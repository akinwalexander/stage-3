import { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import * as authService from '../services/auth.service';
import { AppError, handleError } from '../utils/errors';

// Temporary storage for OAuth states (in production, use Redis)
const oauthStates = new Map<string, { state: string; codeVerifier: string; client: string }>();

export const initiateGithubAuth = async (req: Request, res: Response) => {
  try {
    const client = req.query.client === 'cli' ? 'cli' : 'web';
    
    // Generate PKCE values
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Store state and verifier for callback validation
    const sessionId = crypto.randomBytes(16).toString('hex');
    oauthStates.set(sessionId, { state, codeVerifier, client });
    
    // For CLI, return the auth URL directly
    if (client === 'cli') {
      const authUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${process.env.GITHUB_CLIENT_ID}&` +
        `redirect_uri=${process.env.GITHUB_CALLBACK_URL}&` +
        `state=${state}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256&` +
        `session_id=${sessionId}`;
      
      return res.json({ 
        auth_url: authUrl,
        session_id: sessionId
      });
    }
    
    // For web, redirect to GitHub
    const authUrl = `https://github.com/login/oauth/authorize?` +
      `client_id=${process.env.GITHUB_CLIENT_ID}&` +
      `redirect_uri=${process.env.GITHUB_CALLBACK_URL}&` +
      `state=${state}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256`;
    
    res.redirect(authUrl);
  } catch (error) {
    handleError(error, res);
  }
};

export const githubCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, session_id, client = 'web' } = req.query;
    
    // Retrieve stored OAuth data
    const oauthData = oauthStates.get(session_id as string);
    
    if (!oauthData || oauthData.state !== state) {
      throw new AppError('Invalid state parameter', 400);
    }
    
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
        code_verifier: oauthData.codeVerifier,
      },
      {
        headers: { Accept: 'application/json' }
      }
    );
    
    const githubAccessToken = tokenResponse.data.access_token;
    
    // Get user info from GitHub
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: 'application/json'
      }
    });
    
    // Get user emails
    const emailsResponse = await axios.get('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: 'application/json'
      }
    });
    
    const primaryEmail = emailsResponse.data.find((email: any) => email.primary)?.email;
    const githubUser = {
      ...userResponse.data,
      email: primaryEmail
    };
    
    // Create or update user in database
    const user = await authService.findOrCreateUser({
      githubId: githubUser.id,
      username: githubUser.login,
      email: githubUser.email,
      avatarUrl: githubUser.avatar_url,
    });
    
    // Generate tokens
    const accessToken = authService.generateAccessToken(user);
    const refreshToken = authService.generateRefreshToken();
    await authService.saveRefreshToken(user.id, refreshToken);
    
    // Clean up OAuth state
    oauthStates.delete(session_id as string);
    
    // Handle CLI vs Web response
    if (client === 'cli' || oauthData.client === 'cli') {
      return res.json({
        success: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar_url: user.avatarUrl,
          role: user.role
        }
      });
    }
    
    // Set cookies for web
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });
    
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Redirect to frontend
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/dashboard`);
  } catch (error) {
    console.error('GitHub callback error:', error);
    handleError(error, res);
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      throw new AppError('Refresh token required', 400);
    }
    
    const newAccessToken = await authService.refreshAccessToken(refresh_token);
    
    res.json({
      success: true,
      access_token: newAccessToken
    });
  } catch (error) {
    handleError(error, res);
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;
    
    if (refresh_token) {
      await authService.revokeRefreshToken(refresh_token);
    }
    
    // Clear cookies
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    handleError(error, res);
  }
};

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }
    
    const user = await authService.getUserById(req.user.userId);
    
    res.json({
      success: true,
      data: {
        id: user?.id,
        username: user?.username,
        email: user?.email,
        avatar_url: user?.avatarUrl,
        role: user?.role,
        created_at: user?.createdAt
      }
    });
  } catch (error) {
    handleError(error, res);
  }
};

export const switchRole = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }
    
    const { role } = req.body;
    
    if (!role || !['admin', 'analyst'].includes(role)) {
      throw new AppError('Invalid role. Must be admin or analyst', 400);
    }
    
    // Only allow switching if user has permission (admins can switch to analyst, but analysts can't switch to admin)
    if (role === 'admin' && req.user.role !== 'admin') {
      throw new AppError('Cannot switch to admin role without permission', 403);
    }
    
    const updatedUser = await authService.updateUserRole(req.user.userId, role);
    
    // Generate new tokens with updated role
    const newAccessToken = authService.generateAccessToken(updatedUser);
    
    res.json({
      success: true,
      access_token: newAccessToken,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role
      },
      message: `Switched to ${role} role`
    });
  } catch (error) {
    handleError(error, res);
  }
};