import { Router } from 'express';
import * as profileController from '../controllers/profile.controller';
import { authenticate, requireAdmin, requireReadAccess } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all profile routes
router.use(authenticate);

// Read operations (Admin + Analyst)
router.get('/', requireReadAccess, profileController.getAllProfiles);
router.get('/search', requireReadAccess, profileController.searchProfiles);
router.get('/stats', requireReadAccess, profileController.getProfileStats);
router.get('/export', requireAdmin, profileController.exportProfiles);
router.get('/:id', requireReadAccess, profileController.getProfileById);

// Write operations (Admin only)
router.post('/', requireAdmin, profileController.createProfile);
router.put('/:id', requireAdmin, profileController.updateProfile);
router.delete('/:id', requireAdmin, profileController.deleteProfile);

// Export operations (Admin only)
router.get('/export/csv', requireAdmin, profileController.exportProfiles);
router.get('/export/json', requireAdmin, profileController.exportProfiles);

export default router;