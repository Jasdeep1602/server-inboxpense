import { Schema, model, Document, Types } from 'mongoose';

export interface ICategory extends Document {
  userId: Types.ObjectId;
  name: string;
  icon: string;
  color: string;
  matchStrings: string[];
  // isDefault: boolean;
  parentId: Types.ObjectId | null; // <-- ADD THIS
}

const CategorySchema = new Schema<ICategory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    icon: { type: String, required: true },
    color: { type: String, default: '#888888' },
    matchStrings: [{ type: String }],
    // isDefault: { type: Boolean, default: false },
    // --- THIS IS THE FIX ---
    // A category can have a parent, which is another category.
    // If null, it's a top-level parent category.
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    // --- END FIX ---
  },
  { timestamps: true }
);

export default model<ICategory>('Category', CategorySchema);
