import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createBook, invite, nextPhone, resetDb, setupOwner, startTestApi, stopTestApi } from './helpers.ts';

beforeAll(startTestApi);
afterAll(stopTestApi);
beforeEach(resetDb);

describe('setup', () => {
  it('works once, then is locked', async () => {
    expect((await api('GET', '/auth/status')).body).toEqual({ setupRequired: true });
    const owner = await setupOwner();
    expect(owner.user.isInstanceOwner).toBe(true);
    expect(owner.recoveryCodes).toHaveLength(8);

    const again = await api('POST', '/auth/setup', { body: { name: 'X', phone: nextPhone(), password: 'password123' } });
    expect(again.status).toBe(403);
    expect((await api('GET', '/auth/status')).body).toEqual({ setupRequired: false });
  });

  it('creates a private Personal book', async () => {
    const owner = await setupOwner();
    const books = await api('GET', '/books', { token: owner.accessToken });
    expect(books.body).toHaveLength(1);
    expect(books.body[0]).toMatchObject({ name: 'Personal', isPersonal: true, role: 'owner' });

    const inv = await api('POST', `/books/${books.body[0].id}/invites`, { token: owner.accessToken, body: { role: 'viewer' } });
    expect(inv.status).toBe(400);
  });

  it('validates phone format', async () => {
    const res = await api('POST', '/auth/setup', { body: { name: 'X', phone: '98765', password: 'password123' } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.phone).toBeTruthy();
  });
});

describe('login & sessions', () => {
  it('logs in, rejects bad passwords, and rate limits', async () => {
    const owner = await setupOwner();
    const ok = await api('POST', '/auth/login', { body: { phone: owner.user.phone, password: 'password123' } });
    expect(ok.status).toBe(200);

    for (let i = 0; i < 5; i++) {
      const bad = await api('POST', '/auth/login', { body: { phone: owner.user.phone, password: 'wrong' } });
      expect(bad.status).toBe(401);
    }
    const limited = await api('POST', '/auth/login', { body: { phone: owner.user.phone, password: 'password123' } });
    expect(limited.status).toBe(429);
  });

  it('rotates refresh tokens and logout revokes the session immediately', async () => {
    const owner = await setupOwner();
    const r1 = await api('POST', '/auth/refresh', { body: { refreshToken: owner.refreshToken } });
    expect(r1.status).toBe(200);
    const reuse = await api('POST', '/auth/refresh', { body: { refreshToken: owner.refreshToken } });
    expect(reuse.status).toBe(401);

    expect((await api('GET', '/me', { token: r1.body.accessToken })).status).toBe(200);
    await api('POST', '/auth/logout', { body: { refreshToken: r1.body.refreshToken } });
    expect((await api('GET', '/me', { token: r1.body.accessToken })).status).toBe(401);
  });

  it('recovers with a one-time code and signs out everywhere', async () => {
    const owner = await setupOwner();
    const code = owner.recoveryCodes![0]!;
    const rec = await api('POST', '/auth/recover', { body: { phone: owner.user.phone, code, newPassword: 'newpassword1' } });
    expect(rec.status).toBe(200);
    expect(rec.body.remainingCodes).toBe(7);
    expect((await api('GET', '/me', { token: owner.accessToken })).status).toBe(401);

    const reuse = await api('POST', '/auth/recover', { body: { phone: owner.user.phone, code, newPassword: 'another123' } });
    expect(reuse.status).toBe(401);
    const login = await api('POST', '/auth/login', { body: { phone: owner.user.phone, password: 'newpassword1' } });
    expect(login.status).toBe(200);
  });
});

describe('invite-only registration', () => {
  it('requires a valid invite, is single-use, and honours phone restriction', async () => {
    const owner = await setupOwner();
    const book = await createBook(owner.accessToken, 'Home');

    const noInvite = await api('POST', '/auth/register', {
      body: { inviteToken: 'nonexistent-token', name: 'A', phone: nextPhone(), password: 'password123' },
    });
    expect(noInvite.status).toBe(404);

    const restrictedPhone = nextPhone();
    const restricted = await invite(owner.accessToken, book.id, 'editor', restrictedPhone);
    const wrongPhone = await api('POST', '/auth/register', {
      body: { inviteToken: restricted, name: 'B', phone: nextPhone(), password: 'password123' },
    });
    expect(wrongPhone.status).toBe(403);

    const reg = await api('POST', '/auth/register', {
      body: { inviteToken: restricted, name: 'B', phone: restrictedPhone, password: 'password123' },
    });
    expect(reg.status).toBe(201);
    expect(reg.body.joinedBookId).toBe(book.id);

    const reused = await api('POST', '/auth/register', {
      body: { inviteToken: restricted, name: 'C', phone: nextPhone(), password: 'password123' },
    });
    expect(reused.status).toBe(410);

    const books = await api('GET', '/books', { token: reg.body.accessToken });
    expect(books.body.map((b: { name: string; role: string }) => [b.name, b.role])).toEqual([
      ['Personal', 'owner'],
      ['Home', 'editor'],
    ]);
  });

  it('does not burn the invite when registration fails', async () => {
    const owner = await setupOwner();
    const book = await createBook(owner.accessToken, 'Home');
    const token = await invite(owner.accessToken, book.id, 'viewer');
    const dup = await api('POST', '/auth/register', {
      body: { inviteToken: token, name: 'Dup', phone: owner.user.phone, password: 'password123' },
    });
    expect(dup.status).toBe(409);
    const ok = await api('POST', '/auth/register', {
      body: { inviteToken: token, name: 'New', phone: nextPhone(), password: 'password123' },
    });
    expect(ok.status).toBe(201);
  });

  it('revoked invites cannot be used', async () => {
    const owner = await setupOwner();
    const book = await createBook(owner.accessToken, 'Home');
    await invite(owner.accessToken, book.id, 'viewer');
    const list = await api('GET', `/books/${book.id}/invites`, { token: owner.accessToken });
    expect(list.body).toHaveLength(1);
    await api('DELETE', `/books/${book.id}/invites/${list.body[0].id}`, { token: owner.accessToken });
    expect((await api('GET', `/books/${book.id}/invites`, { token: owner.accessToken })).body).toHaveLength(0);
  });
});
