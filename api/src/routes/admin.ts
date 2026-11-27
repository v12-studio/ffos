import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ObjectId } from 'mongodb';
import type { AdminUserDTO, ResetLinkDTO } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import { badRequest, forbidden, notFound, oid } from '../lib/errors.ts';
import { randomToken, sha256 } from '../lib/tokens.ts';
import { requireAuth } from '../middleware/auth.ts';

// The instance owner (whoever set the app up) looks after everyone's accounts: they can see who has an
// account, give someone who's locked out a one-time reset link, and stop an account from signing in.

/** How long a reset link works. Long enough to pass on by message, short enough not to linger. */
export const RESET_LINK_HOURS = 24;

const requireInstanceOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user').isInstanceOwner) throw forbidden('Only the person who set up the app can manage accounts');
  await next();
});

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireInstanceOwner)

  .get('/users', async (c) => {
    const db = c.get('db');
    const users = await db.users.find({}, { projection: { passwordHash: 0 } }).sort({ createdAt: 1 }).toArray();
    const ids = users.map((u) => u._id);
    const [active, books] = await Promise.all([
      db.sessions
        .aggregate<{ _id: ObjectId; last: Date }>([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', last: { $max: '$lastUsedAt' } } }])
        .toArray(),
      db.bookMembers.aggregate<{ _id: ObjectId; n: number }>([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]).toArray(),
    ]);
    const lastBy = new Map(active.map((a) => [a._id.toHexString(), a.last]));
    const booksBy = new Map(books.map((b) => [b._id.toHexString(), b.n]));
    const result: AdminUserDTO[] = users.map((u) => {
      const id = u._id.toHexString();
      return {
        id,
        name: u.name,
        phone: u.phone,
        email: u.email ?? null,
        isInstanceOwner: u.isInstanceOwner,
        disabled: Boolean(u.disabledAt),
        createdAt: u.createdAt.toISOString(),
        lastActiveAt: lastBy.get(id)?.toISOString() ?? null,
        bookCount: booksBy.get(id) ?? 0,
        recoveryCodesLeft: u.recoveryCodeHashes?.length ?? 0,
      };
    });
    return c.json(result);
  })

  // A new link replaces any earlier one for the same person.
  .post('/users/:id/reset-link', async (c) => {
    const db = c.get('db');
    const userId = oid(c.req.param('id'));
    const user = await db.users.findOne({ _id: userId }, { projection: { _id: 1, disabledAt: 1 } });
    if (!user) throw notFound('Account not found');
    if (user.disabledAt) throw badRequest('Turn sign-in back on for this account first');
    const token = randomToken(24);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESET_LINK_HOURS * 3600_000);
    await db.passwordResets.deleteMany({ userId });
    await db.passwordResets.insertOne({ _id: new ObjectId(), userId, tokenHash: sha256(token), createdBy: c.get('userId'), createdAt: now, expiresAt });
    const result: ResetLinkDTO = { token, expiresAt: expiresAt.toISOString() };
    return c.json(result, 201);
  })

  // Disabling signs the person out everywhere; their entries stay in the books they belong to.
  .post('/users/:id/disable', async (c) => {
    const db = c.get('db');
    const userId = oid(c.req.param('id'));
    if (userId.equals(c.get('userId'))) throw badRequest("You can't turn off your own account");
    const res = await db.users.updateOne({ _id: userId }, { $set: { disabledAt: new Date(), updatedAt: new Date() } });
    if (res.matchedCount === 0) throw notFound('Account not found');
    await Promise.all([db.sessions.deleteMany({ userId }), db.passwordResets.deleteMany({ userId })]);
    return c.body(null, 204);
  })

  .post('/users/:id/enable', async (c) => {
    const res = await c
      .get('db')
      .users.updateOne({ _id: oid(c.req.param('id')) }, { $unset: { disabledAt: '' }, $set: { updatedAt: new Date() } });
    if (res.matchedCount === 0) throw notFound('Account not found');
    return c.body(null, 204);
  });
