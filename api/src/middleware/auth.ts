import { createMiddleware } from 'hono/factory';
import { ObjectId } from 'mongodb';
import type { AppEnv } from '../context.ts';
import { unauthorized } from '../lib/errors.ts';
import { verifyAccessToken } from '../lib/tokens.ts';

/** Requires a valid access token whose session still exists and whose user isn't disabled. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims || !ObjectId.isValid(claims.userId) || !ObjectId.isValid(claims.sessionId)) throw unauthorized();

  const db = c.get('db');
  const userId = new ObjectId(claims.userId);
  const sessionId = new ObjectId(claims.sessionId);
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
