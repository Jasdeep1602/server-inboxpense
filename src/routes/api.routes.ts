import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { google } from 'googleapis';
import { XMLParser } from 'fast-xml-parser';
import { Types } from 'mongoose';
import UserModel from '../models/user.model';
import TransactionModel from '../models/transaction.model';
import SourceMappingModel from '../models/sourceMapping.model';
import CategoryModel from '../models/category.model';

const router = Router();

/**
 * Extracts and intelligently parses transaction data from a list of SMS objects.
 */
function extractTransactionsFromSMS(smsList: any[], source: string) {
  const transactions = [];

  // --- Keyword Lists for Accurate Parsing ---
  const DEBIT_KEYWORDS = [
    'debited for',
    'spent on',
    'purchase of',
    'payment of',
    'sent to',
    'charged on',
    'withdrawn',
    'debited by',
    'payment made',
  ];
  const CREDIT_KEYWORDS = [
    'credited with',
    'credited for',
    'received from',
    'deposited',
    'refund of',
    'credited by',
  ];
  // Keywords that automatically REJECT a message to reduce noise
  const REJECTION_KEYWORDS = [
    'offer',
    'earn',
    'save up to',
    'congratulations',
    'deal',
    'discount',
    'cashback',
    'reward',
    'statement',
    'due on',
    'e-statement',
  ];

  // High-confidence regex that requires a currency symbol
  const amountRegex = /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i;

  // Other regexes for identifying the transaction mode
  const upiIdRegex = /\b[\w.-]+@[\w.-]+\b/i;
  const cardRegex = /\b(?:card|credit card|debit card)\s.*?(?:\*|x)\d{4}/i;
  const bankRegex = /\b(?:A\/c|account)\s.*?(?:\*|x)\d{4}/i;
  const failedRegex = /\b(failed|reversed|refund|unsuccessful|declined)\b/i;

  const upiAppPatterns: { [key: string]: RegExp } = {
    GPay: /\b(Google Pay|GPay)\b/i,
    PhonePe: /\b(PhonePe)\b/i,
    Paytm: /\b(Paytm)\b/i,
  };

  for (const sms of smsList) {
    const originalBody = sms['@_body'] || '';
    // Use a lowercase version for keyword matching, but store the original
    const lcBody = originalBody.replace(/\s+/g, ' ').trim().toLowerCase();
    const smsDate = sms['@_date'];

    if (!lcBody || !smsDate) continue;

    // --- Step 1: Noise Rejection ---
    // If the message contains a word from our rejection list, skip it immediately.
    if (REJECTION_KEYWORDS.some((keyword) => lcBody.includes(keyword))) {
      continue;
    }

    // --- Step 2: Amount Parsing ---
    // If we can't find a clear amount with a currency symbol, it's likely not a transaction.
    const amountMatch = lcBody.match(amountRegex);
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (isNaN(amount)) continue;

    // --- Step 3: Correct Debit/Credit Identification ---
    // This logic now correctly prioritizes debit keywords.
    let type: 'credit' | 'debit' | null = null;

    if (DEBIT_KEYWORDS.some((keyword) => lcBody.includes(keyword))) {
      type = 'debit';
    } else if (CREDIT_KEYWORDS.some((keyword) => lcBody.includes(keyword))) {
      type = 'credit';
    }

    // If we still can't determine a clear type, skip the message.
    if (!type) continue;

    // --- Step 4: Mode Identification ---
    let mode = 'Other'; // Default to 'Other' for safety
    if (
      upiIdRegex.test(lcBody) ||
      upiAppPatterns.GPay.test(lcBody) ||
      upiAppPatterns.PhonePe.test(lcBody) ||
      upiAppPatterns.Paytm.test(lcBody)
    ) {
      mode = 'UPI';
    } else if (cardRegex.test(lcBody)) {
      mode = 'Card';
    } else if (bankRegex.test(lcBody)) {
      mode = 'Bank';
    }

    transactions.push({
      smsId: smsDate,
      date: new Date(parseInt(smsDate)),
      body: originalBody, // Store the original, case-sensitive body
      amount,
      type, // This will now be the correct type
      mode,
      source,
      status: failedRegex.test(lcBody) ? 'failed' : 'success',
    });
  }
  return transactions;
}
/**
 * POST /api/sync/drive
 * Protected route to sync data, now only applying source mapping.
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

      const userMappings = await SourceMappingModel.find({ userId });
      const rawTransactions = extractTransactionsFromSMS(smsList, source);

      // **CHANGE**: Auto-categorization is removed. We only apply source mapping.
      const finalTransactions = rawTransactions.map((tx) => {
        const matchingRule = userMappings.find((rule) =>
          rule.matchStrings.some((str) =>
            tx.body.toLowerCase().includes(str.toLowerCase())
          )
        );
        if (matchingRule) {
          return { ...tx, mode: matchingRule.mappingName };
        }
        return tx;
      });

      if (finalTransactions.length === 0) {
        return res.json({
          message: `Sync complete. No valid transactions found in file '${latestFile.name}'.`,
        });
      }

      const operations = finalTransactions.map((tx) => ({
        updateOne: {
          filter: { userId, smsId: tx.smsId },
          // The $setOnInsert operator ensures categoryId is only set for new documents if it's not already there.
          // We will remove it here, as we are not setting it during sync anymore.
          update: { $set: { ...tx, userId } },
          upsert: true,
        },
      }));
      const result = await TransactionModel.bulkWrite(operations);

      res.status(200).json({
        message: `Sync complete for '${source}'.`,
        fileName: latestFile.name,
        totalFound: finalTransactions.length,
        newlyAdded: result.upsertedCount,
        modified: result.modifiedCount,
      });
    } catch (error: any) {
      console.error('Drive Sync Error:', error);
      if (error.response?.data?.error === 'invalid_grant') {
        return res.status(401).json({
          message: 'Authentication error with Google. Please re-authenticate.',
        });
      }
      res
        .status(500)
        .json({ message: 'An internal server error occurred during sync.' });
    }
  }
);

/**
 * POST /api/transactions
 * A protected route to create a single, manual transaction.
 */
router.post(
  '/transactions',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.sub;
      const { amount, type, date, description, mode, source, categoryId } =
        req.body;

      // --- Data Validation ---
      if (!amount || !type || !date || !mode || !source) {
        return res.status(400).json({
          message:
            'Missing required fields: amount, type, date, mode, and source are required.',
        });
      }
      if (typeof amount !== 'number' || amount <= 0) {
        return res
          .status(400)
          .json({ message: 'Amount must be a positive number.' });
      }
      if (type !== 'debit' && type !== 'credit') {
        return res
          .status(400)
          .json({ message: 'Type must be either "debit" or "credit".' });
      }
      if (categoryId && !Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: 'Invalid category ID format.' });
      }
      // --- End Validation ---

      // Create a unique "smsId" for manual transactions to maintain schema consistency.
      // We can use a timestamp combined with a random string.
      const manualSmsId = `manual_${new Date().getTime()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`;

      const newTransaction = await TransactionModel.create({
        userId,
        smsId: manualSmsId,
        body:
          description ||
          `Manual Entry on ${new Date(date).toLocaleDateString()}`,
        amount,
        type,
        date: new Date(date),
        description,
        mode,
        source,
        categoryId: categoryId || null,
        status: 'success', // Manual entries are always successful
      });

      res.status(201).json(newTransaction);
    } catch (error) {
      console.error('Error creating manual transaction:', error);
      res.status(500).json({ message: 'Failed to create transaction.' });
    }
  }
);

/**
 * GET /api/transactions
 */
router.get(
  '/transactions',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.sub;
      const {
        page = '1',
        limit = '10',
        source = 'All',
        groupBy = 'none',
      } = req.query as { [key: string]: string };

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      // --- AGGREGATION PIPELINE ---
      const matchStage: any = { userId: new Types.ObjectId(userId) };
      if (source && source.toLowerCase() !== 'all') {
        matchStage.source = new RegExp(`^${source}$`, 'i');
      }

      let aggregationPipeline: any[] = [{ $match: matchStage }];

      if (groupBy === 'none') {
        // Standard paginated find if not grouping
        const transactions = await TransactionModel.find(matchStage)
          .populate('categoryId', 'name icon color')
          .sort({ date: -1 })
          .skip(skip)
          .limit(limitNum);
        const totalTransactions = await TransactionModel.countDocuments(
          matchStage
        );

        return res.status(200).json({
          type: 'list', // Tell the frontend this is a flat list
          data: transactions,
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalTransactions / limitNum),
            totalItems: totalTransactions,
          },
        });
      }

      // --- GROUPING LOGIC ---
      let groupStage: any;
      if (groupBy === 'month') {
        groupStage = {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          transactions: { $push: '$$ROOT' },
          totalCredit: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
          periodStartDate: { $min: '$date' },
        };
      } else if (groupBy === 'week') {
        groupStage = {
          _id: { $dateToString: { format: '%Y-%U', date: '$date' } }, // %U for week of the year
          transactions: { $push: '$$ROOT' },
          totalCredit: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
          periodStartDate: { $min: '$date' },
        };
      }

      aggregationPipeline.push({ $sort: { date: -1 } });
      aggregationPipeline.push({ $group: groupStage });
      aggregationPipeline.push({ $sort: { periodStartDate: -1 } }); // Sort groups by date

      // We also need to paginate the groups
      const countPipeline = [...aggregationPipeline, { $count: 'totalGroups' }];

      aggregationPipeline.push({ $skip: skip });
      aggregationPipeline.push({ $limit: limitNum });

      // Execute both pipelines
      const [groupedData, totalGroupsResult] = await Promise.all([
        TransactionModel.aggregate(aggregationPipeline),
        TransactionModel.aggregate(countPipeline),
      ]);

      // We need to populate the category data for each transaction inside the groups
      for (const group of groupedData) {
        await TransactionModel.populate(group.transactions, {
          path: 'categoryId',
          select: 'name icon color',
        });
      }

      const totalGroups = totalGroupsResult[0]?.totalGroups || 0;

      res.status(200).json({
        type: 'grouped', // Tell the frontend this is grouped data
        data: groupedData.map((g) => ({
          period: g._id,
          totalCredit: g.totalCredit,
          totalDebit: g.totalDebit,
          transactions: g.transactions,
        })),
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalGroups / limitNum),
          totalItems: totalGroups,
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

/**
 * **NEW ENDPOINT**
 * PATCH /api/transactions/:id/category
 * A protected route to manually assign or unassign a category for a transaction.
 */
router.patch(
  '/transactions/:id/category',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { categoryId } = req.body; // Can be a valid ID string or null
      const userId = req.auth!.sub;

      if (!Types.ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ message: 'Invalid transaction ID format.' });
      }
      if (categoryId && !Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: 'Invalid category ID format.' });
      }

      const updateOperation = categoryId
        ? { $set: { categoryId: categoryId } }
        : { $unset: { categoryId: '' } };

      const updatedTransaction = await TransactionModel.findOneAndUpdate(
        { _id: id, userId: userId },
        updateOperation,
        { new: true }
      ).populate('categoryId', 'name icon color');

      if (!updatedTransaction) {
        return res.status(404).json({
          message: 'Transaction not found or you do not have permission.',
        });
      }

      res.status(200).json(updatedTransaction);
    } catch (error) {
      console.error('Error updating transaction category:', error);
      res
        .status(500)
        .json({ message: 'Failed to update transaction category.' });
    }
  }
);

export default router;
