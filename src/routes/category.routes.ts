// D:/expense/server/src/routes/category.routes.ts

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import CategoryModel, { ICategory } from '../models/category.model';
import TransactionModel from '../models/transaction.model';
import { Types } from 'mongoose';

const router = Router();

// --- THIS IS THE FIX: Type ObjectId fields as strings for plain objects ---
type PlainCategory = {
  _id: string; // Changed from Types.ObjectId
  userId: string; // Changed from Types.ObjectId
  name: string;
  icon: string;
  color: string;
  matchStrings: string[];
  // isDefault: boolean;
  parentId: string | null; // Changed from Types.ObjectId
};

type CategoryWithSubcategories = PlainCategory & {
  subcategories: PlainCategory[];
};
// --- END FIX ---

router.use(authMiddleware);

/**
 * GET /api/categories
 * Fetches all categories for the user and structures them into a parent/child hierarchy.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const rawCategories = await CategoryModel.find({ userId }).lean();
    const categories: PlainCategory[] = rawCategories.map((cat: any) => ({
      ...cat,
      _id: cat._id.toString(),
      userId: cat.userId.toString(),
      parentId: cat.parentId ? cat.parentId.toString() : null,
    }));

    const categoryMap = new Map<string, CategoryWithSubcategories>();
    const rootCategories: CategoryWithSubcategories[] = [];

    for (const cat of categories) {
      // Mongoose's .lean() might return _id as an object, so we ensure it's a string.
      const id = cat._id.toString();
      categoryMap.set(id, {
        ...cat,
        _id: id, // Ensure _id is a string
        subcategories: [],
      });
    }

    for (const cat of categories) {
      const catNode = categoryMap.get(cat._id.toString())!;

      if (cat.parentId) {
        // parentId will also be an object from .lean(), so convert to string
        const parentNode = categoryMap.get(cat.parentId.toString());
        if (parentNode) {
          parentNode.subcategories.push(catNode);
        }
      } else {
        rootCategories.push(catNode);
      }
    }

    res.status(200).json(rootCategories);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch categories.' });
  }
});

/**
 * POST /api/categories
 * Creates a new parent category OR a subcategory if parentId is provided.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { name, icon, color, matchStrings, parentId } = req.body;

    // --- THIS IS THE FIX ---
    // The validation check was still asking for `icon`.
    // It should only require `name`.
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }
    // --- END FIX ---

    const newCategory = await CategoryModel.create({
      userId,
      name,
      icon: name, // We still set the icon from the name
      color,
      matchStrings: matchStrings || [],
      parentId: parentId || null,
    });
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create category.' });
  }
});

/**
 * PUT /api/categories/:id
 * Updates a user-created category or subcategory.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { id } = req.params;
    const { name, icon, color } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ID format.' });
    }

    const categoryToUpdate = await CategoryModel.findOne({ _id: id, userId });
    if (!categoryToUpdate) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    categoryToUpdate.name = name || categoryToUpdate.name;
    categoryToUpdate.icon = icon || categoryToUpdate.icon;
    categoryToUpdate.color = color || categoryToUpdate.color;

    await categoryToUpdate.save();
    res.status(200).json(categoryToUpdate);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update category.' });
  }
});

/**
 * DELETE /api/categories/:id
 * Deletes a category or subcategory. If a parent is deleted, all its children are also deleted.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.sub;
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ID format.' });
    }

    const categoryToDelete = await CategoryModel.findOne({ _id: id, userId });
    if (!categoryToDelete) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    let idsToDelete = [categoryToDelete._id];
    // If it's a parent category, find and add all its subcategories to the deletion list
    if (categoryToDelete.parentId === null) {
      const subcategories = await CategoryModel.find({
        parentId: categoryToDelete._id,
      });
      idsToDelete = [...idsToDelete, ...subcategories.map((sub) => sub._id)];
    }

    // Unset the subcategoryId from all affected transactions
    await TransactionModel.updateMany(
      { userId, subcategoryId: { $in: idsToDelete } },
      { $unset: { subcategoryId: '' } }
    );

    // Delete all the categories/subcategories
    await CategoryModel.deleteMany({ _id: { $in: idsToDelete }, userId });

    res.status(200).json({
      message: 'Category and its subcategories deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete category.' });
  }
});

export default router;
