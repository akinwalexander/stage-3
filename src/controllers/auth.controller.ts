import { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import * as authService from '../services/auth.service';
import { AppError, handleError } from '../utils/errors';

const oauthStates = new Map<string, {
  state: string;
  codeVerifier: string;
  client: string;
  redirectUri?: string;
}>();

// ─── Initiate GitHub Auth ─────────────────────────────────────────────────────

/**
 * @openapi
 * /auth/github:
 *   get:
 *     summary: Initiate GitHub OAuth login
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: client
 *         schema:
 *           type: string
 *           enum: [web, cli]
 *           default: web
 *       - in: query
 *         name: redirect_uri
 *         schema:
 *           type: string
 *         description: CLI local callback URL (e.g. http://localhost:9876/callback)
 *     responses:
 *       200:
 *         description: CLI auth URL returned as JSON
 *       302:
 *         description: Web redirect to GitHub OAuth page
 */
export const initiateGithubAuth = async (req: Request, res: Response) => {
  try {
    const client = req.query.client === 'cli' ? 'cli' : 'web';

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sessionId = crypto.randomBytes(16).toString('hex');
    const redirectUri = req.query.redirect_uri as string | undefined;

    oauthStates.set(sessionId, { state, codeVerifier, client, redirectUri });

    setInterval(() => {
    }, 5 * 60 * 1000);

    // Encode sessionId into state so GitHub returns it in the callback
    const combinedState = `${state}:${sessionId}`;

    const authUrl =
      `https://github.com/login/oauth/authorize?` +
      `client_id=${process.env.GITHUB_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(process.env.GITHUB_CALLBACK_URL!)}&` +
      `scope=read:user,user:email&` +
      `state=${combinedState}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256`;

    if (client === 'cli') {
      return res.json({ auth_url: authUrl, session_id: sessionId });
    }

    res.redirect(authUrl);
  } catch (error) {
    handleError(error, res);
  }
};

// ─── GitHub Callback ──────────────────────────────────────────────────────────

/**
 * @openapi
 * /auth/github/callback:
 *   get:
 *     summary: GitHub OAuth callback
 *     tags: [Authentication]
 */
export const githubCallback = async (req: Request, res: Response) => {
  try {
    const { code, state: rawState } = req.query;

    // Reject missing code
    if (!code) {
      throw new AppError('Missing authorization code', 400);
    }

    // Reject missing state
    if (!rawState) {
      throw new AppError('Missing state parameter', 400);
    }

    const parts = (rawState as string).split(':');
    if (parts.length !== 2) throw new AppError('Invalid state parameter', 400);

    const [receivedState, sessionId] = parts;
    const oauthData = oauthStates.get(sessionId);

    if (!oauthData || oauthData.state !== receivedState) {
      throw new AppError('Invalid state parameter', 400);
    }

    oauthStates.delete(sessionId);

    // Exchange code for GitHub access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL, // always the registered URL
        code_verifier: oauthData.codeVerifier,
      },
      { headers: { Accept: 'application/json' } }
    );

    const githubAccessToken = tokenResponse.data.access_token;

    if (!githubAccessToken) {
      throw new AppError('Failed to obtain GitHub access token', 400);
    }

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${githubAccessToken}`, Accept: 'application/json' },
    });

    // Fetch email with fallback to public profile email
    let primaryEmail: string | undefined;
    try {
      const emailsResponse = await axios.get('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${githubAccessToken}`, Accept: 'application/json' },
      });
      primaryEmail = emailsResponse.data.find((e: any) => e.primary)?.email;
    } catch {
      primaryEmail = userResponse.data.email;
    }

    const githubUser = { ...userResponse.data, email: primaryEmail };

    const user = await authService.findOrCreateUser({
      githubId: githubUser.id,
      username: githubUser.login,
      email: githubUser.email,
      avatarUrl: githubUser.avatar_url,
    });

    const accessToken = authService.generateAccessToken(user);
    const refreshToken = authService.generateRefreshToken();
    await authService.saveRefreshToken(user.id, refreshToken);

    // ── CLI: redirect to local callback server with tokens in query params ──
    if (oauthData.client === 'cli') {
      const cliCallback = oauthData.redirectUri || 'http://localhost:9876/callback';
      return res.redirect(
        `${cliCallback}?access_token=${accessToken}` +
        `&refresh_token=${refreshToken}` +
        `&username=${encodeURIComponent(user.username)}` +
        `&role=${user.role}` +
        `&email=${encodeURIComponent(user.email || '')}`
      );
    }

    // ── Web: set HTTP-only cookies + CSRF token ──
    const csrfToken = crypto.randomBytes(32).toString('hex');

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',   // ← change from 'none'
      maxAge: 15 * 60 * 1000,         // 15 minutes
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',   // ← change from 'none'
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // CSRF token is readable by JS (not httpOnly) so the frontend can send it as a header
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });
    res.redirect(
      `${process.env.FRONTEND_URL || 'http://localhost:5173'}/?token=${accessToken}&refresh_token=${refreshToken}`
    );
  } catch (error) {
    console.error('GitHub callback error:', error);
    handleError(error, res);
  }
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    // Accept refresh token from body (CLI) or cookie (web)
    const refresh_token = req.cookies?.refresh_token || req.body?.refresh_token;

    if (!refresh_token) {
      throw new AppError('Refresh token required', 400);
    }

    const { newAccessToken, newRefreshToken } =
      await authService.refreshAccessToken(refresh_token);

    // For web clients — update the cookie
    if (req.cookies?.refresh_token) {
      const csrfToken = crypto.randomBytes(32).toString('hex');

      // Access token
      res.cookie('access_token', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000,
      });

      // NEW refresh token
      res.cookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // CSRF token
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000,
      });

      return res.json({ success: true, csrf_token: csrfToken });
    }

    // For CLI clients — return token in body
    res.json({ success: true, access_token: newAccessToken, refresh_token: newRefreshToken });
  } catch (error) {
    console.error("REFRESH ERROR 🔥:", error);
    handleError(error, res);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout and revoke tokens
 *     tags: [Authentication]
 */
export const logout = async (req: Request, res: Response) => {
  try {
    const refresh_token = req.body.refresh_token || req.cookies?.refresh_token;

    if (refresh_token) {
      await authService.revokeRefreshToken(refresh_token);
    }

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.clearCookie('csrf_token');

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    handleError(error, res);
  }
};

// ─── Get Current User ─────────────────────────────────────────────────────────

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
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
        avatar_url: user?.avatar_url,
        role: user?.role,
        created_at: user?.created_at,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
};

// ─── Switch Role ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /auth/switch-role:
 *   post:
 *     summary: Switch active role
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
export const switchRole = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    const { role } = req.body;

    if (!role || !['admin', 'analyst'].includes(role)) {
      throw new AppError('Invalid role. Must be admin or analyst', 400);
    }

    if (role === 'admin' && req.user.role !== 'admin') {
      throw new AppError('Cannot switch to admin role without permission', 403);
    }

    const updatedUser = await authService.updateUserRole(req.user.userId, role);
    const newAccessToken = authService.generateAccessToken(updatedUser);

    res.json({
      success: true,
      access_token: newAccessToken,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
      },
      message: `Switched to ${role} role`,
    });
  } catch (error) {
    handleError(error, res);
  }
};