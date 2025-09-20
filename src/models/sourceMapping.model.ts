import { Schema, model, Document, Types } from 'mongoose';

export interface ISourceMapping extends Document {
  userId: Types.ObjectId;
  mappingName: string; // e.g., "My HDFC Credit Card"
  matchStrings: string[]; // e.g., ["XX810", "HDFC Bank"]
  type: string;
}

const SourceMappingSchema = new Schema<ISourceMapping>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mappingName: { type: String, required: true },
    matchStrings: [{ type: String, required: true }],
    type: { type: String, required: true },
  },
  { timestamps: true }
);

export default model<ISourceMapping>('SourceMapping', SourceMappingSchema);
