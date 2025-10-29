import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types, PipelineStage } from 'mongoose';
import TransactionModel from '../models/transaction.model';
import CategoryModel, { CategoryGroup } from '../models/category.model';

const router = Router();
router.use(authMiddleware);

// --- HELPER FUNCTION ---
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
// --- NEW ENDPOINT for Account Performance Chart ---
router.get('/by-account', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { period = '6m' } = req.query as { [key: string]: string };

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      // Exclude generic, unmapped transactions from this summary
      mode: { $nin: ['Other', 'Credit Card', 'Debit Card'] },
    };

    const dateRange = getDateRange(period);
    if (dateRange) {
      matchFilter.date = dateRange;
    }

    const aggregationPipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: '$mode', // Group by the account name
          totalCredit: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          account: '$_id',
          totalCredit: 1,
          totalDebit: 1,
        },
      },
      { $sort: { totalDebit: -1 } }, // Sort by highest debit amount
    ];

    const result = await TransactionModel.aggregate(aggregationPipeline);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching summary by account:', error);
    res.status(500).json({ message: 'Failed to fetch account summary data.' });
  }
});

// --- CURRENT MONTH OVERVIEW ENDPOINT ---
router.get('/current-month-overview', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { source = 'All' } = req.query as { [key: string]: string };
    const userObjectId = new Types.ObjectId(userId);

    const matchFilter: any = {
      userId: userObjectId,
      date: getDateRange('current'),
    };
    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

    const aggregation: PipelineStage[] = [
      { $match: matchFilter },
      {
        $lookup: {
          from: 'categories',
          localField: 'subcategoryId',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category.group',
          credits: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          debits: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
        },
      },
    ];

    const result = await TransactionModel.aggregate(aggregation);

    let totalBudget = 0;
    let totalExpenses = 0;
    let totalInvestments = 0;

    result.forEach((group) => {
      if (group._id === CategoryGroup.BUDGET) {
        totalBudget = group.credits - group.debits;
      } else if (group._id === CategoryGroup.EXPENSE) {
        totalExpenses = group.debits;
      } else if (group._id === CategoryGroup.INVESTMENT) {
        totalInvestments = group.debits;
      }
    });

    res.status(200).json({
      totalBudget,
      totalExpenses,
      totalInvestments,
    });
  } catch (error) {
    console.error('Error fetching current month overview:', error);
    res.status(500).json({ message: 'Failed to fetch overview data.' });
  }
});

/**
 * GET /api/summary/spending-by-category
 */
router.get('/spending-by-category', async (req: Request, res: Response) => {
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
      type: 'debit',
      subcategoryId: { $exists: true, $ne: null },
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
      { $match: { 'subcategory.group': { $ne: 'IGNORED' } } },
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
        $lookup: {
          from: 'categories',
          localField: 'subcategoryId',
          foreignField: '_id',
          as: 'categoryInfo',
        },
      },
      {
        $match: {
          $or: [
            { subcategoryId: { $exists: false } },
            { 'categoryInfo.group': { $ne: 'IGNORED' } },
          ],
        },
      },
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

    const subcategories = await CategoryModel.find({
      parentId: new Types.ObjectId(parentId),
      userId: new Types.ObjectId(userId),
    });
    const subcategoryIds = subcategories.map((sub) => sub._id);

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      type: 'debit',
      subcategoryId: { $in: subcategoryIds },
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
        $group: {
          _id: '$subcategoryId',
          total: { $sum: '$amount' },
        },
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'subcategoryDetails',
        },
      },
      { $unwind: '$subcategoryDetails' },
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
