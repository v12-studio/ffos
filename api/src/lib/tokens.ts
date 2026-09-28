import { createHash, randomBytes, randomInt } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../env.ts';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env().accessTokenTtlSec}s`)
    .setAudience('ffos')
    .sign(env().jwtSecret);
}

/** Returns the user and session ids, or null if the token is invalid or expired. */
export async function verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, env().jwtSecret, { audience: 'ffos', algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Recovery codes look like "k7m2-9xqp"; stored as sha256 of the normalised form. */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
