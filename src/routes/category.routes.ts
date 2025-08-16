import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import CategoryModel from '../models/category.model';

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

export default router;
