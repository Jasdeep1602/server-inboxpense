import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import CategoryModel from '../models/category.model';
import TransactionModel from '../models/transaction.model';
import { Types } from 'mongoose';

const router = Router();
router.use(authMiddleware); // Protect all category routes

/**
 * GET /api/categories
 * Fetches all categories for the logged-in user.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const categories = await CategoryModel.find({ userId });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch categories.' });
  }
});

/**
 * POST /api/categories
 * Creates a new category for the logged-in user.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { name, icon, color, matchStrings } = req.body;

    if (!name || !icon) {
      return res
        .status(400)
        .json({ message: 'Category name and icon are required.' });
    }

    // You could also add default categories for new users here

    const newCategory = await CategoryModel.create({
      userId,
      name,
      icon,
      color,
      matchStrings: matchStrings || [],
    });
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create category.' });
  }
});

// We can add DELETE and PATCH endpoints here later if needed

/**
 * DELETE /api/categories/:id
 * Deletes a category and un-assigns it from all associated transactions.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid category ID format.' });
    }

    const categoryToDelete = await CategoryModel.findOne({
      _id: id,
      userId: userId,
    });
    if (!categoryToDelete) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    // --- THIS IS THE NEW RULE ---
    // Check if the category is a default one.
    if (categoryToDelete.isDefault) {
      return res
        .status(403)
        .json({ message: 'Default categories cannot be deleted.' });
    }
    // --- END NEW RULE ---

    // The rest of the logic can proceed only if it's not a default category.
    await TransactionModel.updateMany(
      { userId: userId, categoryId: id },
      { $unset: { categoryId: '' } }
    );
    await CategoryModel.deleteOne({ _id: id, userId: userId });

    res.status(200).json({ message: 'Custom category deleted successfully.' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ message: 'Failed to delete category.' });
  }
});
export default router;
