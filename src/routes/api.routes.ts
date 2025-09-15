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

  const DEBIT_KEYWORDS = [
    'spent',
    'debited',
    'purchase',
    'payment',
    'sent to',
    'charged',
    'withdrawn',
    'paid',
  ];
  const CREDIT_KEYWORDS = [
    'credited',
    'received from',
    'deposited',
    'refund',
    'received',
    'added',
  ];
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
    'outstanding',
    'unpaid',
    'overdue',
  ];

  const amountRegex = /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i;
  const failedRegex = /\b(failed|reversed|unsuccessful|declined)\b/i;

  // --- THIS IS THE FIX: New, more specific regex for card types ---
  const creditCardRegex = /\bcredit card\b/i;
  const debitCardRegex = /\bdebit card\b/i;
  // We no longer need the generic 'card', 'upi', or 'bank' regexes for this logic.
  // --- END FIX ---

  for (const sms of smsList) {
    const originalBody = sms['@_body'] || '';
    const lcBody = originalBody.replace(/\s+/g, ' ').trim().toLowerCase();
    const smsDate = sms['@_date'];

    if (!lcBody || !smsDate) continue;

    if (REJECTION_KEYWORDS.some((keyword) => lcBody.includes(keyword))) {
      continue;
    }

    const amountMatch = lcBody.match(amountRegex);
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (isNaN(amount) || amount === 0) continue;

    let type: 'credit' | 'debit' | null = null;
    const isFailed = failedRegex.test(lcBody);

    if (CREDIT_KEYWORDS.some((keyword) => lcBody.includes(keyword))) {
      type = 'credit';
    } else if (DEBIT_KEYWORDS.some((keyword) => lcBody.includes(keyword))) {
      type = 'debit';
    }

    if (!type) continue;

    // --- THIS IS THE FIX: Simplified and more accurate mode identification ---
    let mode = 'Other'; // Default to 'Other'
    if (creditCardRegex.test(lcBody)) {
      mode = 'Credit Card';
    } else if (debitCardRegex.test(lcBody)) {
      mode = 'Debit Card';
    }
    // --- END FIX ---

    transactions.push({
      smsId: smsDate,
      date: new Date(parseInt(smsDate)),
      body: originalBody,
      amount,
      type,
      mode, // This will now be 'Credit Card', 'Debit Card', or 'Other'
      source,
      status: isFailed ? 'failed' : 'success',
    });
  }
  return transactions;
}

function mergeDuplicateTransactions(transactions: any[]) {
  if (transactions.length < 2) {
    return transactions;
  }

  // Sort transactions by date to make finding neighbors easy
  const sorted = transactions.sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
  const merged: any[] = [];
  const discardedIndexes = new Set<number>();

  const TIME_WINDOW_MS = 10 * 60 * 1000; // 10-minute window for duplicate checks

  for (let i = 0; i < sorted.length; i++) {
    if (discardedIndexes.has(i)) {
      continue; // Skip this one if it has already been merged
    }

    let currentTx = sorted[i];

    // Look for duplicates in the near future
    for (let j = i + 1; j < sorted.length; j++) {
      if (discardedIndexes.has(j)) {
        continue;
      }

      const nextTx = sorted[j];

      // If the next transaction is outside our time window, stop searching for this group
      if (nextTx.date.getTime() - currentTx.date.getTime() > TIME_WINDOW_MS) {
        break;
      }

      // Check for a duplicate: same amount, same type, within the time window
      if (
        nextTx.amount === currentTx.amount &&
        nextTx.type === currentTx.type
      ) {
        // --- MERGE LOGIC ---
        // Let's decide which SMS body is "better" (more informative).
        // A simple rule: the longer one is often better.
        // A more complex rule could prioritize messages with "A/c" or "Card".
        if (nextTx.body.length > currentTx.body.length) {
          currentTx = { ...nextTx, smsId: currentTx.smsId }; // Keep the earlier smsId for stability
        }
        discardedIndexes.add(j); // Mark the other transaction to be discarded
      }
    }
    merged.push(currentTx);
  }

  return merged;
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
        return res.status(200).json({
          // Changed from 404 to 200
          message: `No SMS backup file found in folder '${source}'.`,
          status: 'no_file', // Add a status for clearer client-side handling
        });
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

      const uniqueTransactions = mergeDuplicateTransactions(rawTransactions);

      // **CHANGE**: Auto-categorization is removed. We only apply source mapping.
      const finalTransactions = uniqueTransactions.map((tx) => {
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
      const { amount, type, date, description, mode, source, subcategoryId } =
        req.body;

      if (!amount || !type || !date || !mode || !source) {
        return res.status(400).json({ message: 'Missing required fields.' });
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
      // Validate the new field name
      if (subcategoryId && !Types.ObjectId.isValid(subcategoryId)) {
        return res
          .status(400)
          .json({ message: 'Invalid subcategory ID format.' });
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
        subcategoryId: subcategoryId || null,
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
/**
 * GET /api/transactions
 * A protected route to fetch transactions for the logged-in user.
 * Supports filtering by source, pagination, and grouping by week or month.
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
        from,
        to,
      } = req.query as { [key: string]: string };

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      // Base filter for all queries, ensuring user only gets their own data.
      const matchFilter: any = { userId: new Types.ObjectId(userId) };
      if (source && source.toLowerCase() !== 'all') {
        matchFilter.source = new RegExp(`^${source}$`, 'i');
      }

      if (from && to && groupBy === 'none') {
        const startDate = new Date(from);
        startDate.setUTCHours(0, 0, 0, 0); // Start of the day

        const endDate = new Date(to);
        endDate.setUTCHours(23, 59, 59, 999); // End of the day

        matchFilter.date = { $gte: startDate, $lte: endDate };
      }

      // --- Handle the 'none' groupBy case (simple list) separately for clarity ---
      if (groupBy === 'none') {
        const [transactions, totalTransactions] = await Promise.all([
          TransactionModel.find(matchFilter)
            .populate('subcategoryId', 'name icon color')
            .sort({ date: -1 })
            .skip(skip)
            .limit(limitNum),
          TransactionModel.countDocuments(matchFilter),
        ]);

        return res.status(200).json({
          type: 'list',
          data: transactions,
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalTransactions / limitNum),
            totalItems: totalTransactions,
          },
        });
      }

      // --- AGGREGATION PIPELINE for 'week' and 'month' grouping ---
      let aggregationPipeline: any[] = [];

      // 1. Start by matching the user and source filter
      aggregationPipeline.push({ $match: matchFilter });

      // 2. Sort all transactions by date descending BEFORE grouping
      aggregationPipeline.push({ $sort: { date: -1 } });

      // 3. Define the key for grouping based on the 'groupBy' parameter
      let groupKey: any;
      if (groupBy === 'month') {
        groupKey = { $dateToString: { format: '%Y-%m', date: '$date' } };
      } else {
        // 'week'
        groupKey = {
          $dateTrunc: { date: '$date', unit: 'week', startOfWeek: 'sunday' },
        };
      }

      // 4. A single, unified grouping stage
      aggregationPipeline.push({
        $group: {
          _id: groupKey,
          transactions: { $push: '$$ROOT' }, // $$ROOT pushes the entire document
          totalCredit: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
        },
      });

      // 5. Sort the final groups in descending chronological order
      aggregationPipeline.push({ $sort: { _id: -1 } });

      // 6. Use a $facet stage to perform pagination and total count in one go
      aggregationPipeline.push({
        $facet: {
          metadata: [{ $count: 'totalGroups' }],
          data: [{ $skip: skip }, { $limit: limitNum }],
        },
      });

      // Execute the full pipeline
      const result = await TransactionModel.aggregate(aggregationPipeline);

      const groupedData = result[0].data;
      const totalGroups = result[0].metadata[0]?.totalGroups || 0;

      // --- THE FIX ---
      // 7. After aggregation, populate the nested 'categoryId' in the results.
      // This is the most reliable way to handle population on aggregated data.
      if (groupedData.length > 0) {
        await TransactionModel.populate(groupedData, {
          path: 'transactions.subcategoryId',
          model: 'Category', // Explicitly tell Mongoose which model to use for the lookup
          select: 'name icon color',
        });
      }

      res.status(200).json({
        type: 'grouped',
        data: groupedData.map(
          (g: {
            _id: any;
            totalCredit: any;
            totalDebit: any;
            transactions: any;
          }) => ({
            period: g._id,
            totalCredit: g.totalCredit,
            totalDebit: g.totalDebit,
            transactions: g.transactions, // This data is now correctly populated
          })
        ),
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
      const { subcategoryId } = req.body; // Can be a valid ID string or null
      const userId = req.auth!.sub;

      if (!Types.ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ message: 'Invalid transaction ID format.' });
      }
      if (subcategoryId && !Types.ObjectId.isValid(subcategoryId)) {
        return res.status(400).json({ message: 'Invalid category ID format.' });
      }

      const updateOperation = subcategoryId
        ? { $set: { subcategoryId: subcategoryId } }
        : { $unset: { subcategoryId: '' } };

      const updatedTransaction = await TransactionModel.findOneAndUpdate(
        { _id: id, userId: userId },
        updateOperation,
        { new: true }
      ).populate('subcategoryId', 'name icon color');

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
