import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types, PipelineStage } from 'mongoose';
import TransactionModel from '../models/transaction.model';
import CategoryModel, { CategoryGroup } from '../models/category.model';

const router = Router();
router.use(authMiddleware);

// --- UPDATED HELPER FUNCTION ---
const getMonthDateRange = (month: string) => {
  // Expects month in "YYYY-MM" format
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    // Default to current month if format is invalid
    const now = new Date();
    const startDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const endDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    return { $gte: startDate, $lt: endDate };
  }

  const [year, monthNum] = month.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
  const endDate = new Date(Date.UTC(year, monthNum, 1));
  return { $gte: startDate, $lt: endDate };
};

// --- NEW ENDPOINT for Account Performance Chart ---
router.get('/by-account', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { month } = req.query as { [key: string]: string };

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      // --- THIS IS THE FIX ---
      // We only care about debit transactions for this chart
      type: 'debit',
      // Exclude generic, unmapped transactions from this summary
      mode: { $nin: ['Other', 'Credit Card', 'Debit Card'] },
      date: getMonthDateRange(month as string),
    };

    const aggregationPipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: '$mode', // Group by the account name
          totalDebit: { $sum: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          account: '$_id',
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
    const { source = 'All', month } = req.query as { [key: string]: string };
    const userObjectId = new Types.ObjectId(userId);

    const matchFilter: any = {
      userId: userObjectId,
      date: getMonthDateRange(month as string),
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
    const { source = 'All', month } = req.query as {
      [key: string]: string;
    };

    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      type: 'debit',
      subcategoryId: { $exists: true, $ne: null },
      date: getMonthDateRange(month as string),
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
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
 * GET /api/summary/subcategory-breakdown
 */
router.get('/subcategory-breakdown', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const {
      source = 'All',
      month,
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
      date: getMonthDateRange(month as string),
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
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
