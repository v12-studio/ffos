import { Hono, type Context } from 'hono';
import { ObjectId } from 'mongodb';
import { loginSchema, recoverSchema, refreshSchema, registerSchema, setupSchema } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { Collections, UserDoc } from '../db.ts';
import { env } from '../env.ts';
import { createBook } from '../lib/books.ts';
import { conflict, forbidden, HttpError, isDuplicateKey, parse, unauthorized } from '../lib/errors.ts';
import { addMember, claimInvite, findUsableInvite, releaseInvite } from '../lib/invites.ts';
import { normaliseRecoveryCode, randomToken, sha256, signAccessToken } from '../lib/tokens.ts';
import {
  deviceFromUserAgent,
  DUMMY_HASH,
  hashPassword,
  issueSession,
  newRecoveryCodes,
  verifyPassword,
} from '../lib/users.ts';

const MAX_FAILURES_PER_PHONE = 5;
const MAX_FAILURES_PER_IP = 20;
const FAILURE_WINDOW_MS = 15 * 60_000;

function clientIp(c: Context<AppEnv>): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
}

async function assertNotRateLimited(db: Collections, phone: string, ip: string) {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  const [byPhone, byIp] = await Promise.all([
    db.loginAttempts.countDocuments({ phone, at: { $gte: since } }),
    db.loginAttempts.countDocuments({ ip, at: { $gte: since } }),
  ]);
  if (byPhone >= MAX_FAILURES_PER_PHONE || byIp >= MAX_FAILURES_PER_IP) {
    throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.');
  }
}

async function createUser(
  db: Collections,
  input: { name: string; phone: string; email?: string; password: string },
  isInstanceOwner: boolean,
  userId = new ObjectId(),
) {
  const now = new Date();
  const recovery = newRecoveryCodes();
  const user: UserDoc = {
    _id: userId,
    name: input.name,
    phone: input.phone,
    ...(input.email ? { email: input.email } : {}),
    passwordHash: await hashPassword(input.password),
    isInstanceOwner,
    recoveryCodeHashes: recovery.hashes,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.users.insertOne(user);
  } catch (err) {
    if (isDuplicateKey(err)) {
      const field = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0];
      throw conflict(
        field === 'email' ? 'This email is already registered' : 'This phone number is already registered',
        'already_registered',
      );
    }
    throw err;
  }
  await createBook(db, user._id, { name: 'Personal', currency: 'INR', isPersonal: true });
  return { user, recoveryCodes: recovery.codes };
}

export const authRoutes = new Hono<AppEnv>()
  .get('/status', async (c) => {
    const db = c.get('db');
    const setupDone = await db.meta.findOne({ _id: 'setup' });
    return c.json({ setupRequired: !setupDone });
  })

  // First-run: creates the instance owner. Works exactly once.
  .post('/setup', async (c) => {
    const input = parse(setupSchema, await c.req.json());
    const db = c.get('db');
    try {
      await db.meta.insertOne({ _id: 'setup', at: new Date() });
    } catch (err) {
      if (isDuplicateKey(err)) throw forbidden('Setup has already been completed');
      throw err;
    }
    try {
      const { user, recoveryCodes } = await createUser(db, input, true);
      const session = await issueSession(db, user, deviceFromUserAgent(c.req.header('user-agent')));
      return c.json({ ...session, recoveryCodes }, 201);
    } catch (err) {
      await db.meta.deleteOne({ _id: 'setup' });
      throw err;
    }
  })

  // Invite-only registration.
  .post('/register', async (c) => {
    const input = parse(registerSchema, await c.req.json());
    const db = c.get('db');
    const invite = await findUsableInvite(db, input.inviteToken);
    if (invite.phone && invite.phone !== input.phone) {
      throw forbidden('This invite is for a different phone number');
    }
    // Claim the invite first so two people can't register with the same link.
    const userId = new ObjectId();
    await claimInvite(db, invite, userId);
    let created;
    try {
      created = await createUser(db, input, false, userId);
    } catch (err) {
      await releaseInvite(db, invite, userId);
      throw err;
    }
    const { user, recoveryCodes } = created;
    await addMember(db, invite, user._id);
    const session = await issueSession(db, user, deviceFromUserAgent(c.req.header('user-agent')));
    return c.json({ ...session, recoveryCodes, joinedBookId: invite.bookId.toHexString() }, 201);
  })

  .post('/login', async (c) => {
    const input = parse(loginSchema, await c.req.json());
    const db = c.get('db');
    const ip = clientIp(c);
    await assertNotRateLimited(db, input.phone, ip);

    const user = await db.users.findOne({ phone: input.phone });
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await db.loginAttempts.insertOne({ phone: input.phone, ip, at: new Date() });
      throw unauthorized('Incorrect phone number or password');
    }
    if (user.disabledAt) throw forbidden('This account has been disabled');

    await db.loginAttempts.deleteMany({ phone: input.phone });
    return c.json(await issueSession(db, user, input.deviceName || deviceFromUserAgent(c.req.header('user-agent'))));
  })

  // Rotates the refresh token: the old one stops working immediately.
  .post('/refresh', async (c) => {
    const { refreshToken } = parse(refreshSchema, await c.req.json());
    const db = c.get('db');
    const nextToken = randomToken();
    const now = new Date();
    const session = await db.sessions.findOneAndUpdate(
      { refreshTokenHash: sha256(refreshToken), expiresAt: { $gt: now } },
      {
        $set: {
          refreshTokenHash: sha256(nextToken),
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + env().refreshTokenTtlDays * 86_400_000),
        },
      },
      { returnDocument: 'after' },
    );
    if (!session) throw unauthorized();
    const user = await db.users.findOne({ _id: session.userId });
    if (!user || user.disabledAt) {
      await db.sessions.deleteOne({ _id: session._id });
      throw unauthorized();
    }
    return c.json({
      accessToken: await signAccessToken(user._id.toHexString(), session._id.toHexString()),
      refreshToken: nextToken,
    });
  })

  .post('/logout', async (c) => {
    const { refreshToken } = parse(refreshSchema, await c.req.json());
    await c.get('db').sessions.deleteOne({ refreshTokenHash: sha256(refreshToken) });
    return c.body(null, 204);
  })

  // Reset password with a one-time recovery code; signs out all devices.
  .post('/recover', async (c) => {
    const input = parse(recoverSchema, await c.req.json());
    const db = c.get('db');
    const ip = clientIp(c);
    await assertNotRateLimited(db, input.phone, ip);

    const codeHash = sha256(normaliseRecoveryCode(input.code));
    const user = await db.users.findOneAndUpdate(
      { phone: input.phone, recoveryCodeHashes: codeHash, disabledAt: { $exists: false } },
      {
        $pull: { recoveryCodeHashes: codeHash },
        $set: { passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() },
      },
    );
    if (!user) {
      await db.loginAttempts.insertOne({ phone: input.phone, ip, at: new Date() });
      throw unauthorized('Phone number or recovery code is incorrect');
    }
    await db.sessions.deleteMany({ userId: user._id });
    return c.json({ remainingCodes: user.recoveryCodeHashes.length - 1 });
  });
