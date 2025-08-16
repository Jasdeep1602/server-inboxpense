import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import passport from 'passport';
import {
  Profile,
  Strategy as GoogleStrategy,
  VerifyCallback,
} from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import UserModel, { IUser } from './models/user.model';
import CategoryModel from './models/category.model';
import { defaultCategories } from './data/defaultCategories';
import apiRoutes from './routes/api.routes';
import mappingRoutes from './routes/mapping.routes';
import categoryRoutes from './routes/category.routes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware Setup ---
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI!)
  .then(() => console.log('✅ MongoDB connected successfully.'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// --- Passport Google OAuth Strategy ---
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenURL: 'https://oauth2.googleapis.com/token',
      scope: [
        'email',
        'profile',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      passReqToCallback: false,
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        let user = await UserModel.findOne({ googleId: profile.id });
        let isNewUser = false; // Flag to track if this is a new user

        if (user) {
          // If user exists, update their details and refresh token
          user.googleRefreshToken = refreshToken || user.googleRefreshToken;
          user.name = profile.displayName;
          user.picture = profile.photos?.[0].value;
          await user.save();
        } else {
          // If user doesn't exist, create a new one
          isNewUser = true; // Set the flag to true
          user = await UserModel.create({
            googleId: profile.id,
            email: profile.emails?.[0].value,
            name: profile.displayName,
            picture: profile.photos?.[0].value,
            googleRefreshToken: refreshToken,
          });
        }

        // --- THIS IS THE NEW LOGIC ---
        // If it was a new user, create the default categories for them.
        if (isNewUser && user) {
          console.log(
            `Creating default categories for new user: ${user.email}`
          );
          const categoriesToCreate = defaultCategories.map((cat) => ({
            ...cat,
            userId: user._id, // Assign the new user's ID to each default category
          }));

          // Use insertMany for efficient bulk creation
          await CategoryModel.insertMany(categoriesToCreate);
        }
        // --- END NEW LOGIC ---

        return done(null, user);
      } catch (error: any) {
        return done(error, undefined);
      }
    }
  )
);

// --- Authentication Routes ---

app.get(
  '/auth/google',
  passport.authenticate('google', {
    accessType: 'offline',
    prompt: 'consent',
  })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: '/login-failure', // You can create a simple frontend route for this
  }),
  (req: Request, res: Response) => {
    const user = req.user as IUser;
    const payload = { sub: user._id, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: '1d',
    });

    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  }
);

// --- API Routes Mounting ---
app.use('/api', apiRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/categories', categoryRoutes);

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
