import { Schema, model, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  userId: Types.ObjectId;
  smsId: string;
  source: string;
  date: Date;
  body: string;
  amount: number;
  type: 'credit' | 'debit';
  mode: string;
  status?: 'success' | 'failed';
  description?: string;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    smsId: { type: String, required: true },
    source: { type: String, required: true },
    date: { type: Date, required: true },
    body: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, required: true, enum: ['credit', 'debit'] },
    mode: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed'] },
    description: { type: String },
  },
  { timestamps: true }
);

// Create a compound index to prevent duplicate entries
TransactionSchema.index({ userId: 1, source: 1, smsId: 1 }, { unique: true });

export default model<ITransaction>('Transaction', TransactionSchema);
