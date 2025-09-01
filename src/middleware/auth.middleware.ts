// D:/expense/server/src/middleware/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

// 1. Define our own JWT payload structure to ensure `sub` exists
interface CustomJwtPayload extends jwt.JwtPayload {
  sub: string;
  email: string;
}

// 2. Extend the Express Request type using declaration merging
declare global {
  namespace Express {
    interface Request {
      auth?: CustomJwtPayload;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let token: string | undefined;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  try {
    // We now cast to our custom, stricter payload type
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET!
    ) as CustomJwtPayload;

    // --- THIS IS THE FIX ---
    // Now we check for the existence of `sub` before validating it.
    if (!decoded.sub || !Types.ObjectId.isValid(decoded.sub)) {
      return res
        .status(401)
        .json({ message: 'Unauthorized: Invalid token payload' });
    }
    // --- END FIX ---

    // This will now work because of the `declare global` block
    req.auth = decoded;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: 'Unauthorized: Invalid or expired token' });
  }
};
