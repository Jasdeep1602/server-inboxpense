import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types, PipelineStage } from 'mongoose';
import TransactionModel from '../models/transaction.model';
import CategoryModel from '../models/category.model';

const router = Router();
router.use(authMiddleware);

// --- THIS IS THE NEW HELPER FUNCTION ---
const getDateRange = (period: string) => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  switch (period) {
    case 'current': {
      const startDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      );
      return { $gte: startDate };
    }
    case 'lastMonth': {
      const startDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
      );
      const endDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      );
      return { $gte: startDate, $lt: endDate };
    }
    case '3m': {
      const startDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)
      );
      return { $gte: startDate };
    }
    case '6m': {
      const startDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)
      );
      return { $gte: startDate };
    }
    case 'all':
    default:
      return null;
  }
};
// --- END NEW HELPER FUNCTION ---

/**
 * GET /api/summary/spending-by-category
 */
router.get('/spending-by-category', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { source = 'All', period = '6m' } = req.query as {
      [key: string]: string;
    };

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      type: 'debit',
      subcategoryId: { $exists: true, $ne: null },
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

    const dateRange = getDateRange(period);
    if (dateRange) {
      matchFilter.date = dateRange;
    }

    const aggregationPipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $lookup: {
          from: 'categories',
          localField: 'subcategoryId',
          foreignField: '_id',
          as: 'subcategory',
        },
      },
      { $unwind: '$subcategory' },
      {
        $lookup: {
          from: 'categories',
          localField: 'subcategory.parentId',
          foreignField: '_id',
          as: 'parentCategory',
        },
      },
      { $unwind: '$parentCategory' },
      {
        $group: {
          _id: '$parentCategory._id',
          name: { $first: '$parentCategory.name' },
          color: { $first: '$parentCategory.color' },
          total: { $sum: '$amount' },
          parentId: { $first: '$parentCategory._id' },
        },
      },
      {
        $project: {
          _id: 0,
          parentId: 1,
          name: 1,
          color: 1,
          value: '$total',
        },
      },
      { $sort: { value: -1 } },
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
    const {
      source = 'All',
      period = '6m',
      account = 'All',
    } = req.query as {
      [key: string]: string;
    };

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

    if (account && account.toLowerCase() !== 'all') {
      matchFilter.mode = new RegExp(`^${account}$`, 'i');
    }

    const dateRange = getDateRange(period);
    if (dateRange) {
      matchFilter.date = dateRange;
    }

    let groupFormat = '%Y-%m'; // Default to monthly grouping
    if (period === 'current' || period === 'lastMonth') {
      groupFormat = '%Y-%m-%d'; // Switch to daily grouping for shorter periods
    }

    const aggregationPipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: '$date' } },
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
/**
 * GET /api/summary/subcategory-breakdown
 * The new endpoint for the drill-down feature.
 */
router.get('/subcategory-breakdown', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const {
      source = 'All',
      period = '6m',
      parentId,
    } = req.query as { [key: string]: string };

    if (!parentId || !Types.ObjectId.isValid(parentId)) {
      return res.status(400).json({ message: 'A valid parentId is required.' });
    }

    // First, find all subcategories that belong to the given parent
    const subcategories = await CategoryModel.find({
      parentId: new Types.ObjectId(parentId),
      userId: new Types.ObjectId(userId),
    });
    const subcategoryIds = subcategories.map((sub) => sub._id);

    // Now, build the transaction match filter
    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      type: 'debit',
      subcategoryId: { $in: subcategoryIds }, // Match any transaction in our list of subcategories
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

    const dateRange = getDateRange(period);
    if (dateRange) {
      matchFilter.date = dateRange;
    }

    const aggregationPipeline: PipelineStage[] = [
      // 1. Find all transactions that match our criteria
      { $match: matchFilter },

      // 2. Group them by their subcategoryId and sum the amount
      {
        $group: {
          _id: '$subcategoryId',
          total: { $sum: '$amount' },
        },
      },

      // 3. Lookup the details for each of the grouped subcategory IDs
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'subcategoryDetails',
        },
      },
      { $unwind: '$subcategoryDetails' },

      // 4. Project to the final desired shape
      {
        $project: {
          _id: 0,
          name: '$subcategoryDetails.name',
          color: '$subcategoryDetails.color',
          total: 1,
        },
      },
      { $sort: { total: -1 } },
    ];

    const result = await TransactionModel.aggregate(aggregationPipeline);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching subcategory breakdown:', error);
    res.status(500).json({ message: 'Failed to fetch breakdown data.' });
  }
});

export default router;
