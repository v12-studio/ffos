import { createMiddleware } from 'hono/factory';
import { ObjectId } from 'mongodb';
import type { AppEnv } from '../context.ts';
import { HttpError, unauthorized } from '../lib/errors.ts';
import { verifyAccessToken } from '../lib/tokens.ts';
import { loadBookAccess } from './book.ts';

const BOOK_PATH = /^\/api\/v1\/books\/([0-9a-f]{24})(?:\/|$)/;

/** Requires a valid access token whose session still exists and whose user isn't disabled. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims || !ObjectId.isValid(claims.userId) || !ObjectId.isValid(claims.sessionId)) throw unauthorized();

  const db = c.get('db');
  const userId = new ObjectId(claims.userId);
  const sessionId = new ObjectId(claims.sessionId);

  // For /books/:bookId/… requests, start requireBook's lookup now, alongside the session check, instead of
  // after it. The token's signature is already verified; requireBook only reads the result once auth passes.
  const bookId = BOOK_PATH.exec(c.req.path)?.[1];
  if (bookId) {
    const result = loadBookAccess(db, new ObjectId(bookId), userId);
    result.catch(() => undefined); // if auth fails below, nobody awaits it
    c.set('bookAccess', { bookId, result });
  }

  const [user, session] = await Promise.all([
    db.users.findOne({ _id: userId }),
    db.sessions.findOne({ _id: sessionId, userId }, { projection: { _id: 1 } }),
  ]);
  if (!user || user.disabledAt || !session) throw unauthorized();

  c.set('user', user);
  c.set('userId', userId);
  c.set('sessionId', sessionId);
  await next();
});

/** Generous enough for a family adding entries or importing statements; stops runaway scripts and abuse. */
export const WRITE_LIMIT = { max: 600, windowMs: 10 * 60_000 };

/** Counts each person's writes (POST, PUT, PATCH, DELETE) per window; past the limit, answers 429. */
export const limitWrites = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
  const window = Math.floor(Date.now() / WRITE_LIMIT.windowMs);
  const doc = await c
    .get('db')
    .rateLimits.findOneAndUpdate(
      { _id: `w:${c.get('userId').toHexString()}:${window}` },
      { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * WRITE_LIMIT.windowMs) } },
      { upsert: true, returnDocument: 'after' },
    );
  if ((doc?.n ?? 0) > WRITE_LIMIT.max) throw new HttpError(429, 'rate_limited', 'Too many changes in a short time. Wait a few minutes and try again.');
  await next();
});
