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
      // FIX: Pass accessType and prompt as authorizationURL query parameters
      // This is the modern way to request offline access for a refresh token.
      authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenURL: 'https://oauth2.googleapis.com/token',
      scope: [
        'email',
        'profile',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      passReqToCallback: false, // We don't need the request object in the callback
    },
    // FIX: Explicitly type the parameters for the validation callback
    async (
      accessToken: string,
      refreshToken: string, // This will be provided because we used accessType: 'offline'
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        // Find user by their Google ID
        let user = await UserModel.findOne({ googleId: profile.id });

        if (user) {
          // If user exists, always update their refresh token if a new one is provided.
          // Google only sends a refresh token on the first consent.
          user.googleRefreshToken = refreshToken || user.googleRefreshToken;
          await user.save();
        } else {
          // If user doesn't exist, create a new one
          user = await UserModel.create({
            googleId: profile.id,
            email: profile.emails?.[0].value,
            name: profile.displayName,
            picture: profile.photos?.[0].value,
            googleRefreshToken: refreshToken,
          });
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
  // FIX: Add options object here to pass accessType and prompt
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

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
