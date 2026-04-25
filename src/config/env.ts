// src/config/env.ts
export const env = {
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,
};

if (!env.jwtAccessSecret) {
  throw new Error('JWT_ACCESS_SECRET is not defined');
}