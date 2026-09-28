import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResponse } from '@ffos/shared';
import {
  api,
  createBook,
  expenseCategoryId,
  registerMember,
  resetDb,
  setupOwner,
  startTestApi,
  stopTestApi,
} from './helpers.ts';

beforeAll(startTestApi);
afterAll(stopTestApi);

let owner: AuthResponse;
let bookId: string;
let categoryId: string;
let m: Record<'admin' | 'editor' | 'contributor' | 'viewer', AuthResponse>;

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  categoryId = await expenseCategoryId(owner.accessToken, bookId);
  m = {
    admin: await registerMember(owner.accessToken, bookId, 'admin'),
    editor: await registerMember(owner.accessToken, bookId, 'editor'),
    contributor: await registerMember(owner.accessToken, bookId, 'contributor'),
    viewer: await registerMember(owner.accessToken, bookId, 'viewer'),
  };
});

const txn = (token: string, amount = 12345) =>
  api('POST', `/books/${bookId}/transactions`, {
    token,
    body: { type: 'expense', amount, date: '2026-09-15', categoryId, note: 'test' },
  });

describe('book isolation', () => {
  it('non-members get 404 for the book and everything in it', async () => {
    const otherBook = await createBook(owner.accessToken, 'Other');
    const outsider = await registerMember(owner.accessToken, otherBook.id, 'admin', 'Outsider');
    for (const path of ['', '/transactions', '/members', '/categories', '/summary']) {
      expect((await api('GET', `/books/${bookId}${path}`, { token: outsider.accessToken })).status).toBe(404);
    }
    expect((await txn(outsider.accessToken)).status).toBe(404);
  });

  it("can't touch another book's transaction through your own book", async () => {
    const created = await txn(owner.accessToken);
    const otherBook = await createBook(m.editor.accessToken, 'Editor stuff');
    const res = await api('DELETE', `/books/${otherBook.id}/transactions/${created.body.id}`, {
      token: m.editor.accessToken,
    });
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await api('GET', '/books')).status).toBe(401);
    expect((await api('GET', `/books/${bookId}/transactions`, { token: 'garbage' })).status).toBe(401);
  });
});

describe('transaction permissions', () => {
  it('viewer can read but not write', async () => {
    await txn(owner.accessToken);
    const list = await api('GET', `/books/${bookId}/transactions?month=2026-09`, { token: m.viewer.accessToken });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect((await txn(m.viewer.accessToken)).status).toBe(403);
  });

  it('contributor edits own records only', async () => {
    const mine = await txn(m.contributor.accessToken);
    expect(mine.status).toBe(201);
    expect(mine.body.createdByName).toBe('contributor');

    const editOwn = await api('PATCH', `/books/${bookId}/transactions/${mine.body.id}`, {
      token: m.contributor.accessToken,
      body: { amount: 500, version: 0 },
    });
    expect(editOwn.status).toBe(200);
    expect(editOwn.body).toMatchObject({ amount: 500, version: 1 });

    const ownersTxn = await txn(owner.accessToken);
    const editOther = await api('PATCH', `/books/${bookId}/transactions/${ownersTxn.body.id}`, {
      token: m.contributor.accessToken,
      body: { amount: 1, version: 0 },
    });
    expect(editOther.status).toBe(403);
    const deleteOther = await api('DELETE', `/books/${bookId}/transactions/${ownersTxn.body.id}`, {
      token: m.contributor.accessToken,
    });
    expect(deleteOther.status).toBe(403);
  });

  it('editor edits and deletes anyone’s records', async () => {
    const theirs = await txn(m.contributor.accessToken);
    const edit = await api('PATCH', `/books/${bookId}/transactions/${theirs.body.id}`, {
      token: m.editor.accessToken,
      body: { note: 'fixed by editor', version: 0 },
    });
    expect(edit.status).toBe(200);
    const del = await api('DELETE', `/books/${bookId}/transactions/${theirs.body.id}`, { token: m.editor.accessToken });
    expect(del.status).toBe(204);
  });

  it('rejects stale edits with 409', async () => {
    const t = await txn(owner.accessToken);
    await api('PATCH', `/books/${bookId}/transactions/${t.body.id}`, {
      token: m.editor.accessToken,
      body: { amount: 200, version: 0 },
    });
    const stale = await api('PATCH', `/books/${bookId}/transactions/${t.body.id}`, {
      token: owner.accessToken,
      body: { amount: 300, version: 0 },
    });
    expect(stale.status).toBe(409);
  });

  it('rejects a category from the wrong kind or another book', async () => {
    const cats = await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken });
    const incomeCat = cats.body.find((c: { kind: string }) => c.kind === 'income').id;
    const wrongKind = await api('POST', `/books/${bookId}/transactions`, {
      token: owner.accessToken,
      body: { type: 'expense', amount: 100, date: '2026-09-01', categoryId: incomeCat },
    });
    expect(wrongKind.status).toBe(400);

    const other = await createBook(owner.accessToken, 'Other');
    const otherCat = await expenseCategoryId(owner.accessToken, other.id);
    const crossBook = await api('POST', `/books/${bookId}/transactions`, {
      token: owner.accessToken,
      body: { type: 'expense', amount: 100, date: '2026-09-01', categoryId: otherCat },
    });
    expect(crossBook.status).toBe(400);
  });

  it('contributors can add a category, which stays in the book and is reused by name', async () => {
    const add = (token: string, name: string) =>
      api('POST', `/books/${bookId}/categories`, { token, body: { name, kind: 'expense' } });

    const created = await add(m.contributor.accessToken, 'Pet care');
    expect(created.status).toBe(201);
    expect((await add(m.viewer.accessToken, 'Plants')).status).toBe(403);

    const again = await add(m.editor.accessToken, '  pet CARE ');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);

    const cats = await api('GET', `/books/${bookId}/categories`, { token: m.viewer.accessToken });
    expect(cats.body.filter((c: { name: string }) => c.name === 'Pet care')).toHaveLength(1);

    const used = await api('POST', `/books/${bookId}/transactions`, {
      token: m.contributor.accessToken,
      body: { type: 'expense', amount: 500, date: '2026-09-02', categoryId: created.body.id },
    });
    expect(used.status).toBe(201);
  });

  it('summary totals the month', async () => {
    await txn(owner.accessToken, 10000);
    await txn(m.editor.accessToken, 2550);
    const summary = await api('GET', `/books/${bookId}/summary?month=2026-09`, { token: m.viewer.accessToken });
    expect(summary.body).toMatchObject({ expense: 12550, income: 0, net: -12550, count: 2 });
  });
});

describe('member management', () => {
  const memberId = (who: AuthResponse) => who.user.id;

  it('admin can manage editors but not other admins or the owner', async () => {
    const tok = m.admin.accessToken;
    expect(
      (await api('PATCH', `/books/${bookId}/members/${memberId(m.editor)}`, { token: tok, body: { role: 'viewer' } })).status,
    ).toBe(200);
    expect(
      (await api('PATCH', `/books/${bookId}/members/${owner.user.id}`, { token: tok, body: { role: 'viewer' } })).status,
    ).toBe(403);

    const admin2 = await registerMember(owner.accessToken, bookId, 'admin', 'admin2');
    expect(
      (await api('PATCH', `/books/${bookId}/members/${memberId(admin2)}`, { token: tok, body: { role: 'viewer' } })).status,
    ).toBe(403);
    expect((await api('DELETE', `/books/${bookId}/members/${memberId(admin2)}`, { token: tok })).status).toBe(403);
  });

  it('nobody can assign the owner role directly', async () => {
    const res = await api('PATCH', `/books/${bookId}/members/${memberId(m.editor)}`, {
      token: owner.accessToken,
      body: { role: 'owner' },
    });
    expect(res.status).toBe(400);
  });

  it('editors cannot invite or manage members', async () => {
    expect(
      (await api('POST', `/books/${bookId}/invites`, { token: m.editor.accessToken, body: { role: 'viewer' } })).status,
    ).toBe(403);
    expect(
      (await api('DELETE', `/books/${bookId}/members/${memberId(m.viewer)}`, { token: m.editor.accessToken })).status,
    ).toBe(403);
  });

  it('role changes and removals apply immediately', async () => {
    await api('PATCH', `/books/${bookId}/members/${memberId(m.viewer)}`, {
      token: owner.accessToken,
      body: { role: 'contributor' },
    });
    expect((await txn(m.viewer.accessToken)).status).toBe(201);

    await api('DELETE', `/books/${bookId}/members/${memberId(m.viewer)}`, { token: owner.accessToken });
    expect((await api('GET', `/books/${bookId}`, { token: m.viewer.accessToken })).status).toBe(404);
  });

  it('owner must transfer before leaving; others can leave', async () => {
    expect((await api('POST', `/books/${bookId}/leave`, { token: owner.accessToken })).status).toBe(400);
    expect((await api('POST', `/books/${bookId}/leave`, { token: m.viewer.accessToken })).status).toBe(204);

    const transfer = await api('POST', `/books/${bookId}/transfer`, {
      token: owner.accessToken,
      body: { userId: memberId(m.admin) },
    });
    expect(transfer.status).toBe(204);
    const asNewOwner = await api('GET', `/books/${bookId}`, { token: m.admin.accessToken });
    expect(asNewOwner.body.role).toBe('owner');
    const asOldOwner = await api('GET', `/books/${bookId}`, { token: owner.accessToken });
    expect(asOldOwner.body.role).toBe('admin');
    expect((await api('POST', `/books/${bookId}/leave`, { token: owner.accessToken })).status).toBe(204);
  });

  it('hides full phone numbers from non-managers', async () => {
    const asViewer = await api('GET', `/books/${bookId}/members`, { token: m.viewer.accessToken });
    expect(asViewer.body.every((x: { phone: string }) => x.phone.includes('•'))).toBe(true);
    const asOwner = await api('GET', `/books/${bookId}/members`, { token: owner.accessToken });
    expect(asOwner.body.some((x: { phone: string }) => x.phone === owner.user.phone)).toBe(true);
  });

  it('records activity', async () => {
    await txn(m.contributor.accessToken);
    const log = await api('GET', `/books/${bookId}/activity`, { token: m.editor.accessToken });
    expect(log.body[0]).toMatchObject({ userName: 'contributor', action: 'create', entity: 'transaction' });
    expect((await api('GET', `/books/${bookId}/activity`, { token: m.viewer.accessToken })).status).toBe(403);
  });
});
