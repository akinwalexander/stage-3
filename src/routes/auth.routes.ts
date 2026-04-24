import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.get('/github', authController.initiateGithubAuth);
router.get('/github/callback', authController.githubCallback);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);

// Protected routes
router.get('/me', authenticate, authController.getCurrentUser);
router.post('/me/switch-role', authenticate, authController.switchRole); // For users with multiple roles

export default router;