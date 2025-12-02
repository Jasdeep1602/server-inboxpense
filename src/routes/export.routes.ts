import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import TransactionModel from '../models/transaction.model';
import { Parser } from 'json2csv';
import { Types, PipelineStage } from 'mongoose';

const router = Router();
router.use(authMiddleware);

const formatTime = (date: Date): string => {
  const d = new Date(date);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const getCsvData = async (queryFilter: any) => {
  const aggregationPipeline: PipelineStage[] = [
    { $match: queryFilter },
    { $sort: { date: -1 } },
    {
      $lookup: {
        from: 'categories',
        localField: 'subcategoryId',
        foreignField: '_id',
        as: 'subcategory',
      },
    },
    {
      $unwind: {
        path: '$subcategory',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'subcategory.parentId',
        foreignField: '_id',
        as: 'parentCategory',
      },
    },
    {
      $unwind: {
        path: '$parentCategory',
        preserveNullAndEmptyArrays: true,
      },
    },
  ];

  return TransactionModel.aggregate(aggregationPipeline);
};

router.get('/csv-range', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { source, from, to } = req.query as {
      source?: string;
      from?: string;
      to?: string;
    };

    if (!from || !to) {
      return res
        .status(400)
        .json({ message: 'Start and end dates are required.' });
    }

    const queryFilter: any = { userId: new Types.ObjectId(userId) };

    if (source && source.toLowerCase() !== 'all') {
      queryFilter.source = new RegExp(`^${source}$`, 'i');
    }

    const startDate = new Date(from);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(to);
    endDate.setUTCHours(23, 59, 59, 999);

    queryFilter.date = { $gte: startDate, $lte: endDate };

    const transactions = await getCsvData(queryFilter);

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

    const formattedData = transactions.map((tx: any) => {
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
        Group: tx.parentCategory?.group || '',
        Category: tx.parentCategory?.name || '',
        Subcategory: tx.subcategory?.name || 'Uncategorized',
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
      'Group',
      'Category',
      'Subcategory',
      'Description',
      'Profile',
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formattedData);

    const fileName = `transactions-${source || 'all'}-${from}-to-${to}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    res.status(200).send(csv);
  } catch (error) {
    console.error('Error generating date range CSV export:', error);
    res.status(500).json({ message: 'Failed to generate CSV file.' });
  }
});

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

    const transactions = await getCsvData(queryFilter);

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

    const formattedData = transactions.map((tx: any) => {
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
        Group: tx.parentCategory?.group || '',
        Category: tx.parentCategory?.name || 'Uncategorized',
        Subcategory: tx.subcategory?.name || '',
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
      'Group',
      'Category',
      'Subcategory',
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
