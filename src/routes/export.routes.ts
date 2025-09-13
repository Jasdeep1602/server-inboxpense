import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import TransactionModel from '../models/transaction.model';
import { Parser } from 'json2csv';
import { Types } from 'mongoose';

const router = Router();
router.use(authMiddleware);

const formatTime = (date: Date): string => {
  const d = new Date(date);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

router.get('/csv', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { source, month } = req.query as { source?: string; month?: string };

    const queryFilter: any = { userId: new Types.ObjectId(userId) };

    if (source && source.toLowerCase() !== 'all') {
      queryFilter.source = new RegExp(`^${source}$`, 'i');
    }

    let fileNamePeriod = 'all-time';
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
      const endDate = new Date(Date.UTC(year, monthNum, 1));
      queryFilter.date = { $gte: startDate, $lt: endDate };
      fileNamePeriod = month;
    }

    // --- THIS IS THE FIX ---
    // Change `.populate('categoryId', 'name')` to `.populate('subcategoryId', 'name')`
    const transactions = await TransactionModel.find(queryFilter)
      .populate('subcategoryId', 'name')
      .sort({ date: -1 });
    // --- END FIX ---

    if (transactions.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=transactions-empty.csv`
      );
      return res
        .status(200)
        .send('No transactions found for the selected criteria.');
    }

    const formattedData = transactions.map((tx) => {
      const transactionDate = new Date(tx.date);
      const year = transactionDate.getFullYear();
      const month = transactionDate.getMonth() + 1;
      const day = transactionDate.getDate();

      return {
        Date: `="${year}-${String(month).padStart(2, '0')}-${String(
          day
        ).padStart(2, '0')}"`,
        Time: formatTime(transactionDate),
        Type: tx.type,
        Amount: tx.amount,
        Account: tx.mode,
        // --- THIS IS THE FIX ---
        // Change `tx.categoryId` to `tx.subcategoryId`
        Category: tx.subcategoryId
          ? (tx.subcategoryId as any).name
          : 'Uncategorized',
        // --- END FIX ---
        Description: tx.description || '',
        Profile: tx.source,
      };
    });

    const fields = [
      'Date',
      'Time',
      'Type',
      'Amount',
      'Account',
      'Category',
      'Description',
      'Profile',
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formattedData);

    const fileName = `transactions-${source || 'all'}-${fileNamePeriod}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    res.status(200).send(csv);
  } catch (error) {
    console.error('Error generating CSV export:', error);
    res.status(500).json({ message: 'Failed to generate CSV file.' });
  }
});

export default router;
