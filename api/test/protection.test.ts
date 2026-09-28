import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResponse } from '@ffos/shared';
import { collections } from '../src/db.ts';
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
let m: Record<'editor' | 'contributor' | 'viewer', AuthResponse>;

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  categoryId = await expenseCategoryId(owner.accessToken, bookId);
  m = {
    editor: await registerMember(owner.accessToken, bookId, 'editor'),
    contributor: await registerMember(owner.accessToken, bookId, 'contributor'),
    viewer: await registerMember(owner.accessToken, bookId, 'viewer'),
  };
});

const add = async (token: string, note = 'test', amount = 12345) =>
  (
    await api('POST', `/books/${bookId}/transactions`, {
      token,
      body: { type: 'expense', amount, date: '2026-09-15', categoryId, note },
    })
  ).body as { id: string };

const remove = (token: string, id: string) => api('DELETE', `/books/${bookId}/transactions/${id}`, { token });
const deleted = (token: string) => api('GET', `/books/${bookId}/transactions/deleted`, { token });
const restore = (token: string, id: string) => api('POST', `/books/${bookId}/transactions/${id}/restore`, { token });

describe('recently deleted & restore', () => {
  it('lists deleted items with who deleted them and a 30-day purge date', async () => {
    const t = await add(m.contributor.accessToken);
    await remove(m.editor.accessToken, t.id);

    const list = await deleted(owner.accessToken);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: t.id, createdByName: 'contributor', deletedByName: 'editor' });
    const days = (Date.parse(list.body[0].purgeAt) - Date.parse(list.body[0].deletedAt)) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    // The purge date is stored so MongoDB's TTL index removes it permanently.
    const doc = await (await collections()).transactions.findOne({ note: 'test' });
    expect(doc?.purgeAt).toBeInstanceOf(Date);
  });

  it('restores the transaction back into lists and totals', async () => {
    const t = await add(owner.accessToken, 'rent', 50000);
    await remove(owner.accessToken, t.id);
    expect((await api('GET', `/books/${bookId}/summary?month=2026-09`, { token: owner.accessToken })).body.expense).toBe(0);

    const res = await restore(owner.accessToken, t.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(t.id);

    expect((await api('GET', `/books/${bookId}/summary?month=2026-09`, { token: owner.accessToken })).body.expense).toBe(50000);
    expect((await deleted(owner.accessToken)).body).toHaveLength(0);
    const doc = await (await collections()).transactions.findOne({ note: 'rent' });
    expect(doc?.purgeAt).toBeUndefined();

    expect((await restore(owner.accessToken, t.id)).status).toBe(404);
  });

  it('contributors see and restore only their own deletions', async () => {
    const mine = await add(m.contributor.accessToken, 'mine');
    const theirs = await add(owner.accessToken, 'theirs');
    await remove(m.contributor.accessToken, mine.id);
    await remove(owner.accessToken, theirs.id);

    const list = await deleted(m.contributor.accessToken);
    expect(list.body.map((t: { note: string }) => t.note)).toEqual(['mine']);
    expect((await restore(m.contributor.accessToken, theirs.id)).status).toBe(403);
    expect((await restore(m.contributor.accessToken, mine.id)).status).toBe(200);
  });

  it('viewers have no Recently deleted access', async () => {
    const t = await add(owner.accessToken);
    await remove(owner.accessToken, t.id);
    expect((await deleted(m.viewer.accessToken)).status).toBe(403);
    expect((await restore(m.viewer.accessToken, t.id)).status).toBe(403);
  });

  it('cannot restore across books', async () => {
    const t = await add(owner.accessToken);
    await remove(owner.accessToken, t.id);
    const other = await createBook(owner.accessToken, 'Other');
    const res = await api('POST', `/books/${other.id}/transactions/${t.id}/restore`, { token: owner.accessToken });
    expect(res.status).toBe(404);
  });

  it('records restore in the activity log', async () => {
    const t = await add(owner.accessToken);
    await remove(owner.accessToken, t.id);
    await restore(owner.accessToken, t.id);
    const log = await api('GET', `/books/${bookId}/activity`, { token: owner.accessToken });
    expect(log.body[0]).toMatchObject({ action: 'restore', entity: 'transaction' });
  });
});

describe('export', () => {
  it('only owner, admin and editor can export', async () => {
    expect((await api('GET', `/books/${bookId}/export`, { token: m.viewer.accessToken })).status).toBe(403);
    expect((await api('GET', `/books/${bookId}/export`, { token: m.contributor.accessToken })).status).toBe(403);
    expect((await api('GET', `/books/${bookId}/export`, { token: m.editor.accessToken })).status).toBe(200);
  });

  it('JSON backup has the book, categories and live transactions, without phone numbers', async () => {
    await add(owner.accessToken, 'kept', 2550);
    const gone = await add(owner.accessToken, 'gone');
    await remove(owner.accessToken, gone.id);

    const res = await api('GET', `/books/${bookId}/export`, { token: owner.accessToken });
    expect(res.body).toMatchObject({ format: 'ffos-book-export', version: 1, book: { name: 'Home', currency: 'INR' } });
    expect(res.body.categories.length).toBeGreaterThan(5);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({ note: 'kept', amountMinor: 2550, amount: '25.50', addedBy: 'Owner' });
    expect(res.body.members).toHaveLength(4);
    expect(JSON.stringify(res.body)).not.toContain(owner.user.phone);
  });

  it('CSV opens cleanly in spreadsheets and neutralises formulas', async () => {
    await add(owner.accessToken, 'Dinner, with "friends"', 42000);
    await add(owner.accessToken, '=HYPERLINK("http://x")', 100);

    const res = await fetchRaw(`/books/${bookId}/export?format=csv`, owner.accessToken);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const text = new TextDecoder().decode(bytes); // strips the BOM
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Type,Category,Amount,Currency,Note,Added by,Added at');
    expect(lines[1]).toContain('420.00,INR,"Dinner, with ""friends""",Owner');
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

// The shared helper parses JSON; CSV needs the raw response.
async function fetchRaw(path: string, token: string) {
  const { createApp } = await import('../src/app.ts');
  return createApp().request(`/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
}
