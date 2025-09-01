// D:/expense/server/src/middleware/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let token: string | undefined;

  // --- THIS IS THE FIX ---
  // 1. First, check for an Authorization header (for client-side requests)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  // 2. If no header, fall back to checking for the cookie (for server-side requests)
  else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }
  // --- END FIX ---

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    if (!decoded.sub || !Types.ObjectId.isValid(decoded.sub)) {
      return res
        .status(401)
        .json({ message: 'Unauthorized: Invalid token payload' });
    }

    req.auth = decoded;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: 'Unauthorized: Invalid or expired token' });
  }
};
