import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../prisma/schema';

export class TokenService {
  static generateAccessToken(user) {
    return jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );
  }

  static generateRefreshToken() {
    return crypto.randomBytes(40).toString('hex');
  }

  static async saveRefreshToken(userId, refreshToken) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    return await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: userId,
        expiresAt: expiresAt
      }
    });
  }

  static async verifyRefreshToken(refreshToken) {
    const token = await prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        revoked: false,
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        user: true
      }
    });
    
    if (!token) {
      throw new Error('Invalid or expired refresh token');
    }
    
    return token;
  }

  static async revokeRefreshToken(refreshToken) {
    return await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revoked: true }
    });
  }

  static async revokeAllUserRefreshTokens(userId) {
    return await prisma.refreshToken.updateMany({
      where: { userId: userId },
      data: { revoked: true }
    });
  }

  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (error) {
      return null;
    }
  }
}