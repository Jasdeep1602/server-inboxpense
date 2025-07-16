import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

// Define our JWT payload structure
interface JwtPayload {
  sub: string;
  email: string;
}

// Extend the Express Request type to add our custom payload
// We will call it `auth` to avoid conflicts with Passport's `user`
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
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  // Verify the token and extract the payload
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    if (!Types.ObjectId.isValid(decoded.sub)) {
      return res
        .status(401)
        .json({ message: 'Unauthorized: Invalid token payload' });
    }

    // Attach the simple, decoded JWT payload to req.auth
    req.auth = decoded;

    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: 'Unauthorized: Invalid or expired token' });
  }
};
