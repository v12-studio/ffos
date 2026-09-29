import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentAppMonth,
  shiftMonthKey,
  todayInAppZone,
  type AuthResponse,
  type CategoryDTO,
  type RecurringDueDTO,
  type TransactionDTO,
  type TransactionSearchDTO,
  type TrendsDTO,
} from '@ffos/shared';
import { api, createBook, registerMember, resetDb, setupOwner, startTestApi, stopTestApi } from './helpers.ts';

beforeAll(startTestApi);
afterAll(stopTestApi);

let owner: AuthResponse;
let bookId: string;
let cats: CategoryDTO[];

const cat = (name: string) => cats.find((c) => c.name === name)!;
const thisMonth = () => currentAppMonth();

async function loadCategories(token = owner.accessToken) {
  cats = (await api<CategoryDTO[]>('GET', `/books/${bookId}/categories`, { token })).body;
  return cats;
}

const add = (body: Record<string, unknown>, token = owner.accessToken) =>
  api<TransactionDTO>('POST', `/books/${bookId}/transactions`, {
    token,
    body: { type: 'expense', amount: 10000, date: todayInAppZone(), categoryId: cat('Groceries').id, note: '', ...body },
  });

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  await loadCategories();
});

describe('Mumbai time', () => {
  it('uses the Mumbai date even when UTC is still on the previous day', () => {
    // 20:00 UTC on 31 Jan is 01:30 on 1 Feb in Mumbai.
    const now = new Date('2026-01-31T20:00:00Z');
    expect(todayInAppZone(now)).toBe('2026-02-01');
    expect(currentAppMonth(now)).toBe('2026-02');
  });

  it("the server's default month is the Mumbai month", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-31T20:00:00Z'));
    try {
      const res = await api('GET', `/books/${bookId}/summary`, { token: owner.accessToken });
      expect(res.body.month).toBe('2026-02');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('managing categories', () => {
  it('renames, recolours and hides a category; hidden ones stay listed but flagged', async () => {
    const id = cat('Groceries').id;
    const renamed = await api('PATCH', `/books/${bookId}/categories/${id}`, {
      token: owner.accessToken,
      body: { name: 'Groceries & Milk', color: '#123456', icon: 'cart' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Groceries & Milk', color: '#123456', archived: false });

    const hidden = await api('PATCH', `/books/${bookId}/categories/${id}`, { token: owner.accessToken, body: { archived: true } });
    expect(hidden.body.archived).toBe(true);
    await loadCategories();
    expect(cats.find((c) => c.id === id)?.archived).toBe(true);
  });

  it('rejects a duplicate name and protects "Other"', async () => {
    const dup = await api('PATCH', `/books/${bookId}/categories/${cat('Groceries').id}`, {
      token: owner.accessToken,
      body: { name: 'rent' },
    });
    expect(dup.status).toBe(409);
    const other = cat('Other').id;
    expect((await api('PATCH', `/books/${bookId}/categories/${other}`, { token: owner.accessToken, body: { name: 'Misc' } })).status).toBe(400);
    expect((await api('PATCH', `/books/${bookId}/categories/${other}`, { token: owner.accessToken, body: { archived: true } })).status).toBe(400);
  });

  it('reorders one kind', async () => {
    const expense = cats.filter((c) => c.kind === 'expense').map((c) => c.id);
    const reversed = [...expense].reverse();
    const res = await api<CategoryDTO[]>('PUT', `/books/${bookId}/categories/order`, {
      token: owner.accessToken,
      body: { kind: 'expense', ids: reversed },
    });
    expect(res.status).toBe(200);
    expect(res.body.filter((c) => c.kind === 'expense').map((c) => c.id)).toEqual(reversed);
  });

  it('only admins and owners can manage categories', async () => {
    const editor = await registerMember(owner.accessToken, bookId, 'editor');
    const res = await api('PATCH', `/books/${bookId}/categories/${cat('Rent').id}`, {
      token: editor.accessToken,
      body: { name: 'House rent' },
    });
    expect(res.status).toBe(403);
  });

  it('hidden categories are not usable for new entries, but old entries can still be edited', async () => {
    const t = (await add({ note: 'milk' })).body;
    await api('PATCH', `/books/${bookId}/categories/${cat('Groceries').id}`, { token: owner.accessToken, body: { archived: true } });
    expect((await add({})).status).toBe(400);
    const edit = await api('PATCH', `/books/${bookId}/transactions/${t.id}`, {
      token: owner.accessToken,
      body: { categoryId: t.categoryId, note: 'milk and bread', version: t.version },
    });
    expect(edit.status).toBe(200);
  });

  it('adding a category with a hidden name brings the hidden one back', async () => {
    const id = cat('Rent').id;
    await api('PATCH', `/books/${bookId}/categories/${id}`, { token: owner.accessToken, body: { archived: true } });
    const res = await api('POST', `/books/${bookId}/categories`, { token: owner.accessToken, body: { name: 'rent', kind: 'expense' } });
    expect(res.body).toMatchObject({ id, archived: false });
  });
});

describe('saving the same entry twice (retries, offline queue)', () => {
  it('records a transaction once per clientId', async () => {
    const first = await add({ clientId: 'offline-abc-123' });
    const again = await add({ clientId: 'offline-abc-123' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const list = await api<TransactionDTO[]>('GET', `/books/${bookId}/transactions?month=${thisMonth()}`, { token: owner.accessToken });
    expect(list.body).toHaveLength(1);
  });
});

describe('recurring entries', () => {
  const setUp = (body: Record<string, unknown> = {}) =>
    api('POST', `/books/${bookId}/recurring`, {
      token: owner.accessToken,
      body: { type: 'expense', amount: 1500000, categoryId: cat('Rent').id, note: 'Rent', dayOfMonth: 1, startMonth: thisMonth(), ...body },
    });
  const due = () => api<RecurringDueDTO>('GET', `/books/${bookId}/recurring/due`, { token: owner.accessToken });

  it('is due once its day has come, and adding it clears it', async () => {
    const rule = (await setUp()).body;
    expect((await due()).body.items.map((i) => i.recurring.id)).toEqual([rule.id]);
    expect((await due()).body.items[0]!.date).toBe(`${thisMonth()}-01`);

    const added = await api('POST', `/books/${bookId}/recurring/due/add`, {
      token: owner.accessToken,
      body: { month: thisMonth(), ids: [rule.id] },
    });
    expect(added.body).toEqual({ added: 1 });
    expect((await due()).body.items).toHaveLength(0);

    // Pressing Add again (another member, a double tap) doesn't add it twice.
    await api('POST', `/books/${bookId}/recurring/due/add`, { token: owner.accessToken, body: { month: thisMonth(), ids: [rule.id] } });
    const list = await api<TransactionDTO[]>('GET', `/books/${bookId}/transactions?month=${thisMonth()}`, { token: owner.accessToken });
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ amount: 1500000, note: 'Rent', recurringId: rule.id });
  });

  it('skipping or pausing stops it being offered', async () => {
    const a = (await setUp()).body;
    const b = (await setUp({ note: 'Maid', amount: 400000 })).body;
    await api('POST', `/books/${bookId}/recurring/${a.id}/skip`, { token: owner.accessToken, body: { month: thisMonth() } });
    await api('PATCH', `/books/${bookId}/recurring/${b.id}`, { token: owner.accessToken, body: { active: false } });
    expect((await due()).body.items).toHaveLength(0);
  });

  it('is not due before its start month or in future months', async () => {
    await setUp({ startMonth: shiftMonthKey(thisMonth(), 1) });
    expect((await due()).body.items).toHaveLength(0);
    await setUp();
    const future = await api<RecurringDueDTO>('GET', `/books/${bookId}/recurring/due?month=${shiftMonthKey(thisMonth(), 1)}`, {
      token: owner.accessToken,
    });
    expect(future.body.items).toHaveLength(0);
  });

  it('"repeat monthly" on a new transaction sets it up and counts this month as done', async () => {
    const t = await add({ repeatMonthly: true, date: `${thisMonth()}-01`, note: 'Netflix' });
    expect(t.body.recurringId).toBeTruthy();
    const rules = await api('GET', `/books/${bookId}/recurring`, { token: owner.accessToken });
    expect(rules.body).toHaveLength(1);
    expect(rules.body[0]).toMatchObject({ dayOfMonth: 1, startMonth: thisMonth(), note: 'Netflix' });
    expect((await due()).body.items).toHaveLength(0);
  });

  it('day 31 falls on the last day of shorter months', async () => {
    const { recurringDate } = await import('@ffos/shared');
    expect(recurringDate('2026-02', 31)).toBe('2026-02-28');
    expect(recurringDate('2028-02', 30)).toBe('2028-02-29');
    expect(recurringDate('2026-04', 31)).toBe('2026-04-30');
  });

  it('contributors can only change their own', async () => {
    const rule = (await setUp()).body;
    const contributor = await registerMember(owner.accessToken, bookId, 'contributor');
    const res = await api('PATCH', `/books/${bookId}/recurring/${rule.id}`, { token: contributor.accessToken, body: { amount: 1 } });
    expect(res.status).toBe(403);
  });
});

describe('search across months', () => {
  it('finds notes, categories and people in any month, newest first', async () => {
    await add({ date: '2025-03-10', note: 'Plumber for kitchen tap' });
    await add({ date: '2026-01-05', note: 'plumber again' });
    await add({ date: '2026-01-06', note: 'vegetables' });
    const res = await api<TransactionSearchDTO>('GET', `/books/${bookId}/transactions/search?q=plumb`, { token: owner.accessToken });
    expect(res.body.items.map((t) => t.date)).toEqual(['2026-01-05', '2025-03-10']);
    expect(res.body.truncated).toBe(false);

    const byCategory = await api<TransactionSearchDTO>('GET', `/books/${bookId}/transactions/search?q=grocer`, { token: owner.accessToken });
    expect(byCategory.body.items).toHaveLength(3);

    const byPerson = await api<TransactionSearchDTO>('GET', `/books/${bookId}/transactions/search?q=owner`, { token: owner.accessToken });
    expect(byPerson.body.items).toHaveLength(3);
  });

  it('filters by category and type without a search term', async () => {
    await add({ date: '2025-03-10' });
    await add({ date: '2025-04-10', categoryId: cat('Rent').id });
    const res = await api<TransactionSearchDTO>('GET', `/books/${bookId}/transactions/search?category=${cat('Rent').id}&type=expense`, {
      token: owner.accessToken,
    });
    expect(res.body.items.map((t) => t.date)).toEqual(['2025-04-10']);
  });

  it('treats search text literally', async () => {
    await add({ note: 'a+b (test)' });
    const res = await api<TransactionSearchDTO>('GET', `/books/${bookId}/transactions/search?q=${encodeURIComponent('a+b (')}`, {
      token: owner.accessToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('trends', () => {
  it('totals each month and each category, including empty months', async () => {
    await add({ date: '2026-01-10', amount: 5000 });
    await add({ date: '2026-03-02', amount: 7000, categoryId: cat('Rent').id });
    await add({ date: '2026-03-03', type: 'income', amount: 90000, categoryId: cat('Salary').id });
    const res = await api<TrendsDTO>('GET', `/books/${bookId}/trends?end=2026-03&months=3`, { token: owner.accessToken });
    expect(res.body.months).toEqual([
      { month: '2026-01', income: 0, expense: 5000 },
      { month: '2026-02', income: 0, expense: 0 },
      { month: '2026-03', income: 90000, expense: 7000 },
    ]);
    expect(res.body.byCategory).toEqual([
      { categoryId: cat('Rent').id, totals: [0, 0, 7000] },
      { categoryId: cat('Groceries').id, totals: [5000, 0, 0] },
    ]);
  });
});
