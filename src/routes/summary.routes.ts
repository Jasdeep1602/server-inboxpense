import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types, PipelineStage } from 'mongoose';
import TransactionModel from '../models/transaction.model';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/summary/spending-by-category
 */
router.get('/spending-by-category', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const source = req.query.source as string;

    // Get the period from the query, default to '6m' (6 months)
    const period = (req.query.period as string) || '6m';

    // Base filter object
    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      type: 'debit',
      categoryId: { $exists: true, $ne: null },
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

    // Dynamically set the date filter based on the 'period' parameter
    if (period !== 'all') {
      const now = new Date();
      let startDate: Date;
      if (period === '30d') {
        startDate = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - 30
          )
        );
      } else if (period === '3m') {
        startDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)
        );
      } else {
        // Default to 6m
        startDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)
        );
      }
      matchFilter.date = { $gte: startDate };
    }

    // --- END FIX ---

    const aggregationPipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: '%Y-%m', date: '$date' } },
            categoryId: '$categoryId',
          },
          totalAmount: { $sum: '$amount' },
        },
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id.categoryId',
          foreignField: '_id',
          as: 'categoryDetails',
        },
      },
      { $unwind: '$categoryDetails' },
      {
        $project: {
          _id: 0,
          month: '$_id.month',
          name: '$categoryDetails.name',
          color: '$categoryDetails.color',
          total: '$totalAmount',
        },
      },
      {
        $group: {
          _id: '$month',
          categories: {
            $push: { name: '$name', color: '$color', total: '$total' },
          },
          monthlyTotal: { $sum: '$total' },
        },
      },
      {
        $project: {
          _id: 0,
          month: '$_id',
          categories: 1,
          monthlyTotal: 1,
        },
      },
      { $sort: { month: 1 } },
    ];

    const result = await TransactionModel.aggregate(aggregationPipeline);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching category spending summary:', error);
    res.status(500).json({ message: 'Failed to fetch summary data.' });
  }
});

/**
 * GET /api/summary/monthly
 */
router.get('/monthly', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const monthsToQuery = parseInt(req.query.months as string) || 6;
    const source = req.query.source as string;
    const now = new Date();
    const startDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsToQuery - 1), 1)
    );

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      date: { $gte: startDate },
    };
    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

    const aggregationPipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          totalCredit: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          month: '$_id',
          totalCredit: 1,
          totalDebit: 1,
        },
      },
    ];

    const result = await TransactionModel.aggregate(aggregationPipeline);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching monthly summary:', error);
    res.status(500).json({ message: 'Failed to fetch monthly summary data.' });
  }
});

export default router;
