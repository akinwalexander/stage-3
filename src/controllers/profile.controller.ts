import { Request, Response } from 'express';
import * as profileService from '../services/profile.service';
import { parseNLQuery } from '../utils/parser';
import { AppError, handleError } from '../utils/errors';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        username: string;
        role: string;
      };
    }
  }
}


/**
 * @openapi
 * /api/profiles:
 *   get:
 *     summary: Get all profiles with filtering, sorting, and pagination
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: gender
 *         schema:
 *           type: string
 *           enum: [male, female]
 *       - in: query
 *         name: age_group
 *         schema:
 *           type: string
 *           enum: [child, teenager, adult, senior]
 *       - in: query
 *         name: country_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: min_age
 *         schema:
 *           type: integer
 *       - in: query
 *         name: max_age
 *         schema:
 *           type: integer
 *       - in: query
 *         name: min_gender_probability
 *         schema:
 *           type: number
 *       - in: query
 *         name: min_country_probability
 *         schema:
 *           type: number
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [age, created_at, gender_probability]
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Success response
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       422:
 *         description: Invalid parameter type
 */
export const getAllProfiles = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    // Both Admin and Analyst can read profiles
    if (!['admin', 'analyst'].includes(req.user.role)) {
      throw new AppError('Access denied. Role must be admin or analyst', 403);
    }

    const {
      gender,
      age_group,
      country_id,
      min_age,
      max_age,
      min_gender_probability,
      min_country_probability,
      sort_by,
      order,
      page,
      limit,
    } = req.query;

    const filters: profileService.ProfileFilters = {
      gender: gender as string,
      age_group: age_group as string,
      country_id: country_id as string,
      min_age: min_age ? parseInt(min_age as string) : undefined,
      max_age: max_age ? parseInt(max_age as string) : undefined,
      min_gender_probability: min_gender_probability ? parseFloat(min_gender_probability as string) : undefined,
      min_country_probability: min_country_probability ? parseFloat(min_country_probability as string) : undefined,
      sort_by: sort_by as any,
      order: order as any,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    };

    // Basic validation for numeric types
    if (min_age && isNaN(filters.min_age!)) throw new AppError('Invalid parameter type', 422);
    if (max_age && isNaN(filters.max_age!)) throw new AppError('Invalid parameter type', 422);
    if (min_gender_probability && isNaN(filters.min_gender_probability!)) throw new AppError('Invalid parameter type', 422);
    if (min_country_probability && isNaN(filters.min_country_probability!)) throw new AppError('Invalid parameter type', 422);
    if (page && isNaN(filters.page!)) throw new AppError('Invalid parameter type', 422);
    if (limit && isNaN(filters.limit!)) throw new AppError('Invalid parameter type', 422);

    const result = await profileService.getProfiles(filters);

    // Add metadata about the authenticated user
    res.json({
      ...result,
      authenticated_as: {
        username: req.user.username,
        role: req.user.role
      }
    });
  } catch (error) {
     console.error('getAllProfiles error:', error);
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles/search:
 *   get:
 *     summary: Natural Language Query to search profiles
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Plain English query (e.g., "young males from nigeria")
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Success response
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       400:
 *         description: Missing or empty parameter
 */
export const searchProfiles = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    // Both Admin and Analyst can search profiles
    if (!['admin', 'analyst'].includes(req.user.role)) {
      throw new AppError('Access denied. Role must be admin or analyst', 403);
    }

    const { q, page, limit } = req.query;

    if (!q || (q as string).trim() === '') {
      throw new AppError('Missing or empty parameter', 400);
    }

    const nlFilters = parseNLQuery(q as string);

    if (!nlFilters) {
      return res.status(200).json({
        status: 'error',
        message: 'Unable to interpret query',
        authenticated_as: req.user.username
      });
    }

    const filters: profileService.ProfileFilters = {
      ...nlFilters,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    };

    const result = await profileService.getProfiles(filters);

    res.json({
      ...result,
      search_query: q,
      authenticated_as: req.user.username
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles/{id}:
 *   get:
 *     summary: Get a single profile by ID
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile found
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Profile not found
 */
export const getProfileById = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (!['admin', 'analyst'].includes(req.user.role)) {
      throw new AppError('Access denied. Role must be admin or analyst', 403);
    }

    const id = req.params.id as string;
    const profile = await profileService.getProfileById(id);

    if (!profile) {
      throw new AppError('Profile not found', 404);
    }

    res.json({
      success: true,
      data: profile,
      requested_by: req.user.username
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles:
 *   post:
 *     summary: Create a new profile
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - gender
 *               - age
 *               - country_id
 *               - country_name
 *             properties:
 *               name:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *               gender_probability:
 *                 type: number
 *               age:
 *                 type: integer
 *               age_group:
 *                 type: string
 *               country_id:
 *                 type: string
 *               country_name:
 *                 type: string
 *               country_probability:
 *                 type: number
 *     responses:
 *       201:
 *         description: Profile created
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied (Admin only)
 *       409:
 *         description: Profile with this name already exists
 */
export const createProfile = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization (Admin only)
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (req.user.role !== 'admin') {
      throw new AppError('Access denied. Only admin can create profiles', 403);
    }

    const profile = await profileService.createProfile({
      ...req.body,
      created_by: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: profile,
      message: 'Profile created successfully',
      created_by: req.user.username
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles/{id}:
 *   put:
 *     summary: Update a profile
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile updated
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied (Admin only)
 *       404:
 *         description: Profile not found
 */
export const updateProfile = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization (Admin only)
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (req.user.role !== 'admin') {
      throw new AppError('Access denied. Only admin can update profiles', 403);
    }

    const id = req.params.id as string;
    const profile = await profileService.updateProfile(id, req.body);

    if (!profile) {
      throw new AppError('Profile not found', 404);
    }

    res.json({
      success: true,
      data: profile,
      message: 'Profile updated successfully',
      updated_by: req.user.username
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles/{id}:
 *   delete:
 *     summary: Delete a profile
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile deleted
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied (Admin only)
 *       404:
 *         description: Profile not found
 */
export const deleteProfile = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization (Admin only)
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (req.user.role !== 'admin') {
      throw new AppError('Access denied. Only admin can delete profiles', 403);
    }

    const id = req.params.id as string;
    const deleted = await profileService.deleteProfile(id);

    if (!deleted) {
      throw new AppError('Profile not found', 404);
    }

    res.json({
      success: true,
      message: 'Profile deleted successfully',
      deleted_by: req.user.username
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles/export:
 *   get:
 *     summary: Export profiles to CSV/JSON
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *           default: csv
 *     responses:
 *       200:
 *         description: File downloaded
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied (Admin only)
 */
export const exportProfiles = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization (Admin only)
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (req.user.role !== 'admin') {
      throw new AppError('Access denied. Only admin can export profiles', 403);
    }

    const { format = 'csv' } = req.query;
    const data = await profileService.exportProfiles(format as 'csv' | 'json');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=profiles.csv');
      res.send(data);
    } else if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=profiles.json');
      res.json(data);
    } else {
      throw new AppError('Invalid format. Use csv or json', 400);
    }
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * @openapi
 * /api/profiles/stats:
 *   get:
 *     summary: Get profile statistics for dashboard
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 */
export const getProfileStats = async (req: Request, res: Response) => {
  try {
    // Check authentication and authorization
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (!['admin', 'analyst'].includes(req.user.role)) {
      throw new AppError('Access denied. Role must be admin or analyst', 403);
    }

    const stats = await profileService.getProfileStats();

    res.json({
      success: true,
      data: stats,
      viewed_by: req.user.username,
      role: req.user.role
    });
  } catch (error) {
    handleError(error, res);
  }
};