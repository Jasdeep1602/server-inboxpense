import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types } from 'mongoose';
import SourceMappingModel from '../models/sourceMapping.model';
import TransactionModel from '../models/transaction.model';

const router = Router();

// Protect all routes in this file with the auth middleware
router.use(authMiddleware);

// --- THIS IS THE NEW FUNCTION ---
const remapTransactions = async (userId: string) => {
  const userObjectId = new Types.ObjectId(userId);
  const mappings = await SourceMappingModel.find({ userId: userObjectId });
  const allTransactions = await TransactionModel.find({
    userId: userObjectId,
  });

  const bulkOps = allTransactions.map((tx) => {
    const matchingRule = mappings.find((rule) =>
      rule.matchStrings.some((str) =>
        tx.body.toLowerCase().includes(str.toLowerCase())
      )
    );

    if (matchingRule) {
      // If a rule matches, update the transaction's mode and accountType
      return {
        updateOne: {
          filter: { _id: tx._id },
          update: {
            $set: {
              mode: matchingRule.mappingName,
              accountType: matchingRule.type,
            },
          },
        },
      };
    } else {
      // If no rule matches, revert to a default 'Other' mode and unset the accountType
      return {
        updateOne: {
          filter: { _id: tx._id, smsId: { $not: /manual_.*/ } }, // Avoid reverting manual entries
          update: {
            $set: { mode: 'Other' },
            $unset: { accountType: '' },
          },
        },
      };
    }
  });

  if (bulkOps.length > 0) {
    await TransactionModel.bulkWrite(bulkOps);
  }
};
// --- END NEW FUNCTION ---

/**
 * GET /api/mappings
 * Fetches all source mappings for the logged-in user.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const mappings = await SourceMappingModel.find({ userId });
    res.status(200).json(mappings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch mappings.' });
  }
});

/**
 * POST /api/mappings
 * Creates a new source mapping for the logged-in user.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { mappingName, matchStrings, type } = req.body;

    if (
      !mappingName ||
      !type ||
      !matchStrings ||
      !Array.isArray(matchStrings) ||
      matchStrings.length === 0
    ) {
      return res.status(400).json({
        message:
          'Mapping name, type, and at least one match string are required.',
      });
    }

    const newMapping = await SourceMappingModel.create({
      userId,
      mappingName,
      matchStrings,
      type,
    });

    await remapTransactions(userId); // <-- Re-map after creating

    res.status(201).json(newMapping);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create mapping.' });
  }
});

/**
 * PUT /api/mappings/:id
 * Updates a specific source mapping for the logged-in user.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { id } = req.params;
    const { mappingName, matchStrings, type } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mapping ID format.' });
    }

    if (
      !mappingName ||
      !type ||
      !matchStrings ||
      !Array.isArray(matchStrings) ||
      matchStrings.length === 0
    ) {
      return res
        .status(400)
        .json({ message: 'All fields are required for an update.' });
    }

    const updatedMapping = await SourceMappingModel.findOneAndUpdate(
      { _id: id, userId: userId },
      { mappingName, matchStrings, type },
      { new: true }
    );

    if (!updatedMapping) {
      return res.status(404).json({
        message: 'Mapping not found or you do not have permission to edit it.',
      });
    }

    await remapTransactions(userId); // <-- Re-map after updating

    res.status(200).json(updatedMapping);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update mapping.' });
  }
});

/**
 * DELETE /api/mappings/:id
 * Deletes a specific source mapping for the logged-in user.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mapping ID format.' });
    }

    const result = await SourceMappingModel.deleteOne({
      _id: id,
      userId: userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message:
          'Mapping not found or you do not have permission to delete it.',
      });
    }

    await remapTransactions(userId); // <-- Re-map after deleting

    res.status(200).json({ message: 'Mapping deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete mapping.' });
  }
});

export default router;
