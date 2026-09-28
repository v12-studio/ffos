export interface Env {
  mongodbUri: string;
  mongodbDb: string;
  jwtSecret: Uint8Array;
  corsOrigins: string[];
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
  inviteTtlDays: number;
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const secret = required('JWT_SECRET');
  if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  cached = {
    mongodbUri: required('MONGODB_URI'),
    mongodbDb: process.env.MONGODB_DB || 'ffos',
    jwtSecret: new TextEncoder().encode(secret),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    accessTokenTtlSec: 15 * 60,
    refreshTokenTtlDays: 30,
    inviteTtlDays: 7,
  };
  return cached;
}

/** For tests only. */
export function resetEnv() {
  cached = undefined;
}
