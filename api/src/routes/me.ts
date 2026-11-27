import { Hono } from 'hono';
import type { ObjectId } from 'mongodb';
import { changePasswordSchema, confirmPasswordSchema, pushSubscribeSchema, pushUnsubscribeSchema, updateMeSchema, type PushStatusDTO, type SessionDTO } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { Collections, UserDoc } from '../db.ts';
import { logActivity } from '../lib/books.ts';
import { badRequest, conflict, isDuplicateKey, notFound, oid, parse } from '../lib/errors.ts';
import { sendPush, vapidKeys } from '../lib/push.ts';
import { deviceFromUserAgent, hashPassword, newRecoveryCodes, toUserDTO, verifyPassword } from '../lib/users.ts';
import { requireAuth } from '../middleware/auth.ts';

async function assertPassword(user: UserDoc, password: string) {
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw badRequest('Password is incorrect', { password: 'Password is incorrect' });
  }
}

/** Removes a book and everything in it, for good. */
async function purgeBook(db: Collections, bookId: ObjectId) {
  await Promise.all([
    db.transactions.deleteMany({ bookId }),
    db.categories.deleteMany({ bookId }),
    db.budgets.deleteMany({ bookId }),
    db.recurring.deleteMany({ bookId }),
    db.invites.deleteMany({ bookId }),
    db.activity.deleteMany({ bookId }),
    db.bookMembers.deleteMany({ bookId }),
    db.accounts.deleteMany({ bookId }),
    db.transfers.deleteMany({ bookId }),
  ]);
  await db.books.deleteOne({ _id: bookId });
}

export const meRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', (c) => c.json(toUserDTO(c.get('user'))))

  .patch('/', async (c) => {
    const body = await c.req.json();
    const input = parse(updateMeSchema, body);
    const db = c.get('db');
    const user = c.get('user');
    const clearEmail = 'email' in body && !input.email;
    try {
      await db.users.updateOne(
        { _id: user._id },
        {
          $set: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.email ? { email: input.email } : {}),
            ...(input.notify ? { notify: input.notify } : {}),
            updatedAt: new Date(),
          },
          ...(clearEmail ? { $unset: { email: '' as const } } : {}),
        },
      );
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('This email is already used by another account');
      throw err;
    }
    const updated = await db.users.findOne({ _id: user._id });
    return c.json(toUserDTO(updated!));
  })

  // Changing the password signs out every other device.
  .post('/password', async (c) => {
    const input = parse(changePasswordSchema, await c.req.json());
    const db = c.get('db');
    const user = c.get('user');
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    await db.users.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() } },
    );
    await db.sessions.deleteMany({ userId: user._id, _id: { $ne: c.get('sessionId') } });
    return c.body(null, 204);
  })

  // ── notifications ──
  .get('/push', async (c) => {
    const subs = await c.get('db').pushSubscriptions.find({ userId: c.get('userId') }, { projection: { endpoint: 1 } }).toArray();
    const result: PushStatusDTO = { publicKey: vapidKeys()?.publicKey ?? null, endpoints: subs.map((s) => s.endpoint) };
    return c.json(result);
  })

  .post('/push', async (c) => {
    if (!vapidKeys()) throw badRequest("Notifications aren't set up on the server yet");
    const input = parse(pushSubscribeSchema, await c.req.json());
    // A browser's subscription belongs to whoever is signed in on it now.
    await c.get('db').pushSubscriptions.updateOne(
      { endpoint: input.endpoint },
      {
        $set: { userId: c.get('userId'), p256dh: input.keys.p256dh, auth: input.keys.auth, device: deviceFromUserAgent(c.req.header('user-agent')) },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return c.body(null, 204);
  })

  .delete('/push', async (c) => {
    const { endpoint } = parse(pushUnsubscribeSchema, await c.req.json());
    await c.get('db').pushSubscriptions.deleteOne({ endpoint, userId: c.get('userId') });
    return c.body(null, 204);
  })

  // A test notification to every device this person turned notifications on for.
  .post('/push/test', async (c) => {
    const keys = vapidKeys();
    if (!keys) throw badRequest("Notifications aren't set up on the server yet");
    const db = c.get('db');
    const subs = await db.pushSubscriptions.find({ userId: c.get('userId') }).toArray();
    let sent = 0;
    for (const sub of subs) {
      const result = await sendPush(sub, { title: 'Family Finance OS', body: 'Notifications are working. You will hear about bills due and budgets running low.', url: '#/', tag: 'ffos-test' }, keys);
      if (result === 'gone') await db.pushSubscriptions.deleteOne({ _id: sub._id });
      if (result === 'sent') sent++;
    }
    return c.json({ sent, devices: subs.length });
  })

  // New recovery codes replace all the old ones; shown once.
  .post('/recovery-codes', async (c) => {
    const { password } = parse(confirmPasswordSchema, await c.req.json());
    const user = c.get('user');
    await assertPassword(user, password);
    const recovery = newRecoveryCodes();
    await c.get('db').users.updateOne({ _id: user._id }, { $set: { recoveryCodeHashes: recovery.hashes, updatedAt: new Date() } });
    return c.json({ codes: recovery.codes });
  })

  // Everything the app holds about this person: profile, devices, books, and every entry they added.
  .get('/export', async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const [sessions, memberships, added] = await Promise.all([
      db.sessions.find({ userId: user._id }).toArray(),
      db.bookMembers.find({ userId: user._id }).toArray(),
      db.transactions.find({ createdBy: user._id, deletedAt: { $exists: false } }).sort({ date: 1 }).toArray(),
    ]);
    const bookIds = [...new Set([...memberships.map((m) => m.bookId.toHexString()), ...added.map((t) => t.bookId.toHexString())])];
    const [books, categories] = await Promise.all([
      db.books.find({ _id: { $in: bookIds.map((id) => oid(id)) } }, { projection: { name: 1, currency: 1 } }).toArray(),
      db.categories.find({ _id: { $in: [...new Set(added.map((t) => t.categoryId.toHexString()))].map((id) => oid(id)) } }, { projection: { name: 1 } }).toArray(),
    ]);
    const bookById = new Map(books.map((b) => [b._id.toHexString(), b]));
    const categoryName = new Map(categories.map((cat) => [cat._id.toHexString(), cat.name]));
    return c.json({
      format: 'ffos-account-export',
      exportedAt: new Date().toISOString(),
      profile: { name: user.name, phone: user.phone, email: user.email ?? null, createdAt: user.createdAt.toISOString() },
      devices: sessions.map((s) => ({ device: s.deviceName, signedInAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString() })),
      books: memberships.map((m) => ({ book: bookById.get(m.bookId.toHexString())?.name ?? null, role: m.role, joinedAt: m.joinedAt.toISOString() })),
      entriesAdded: added.map((t) => ({
        book: bookById.get(t.bookId.toHexString())?.name ?? null,
        currency: bookById.get(t.bookId.toHexString())?.currency ?? null,
        date: t.date,
        type: t.type,
        amount: (t.amount / 100).toFixed(2),
        category: categoryName.get(t.categoryId.toHexString()) ?? null,
        note: t.note,
        addedAt: t.createdAt.toISOString(),
      })),
    });
  })

  // Deletes the account. Books only this person uses go with it; books shared with others must be handed
  // over or deleted first, so nobody else loses their data. Entries they added to other people's books stay.
  .delete('/', async (c) => {
    const { password } = parse(confirmPasswordSchema, await c.req.json());
    const db = c.get('db');
    const user = c.get('user');
    await assertPassword(user, password);

    if (user.isInstanceOwner && (await db.users.countDocuments({ _id: { $ne: user._id } })) > 0) {
      throw badRequest("You set up this app, so your account looks after everyone else's. It can only be deleted once you're the only account.");
    }
    const owned = await db.books.find({ ownerId: user._id }).toArray();
    const ownedIds = owned.map((b) => b._id);
    const others = await db.bookMembers
      .aggregate<{ _id: ObjectId }>([{ $match: { bookId: { $in: ownedIds }, userId: { $ne: user._id } } }, { $group: { _id: '$bookId' } }])
      .toArray();
    const shared = owned.filter((b) => !b.deletedAt && others.some((o) => o._id.equals(b._id)));
    if (shared.length) {
      throw badRequest(
        `First make someone else the owner of, or delete: ${shared.map((b) => b.name).join(', ')}. Other people use ${shared.length === 1 ? 'it' : 'them'}.`,
      );
    }

    for (const book of owned) await purgeBook(db, book._id);
    const memberships = await db.bookMembers.find({ userId: user._id }).toArray();
    for (const m of memberships) {
      await logActivity(db, { bookId: m.bookId, userId: user._id, action: 'leave', entity: 'member', entityId: user._id, summary: 'left the book (account deleted)' });
    }
    await Promise.all([
      db.bookMembers.deleteMany({ userId: user._id }),
      db.sessions.deleteMany({ userId: user._id }),
      db.passwordResets.deleteMany({ userId: user._id }),
      db.pushSubscriptions.deleteMany({ userId: user._id }),
    ]);
    await db.users.deleteOne({ _id: user._id });
    // The instance owner was the last account: the app can be set up afresh.
    if (user.isInstanceOwner) await db.meta.deleteOne({ _id: 'setup' });
    return c.body(null, 204);
  })

  .get('/sessions', async (c) => {
    const sessions = await c
      .get('db')
      .sessions.find({ userId: c.get('userId') })
      .sort({ lastUsedAt: -1 })
      .toArray();
    const current = c.get('sessionId');
    const result: SessionDTO[] = sessions.map((s) => ({
      id: s._id.toHexString(),
      deviceName: s.deviceName,
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s._id.equals(current),
    }));
    return c.json(result);
  })

  .delete('/sessions/:id', async (c) => {
    const res = await c.get('db').sessions.deleteOne({ _id: oid(c.req.param('id')), userId: c.get('userId') });
    if (res.deletedCount === 0) throw notFound('Session not found');
    return c.body(null, 204);
  });
