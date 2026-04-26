import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError } from '../utils/errors';

const prisma = new PrismaClient();

export interface UserData {
  githubId: number;
  username: string;
  email?: string;
  avatarUrl?: string;
}

export const findOrCreateUser = async (userData: UserData) => {
  const existingUser = await prisma.user.findUnique({
    where: { github_id: userData.githubId }
  });

  if (existingUser) {
    // Update last login time
    return await prisma.user.update({
      where: { github_id: userData.githubId },
      data: {
        username: userData.username,
        email: userData.email || existingUser.email,
        avatar_url: userData.avatarUrl || existingUser.avatar_url,
        updated_at: new Date()
      }
    });
  }

  // Create new user (default role: analyst)
  return await prisma.user.create({
    data: {
      github_id: userData.githubId,
      username: userData.username,
      email: userData.email,
      avatar_url: userData.avatarUrl,
      role: 'analyst' // Default role
    }
  });
};

export const generateAccessToken = (user: any) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role
    },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );
};

export const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

export const saveRefreshToken = async (userId: number, refreshToken: string) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  return await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      user_id: userId,
      expires_at: expiresAt
    }
  });
};

export const verifyRefreshToken = async (refreshToken: string) => {
  const token = await prisma.refreshToken.findFirst({
    where: {
      token: refreshToken,
      revoked: false,
      expires_at: {
        gt: new Date()
      }
    },
    include: {
      user: true
    }
  });

  if (!token) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  return token;
};

export const refreshAccessToken = async (refreshToken: string) => {
  const tokenData = await verifyRefreshToken(refreshToken);

  // revoke old token
  await prisma.refreshToken.update({
    where: { id: tokenData.id },
    data: { revoked: true }
  });

  // issue new refresh token
  const newRefreshToken = generateRefreshToken();
  await saveRefreshToken(tokenData.user.id, newRefreshToken);

  const newAccessToken = generateAccessToken(tokenData.user);
  await revokeRefreshToken(refreshToken); // revoke old one

  return { newAccessToken, newRefreshToken };
};

export const revokeRefreshToken = async (refreshToken: string) => {
  await prisma.refreshToken.updateMany({
    where: { token: refreshToken },
    data: { revoked: true }
  });
};

export const revokeAllUserRefreshTokens = async (userId: number) => {
  await prisma.refreshToken.updateMany({
    where: { user_id: userId },
    data: { revoked: true }
  });
};

export const getUserById = async (userId: number) => {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      avatar_url: true,
      role: true,
      created_at: true
    }
  });
};

export const updateUserRole = async (userId: number, role: string) => {
  return await prisma.user.update({
    where: { id: userId },
    data: { role: role as 'admin' | 'analyst' }
  });
};

export const getAllUsers = async () => {
  return await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      avatar_url: true,
      role: true,
      created_at: true,
      _count: {
        select: { profiles: true }
      }
    },
    orderBy: { created_at: 'desc' }
  });
};

export const updateUserRoleAdmin = async (userId: number, role: string, requestingUserRole: string) => {
  // Only admins can change roles
  if (requestingUserRole !== 'admin') {
    throw new AppError('Only admins can change user roles', 403);
  }

  return await prisma.user.update({
    where: { id: userId },
    data: { role: role as 'admin' | 'analyst' }
  });
};