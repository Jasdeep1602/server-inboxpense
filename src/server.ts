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
import exportRoutes from './routes/export.routes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- THIS IS THE PERMANENT FIX - PART 1 ---
// It is MANDATORY to trust the proxy when deployed on a service like Render.
// This allows Express to correctly determine the protocol (http vs https)
// and set Secure cookies properly.
app.set('trust proxy', 1);
// --- END FIX ---

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

// A more robust way to define the callback URL
const callbackURL = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/auth/google/callback`
  : `http://localhost:${PORT}/auth/google/callback`;

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
        let isNewUser = false;

        if (user) {
          user.googleRefreshToken = refreshToken || user.googleRefreshToken;
          user.name = profile.displayName;
          user.picture = profile.photos?.[0].value;
          await user.save();
        } else {
          isNewUser = true;
          user = await UserModel.create({
            googleId: profile.id,
            email: profile.emails?.[0].value,
            name: profile.displayName,
            picture: profile.photos?.[0].value,
            googleRefreshToken: refreshToken,
          });
        }

        if (isNewUser && user) {
          console.log(
            `Creating default categories for new user: ${user.email}`
          );
          const categoriesToCreate = defaultCategories.map((cat, index) => ({
            name: cat.name,
            icon: cat.icon,
            matchStrings: cat.matchStrings,
            isDefault: true,
            userId: user._id,
            color: COLOR_PALETTE[index % COLOR_PALETTE.length],
          }));
          await CategoryModel.insertMany(categoriesToCreate);
        }

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
    failureRedirect: '/login-failure',
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

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      // --- THIS IS THE PERMANENT FIX - PART 2 ---
      // This tells the browser the cookie is valid for the entire site.
      path: '/',
      // --- END FIX ---
      maxAge: 24 * 60 * 60 * 1000,
    });

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
