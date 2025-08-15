import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { Types } from 'mongoose';
import SourceMappingModel from '../models/sourceMapping.model';

const router = Router();

// Protect all routes in this file with the auth middleware
router.use(authMiddleware);

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
    const { mappingName, matchStrings } = req.body;

    if (
      !mappingName ||
      !matchStrings ||
      !Array.isArray(matchStrings) ||
      matchStrings.length === 0
    ) {
      return res
        .status(400)
        .json({
          message: 'Mapping name and at least one match string are required.',
        });
    }

    const newMapping = await SourceMappingModel.create({
      userId,
      mappingName,
      matchStrings,
    });
    res.status(201).json(newMapping);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create mapping.' });
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
      return res
        .status(404)
        .json({
          message:
            'Mapping not found or you do not have permission to delete it.',
        });
    }
    res.status(200).json({ message: 'Mapping deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete mapping.' });
  }
});

export default router;
