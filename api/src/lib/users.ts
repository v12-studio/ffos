import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import type { AuthResponse, UserDTO } from '@ffos/shared';
import type { Collections, UserDoc } from '../db.ts';
import { env } from '../env.ts';
import { generateRecoveryCodes, normaliseRecoveryCode, randomToken, sha256, signAccessToken } from './tokens.ts';

const BCRYPT_ROUNDS = 10;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** Used when the phone doesn't exist, so response time doesn't reveal registered numbers. */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export function toUserDTO(user: UserDoc): UserDTO {
  return {
    id: user._id.toHexString(),
    name: user.name,
    phone: user.phone,
    email: user.email ?? null,
    isInstanceOwner: user.isInstanceOwner,
  };
}

export function newRecoveryCodes() {
  const codes = generateRecoveryCodes();
  return { codes, hashes: codes.map((c) => sha256(normaliseRecoveryCode(c))) };
}

export async function issueSession(db: Collections, user: UserDoc, deviceName: string): Promise<AuthResponse> {
  const refreshToken = randomToken();
  const now = new Date();
  const session = {
    _id: new ObjectId(),
    userId: user._id,
    refreshTokenHash: sha256(refreshToken),
    deviceName: deviceName || 'Unknown device',
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + env().refreshTokenTtlDays * 86_400_000),
  };
  await db.sessions.insertOne(session);
  return {
    user: toUserDTO(user),
    accessToken: await signAccessToken(user._id.toHexString(), session._id.toHexString()),
    refreshToken,
  };
}

/** Best-effort device label from the User-Agent, e.g. "Chrome on Android". */
export function deviceFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${os}`;
}
