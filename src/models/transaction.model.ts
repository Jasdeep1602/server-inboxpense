import { Schema, model, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  userId: Types.ObjectId;
  subcategoryId?: Types.ObjectId; // <-- RENAME THIS
  smsId: string;
  source: string;
  date: Date;
  body: string;
  amount: number;
  type: 'credit' | 'debit';
  mode: string;
  status?: 'success' | 'failed';
  description?: string;
  details?: string;
  accountType?: string;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // --- THIS IS THE FIX ---
    // Renamed from categoryId to subcategoryId for clarity.
    // A transaction is always assigned to a subcategory.
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    // --- END FIX ---

    smsId: { type: String, required: true },
    source: { type: String, required: true },
    date: { type: Date, required: true },
    body: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, required: true, enum: ['credit', 'debit'] },
    mode: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed'] },
    description: { type: String },
    details: { type: String },
    accountType: { type: String },
  },
  { timestamps: true }
);

TransactionSchema.index({ userId: 1, source: 1, smsId: 1 }, { unique: true });

export default model<ITransaction>('Transaction', TransactionSchema);
