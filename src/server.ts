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
import summaryRoutes from './routes/summary.routes';
import { COLOR_PALETTE } from './data/theme';
import exportRoutes from './routes/export.routes'; // Import the export routes

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

const callbackURL =
  process.env.RENDER_EXTERNAL_URL + '/auth/google/callback' ||
  `http://localhost:${PORT}/auth/google/callback`;

// --- Passport Google OAuth Strategy ---
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: callbackURL,
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
          user.picture = profile.photos?.[0].value; // This is safe now because the schema is optional
          await user.save();
        } else {
          // If user doesn't exist, create a new one
          isNewUser = true; // Set the flag to true
          user = await UserModel.create({
            googleId: profile.id,
            email: profile.emails?.[0].value,
            name: profile.displayName,
            picture: profile.photos?.[0].value, // This is also safe
            googleRefreshToken: refreshToken,
          });
        }

        // If it was a new user, create the default categories for them.
        if (isNewUser && user) {
          console.log(
            `Creating default categories for new user: ${user.email}`
          );

          // Map over the default data and assign a color from our new, large palette.
          const categoriesToCreate = defaultCategories.map((cat, index) => ({
            name: cat.name,
            icon: cat.icon,
            matchStrings: cat.matchStrings,
            isDefault: true, // We ensure this is always true for default categories
            userId: user._id,
            // We IGNORE the old color from the defaultCategories file and use our new palette.
            // The modulo operator (%) ensures we loop back to the start of the palette if we have more categories than colors.
            color: COLOR_PALETTE[index % COLOR_PALETTE.length],
          }));

          await CategoryModel.insertMany(categoriesToCreate);
        }

        // Pass the user object to the next step in the authentication flow
        return done(null, user);
      } catch (error: any) {
        // If any error occurs, pass it to Passport to handle
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
    const payload = {
      sub: user._id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: '1d',
    });

    // --- THIS IS THE FIX ---
    // For production (deployed), cookies must be secure and allow cross-site usage.
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: isProduction, // Set to true in production
      sameSite: isProduction ? 'none' : 'lax', // Must be 'none' for cross-domain cookies
      maxAge: 24 * 60 * 60 * 1000,
    });
    // --- END FIX ---

    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  }
);

// --- API Routes Mounting ---
app.use('/api', apiRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/export', exportRoutes);

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
