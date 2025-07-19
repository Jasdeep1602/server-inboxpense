import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { google } from 'googleapis';
import { XMLParser } from 'fast-xml-parser';
import { Types } from 'mongoose';
import UserModel from '../models/user.model';
import TransactionModel from '../models/transaction.model';

const router = Router();

/**
 * Extracts transaction data from a list of SMS objects.
 */
function extractTransactionsFromSMS(smsList: any[], source: string) {
  const transactions = [];

  // --- THE NEW, LAYERED REGEX APPROACH ---

  // Regex 1: High Confidence. Looks for a number directly adjacent to a currency symbol.
  // It handles both "Rs 500" and "500 INR".
  const currencyFirstRegex = /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i;
  const amountFirstRegex = /([\d,]+\.?\d*)\s*(?:Rs\.?|INR|₹)/i;

  // Regex 2: Fallback. Looks for keywords if the above fails. This is now more constrained.
  const keywordRegex =
    /(?:debited by|credited with|payment of|spent at)\s*(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)/i;

  // --- END NEW REGEX ---

  const upiIdRegex = /\b[\w.-]+@[\w.-]+\b/i;
  const cardRegex = /\b(?:Card\s+\*\*\d{4}|credit card|debit card)\b/i;
  const bankRegex = /\b(?:A\/c\s+\w+|A\/c\s+XX\d+|account\s+number)\b/i;
  const failedRegex = /\b(failed|reversed|refund(?:ed)?|unsuccessful)\b/i;

  const upiAppPatterns: { [key: string]: RegExp } = {
    GPay: /\b(Google Pay|GPay|okgoogle)\b|@okgoogle/i,
    PhonePe: /\b(PhonePe|okphonepe)\b|@ybl/i,
    Paytm: /\b(Paytm|okpaytm)\b|@paytm/i,
  };

  for (const sms of smsList) {
    const body = (sms['@_body'] || '').replace(/\s+/g, ' ').trim();
    const smsDate = sms['@_date'];
    if (!body || !smsDate) continue;

    // --- NEW, LAYERED PARSING LOGIC ---
    let amountMatch = body.match(currencyFirstRegex);
    if (!amountMatch) {
      amountMatch = body.match(amountFirstRegex);
    }
    if (!amountMatch) {
      amountMatch = body.match(keywordRegex);
    }

    if (!amountMatch) continue;

    // The first non-null capture group is our amount.
    const amountStr = amountMatch[1];
    if (!amountStr) continue;

    const amount = parseFloat(amountStr.replace(/,/g, ''));
    // --- END NEW LOGIC ---

    if (isNaN(amount)) continue;

    const type = /credited|received/i.test(body) ? 'credit' : 'debit';
    let mode = 'UPI';
    // ... (rest of the function is the same)
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
      body,
      amount,
      type,
      mode,
      source,
      status: failedRegex.test(body) ? 'failed' : 'success',
    });
  }
  return transactions;
}

/**
 * POST /api/sync/drive
 * Protected route to trigger a sync with Google Drive for a specific profile.
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
        return res.status(401).json({
          message:
            'User not found or Google refresh token is missing. Please re-authenticate.',
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
        q: `'${folderId}' in parents and name contains 'sms-' and name contains '.xml' and trashed = false`,
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
      const transactions = extractTransactionsFromSMS(smsList, source);
      if (transactions.length === 0) {
        return res.json({
          message: `Sync complete. No transactions found in file '${latestFile.name}'.`,
        });
      }

      const operations = transactions.map((tx) => ({
        updateOne: {
          filter: { userId, source: tx.source, smsId: tx.smsId },
          update: { $set: { ...tx, userId } },
          upsert: true,
        },
      }));
      const result = await TransactionModel.bulkWrite(operations);

      res.status(200).json({
        message: `Sync complete for '${source}'.`,
        fileName: latestFile.name,
        totalFound: transactions.length,
        newlyAdded: result.upsertedCount,
        modified: result.modifiedCount,
      });
    } catch (error: any) {
      console.error('Drive Sync Error:', error);
      if (error.response?.data?.error === 'invalid_grant') {
        return res.status(401).json({
          message:
            'Authentication error with Google. The token might be revoked. Please re-authenticate.',
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
 * A protected route to fetch all transactions for the logged-in user.
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

      // 1. Create the base filter object
      const queryFilter: { userId: any; source?: any } = { userId: userId };
      const source = req.query.source as string;

      if (source && source.toLowerCase() !== 'all') {
        // --- ADD THIS LOG ---
        console.log(`>>> FILTERING BY SOURCE: ${source}`);
        // --- END LOG ---
        queryFilter.source = new RegExp(`^${source}$`, 'i');
      }

      // 2. Add the source to the filter if it's provided and not 'All'
      if (source && source.toLowerCase() !== 'all') {
        queryFilter.source = new RegExp(`^${source}$`, 'i');
      }

      console.log('Executing DB query with filter:', queryFilter); // Add this log for confirmation

      // 3. --- THE FIX ---
      //    Use the dynamic `queryFilter` object in both database calls.
      const transactions = await TransactionModel.find(queryFilter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit);

      const totalTransactions = await TransactionModel.countDocuments(
        queryFilter
      );
      // --- END FIX ---

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
 * A protected route to update a single transaction (e.g., its description).
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
        // The filter ensures a user can only update their OWN transaction.
        { _id: id, userId: userId },
        { description: description },
        { new: true } // This option returns the document after the update.
      );

      if (!updatedTransaction) {
        return res.status(404).json({
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
