import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { google } from 'googleapis';
import { XMLParser } from 'fast-xml-parser';
import { Types } from 'mongoose';
import UserModel from '../models/user.model';
import TransactionModel from '../models/transaction.model';
import SourceMappingModel from '../models/sourceMapping.model';

const router = Router();

/**
 * Extracts raw transaction data from a list of SMS objects.
 */
function extractTransactionsFromSMS(smsList: any[], source: string) {
  const transactions = [];
  const DEBIT_KEYWORDS = [
    'debited for',
    'spent on',
    'purchase of',
    'payment of',
    'sent to',
    'charged on',
    'withdrawn',
  ];
  const CREDIT_KEYWORDS = [
    'credited with',
    'credited for',
    'received from',
    'deposited',
    'refund of',
  ];
  const REJECTION_KEYWORDS = [
    'offer',
    'earn',
    'save up to',
    'congratulations',
    'deal',
    'discount',
    'cashback up to',
  ];
  const amountRegex = /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i;
  const upiIdRegex = /\b[\w.-]+@[\w.-]+\b/i;
  const cardRegex = /\b(?:Card\s+\*\*\d{4}|credit card|debit card)\b/i;
  const bankRegex = /\b(?:A\/c\s+\w+|A\/c\s+XX\d+|account\s+number)\b/i;
  const failedRegex = /\b(failed|reversed|refund(?:ed)?|unsuccessful)\b/i;
  const upiAppPatterns: { [key: string]: RegExp } = {
    GPay: /\b(Google Pay|GPay)\b/i,
    PhonePe: /\b(PhonePe)\b/i,
    Paytm: /\b(Paytm)\b/i,
  };

  for (const sms of smsList) {
    const originalBody = sms['@_body'] || '';
    const body = originalBody.replace(/\s+/g, ' ').trim().toLowerCase();
    const smsDate = sms['@_date'];
    if (!body || !smsDate) continue;

    if (REJECTION_KEYWORDS.some((keyword) => body.includes(keyword))) {
      continue;
    }

    const amountMatch = body.match(amountRegex);
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (isNaN(amount)) continue;

    let type: 'credit' | 'debit' | null = null;
    if (DEBIT_KEYWORDS.some((keyword) => body.includes(keyword))) {
      type = 'debit';
    } else if (CREDIT_KEYWORDS.some((keyword) => body.includes(keyword))) {
      type = 'credit';
    }
    if (!type) continue;

    let mode = 'UPI';
    for (const [app, pattern] of Object.entries(upiAppPatterns)) {
      if (pattern.test(body)) {
        mode = app;
        break;
      }
    }
    if (mode === 'UPI' && upiIdRegex.test(body)) {
    } else if (mode === 'UPI') {
      if (cardRegex.test(body)) mode = 'Card';
      else if (bankRegex.test(body)) mode = 'Bank';
      else mode = 'Other';
    }

    transactions.push({
      smsId: smsDate,
      date: new Date(parseInt(smsDate)),
      body: originalBody,
      amount,
      type,
      mode,
      source, // This is the initial source (e.g., 'Mom', 'Dad')
      status: failedRegex.test(body) ? 'failed' : 'success',
    });
  }
  return transactions;
}

/**
 * POST /api/sync/drive
 * Protected route to sync data, now with source mapping logic.
 */
router.post(
  '/sync/drive',
  authMiddleware,
  async (req: Request, res: Response) => {
    const { source } = req.body;
    const userId = req.auth!.sub;

    if (!source) {
      return res
        .status(400)
        .json({ message: 'Source folder name is required.' });
    }

    try {
      const user = await UserModel.findById(userId);
      if (!user || !user.googleRefreshToken) {
        return res
          .status(401)
          .json({
            message: 'User not found or Google refresh token is missing.',
          });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
      );
      oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      const folderRes = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${source}' and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
      });
      const folderId = folderRes.data.files?.[0]?.id;
      if (!folderId) {
        return res
          .status(404)
          .json({ message: `Folder '${source}' not found in Google Drive.` });
      }

      const fileRes = await drive.files.list({
        q: `'${folderId}' in parents and name contains 'sms-' and name contains '.xml'`,
        orderBy: 'name desc',
        pageSize: 1,
        fields: 'files(id, name)',
      });
      const latestFile = fileRes.data.files?.[0];
      if (!latestFile || !latestFile.id) {
        return res
          .status(404)
          .json({ message: `No SMS backup file found in folder '${source}'.` });
      }

      const fileContentRes = await drive.files.get({
        fileId: latestFile.id,
        alt: 'media',
      });
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
      });
      const parsedXml = parser.parse(fileContentRes.data as string);
      const smsList = parsedXml?.smses?.sms || [];

      // --- SOURCE MAPPING LOGIC ---
      // 1. Fetch the user's mapping rules from the database.
      const userMappings = await SourceMappingModel.find({ userId });

      // 2. Extract transactions with the initial source ('Me', 'Mom', 'Dad').
      const rawTransactions = extractTransactionsFromSMS(smsList, source);

      // 3. Apply the mapping rules to each transaction.
      const mappedTransactions = rawTransactions.map((tx) => {
        const matchingRule = userMappings.find((rule) =>
          rule.matchStrings.some((str) =>
            tx.body.toLowerCase().includes(str.toLowerCase())
          )
        );
        if (matchingRule) {
          // If a rule matches, override the transaction's 'mode' with the clean mapping name.
          // We change 'mode' instead of 'source' so we can still filter by 'Me', 'Mom', 'Dad'.
          return { ...tx, mode: matchingRule.mappingName };
        }
        return tx;
      });
      // --- END SOURCE MAPPING LOGIC ---

      if (mappedTransactions.length === 0) {
        return res.json({
          message: `Sync complete. No valid transactions found in file '${latestFile.name}'.`,
        });
      }

      const operations = mappedTransactions.map((tx) => ({
        updateOne: {
          filter: { userId, smsId: tx.smsId }, // We use smsId for uniqueness across all sources
          update: { $set: { ...tx, userId } },
          upsert: true,
        },
      }));
      const result = await TransactionModel.bulkWrite(operations);

      res.status(200).json({
        message: `Sync complete for '${source}'.`,
        fileName: latestFile.name,
        totalFound: mappedTransactions.length,
        newlyAdded: result.upsertedCount,
        modified: result.modifiedCount,
      });
    } catch (error: any) {
      console.error('Drive Sync Error:', error);
      if (error.response?.data?.error === 'invalid_grant') {
        return res
          .status(401)
          .json({
            message:
              'Authentication error with Google. Please re-authenticate.',
          });
      }
      res
        .status(500)
        .json({ message: 'An internal server error occurred during sync.' });
    }
  }
);

/**
 * GET /api/transactions
 * Fetches paginated and filtered transactions for the logged-in user.
 */
router.get(
  '/transactions',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.sub;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const queryFilter: { userId: any; source?: any } = { userId: userId };
      const source = req.query.source as string;

      if (source && source.toLowerCase() !== 'all') {
        queryFilter.source = new RegExp(`^${source}$`, 'i');
      }

      const transactions = await TransactionModel.find(queryFilter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit);
      const totalTransactions = await TransactionModel.countDocuments(
        queryFilter
      );
      const totalPages = Math.ceil(totalTransactions / limit);

      res.status(200).json({
        data: transactions,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: totalTransactions,
        },
      });
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ message: 'Failed to fetch transactions.' });
    }
  }
);

/**
 * PATCH /api/transactions/:id
 * Updates a single transaction's description.
 */
router.patch(
  '/transactions/:id',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { description } = req.body;
      const userId = req.auth!.sub;

      if (!Types.ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ message: 'Invalid transaction ID format.' });
      }
      if (typeof description !== 'string') {
        return res
          .status(400)
          .json({ message: 'A valid description string is required.' });
      }

      const updatedTransaction = await TransactionModel.findOneAndUpdate(
        { _id: id, userId: userId },
        { description: description },
        { new: true }
      );

      if (!updatedTransaction) {
        return res
          .status(404)
          .json({
            message:
              'Transaction not found or you do not have permission to edit it.',
          });
      }
      res.status(200).json(updatedTransaction);
    } catch (error) {
      console.error('Error updating transaction:', error);
      res.status(500).json({ message: 'Failed to update transaction.' });
    }
  }
);

export default router;
