import { Hono } from 'hono';
import { changePasswordSchema, updateMeSchema, type SessionDTO } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import { badRequest, conflict, isDuplicateKey, notFound, oid, parse } from '../lib/errors.ts';
import { hashPassword, toUserDTO, verifyPassword } from '../lib/users.ts';
import { requireAuth } from '../middleware/auth.ts';

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
