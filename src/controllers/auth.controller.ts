import { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import * as authService from '../services/auth.service';
import { AppError, handleError } from '../utils/errors';

const oauthStates = new Map<string, { state: string; codeVerifier: string; client: string }>();

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
 *         description: Client type. CLI returns auth URL as JSON; web redirects to GitHub.
 *     responses:
 *       200:
 *         description: CLI auth URL returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 auth_url:
 *                   type: string
 *                   example: https://github.com/login/oauth/authorize?client_id=...
 *                 session_id:
 *                   type: string
 *                   example: abc123def456
 *       302:
 *         description: Web redirect to GitHub OAuth page
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
    oauthStates.set(sessionId, { state, codeVerifier, client });

    if (client === 'cli') {
      const authUrl =
        `https://github.com/login/oauth/authorize?` +
        `client_id=${process.env.GITHUB_CLIENT_ID}&` +
        `redirect_uri=${process.env.GITHUB_CALLBACK_URL}&` +
        `scope=read:user,user:email&` +
        `state=${state}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256&` +
        `session_id=${sessionId}`;

      return res.json({ auth_url: authUrl, session_id: sessionId });
    }

    // Web: encode sessionId into state so GitHub returns it in callback
    const combinedState = `${state}:${sessionId}`;

    const authUrl =
      `https://github.com/login/oauth/authorize?` +
      `client_id=${process.env.GITHUB_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(process.env.GITHUB_CALLBACK_URL!)}&` +
      `scope=read:user,user:email&` +
      `state=${combinedState}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256`;

    res.redirect(authUrl);
  } catch (error) {
    handleError(error, res);
  }
};


/**
 * @openapi
 * /auth/github/callback:
 *   get:
 *     summary: GitHub OAuth callback
 *     tags: [Authentication]
 *     description: >
 *       Handles the GitHub OAuth redirect. Exchanges the authorization code for tokens.
 *       Web clients receive cookies and are redirected to the dashboard.
 *       CLI clients receive tokens as JSON.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from GitHub
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: State parameter for CSRF validation
 *       - in: query
 *         name: session_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID generated during auth initiation
 *       - in: query
 *         name: client
 *         schema:
 *           type: string
 *           enum: [web, cli]
 *           default: web
 *     responses:
 *       200:
 *         description: CLI login successful — tokens returned as JSON
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 access_token:
 *                   type: string
 *                 refresh_token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       302:
 *         description: Web login successful — redirected to dashboard with cookies set
 *       400:
 *         description: Invalid state parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const githubCallback = async (req: Request, res: Response) => {
  try {
    const { code, state: rawState, session_id, client = 'web' } = req.query;

    let oauthData;
    let receivedState: string;

    if (session_id) {
      // CLI flow — session_id comes back as a query param
      oauthData = oauthStates.get(session_id as string);
      receivedState = rawState as string;
      if (!oauthData || oauthData.state !== receivedState) {
        throw new AppError('Invalid state parameter', 400);
      }
    } else {
      // Web flow — session_id is encoded inside state as "state:sessionId"
      const parts = (rawState as string).split(':');
      if (parts.length !== 2) throw new AppError('Invalid state parameter', 400);
      const [statepart, sessionIdPart] = parts;
      oauthData = oauthStates.get(sessionIdPart);
      receivedState = statepart;
      if (!oauthData || oauthData.state !== receivedState) {
        throw new AppError('Invalid state parameter', 400);
      }
      // Clean up using the extracted sessionId
      oauthStates.delete(sessionIdPart);
    }

    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
        code_verifier: oauthData.codeVerifier,
      },
      { headers: { Accept: 'application/json' } }
    );

    const githubAccessToken = tokenResponse.data.access_token;

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${githubAccessToken}`, Accept: 'application/json' },
    });

    const emailsResponse = await axios.get('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${githubAccessToken}`, Accept: 'application/json' },
    });

    const primaryEmail = emailsResponse.data.find((email: any) => email.primary)?.email;
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

    // CLI cleanup
    if (session_id) oauthStates.delete(session_id as string);

    if (client === 'cli' || oauthData.client === 'cli') {
      return res.json({
        success: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar_url: user.avatar_url,
          role: user.role,
        },
      });
    }

    res.redirect(
      `${process.env.FRONTEND_URL || 'http://localhost:5173'}/?token=${accessToken}&refresh_token=${refreshToken}`
    );
  } catch (error) {
    console.error('GitHub callback error:', error);
    handleError(error, res);
  }
};
/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refresh_token
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 access_token:
 *                   type: string
 *       400:
 *         description: Refresh token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      throw new AppError('Refresh token required', 400);
    }

    const newAccessToken = await authService.refreshAccessToken(refresh_token);

    res.json({ success: true, access_token: newAccessToken });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout and revoke tokens
 *     tags: [Authentication]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 description: Optional — if provided, the refresh token is revoked server-side
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const logout = async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (refresh_token) {
      await authService.revokeRefreshToken(refresh_token);
    }

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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

/**
 * @openapi
 * /auth/switch-role:
 *   post:
 *     summary: Switch active role
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     description: >
 *       Allows a user to switch their active role. Admins may switch to analyst.
 *       Analysts cannot switch to admin.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, analyst]
 *                 example: analyst
 *     responses:
 *       200:
 *         description: Role switched — new access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 access_token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *                     role:
 *                       type: string
 *                 message:
 *                   type: string
 *                   example: Switched to analyst role
 *       400:
 *         description: Invalid role value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient permissions to switch to requested role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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