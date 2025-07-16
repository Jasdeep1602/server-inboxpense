import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  picture: string;
  googleRefreshToken?: string;
}

const UserSchema = new Schema<IUser>(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: { type: String },
    picture: { type: String },
    googleRefreshToken: { type: String },
  },
  { timestamps: true }
);

export default model<IUser>('User', UserSchema);
