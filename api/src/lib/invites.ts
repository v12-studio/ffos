import { ObjectId } from 'mongodb';
import type { Collections, InviteDoc } from '../db.ts';
import { conflict, HttpError, notFound } from './errors.ts';
import { logActivity } from './books.ts';
import { sha256 } from './tokens.ts';

const gone = (message: string) => new HttpError(410, 'invite_unusable', message);

/** Finds an invite by raw token and checks it can still be used (book exists, not used/revoked/expired). */
export async function findUsableInvite(db: Collections, token: string): Promise<InviteDoc> {
  const invite = await db.invites.findOne({ tokenHash: sha256(token) });
  if (!invite) throw notFound('This invite link is not valid');
  if (invite.revokedAt) throw gone('This invite was cancelled');
  if (invite.usedAt) throw gone('This invite has already been used');
  if (invite.expiresAt <= new Date()) throw gone('This invite has expired');
  const book = await db.books.findOne({ _id: invite.bookId, deletedAt: { $exists: false } });
  if (!book) throw gone('This book no longer exists');
  return invite;
}

/** Atomically marks the invite as used; fails if someone else got there first. */
export async function claimInvite(db: Collections, invite: InviteDoc, userId: ObjectId) {
  const res = await db.invites.updateOne(
    { _id: invite._id, usedAt: { $exists: false }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date(), usedBy: userId } },
  );
  if (res.modifiedCount !== 1) throw gone('This invite has already been used');
}

export async function releaseInvite(db: Collections, invite: InviteDoc, userId: ObjectId) {
  await db.invites.updateOne({ _id: invite._id, usedBy: userId }, { $unset: { usedAt: '', usedBy: '' } });
}

export async function addMember(db: Collections, invite: InviteDoc, userId: ObjectId) {
  await db.bookMembers.insertOne({
    _id: new ObjectId(),
    bookId: invite.bookId,
    userId,
    role: invite.role,
    invitedBy: invite.createdBy,
    joinedAt: new Date(),
  });
  await logActivity(db, {
    bookId: invite.bookId,
    userId,
    action: 'join',
    entity: 'member',
    entityId: userId,
    summary: `joined as ${invite.role}`,
  });
}

/** Existing user accepting an invite. */
export async function acceptInvite(db: Collections, token: string, user: { _id: ObjectId; phone: string }) {
  const invite = await findUsableInvite(db, token);
  if (invite.phone && invite.phone !== user.phone) {
    throw new HttpError(403, 'forbidden', 'This invite is for a different phone number');
  }
  const existing = await db.bookMembers.findOne({ bookId: invite.bookId, userId: user._id });
  if (existing) throw conflict('You are already a member of this book', 'already_member');
  await claimInvite(db, invite, user._id);
  await addMember(db, invite, user._id);
  return invite;
}
