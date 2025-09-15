import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types, PipelineStage } from 'mongoose';
import TransactionModel from '../models/transaction.model';
import CategoryModel from '../models/category.model';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/summary/spending-by-category
 * --- UPDATED to aggregate by PARENT category ---
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
      subcategoryId: { $exists: true, $ne: null }, // Use the new field name
    };

    if (source && source.toLowerCase() !== 'all') {
      matchFilter.source = new RegExp(`^${source}$`, 'i');
    }

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

    const aggregationPipeline: PipelineStage[] = [
      // 1. Match relevant transactions
      { $match: matchFilter },

      // 2. Lookup the subcategory document for each transaction
      {
        $lookup: {
          from: 'categories',
          localField: 'subcategoryId',
          foreignField: '_id',
          as: 'subcategory',
        },
      },
      { $unwind: '$subcategory' },

      // 3. Lookup the PARENT category document using the parentId from the subcategory
      {
        $lookup: {
          from: 'categories',
          localField: 'subcategory.parentId',
          foreignField: '_id',
          as: 'parentCategory',
        },
      },
      { $unwind: '$parentCategory' },

      // 4. Group by the PARENT category and sum the transaction amounts
      {
        $group: {
          _id: '$parentCategory._id',
          name: { $first: '$parentCategory.name' },
          color: { $first: '$parentCategory.color' },
          total: { $sum: '$amount' },
          // Pass the parentId through for the drill-down feature
          parentId: { $first: '$parentCategory._id' },
        },
      },

      // 5. Project to the final shape for the chart
      {
        $project: {
          _id: 0,
          parentId: 1,
          name: 1,
          color: 1,
          value: '$total', // Rename to 'value' for consistency with the chart
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
 * This endpoint does not depend on categories, so it remains unchanged.
 */
router.get('/monthly', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { source = 'All', months = '6' } = req.query as {
      [key: string]: string;
    };
    const monthsToQuery = parseInt(months);
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
        startDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)
        );
      }
      matchFilter.date = { $gte: startDate };
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
