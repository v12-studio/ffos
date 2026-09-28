import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResponse, BudgetDTO } from '@ffos/shared';
import { api, createBook, registerMember, resetDb, setupOwner, startTestApi, stopTestApi } from './helpers.ts';

beforeAll(startTestApi);
afterAll(stopTestApi);

const rs = (rupees: number) => rupees * 100;

let owner: AuthResponse;
let bookId: string;
let heads: Record<string, string>; // name → categoryId

async function head(name: string) {
  const res = await api('POST', `/books/${bookId}/categories`, { token: owner.accessToken, body: { name, kind: 'expense' } });
  return res.body.id as string;
}

/** The user's own example: ₹30,000 split into six heads (₹25,000), ₹5,000 left as savings. */
async function planOctober(token = owner.accessToken) {
  return api<BudgetDTO>('PUT', `/books/${bookId}/budget/2026-10`, {
    token,
    body: {
      income: rs(30000),
      lines: [
        { categoryId: heads.Food!, planned: rs(5000) },
        { categoryId: heads.Medical!, planned: rs(2000) },
        { categoryId: heads.Bills!, planned: rs(10000) },
        { categoryId: heads.Fruits!, planned: rs(3000) },
        { categoryId: heads.Groceries!, planned: rs(3000) },
        { categoryId: heads.Entertainment!, planned: rs(2000) },
      ],
    },
  });
}

const spend = (categoryId: string, rupees: number, date = '2026-10-06', token = owner.accessToken) =>
  api('POST', `/books/${bookId}/transactions`, {
    token,
    body: { type: 'expense', amount: rs(rupees), date, categoryId, note: '' },
  });

const line = (b: BudgetDTO, name: string) => b.lines.find((l) => l.categoryId === heads[name])!;

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  heads = {};
  for (const name of ['Food', 'Medical', 'Bills', 'Fruits', 'Groceries', 'Entertainment']) heads[name] = await head(name);
});

describe('planning a month', () => {
  it('an unplanned month reports exists=false', async () => {
    const res = await api<BudgetDTO>('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: false, income: 0, lines: [] });
  });

  it('splits income into heads and shows what is left as planned savings', async () => {
    const res = await planOctober();
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.totals).toMatchObject({ allocated: rs(25000), plannedSavings: rs(5000), spent: 0, projectedSavings: rs(5000) });
  });

  it('tracks spending per head, allows going over, and lowers projected savings', async () => {
    await planOctober();
    await spend(heads.Food!, 200); // dinner
    await spend(heads.Food!, 400); // lunch
    await spend(heads.Groceries!, 40); // milk
    await spend(heads.Fruits!, 3500); // over the ₹3,000 limit — still accepted
    await spend(heads.Food!, 999, '2026-09-30'); // other month: ignored

    const b = (await api<BudgetDTO>('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken })).body;
    expect(line(b, 'Food')).toMatchObject({ planned: rs(5000), spent: rs(600), remaining: rs(4400) });
    expect(line(b, 'Groceries')).toMatchObject({ spent: rs(40), remaining: rs(2960) });
    expect(line(b, 'Fruits')).toMatchObject({ spent: rs(3500), remaining: rs(-500) });
    // Fruits' ₹500 overspend comes out of the ₹5,000 savings.
    expect(b.totals).toMatchObject({ spent: rs(4140), overspent: rs(500), projectedSavings: rs(4500) });
  });

  it('shows spending in categories without a budget head as unbudgeted', async () => {
    await planOctober();
    const cats = (await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body as { id: string; name: string }[];
    const fuel = cats.find((c) => c.name === 'Fuel & Transport')!.id;
    await spend(fuel, 700);
    const b = (await api<BudgetDTO>('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken })).body;
    expect(b.unbudgeted).toEqual([{ categoryId: fuel, spent: rs(700) }]);
    expect(b.totals.projectedSavings).toBe(rs(4300));
  });

  it('allows planning more than income (shown as negative savings)', async () => {
    await planOctober();
    const current = (await api<BudgetDTO>('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken })).body;
    const res = await api<BudgetDTO>('PUT', `/books/${bookId}/budget/2026-10`, {
      token: owner.accessToken,
      body: { income: rs(24000), lines: current.lines.map(({ categoryId, planned }) => ({ categoryId, planned })), version: current.version },
    });
    expect(res.body.totals.plannedSavings).toBe(rs(-1000));
  });

  it('reports income actually received alongside the plan', async () => {
    await planOctober();
    const cats = (await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body as { id: string; kind: string }[];
    await api('POST', `/books/${bookId}/transactions`, {
      token: owner.accessToken,
      body: { type: 'income', amount: rs(30000), date: '2026-10-01', categoryId: cats.find((c) => c.kind === 'income')!.id },
    });
    const b = (await api<BudgetDTO>('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken })).body;
    expect(b.totals.incomeReceived).toBe(rs(30000));
  });
});

describe('validation & concurrency', () => {
  it('rejects income categories, other books’ categories and duplicate heads', async () => {
    const cats = (await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body as { id: string; kind: string }[];
    const incomeCat = cats.find((c) => c.kind === 'income')!.id;
    const put = (lines: { categoryId: string; planned: number }[]) =>
      api('PUT', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken, body: { income: rs(1000), lines } });

    expect((await put([{ categoryId: incomeCat, planned: 100 }])).status).toBe(400);
    const other = await createBook(owner.accessToken, 'Other');
    const otherCat = (await api('GET', `/books/${other.id}/categories`, { token: owner.accessToken })).body[0].id;
    expect((await put([{ categoryId: otherCat, planned: 100 }])).status).toBe(400);
    expect(
      (
        await put([
          { categoryId: heads.Food!, planned: 100 },
          { categoryId: heads.Food!, planned: 200 },
        ])
      ).status,
    ).toBe(400);
  });

  it('rejects a stale save with 409', async () => {
    const first = (await planOctober()).body;
    const body = { income: rs(31000), lines: [], version: first.version };
    expect((await api('PUT', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken, body })).status).toBe(200);
    expect((await api('PUT', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken, body })).status).toBe(409);
    // Creating again without a version, when a plan already exists, is also a conflict.
    expect((await planOctober()).status).toBe(409);
  });
});

describe('copy from last month', () => {
  it('starts November from October’s plan, once', async () => {
    await planOctober();
    const res = await api<BudgetDTO>('POST', `/books/${bookId}/budget/2026-11/copy`, { token: owner.accessToken, body: { from: '2026-10' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ month: '2026-11', income: rs(30000) });
    expect(res.body.lines).toHaveLength(6);
    expect(res.body.lines.every((l) => l.spent === 0)).toBe(true);

    const again = await api('POST', `/books/${bookId}/budget/2026-11/copy`, { token: owner.accessToken, body: { from: '2026-10' } });
    expect(again.status).toBe(409);
    const missing = await api('POST', `/books/${bookId}/budget/2027-01/copy`, { token: owner.accessToken, body: { from: '2026-12' } });
    expect(missing.status).toBe(404);
  });
});

describe('browser access', () => {
  it('allows PUT from the web app origin (budget saves use PUT)', async () => {
    const { createApp } = await import('../src/app.ts');
    const res = await createApp().request(`/api/v1/books/${bookId}/budget/2026-10`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
  });
});

describe('permissions', () => {
  it('everyone can view; only owner/admin/editor can plan; contributors’ spending still counts', async () => {
    const editor = await registerMember(owner.accessToken, bookId, 'editor');
    const contributor = await registerMember(owner.accessToken, bookId, 'contributor');
    const viewer = await registerMember(owner.accessToken, bookId, 'viewer');

    expect((await planOctober(contributor.accessToken)).status).toBe(403);
    expect((await planOctober(viewer.accessToken)).status).toBe(403);
    expect((await planOctober(editor.accessToken)).status).toBe(200);

    await spend(heads.Food!, 300, '2026-10-06', contributor.accessToken);
    const asViewer = await api<BudgetDTO>('GET', `/books/${bookId}/budget/2026-10`, { token: viewer.accessToken });
    expect(asViewer.status).toBe(200);
    expect(line(asViewer.body, 'Food').spent).toBe(rs(300));

    const outsiderBook = await createBook(owner.accessToken, 'Private');
    const outsider = await registerMember(owner.accessToken, outsiderBook.id, 'admin', 'outsider');
    expect((await api('GET', `/books/${bookId}/budget/2026-10`, { token: outsider.accessToken })).status).toBe(404);
  });
});
