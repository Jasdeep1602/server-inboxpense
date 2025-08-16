import { Schema, model, Document, Types } from 'mongoose';

export interface ICategory extends Document {
  userId: Types.ObjectId;
  name: string; // e.g., "Food", "Shopping"
  icon: string; // We can store the name of an icon (e.g., from lucide-react)
  color: string; // A hex or tailwind color name
  matchStrings: string[]; // Keywords to auto-categorize transactions
  isDefault: boolean;
}

const CategorySchema = new Schema<ICategory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    icon: { type: String, required: true },
    color: { type: String, default: '#888888' },
    matchStrings: [{ type: String }],
    isDefault: { type: Boolean, default: false }, // <-- ADD THIS
  },
  { timestamps: true }
);

export default model<ICategory>('Category', CategorySchema);
