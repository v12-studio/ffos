import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  currentAppMonth,
  daysInMonth,
  shiftMonthKey,
  todayInAppZone,
  type AuthResponse,
  type BudgetDTO,
  type BudgetSuggestionsDTO,
  type CategoryDTO,
} from '@ffos/shared';
import { api, createBook, registerMember, resetDb, setupOwner, startTestApi, stopTestApi } from './helpers.ts';

// Budget-first planning: head groups, plans that carry over, bills, goals, allowances and suggestions.
// Months are relative to today because the current month behaves differently (it's saved on open, and
// has "safe to spend today").

beforeAll(startTestApi);
afterAll(stopTestApi);

const rs = (rupees: number) => rupees * 100;
const THIS = currentAppMonth();
const LAST = shiftMonthKey(THIS, -1);
const TWO_AGO = shiftMonthKey(THIS, -2);
const NEXT = shiftMonthKey(THIS, 1);

let owner: AuthResponse;
let bookId: string;
let heads: Record<string, string>;

async function head(name: string) {
  const res = await api<CategoryDTO>('POST', `/books/${bookId}/categories`, { token: owner.accessToken, body: { name, kind: 'expense' } });
  return res.body.id;
}

const plan = (month: string, income: number, lines: [string, number][], version?: number, token = owner.accessToken) =>
  api<BudgetDTO>('PUT', `/books/${bookId}/budget/${month}`, {
    token,
    body: { income: rs(income), lines: lines.map(([name, planned]) => ({ categoryId: heads[name]!, planned: rs(planned) })), version },
  });

const getBudget = (month: string, token = owner.accessToken) => api<BudgetDTO>('GET', `/books/${bookId}/budget/${month}`, { token });

const spend = (name: string, rupees: number, date: string) =>
  api('POST', `/books/${bookId}/transactions`, {
    token: owner.accessToken,
    body: { type: 'expense', amount: rs(rupees), date, categoryId: heads[name]!, note: '' },
  });

const line = (b: BudgetDTO, name: string) => b.lines.find((l) => l.categoryId === heads[name])!;

const setHead = (name: string, body: object, token = owner.accessToken) =>
  api<CategoryDTO>('PATCH', `/books/${bookId}/categories/${heads[name]}/budget`, { token, body });

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  heads = {};
  for (const name of ['Milk', 'Vegetables', 'Rent', 'Seetu', 'Trip']) heads[name] = await head(name);
});

describe('head groups', () => {
  it('guesses the group from the name until someone sets it', async () => {
    const cats = (await api<CategoryDTO[]>('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body;
    const group = (id: string) => cats.find((c) => c.id === id)!.group;
    expect(group(heads.Milk!)).toBe('spending');
    expect(group(heads.Rent!)).toBe('bills');
    expect(group(heads.Seetu!)).toBe('savings');
    // Seeded defaults come with a group.
    expect(cats.find((c) => c.name === 'EMI & Loans')!.group).toBe('bills');

    const res = await setHead('Trip', { group: 'savings' });
    expect(res.status).toBe(200);
    expect(res.body.group).toBe('savings');
  });

  it('only planners can change a head, and only for expense categories', async () => {
    const contributor = await registerMember(owner.accessToken, bookId, 'contributor');
    const editor = await registerMember(owner.accessToken, bookId, 'editor');
    expect((await setHead('Milk', { group: 'bills' }, contributor.accessToken)).status).toBe(403);
    expect((await setHead('Milk', { group: 'bills' }, editor.accessToken)).status).toBe(200);

    const cats = (await api<CategoryDTO[]>('GET', `/books/${bookId}/categories`, { token: owner.accessToken })).body;
    const salary = cats.find((c) => c.name === 'Salary')!;
    const res = await api('PATCH', `/books/${bookId}/categories/${salary.id}/budget`, { token: owner.accessToken, body: { group: 'bills' } });
    expect(res.status).toBe(400);
  });

  it('savings heads count as saved, not spent', async () => {
    await plan(LAST, 50000, [
      ['Rent', 15000],
      ['Milk', 2000],
      ['Seetu', 5000],
    ]);
    await spend('Rent', 15000, `${LAST}-05`);
    await spend('Milk', 2500, `${LAST}-10`); // ₹500 over
    await spend('Seetu', 6000, `${LAST}-12`); // ₹1,000 more saved than planned: not overspending

    const b = (await getBudget(LAST)).body;
    expect(line(b, 'Seetu').group).toBe('savings');
    expect(b.totals).toMatchObject({
      allocated: rs(22000),
      unallocated: rs(28000),
      // Income minus bills and spending: the unassigned ₹28,000 plus the ₹5,000 Seetu plan.
      plannedSavings: rs(33000),
      spent: rs(17500),
      saved: rs(6000),
      overspent: rs(500),
      projectedSavings: rs(32500),
    });
    // Not the current month: nothing about today.
    expect(b.today).toBeNull();
  });
});

describe('plans carry over', () => {
  it('follows the latest earlier plan until a month gets its own', async () => {
    await plan(TWO_AGO, 40000, [
      ['Milk', 2000],
      ['Rent', 15000],
    ]);

    const last = (await getBudget(LAST)).body;
    expect(last).toMatchObject({ exists: true, saved: false, carriedFrom: TWO_AGO, income: rs(40000) });
    expect(last.lines).toHaveLength(2);

    // Opening the current month saves the carried plan as its own...
    const now = (await getBudget(THIS)).body;
    expect(now).toMatchObject({ exists: true, saved: true, carriedFrom: TWO_AGO, version: 0 });

    // ...so it stays put when an earlier month is changed afterwards.
    await plan(TWO_AGO, 99000, [['Milk', 1000]], 0);
    expect((await getBudget(THIS)).body.income).toBe(rs(40000));
    // A month in between, never opened as the current month, follows the change.
    expect((await getBudget(LAST)).body.income).toBe(rs(99000));

    // Saving changes makes it the month's own plan.
    const saved = await plan(THIS, 45000, [['Milk', 2500]], 0);
    expect(saved.body).toMatchObject({ saved: true, carriedFrom: null, version: 1 });
  });

  it("leaves out heads whose category was hidden, and says so when there's nothing to carry", async () => {
    expect((await getBudget(THIS)).body).toMatchObject({ exists: false, saved: false, carriedFrom: null });
    await plan(LAST, 30000, [
      ['Milk', 2000],
      ['Trip', 5000],
    ]);
    await api('PATCH', `/books/${bookId}/categories/${heads.Trip}`, { token: owner.accessToken, body: { archived: true } });
    const next = (await getBudget(NEXT)).body;
    expect(next.lines.map((l) => l.categoryId)).toEqual([heads.Milk]);
  });

  it('a viewer opening the month also starts it, and a save from a planner still works', async () => {
    const viewer = await registerMember(owner.accessToken, bookId, 'viewer');
    await plan(LAST, 30000, [['Milk', 2000]]);
    expect((await getBudget(THIS, viewer.accessToken)).body).toMatchObject({ saved: true, carriedFrom: LAST });
    expect((await plan(THIS, 31000, [['Milk', 2000]], 0)).status).toBe(200);
  });
});

describe('this month', () => {
  it('works out what can be spent per day from spending heads only', async () => {
    await plan(THIS, 60000, [
      ['Milk', 3000],
      ['Vegetables', 4000],
      ['Rent', 15000],
      ['Seetu', 5000],
    ]);
    const today = todayInAppZone();
    await spend('Milk', 500, today);
    await spend('Vegetables', 4500, today); // over: counts as nothing left, not negative

    const b = (await getBudget(THIS)).body;
    const day = Number(today.slice(8, 10));
    const daysLeft = daysInMonth(THIS) - day + 1;
    expect(b.today).toMatchObject({ day, daysInMonth: daysInMonth(THIS), daysLeft, spendingLeft: rs(2500) });
    expect(b.today!.safePerDay).toBe(Math.floor(rs(2500) / daysLeft / 100) * 100);
  });
});

describe('bills', () => {
  it('shows when a monthly bill is due, and Mark paid adds it once', async () => {
    await plan(THIS, 60000, [['Rent', 15000]]);
    const rule = (
      await api('POST', `/books/${bookId}/recurring`, {
        token: owner.accessToken,
        body: { type: 'expense', amount: rs(15000), categoryId: heads.Rent, note: 'Rent', dayOfMonth: 28, startMonth: THIS },
      })
    ).body as { id: string };

    let rent = line((await getBudget(THIS)).body, 'Rent');
    expect(rent.due).toEqual({ date: `${THIS}-28`, recurringIds: [rule.id], paid: false });

    const pay = () => api('POST', `/books/${bookId}/recurring/${rule.id}/pay`, { token: owner.accessToken, body: { month: THIS } });
    expect((await pay()).body).toEqual({ added: 1 });
    expect((await pay()).body).toEqual({ added: 0 });

    rent = line((await getBudget(THIS)).body, 'Rent');
    expect(rent).toMatchObject({ spent: rs(15000), remaining: 0 });
    expect(rent.due!.paid).toBe(true);

    // Paid early is dated today, not the 28th.
    const txns = (await api('GET', `/books/${bookId}/transactions?month=${THIS}`, { token: owner.accessToken })).body as { date: string }[];
    const today = todayInAppZone();
    expect(txns[0]!.date).toBe(today < `${THIS}-28` ? today : `${THIS}-28`);

    // It no longer shows as due on the Overview either.
    const due = (await api('GET', `/books/${bookId}/recurring/due?month=${THIS}`, { token: owner.accessToken })).body;
    expect(due.items).toHaveLength(0);

    const future = await api('POST', `/books/${bookId}/recurring/${rule.id}/pay`, { token: owner.accessToken, body: { month: NEXT } });
    expect(future.status).toBe(400);
  });
});

describe('goals and allowances', () => {
  it('tracks progress towards a savings goal and what to put aside each month', async () => {
    const goalBy = shiftMonthKey(LAST, 4); // LAST plus four more months: five months including LAST
    const res = await setHead('Trip', { group: 'savings', goal: { target: rs(30000), by: goalBy, start: rs(5000) } });
    expect(res.body.goal).toEqual({ target: rs(30000), by: goalBy, start: rs(5000) });

    await spend('Trip', 2000, `${TWO_AGO}-15`);
    await plan(LAST, 50000, [['Trip', 5000]]);
    await spend('Trip', 5000, `${LAST}-10`);

    const trip = line((await getBudget(LAST)).body, 'Trip');
    // ₹30,000 − (₹5,000 start + ₹2,000 earlier) = ₹23,000 over 5 months.
    expect(trip.goal).toEqual({ target: rs(30000), by: goalBy, saved: rs(12000), monthlyNeeded: rs(4600) });

    expect((await setHead('Trip', { goal: null })).body.goal).toBeNull();
  });

  it('marks a head as one member’s allowance', async () => {
    const kavya = await registerMember(owner.accessToken, bookId, 'contributor', 'Kavya');
    const outsiderBook = await createBook(owner.accessToken, 'Other');
    const outsider = await registerMember(owner.accessToken, outsiderBook.id, 'admin', 'Outsider');

    expect((await setHead('Milk', { memberId: kavya.user.id })).body.memberId).toBe(kavya.user.id);
    expect((await setHead('Milk', { memberId: outsider.user.id })).status).toBe(400);
    expect((await setHead('Milk', { memberId: null })).body.memberId).toBeNull();
  });
});

describe('suggestions', () => {
  it('averages the last three months that have entries, and shows last month', async () => {
    await spend('Milk', 1200, `${TWO_AGO}-03`);
    await spend('Milk', 1000, `${LAST}-03`);
    await spend('Milk', 333, `${LAST}-20`);
    await spend('Rent', 15000, `${LAST}-05`);
    await spend('Milk', 9999, `${THIS}-01`); // the month being planned: not counted

    const res = await api<BudgetSuggestionsDTO>('GET', `/books/${bookId}/budget/${THIS}/suggestions`, { token: owner.accessToken });
    expect(res.body.months).toEqual([shiftMonthKey(THIS, -3), TWO_AGO, LAST]);
    const milk = res.body.byCategory.find((s) => s.categoryId === heads.Milk)!;
    // (1,200 + 1,333) ÷ 2 months with entries = 1,266.50 → ₹1,270.
    expect(milk).toEqual({ categoryId: heads.Milk, average: rs(1270), last: rs(1333) });
    expect(res.body.byCategory.find((s) => s.categoryId === heads.Rent)).toEqual({ categoryId: heads.Rent, average: rs(7500), last: rs(15000) });
  });
});
