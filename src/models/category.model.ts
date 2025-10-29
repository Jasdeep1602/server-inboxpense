import { Schema, model, Document, Types } from 'mongoose';

export enum CategoryGroup {
  EXPENSE = 'EXPENSE',
  BUDGET = 'BUDGET',
  INVESTMENT = 'INVESTMENT',
  IGNORED = 'IGNORED',
}

export interface ICategory extends Document {
  userId: Types.ObjectId;
  name: string;
  icon: string;
  color: string;
  group: CategoryGroup;
  parentId: Types.ObjectId | null;
}

const CategorySchema = new Schema<ICategory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    icon: { type: String, required: true },
    color: { type: String, default: '#888888' },
    group: {
      type: String,
      enum: Object.values(CategoryGroup),
      required: true,
      default: CategoryGroup.EXPENSE,
    },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
  },
  { timestamps: true }
);

export default model<ICategory>('Category', CategorySchema);
