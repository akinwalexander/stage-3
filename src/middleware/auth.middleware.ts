import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/errors';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  exp: number;
  iat: number;
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Try to get token from multiple sources
    let token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token && req.cookies?.access_token) {
      token = req.cookies.access_token;
    }
    
    if (!token && req.query?.access_token) {
      token = req.query.access_token as string;
    }

    if (!token) {
      throw new AppError('Authentication required. Please login.', 401);
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET!
    ) as JwtPayload;

    // Check if token is expired
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      throw new AppError('Token expired. Please refresh.', 401);
    }

    // Attach user to request
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token. Please login again.', 401));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expired. Please refresh.', 401));
    } else {
      next(error);
    }
  }
};

// Optional authentication (doesn't fail if no token)
export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    let token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token && req.cookies?.access_token) {
      token = req.cookies.access_token;
    }
    
    if (token) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET!
      ) as JwtPayload;
      
      req.user = {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role
      };
    }
    
    next();
  } catch (error) {
    // Just continue without user
    next();
  }
};

// Role-based middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(
        `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
        403
      ));
    }
    
    next();
  };
};

// Convenience middleware
export const requireAdmin = requireRole(['admin']);
export const requireReadAccess = requireRole(['admin', 'analyst']);

// Permission checker
export const can = {
  create: (user: any) => user?.role === 'admin',
  read: (user: any) => ['admin', 'analyst'].includes(user?.role),
  update: (user: any) => user?.role === 'admin',
  delete: (user: any) => user?.role === 'admin',
  export: (user: any) => user?.role === 'admin',
  manageUsers: (user: any) => user?.role === 'admin'
};