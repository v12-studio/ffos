import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminUserDTO, AuthResponse, BookDTO, UserDTO } from '@ffos/shared';
import { api, createBook, expenseCategoryId, registerMember, resetDb, setupOwner, startTestApi, stopTestApi } from './helpers.ts';

beforeAll(startTestApi);
afterAll(stopTestApi);

let owner: AuthResponse;
let member: AuthResponse;
let bookId: string;

const login = (phone: string, password: string) => api<AuthResponse>('POST', '/auth/login', { body: { phone, password } });

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  member = await registerMember(owner.accessToken, bookId, 'editor', 'Meena');
});

describe('instance owner: accounts', () => {
  it('lists every account; nobody else can', async () => {
    const res = await api<AdminUserDTO[]>('GET', '/admin/users', { token: owner.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.name)).toEqual(['Owner', 'Meena']);
    expect(res.body[1]).toMatchObject({ disabled: false, bookCount: 2, recoveryCodesLeft: 8 });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect((await api('GET', '/admin/users', { token: member.accessToken })).status).toBe(403);
  });

  it('a reset link lets a locked-out person set a new password, once', async () => {
    const link = await api('POST', `/admin/users/${member.user.id}/reset-link`, { token: owner.accessToken });
    expect(link.status).toBe(201);
    const token = link.body.token as string;

    const preview = await api('GET', `/auth/reset/${token}`);
    expect(preview.body).toMatchObject({ name: 'Meena' });

    expect((await api('POST', '/auth/reset', { body: { token, newPassword: 'brand-new-pass' } })).status).toBe(204);
    // Signed out everywhere, old password gone, new one works.
    expect((await api('GET', '/me', { token: member.accessToken })).status).toBe(401);
    expect((await login(member.user.phone, 'password123')).status).toBe(401);
    expect((await login(member.user.phone, 'brand-new-pass')).status).toBe(200);
    // Used up.
    expect((await api('GET', `/auth/reset/${token}`)).status).toBe(404);
    expect((await api('POST', '/auth/reset', { body: { token, newPassword: 'another-pass' } })).status).toBe(404);
  });

  it('a new link replaces the old one', async () => {
    const first = (await api('POST', `/admin/users/${member.user.id}/reset-link`, { token: owner.accessToken })).body.token;
    await api('POST', `/admin/users/${member.user.id}/reset-link`, { token: owner.accessToken });
    expect((await api('GET', `/auth/reset/${first}`)).status).toBe(404);
  });

  it('turning an account off signs it out and blocks sign-in until turned back on', async () => {
    expect((await api('POST', `/admin/users/${member.user.id}/disable`, { token: owner.accessToken })).status).toBe(204);
    expect((await api('GET', '/me', { token: member.accessToken })).status).toBe(401);
    expect((await login(member.user.phone, 'password123')).status).toBe(403);
    expect((await api('POST', `/admin/users/${member.user.id}/reset-link`, { token: owner.accessToken })).status).toBe(400);
    expect((await api('POST', `/admin/users/${owner.user.id}/disable`, { token: owner.accessToken })).status).toBe(400);

    expect((await api('POST', `/admin/users/${member.user.id}/enable`, { token: owner.accessToken })).status).toBe(204);
    expect((await login(member.user.phone, 'password123')).status).toBe(200);
  });
});

describe('recovery codes', () => {
  it('can be replaced with a fresh set; the old ones stop working', async () => {
    expect((await api('POST', '/me/recovery-codes', { token: member.accessToken, body: { password: 'wrong' } })).status).toBe(400);
    const res = await api('POST', '/me/recovery-codes', { token: member.accessToken, body: { password: 'password123' } });
    expect(res.status).toBe(200);
    expect(res.body.codes).toHaveLength(8);

    const recover = (code: string) => api('POST', '/auth/recover', { body: { phone: member.user.phone, code, newPassword: 'newpass123' } });
    expect((await recover(res.body.codes[0])).status).toBe(200);
    const me = await login(member.user.phone, 'newpass123');
    expect((await api<UserDTO>('GET', '/me', { token: me.body.accessToken })).body.recoveryCodesLeft).toBe(7);
  });
});

describe('my data', () => {
  it('downloads profile, books and entries I added, without other people', async () => {
    const categoryId = await expenseCategoryId(owner.accessToken, bookId);
    await api('POST', `/books/${bookId}/transactions`, {
      token: member.accessToken,
      body: { type: 'expense', amount: 5000, date: '2026-10-01', categoryId, note: 'Milk' },
    });
    const res = await api('GET', '/me/export', { token: member.accessToken });
    expect(res.body).toMatchObject({ format: 'ffos-account-export', profile: { name: 'Meena' } });
    expect(res.body.books.map((b: { book: string }) => b.book).sort()).toEqual(['Home', 'Personal']);
    expect(res.body.entriesAdded).toEqual([expect.objectContaining({ book: 'Home', amount: '50.00', note: 'Milk' })]);
    expect(JSON.stringify(res.body)).not.toContain(owner.user.phone);
  });
});

describe('deleting my account', () => {
  it('a member can delete theirs: their own books go, shared books keep their entries', async () => {
    const categoryId = await expenseCategoryId(owner.accessToken, bookId);
    await api('POST', `/books/${bookId}/transactions`, {
      token: member.accessToken,
      body: { type: 'expense', amount: 5000, date: '2026-10-01', categoryId, note: 'Milk' },
    });
    expect((await api('DELETE', '/me', { token: member.accessToken, body: { password: 'nope' } })).status).toBe(400);
    expect((await api('DELETE', '/me', { token: member.accessToken, body: { password: 'password123' } })).status).toBe(204);

    expect((await login(member.user.phone, 'password123')).status).toBe(401);
    const members = await api('GET', `/books/${bookId}/members`, { token: owner.accessToken });
    expect(members.body).toHaveLength(1);
    const txns = await api('GET', `/books/${bookId}/transactions?month=2026-10`, { token: owner.accessToken });
    expect(txns.body).toEqual([expect.objectContaining({ note: 'Milk', createdByName: 'Former member' })]);
  });

  it("not while they own a book other people use", async () => {
    const trip = await createBook(member.accessToken, 'Goa trip');
    const third = await registerMember(member.accessToken, trip.id, 'viewer', 'Ravi');
    void third;
    const res = await api('DELETE', '/me', { token: member.accessToken, body: { password: 'password123' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Goa trip');
  });

  it("the instance owner can't while other accounts exist", async () => {
    const res = await api('DELETE', '/me', { token: owner.accessToken, body: { password: 'password123' } });
    expect(res.status).toBe(400);
  });
});

describe('restoring a backup', () => {
  it('a JSON backup comes back as a new book with categories, entries, budgets and monthly entries', async () => {
    const categoryId = await expenseCategoryId(owner.accessToken, bookId);
    await api('POST', `/books/${bookId}/transactions`, {
      token: owner.accessToken,
      body: { type: 'expense', amount: 12000, date: '2026-10-02', categoryId, note: 'Veg', repeatMonthly: true },
    });
    await api('PUT', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken, body: { income: 5000000, lines: [{ categoryId, planned: 800000 }] } });
    await api('PUT', `/books/${bookId}/budget-order`, { token: owner.accessToken, body: { groups: ['savings', 'bills', 'spending'] } });

    const backup = (await api('GET', `/books/${bookId}/export?what=everything&format=json`, { token: owner.accessToken })).body;
    expect(backup.recurring).toHaveLength(1);

    const res = await api('POST', '/books/import', { token: member.accessToken, body: backup });
    expect(res.status).toBe(201);
    expect(res.body.counts).toMatchObject({ transactions: 1, budgets: 1, recurring: 1, skipped: 0 });
    const restored = res.body.book as BookDTO;
    expect(restored).toMatchObject({ name: 'Home (restored)', role: 'owner', groupOrder: ['savings', 'bills', 'spending'] });

    const txns = await api('GET', `/books/${restored.id}/transactions?month=2026-10`, { token: member.accessToken });
    expect(txns.body).toEqual([expect.objectContaining({ note: 'Veg', amount: 12000, createdByName: 'Meena' })]);
    const budget = await api('GET', `/books/${restored.id}/budget/2026-10`, { token: member.accessToken });
    expect(budget.body).toMatchObject({ exists: true, income: 5000000, lines: [expect.objectContaining({ planned: 800000, spent: 12000 })] });
    const rules = await api('GET', `/books/${restored.id}/recurring`, { token: member.accessToken });
    expect(rules.body).toHaveLength(1);
  });

  it('rejects files that are not FFOS backups', async () => {
    expect((await api('POST', '/books/import', { token: owner.accessToken, body: { hello: 'world' } })).status).toBe(400);
  });
});

describe('importing a spreadsheet', () => {
  const rows = (categoryId: string) => [
    { type: 'expense', amount: 4500, date: '2026-10-03', categoryId, note: 'Amazon' },
    { type: 'expense', amount: 12000, date: '2026-10-04', categoryId, note: 'Swiggy' },
  ];

  it('adds rows, skips ones already there, and can be undone', async () => {
    const categoryId = await expenseCategoryId(owner.accessToken, bookId);
    const first = await api('POST', `/books/${bookId}/transactions/import`, { token: owner.accessToken, body: { importId: 'import-one-1234', rows: rows(categoryId) } });
    expect(first.body).toEqual({ added: 2, skipped: 0 });
    // The same statement again: nothing new.
    const again = await api('POST', `/books/${bookId}/transactions/import`, { token: owner.accessToken, body: { importId: 'import-two-1234', rows: rows(categoryId) } });
    expect(again.body).toEqual({ added: 0, skipped: 2 });

    const undo = await api('DELETE', `/books/${bookId}/transactions/import/import-one-1234`, { token: owner.accessToken });
    expect(undo.body).toEqual({ removed: 2 });
    expect((await api('GET', `/books/${bookId}/transactions?month=2026-10`, { token: owner.accessToken })).body).toHaveLength(0);
    expect((await api('GET', `/books/${bookId}/transactions/deleted`, { token: owner.accessToken })).body).toHaveLength(2);
  });

  it('checks categories and permissions', async () => {
    const categoryId = await expenseCategoryId(owner.accessToken, bookId);
    const wrongKind = await api('POST', `/books/${bookId}/transactions/import`, {
      token: owner.accessToken,
      body: { importId: 'import-bad-1234', rows: [{ type: 'income', amount: 100, date: '2026-10-01', categoryId, note: '' }] },
    });
    expect(wrongKind.status).toBe(400);
    const contributor = await registerMember(owner.accessToken, bookId, 'contributor');
    const res = await api('POST', `/books/${bookId}/transactions/import`, { token: contributor.accessToken, body: { importId: 'import-c-12345', rows: rows(categoryId) } });
    expect(res.status).toBe(403);
  });
});

describe('accounts and balances', () => {
  const create = (body: object, token = owner.accessToken) => api('POST', `/books/${bookId}/accounts`, { token, body });
  const list = () => api('GET', `/books/${bookId}/accounts`, { token: owner.accessToken });
  const spend = async (accountId: string | undefined, amount: number, date: string, type: 'expense' | 'income' = 'expense') => {
    const cats = (await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body as { id: string; kind: string }[];
    return api('POST', `/books/${bookId}/transactions`, {
      token: owner.accessToken,
      body: { type, amount, date, categoryId: cats.find((c) => c.kind === type)!.id, note: '', ...(accountId ? { accountId } : {}) },
    });
  };

  it('balances follow entries and transfers from the opening date on', async () => {
    const bank = (await create({ name: 'SBI', kind: 'bank', openingBalance: 5000000, openingDate: '2026-10-01' })).body;
    const cash = (await create({ name: 'Cash', kind: 'cash', openingBalance: 0, openingDate: '2026-10-01' })).body;
    const card = (await create({ name: 'HDFC card', kind: 'card', openingBalance: -200000, openingDate: '2026-10-01' })).body;

    await spend(bank.id, 1000000, '2026-10-01', 'income'); // salary in
    await spend(card.id, 300000, '2026-10-05'); // shopping on the card
    await spend(bank.id, 99999, '2026-09-30'); // before the opening date: already in the opening balance
    await spend(undefined, 7000, '2026-10-06'); // no account: doesn't touch any balance
    await api('POST', `/books/${bookId}/transfers`, { token: owner.accessToken, body: { fromAccountId: bank.id, toAccountId: cash.id, amount: 200000, date: '2026-10-07', note: 'ATM' } });
    const payCard = await api('POST', `/books/${bookId}/transfers`, { token: owner.accessToken, body: { fromAccountId: bank.id, toAccountId: card.id, amount: 500000, date: '2026-10-10' } });
    expect(payCard.status).toBe(201);

    const balances = Object.fromEntries((await list()).body.map((a: { name: string; balance: number }) => [a.name, a.balance]));
    expect(balances).toEqual({ SBI: 5000000 + 1000000 - 200000 - 500000, Cash: 200000, 'HDFC card': -200000 - 300000 + 500000 });

    // Spending isn't changed by transfers.
    const summary = await api('GET', `/books/${bookId}/summary?month=2026-10`, { token: owner.accessToken });
    expect(summary.body.expense).toBe(300000 + 7000);
  });

  it('checks accounts on entries and transfers, and only deletes unused ones', async () => {
    const bank = (await create({ name: 'Bank', kind: 'bank', openingBalance: 0, openingDate: '2026-10-01' })).body;
    expect((await spend('0123456789abcdef01234567', 100, '2026-10-02')).status).toBe(400);
    expect((await api('POST', `/books/${bookId}/transfers`, { token: owner.accessToken, body: { fromAccountId: bank.id, toAccountId: bank.id, amount: 1, date: '2026-10-02' } })).status).toBe(400);
    expect((await create({ name: 'X', kind: 'bank', openingDate: '2026-10-01' }, (await registerMember(owner.accessToken, bookId, 'contributor')).accessToken)).status).toBe(403);

    const t = (await spend(bank.id, 100, '2026-10-02')).body;
    expect(t.accountId).toBe(bank.id);
    expect((await api('DELETE', `/books/${bookId}/accounts/${bank.id}`, { token: owner.accessToken })).status).toBe(400);
    const closed = await api('PATCH', `/books/${bookId}/accounts/${bank.id}`, { token: owner.accessToken, body: { archived: true } });
    expect(closed.body.archived).toBe(true);
    // A closed account can't take new entries.
    expect((await spend(bank.id, 100, '2026-10-03')).status).toBe(400);

    const empty = (await create({ name: 'Unused', kind: 'wallet', openingDate: '2026-10-01' })).body;
    expect((await api('DELETE', `/books/${bookId}/accounts/${empty.id}`, { token: owner.accessToken })).status).toBe(204);
  });

  it('accounts and transfers survive a backup and restore', async () => {
    const bank = (await create({ name: 'Bank', kind: 'bank', openingBalance: 100000, openingDate: '2026-10-01' })).body;
    const cash = (await create({ name: 'Cash', kind: 'cash', openingDate: '2026-10-01' })).body;
    await spend(bank.id, 30000, '2026-10-02');
    await api('POST', `/books/${bookId}/transfers`, { token: owner.accessToken, body: { fromAccountId: bank.id, toAccountId: cash.id, amount: 20000, date: '2026-10-03' } });
    const backup = (await api('GET', `/books/${bookId}/export?what=everything&format=json`, { token: owner.accessToken })).body;
    const restored = (await api('POST', '/books/import', { token: owner.accessToken, body: backup })).body.book;
    const accounts = (await api('GET', `/books/${restored.id}/accounts`, { token: owner.accessToken })).body;
    expect(Object.fromEntries(accounts.map((a: { name: string; balance: number }) => [a.name, a.balance]))).toEqual({ Bank: 100000 - 30000 - 20000, Cash: 20000 });
  });
});

describe('daily reminders', () => {
  it('one notification per book about bills due soon and budgets running out, each sent once', async () => {
    const { collections } = await import('../src/db.ts');
    const { sendDailyReminders } = await import('../src/lib/reminders.ts');
    const { generateVapidKeys } = await import('../src/lib/push.ts');
    const { currentAppMonth, shiftDate, todayInAppZone } = await import('@ffos/shared');
    const { ObjectId } = await import('mongodb');
    const db = await collections();
    const month = currentAppMonth();
    const tomorrow = shiftDate(todayInAppZone(), 1);
    const cats = (await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body as { id: string; name: string }[];
    const id = (name: string) => cats.find((c) => c.name === name)!.id;

    // Internet is due tomorrow (only if tomorrow is still this month); Groceries is over its budget.
    if (tomorrow.slice(0, 7) === month) {
      await api('POST', `/books/${bookId}/recurring`, {
        token: owner.accessToken,
        body: { type: 'expense', amount: 99900, categoryId: id('Utilities'), note: 'Internet', dayOfMonth: Number(tomorrow.slice(8)), startMonth: month },
      });
    }
    await api('PUT', `/books/${bookId}/budget/${month}`, { token: owner.accessToken, body: { income: 5000000, lines: [{ categoryId: id('Groceries'), planned: 100000 }] } });
    await api('POST', `/books/${bookId}/transactions`, {
      token: owner.accessToken,
      body: { type: 'expense', amount: 150000, date: todayInAppZone(), categoryId: id('Groceries'), note: '' },
    });
    await db.pushSubscriptions.insertMany([
      { _id: new ObjectId(), userId: new ObjectId(owner.user.id), endpoint: 'https://push.example/a', p256dh: 'x', auth: 'y', device: 'Phone', createdAt: new Date() },
      { _id: new ObjectId(), userId: new ObjectId(owner.user.id), endpoint: 'https://push.example/gone', p256dh: 'x', auth: 'y', device: 'Old phone', createdAt: new Date() },
    ]);

    const sent: { endpoint: string; title: string; body: string }[] = [];
    const fake = async (target: { endpoint: string }, message: { title: string; body: string }) => {
      if (target.endpoint.endsWith('/gone')) return 'gone' as const;
      sent.push({ endpoint: target.endpoint, ...message });
      return 'sent' as const;
    };
    const keys = { ...generateVapidKeys(), subject: 'https://family.example' };

    const first = await sendDailyReminders(db, fake, keys);
    expect(first).toMatchObject({ users: 1, notifications: 1, removedSubscriptions: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('Home');
    expect(sent[0]!.body).toContain('Groceries is ₹500 over budget');
    if (tomorrow.slice(0, 7) === month) expect(sent[0]!.body).toContain('Internet due tomorrow · ₹999');

    // The same reminders aren't sent twice.
    expect((await sendDailyReminders(db, fake, keys)).notifications).toBe(0);
    // Without server keys nothing runs.
    expect((await sendDailyReminders(db, fake, null)).users).toBe(0);
  });

  it('notification settings and subscriptions per person', async () => {
    const status = await api('GET', '/me/push', { token: owner.accessToken });
    expect(status.body).toEqual({ publicKey: null, endpoints: [] });
    // The server has no keys in tests, so subscribing is refused with a clear message.
    const sub = await api('POST', '/me/push', { token: owner.accessToken, body: { endpoint: 'https://push.example/x', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } } });
    expect(sub.status).toBe(400);
    const prefs = await api('PATCH', '/me', { token: owner.accessToken, body: { notify: { bills: true, budget: false } } });
    expect(prefs.body.notify).toEqual({ bills: true, budget: false });
  });
});
