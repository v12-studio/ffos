import { Hono } from 'hono';
import type { InvitePreviewDTO } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import { acceptInvite, findUsableInvite } from '../lib/invites.ts';
import { requireAuth } from '../middleware/auth.ts';

export const inviteRoutes = new Hono<AppEnv>()
  // Public: lets the invite page show "Join <book> as <role>" before sign-in.
  .get('/:token', async (c) => {
    const db = c.get('db');
    const invite = await findUsableInvite(db, c.req.param('token'));
    const [book, inviter] = await Promise.all([
      db.books.findOne({ _id: invite.bookId }, { projection: { name: 1 } }),
      db.users.findOne({ _id: invite.createdBy }, { projection: { name: 1 } }),
    ]);
    const result: InvitePreviewDTO = {
      bookName: book?.name ?? 'A book',
      role: invite.role,
      invitedByName: inviter?.name ?? 'Someone',
      phoneRestricted: Boolean(invite.phone),
      expiresAt: invite.expiresAt.toISOString(),
    };
    return c.json(result);
  })

  .post('/:token/accept', requireAuth, async (c) => {
    const invite = await acceptInvite(c.get('db'), c.req.param('token'), c.get('user'));
    return c.json({ bookId: invite.bookId.toHexString() });
  });
