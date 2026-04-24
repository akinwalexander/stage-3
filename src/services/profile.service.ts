import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import { AppError } from '../utils/errors';

let prisma: PrismaClient;

const getPrisma = () => {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
};

export interface ProfileFilters {
  gender?: string;
  age_group?: string;
  country_id?: string;
  min_age?: number;
  max_age?: number;
  min_gender_probability?: number;
  min_country_probability?: number;
  sort_by?: 'age' | 'created_at' | 'gender_probability';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface CreateProfileData {
  name: string;
  gender: string;
  gender_probability?: number;
  age: number;
  age_group: string;
  country_id: string;
  country_name: string;
  country_probability?: number;
  created_by?: number;
}

export interface UpdateProfileData {
  name?: string;
  gender?: string;
  gender_probability?: number;
  age?: number;
  age_group?: string;
  country_id?: string;
  country_name?: string;
  country_probability?: number;
}

export const getProfiles = async (filters: ProfileFilters) => {
  const db = getPrisma();
  const {
    gender,
    age_group,
    country_id,
    min_age,
    max_age,
    min_gender_probability,
    min_country_probability,
    sort_by = 'created_at',
    order = 'desc',
    page = 1,
    limit = 10,
  } = filters;

  const where: Prisma.ProfileWhereInput = {};

  if (gender) where.gender = gender;
  if (age_group) where.age_group = age_group;
  if (country_id) where.country_id = country_id;
  
  if (min_age !== undefined || max_age !== undefined) {
    where.age = {
      gte: min_age,
      lte: max_age,
    };
  }

  if (min_gender_probability !== undefined) {
    where.gender_probability = { gte: min_gender_probability };
  }

  if (min_country_probability !== undefined) {
    where.country_probability = { gte: min_country_probability };
  }

  const skip = (page - 1) * limit;
  const take = Math.min(limit, 50);

  const [data, total] = await Promise.all([
    db.profile.findMany({
      where,
      orderBy: { [sort_by]: order },
      skip,
      take,
    }),
    db.profile.count({ where }),
  ]);

  return {
    status: 'success',
    page,
    limit: take,
    total,
    data,
  };
};

/**
 * Get a single profile by ID
 */
export const getProfileById = async (id: string) => {
  const db = getPrisma();
  return await db.profile.findUnique({
    where: { id },
  });
};

/**
 * Create a new profile
 */
export const createProfile = async (data: CreateProfileData) => {
  const db = getPrisma();
  
  // Check if profile with same name already exists
  const existingProfile = await db.profile.findUnique({
    where: { name: data.name },
  });
  
  if (existingProfile) {
    throw new AppError(`Profile with name "${data.name}" already exists`, 409);
  }
  
  // Generate UUID for the profile
  const profileId = crypto.randomUUID();
  
  return await db.profile.create({
    data: {
      id: profileId,
      name: data.name,
      gender: data.gender,
      gender_probability: data.gender_probability || 0,
      age: data.age,
      age_group: data.age_group,
      country_id: data.country_id,
      country_name: data.country_name,
      country_probability: data.country_probability || 0,
      created_by: data.created_by,
      created_at: new Date(),
    },
  });
};

/**
 * Update an existing profile
 */
export const updateProfile = async (id: string, data: UpdateProfileData) => {
  const db = getPrisma();
  
  // Check if profile exists
  const existingProfile = await db.profile.findUnique({
    where: { id },
  });
  
  if (!existingProfile) {
    return null;
  }
  
  // If name is being updated, check for uniqueness
  if (data.name && data.name !== existingProfile.name) {
    const nameExists = await db.profile.findUnique({
      where: { name: data.name },
    });
    
    if (nameExists) {
      throw new AppError(`Profile with name "${data.name}" already exists`, 409);
    }
  }
  
  // Update the profile
  return await db.profile.update({
    where: { id },
    data: {
      ...data,
      updated_at: new Date(),
    },
  });
};

/**
 * Delete a profile
 */
export const deleteProfile = async (id: string) => {
  const db = getPrisma();
  
  // Check if profile exists
  const existingProfile = await db.profile.findUnique({
    where: { id },
  });
  
  if (!existingProfile) {
    return null;
  }
  
  await db.profile.delete({
    where: { id },
  });
  
  return true;
};

/**
 * Export profiles to CSV or JSON
 */
export const exportProfiles = async (format: 'csv' | 'json') => {
  const db = getPrisma();
  
  const profiles = await db.profile.findMany({
    orderBy: { created_at: 'desc' },
  });
  
  if (format === 'json') {
    return profiles;
  }
  
  // Generate CSV
  const headers = [
    'id',
    'name',
    'gender',
    'gender_probability',
    'age',
    'age_group',
    'country_id',
    'country_name',
    'country_probability',
    'created_at',
  ];
  
  const csvRows = [headers.join(',')];
  
  for (const profile of profiles) {
    const values = headers.map(header => {
      const value = profile[header as keyof typeof profile];
      
      // Handle different value types
      if (value === null || value === undefined) {
        return '';
      }
      
      let stringValue = value.toString();
      
      // Escape quotes and wrap in quotes if contains comma or newline
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        stringValue = `"${stringValue.replace(/"/g, '""')}"`;
      }
      
      return stringValue;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
};

/**
 * Get statistics for dashboard
 */
export const getProfileStats = async () => {
  const db = getPrisma();
  
  const [
    totalProfiles,
    uniqueCountries,
    genderDistribution,
    ageGroupDistribution,
    ageStats,
    recentProfiles,
  ] = await Promise.all([
    // Total count
    db.profile.count(),
    
    // Unique countries
    db.profile.groupBy({
      by: ['country_name'],
      _count: true,
    }),
    
    // Gender distribution
    db.profile.groupBy({
      by: ['gender'],
      _count: true,
    }),
    
    // Age group distribution
    db.profile.groupBy({
      by: ['age_group'],
      _count: true,
    }),
    
    // Age statistics
    db.profile.aggregate({
      _avg: { age: true },
      _min: { age: true },
      _max: { age: true },
    }),
    
    // Recent 5 profiles
    db.profile.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        gender: true,
        age: true,
        country_name: true,
        created_at: true,
      },
    }),
  ]);
  
  return {
    total_profiles: totalProfiles,
    total_countries: uniqueCountries.length,
    average_age: Math.round(ageStats._avg.age || 0),
    min_age: ageStats._min.age || 0,
    max_age: ageStats._max.age || 0,
    gender_distribution: genderDistribution,
    age_group_distribution: ageGroupDistribution,
    top_countries: uniqueCountries
      .sort((a, b) => b._count - a._count)
      .slice(0, 5)
      .map(item => ({
        country: item.country_name,
        count: item._count,
      })),
    recent_profiles: recentProfiles,
  };
};

/**
 * Bulk create profiles (useful for seeding/data import)
 */
export const bulkCreateProfiles = async (profiles: CreateProfileData[]) => {
  const db = getPrisma();
  
  const results = [];
  const errors = [];
  
  for (const profile of profiles) {
    try {
      const created = await createProfile(profile);
      results.push(created);
    } catch (error) {
      errors.push({
        name: profile.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  return {
    success: results.length,
    failed: errors.length,
    results,
    errors,
  };
};

/**
 * Search profiles by text (additional search method)
 */
export const searchProfilesByText = async (searchTerm: string, limit: number = 20) => {
  const db = getPrisma();
  
  return await db.profile.findMany({
    where: {
      OR: [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { country_name: { contains: searchTerm, mode: 'insensitive' } },
        { gender: { contains: searchTerm, mode: 'insensitive' } },
        { age_group: { contains: searchTerm, mode: 'insensitive' } },
      ],
    },
    take: limit,
    orderBy: { created_at: 'desc' },
  });
};

/**
 * Get profiles by creator (user who created them)
 */
export const getProfilesByCreator = async (userId: number, filters: ProfileFilters = {}) => {
  const db = getPrisma();
  
  const where: Prisma.ProfileWhereInput = {
    created_by: userId,
  };
  
  // Apply additional filters
  if (filters.gender) where.gender = filters.gender;
  if (filters.age_group) where.age_group = filters.age_group;
  if (filters.country_id) where.country_id = filters.country_id;
  
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 10, 50);
  const skip = (page - 1) * limit;
  
  const [data, total] = await Promise.all([
    db.profile.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    db.profile.count({ where }),
  ]);
  
  return {
    status: 'success',
    page,
    limit,
    total,
    data,
  };
};