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

// State-changing methods that require CSRF validation
const CSRF_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. Try Bearer token (CLI + web fallback)
    let token = req.headers.authorization?.replace('Bearer ', '');

    // 2. Try httpOnly cookie (web)
    if (!token && req.cookies?.access_token) {
      token = req.cookies.access_token;

      // CSRF check for cookie-based auth on state-changing requests
      if (CSRF_METHODS.includes(req.method)) {
        const csrfFromHeader = req.headers['x-csrf-token'] as string;
        const csrfFromCookie = req.cookies?.csrf_token;

        if (!csrfFromHeader || !csrfFromCookie || csrfFromHeader !== csrfFromCookie) {
          return next(new AppError('Invalid or missing CSRF token', 403));
        }
      }
    }

    if (!token) {
      throw new AppError('Authentication required. Please login.', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as JwtPayload;

    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      throw new AppError('Token expired. Please refresh.', 401);
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
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
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as JwtPayload;
      req.user = {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
      };
    }

    next();
  } catch {
    next();
  }
};

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

export const requireAdmin = requireRole(['admin']);
export const requireReadAccess = requireRole(['admin', 'analyst']);

export const can = {
  create: (user: any) => user?.role === 'admin',
  read: (user: any) => ['admin', 'analyst'].includes(user?.role),
  update: (user: any) => user?.role === 'admin',
  delete: (user: any) => user?.role === 'admin',
  export: (user: any) => user?.role === 'admin',
  manageUsers: (user: any) => user?.role === 'admin',
};