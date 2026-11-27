import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResponse, BookDTO } from '@ffos/shared';
import { api, createBook, registerMember, resetDb, setupOwner, startTestApi, stopTestApi } from './helpers.ts';

beforeAll(startTestApi);
afterAll(stopTestApi);

const rs = (rupees: number) => rupees * 100;

let owner: AuthResponse;
let bookId: string;
let heads: Record<string, string>; // name → categoryId
let salaryId: string;

async function category(name: string, kind: 'expense' | 'income' = 'expense') {
  const res = await api('POST', `/books/${bookId}/categories`, { token: owner.accessToken, body: { name, kind } });
  return res.body.id as string;
}

const entry = (categoryId: string, rupees: number, date: string, note = '', type: 'expense' | 'income' = 'expense') =>
  api('POST', `/books/${bookId}/transactions`, { token: owner.accessToken, body: { type, amount: rs(rupees), date, categoryId, note } });

const plan = (month: string, income: number, lines: [string, number][]) =>
  api('PUT', `/books/${bookId}/budget/${month}`, {
    token: owner.accessToken,
    body: { income: rs(income), lines: lines.map(([name, planned]) => ({ categoryId: heads[name]!, planned: rs(planned) })) },
  });

async function raw(path: string, token = owner.accessToken) {
  const { createApp } = await import('../src/app.ts');
  return createApp().request(`/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
}

async function csv(query: string) {
  const res = await raw(`/books/${bookId}/export?${query}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/csv');
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer())).trim().split('\r\n');
}

/** Reads our own zip output: local headers one after another, deflated, no data descriptors. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    files.set(name, new TextDecoder().decode(inflateRawSync(bytes.subarray(start, start + size))));
    at = start + size;
  }
  return files;
}

/** Cell texts of a worksheet, row by row (inline strings and numbers). */
function sheetRows(xml: string): string[][] {
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(([, row]) =>
    [...row!.matchAll(/<c [^>]*>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g)].map(([, text, num]) => text ?? num ?? ''),
  );
}

beforeEach(async () => {
  await resetDb();
  owner = await setupOwner();
  bookId = (await createBook(owner.accessToken, 'Home')).id;
  heads = {};
  for (const name of ['Rent', 'Groceries', 'Chit']) heads[name] = await category(name);
  salaryId = await category('Salary job', 'income');
  // Rent is a bill and Chit savings (guessed from the names); Groceries is spending.
  await plan('2026-09', 30000, [['Rent', 10000], ['Groceries', 5000], ['Chit', 3000]]);
  await plan('2026-10', 32000, [['Rent', 10000], ['Groceries', 6000], ['Chit', 3000]]);
  await entry(heads.Rent!, 10000, '2026-09-05', 'Sept rent');
  await entry(heads.Groceries!, 5500, '2026-09-12', 'Big shop');
  await entry(heads.Groceries!, 1200, '2026-10-03', 'Veg');
  await entry(heads.Chit!, 3000, '2026-10-10');
  await entry(salaryId, 30000, '2026-09-01', 'Salary', 'income');
});

describe('section order', () => {
  it('defaults to bills, spending, savings and can be changed by whoever plans the budget', async () => {
    const books = await api<BookDTO[]>('GET', '/books', { token: owner.accessToken });
    expect(books.body.find((b) => b.id === bookId)!.groupOrder).toEqual(['bills', 'spending', 'savings']);

    const res = await api('PUT', `/books/${bookId}/budget-order`, { token: owner.accessToken, body: { groups: ['spending', 'savings', 'bills'] } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ groupOrder: ['spending', 'savings', 'bills'] });
    const book = await api<BookDTO>('GET', `/books/${bookId}`, { token: owner.accessToken });
    expect(book.body.groupOrder).toEqual(['spending', 'savings', 'bills']);

    const log = await api('GET', `/books/${bookId}/activity`, { token: owner.accessToken });
    expect(log.body[0].summary).toBe('changed the budget section order to Spending, Savings, Bills');
  });

  it('needs every section exactly once, and budget.manage', async () => {
    const put = (groups: string[], token = owner.accessToken) => api('PUT', `/books/${bookId}/budget-order`, { token, body: { groups } });
    expect((await put(['bills', 'bills', 'savings'])).status).toBe(400);
    expect((await put(['bills', 'spending'])).status).toBe(400);
    expect((await put(['bills', 'spending', 'loans'])).status).toBe(400);

    const contributor = await registerMember(owner.accessToken, bookId, 'contributor');
    const editor = await registerMember(owner.accessToken, bookId, 'editor');
    expect((await put(['savings', 'spending', 'bills'], contributor.accessToken)).status).toBe(403);
    expect((await put(['savings', 'spending', 'bills'], editor.accessToken)).status).toBe(200);
  });
});

describe('custom sections', () => {
  const save = (sections: object[], token = owner.accessToken) => api('PUT', `/books/${bookId}/budget-sections`, { token, body: { sections } });
  const defaults = [
    { id: 'bills', name: 'Bills', kind: 'bills' },
    { id: 'spending', name: 'Spending', kind: 'spending' },
    { id: 'savings', name: 'Savings', kind: 'savings' },
  ];

  it('can be renamed, added and reordered; categories follow them in the budget and exports', async () => {
    const res = await save([
      { id: 'emi', name: 'EMIs & loans', kind: 'bills' },
      { id: 'bills', name: 'Fixed costs', kind: 'bills' },
      { id: 'spending', name: 'Day to day', kind: 'spending' },
      { id: 'savings', name: 'Savings', kind: 'savings' },
    ]);
    expect(res.status).toBe(200);
    const book = await api<BookDTO>('GET', `/books/${bookId}`, { token: owner.accessToken });
    expect(book.body.sections.map((s) => s.name)).toEqual(['EMIs & loans', 'Fixed costs', 'Day to day', 'Savings']);

    // Rent was a bill (by its name); move it into the new section. It's still tracked as a bill.
    const moved = await api('PATCH', `/books/${bookId}/categories/${heads.Rent}/budget`, { token: owner.accessToken, body: { section: 'emi' } });
    expect(moved.body).toMatchObject({ section: 'emi', group: 'bills' });
    const budget = await api('GET', `/books/${bookId}/budget/2026-09`, { token: owner.accessToken });
    expect(budget.body.lines.find((l: { categoryId: string }) => l.categoryId === heads.Rent)).toMatchObject({ section: 'emi', group: 'bills' });
    expect(budget.body.lines.find((l: { categoryId: string }) => l.categoryId === heads.Groceries)).toMatchObject({ section: 'spending' });

    const lines = await csv('what=budget&format=csv&from=2026-09&to=2026-09');
    expect(lines.slice(1).map((l) => l.split(',').slice(1, 3).join(','))).toEqual(['Income,Income', 'EMIs & loans,Rent', 'Day to day,Groceries', 'Savings,Chit']);

    const log = await api('GET', `/books/${bookId}/activity`, { token: owner.accessToken });
    expect(log.body.some((a: { summary: string }) => a.summary.includes('added EMIs & loans') && a.summary.includes('renamed Bills to Fixed costs'))).toBe(true);
  });

  it('removing a section moves its categories to another of the same kind', async () => {
    await save([{ id: 'emi', name: 'EMIs', kind: 'bills' }, ...defaults]);
    await api('PATCH', `/books/${bookId}/categories/${heads.Rent}/budget`, { token: owner.accessToken, body: { section: 'emi' } });
    await save(defaults);
    const cats = await api('GET', `/books/${bookId}/categories`, { token: owner.accessToken });
    expect(cats.body.find((c: { id: string }) => c.id === heads.Rent)).toMatchObject({ section: 'bills', group: 'bills' });
  });

  it('keeps one section of each kind, unique names, and needs budget.manage', async () => {
    expect((await save([defaults[0]!, defaults[1]!, { id: 'more', name: 'More', kind: 'spending' }])).status).toBe(400);
    expect((await save([...defaults, { id: 'x', name: 'bills', kind: 'bills' }])).status).toBe(400);
    expect((await save([...defaults, { id: 'Bad Id', name: 'X', kind: 'bills' }])).status).toBe(400);
    expect((await api('PATCH', `/books/${bookId}/categories/${heads.Rent}/budget`, { token: owner.accessToken, body: { section: 'nope' } })).status).toBe(400);
    const contributor = await registerMember(owner.accessToken, bookId, 'contributor');
    expect((await save(defaults, contributor.accessToken)).status).toBe(403);
  });
});

describe('exporting transactions', () => {
  it('all transactions by default, with each category’s budget section', async () => {
    const lines = await csv('what=transactions&format=csv');
    expect(lines[0]).toBe('Date,Type,Category,Section,Amount,Currency,Note,Tags,For,Account,Added by,Added at');
    expect(lines).toHaveLength(6);
    expect(lines[1]).toMatch(/^2026-09-01,income,Salary job,Income,30000.00,INR,Salary,,,,Owner,/);
    expect(lines[2]).toMatch(/^2026-09-05,expense,Rent,Bills,10000.00,/);
  });

  it('one month, or one head over a range', async () => {
    const october = await csv('what=transactions&format=csv&from=2026-10&to=2026-10');
    expect(october.slice(1).map((l) => l.slice(0, 10))).toEqual(['2026-10-03', '2026-10-10']);

    const groceries = await csv(`what=transactions&format=csv&category=${heads.Groceries}&from=2026-09`);
    expect(groceries).toHaveLength(3);
    expect(groceries.slice(1).every((l) => l.includes(',Groceries,Spending,'))).toBe(true);
  });
});

describe('exporting the budget', () => {
  it('plan vs actual per head for every month, with income first', async () => {
    const lines = await csv('what=budget&format=csv&from=2026-09&to=2026-10');
    expect(lines[0]).toBe('Month,Section,Category,Planned,Actual,Remaining,Status');
    expect(lines.slice(1, 5)).toEqual([
      '2026-09,Income,Income,30000.00,30000.00,0.00,Received',
      '2026-09,Bills,Rent,10000.00,10000.00,0.00,Paid',
      '2026-09,Spending,Groceries,5000.00,5500.00,-500.00,Over budget',
      '2026-09,Savings,Chit,3000.00,0.00,3000.00,To put aside',
    ]);
    expect(lines.slice(5)).toEqual([
      '2026-10,Income,Income,32000.00,0.00,32000.00,Not recorded',
      '2026-10,Bills,Rent,10000.00,0.00,10000.00,To pay',
      '2026-10,Spending,Groceries,6000.00,1200.00,4800.00,Within budget',
      '2026-10,Savings,Chit,3000.00,3000.00,0.00,Saved',
    ]);
  });

  it("lists sections in the book's order", async () => {
    await api('PUT', `/books/${bookId}/budget-order`, { token: owner.accessToken, body: { groups: ['savings', 'spending', 'bills'] } });
    const lines = await csv('what=budget&format=csv&from=2026-10&to=2026-10');
    expect(lines.slice(1).map((l) => l.split(',')[2])).toEqual(['Income', 'Chit', 'Groceries', 'Rent']);
  });

  it('one head across months; spending outside the plan is marked', async () => {
    const lines = await csv(`what=budget&format=csv&category=${heads.Groceries}`);
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 5).join(','))).toEqual(
      expect.arrayContaining(['2026-09,Spending,Groceries,5000.00,5500.00', '2026-10,Spending,Groceries,6000.00,1200.00']),
    );
    expect(lines.slice(1).every((l) => l.includes('Groceries'))).toBe(true);

    const other = await category('Gifts');
    await entry(other, 700, '2026-10-20');
    const october = await csv('what=budget&format=csv&from=2026-10&to=2026-10');
    expect(october).toContain('2026-10,Spending,Gifts,,700.00,,Not in budget');
  });

  it('months before the first plan are left out', async () => {
    const lines = await csv('what=budget&format=csv&from=2026-06&to=2026-09');
    expect(new Set(lines.slice(1).map((l) => l.slice(0, 7)))).toEqual(new Set(['2026-09']));
  });
});

describe('exporting everything', () => {
  it('Excel workbook: summary, budget, transactions and categories sheets', async () => {
    const res = await raw(`/books/${bookId}/export?what=everything&format=xlsx&from=2026-09&to=2026-10`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet4.xml']),
    );
    expect([...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'Monthly summary',
      'Budget',
      'Transactions',
      'Categories',
    ]);

    const summary = sheetRows(files.get('xl/worksheets/sheet1.xml')!);
    expect(summary[0]!.slice(0, 6)).toEqual(['Month', 'Income planned', 'Income received', 'Bills planned', 'Spending planned', 'Savings planned']);
    // September: ₹30,000 in, ₹15,500 spent (savings aren't spending) → ₹14,500 saved.
    expect(summary[1]![0]).toBe('2026-09');
    expect(summary[1]!.at(-1)).toBe('14500');

    const txns = sheetRows(files.get('xl/worksheets/sheet3.xml')!);
    expect(txns).toHaveLength(6);
    // Dates are real dates (serial numbers) and amounts real numbers, so they sort and sum.
    expect(txns[1]!.slice(0, 5)).toEqual(['46266', 'income', 'Salary job', 'Income', '30000']);
    expect(files.get('xl/worksheets/sheet3.xml')).toContain('<pane ySplit="1"');
  });

  it('notes stay text in Excel, never formulas', async () => {
    await entry(heads.Groceries!, 1, '2026-10-04', '=HYPERLINK("http://x") & <b>');
    const res = await raw(`/books/${bookId}/export?what=transactions&format=xlsx`);
    const sheet = unzip(new Uint8Array(await res.arrayBuffer())).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<is><t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;) &amp; &lt;b&gt;</t></is>');
    expect(sheet).not.toContain('<f>');
  });

  it('JSON backup includes the saved plans', async () => {
    const res = await api('GET', `/books/${bookId}/export?what=everything&format=json`, { token: owner.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.budgets.map((b: { month: string }) => b.month)).toEqual(['2026-09', '2026-10']);
    expect(res.body.budgets[0].lines[0]).toMatchObject({ category: 'Rent', planned: rs(10000) });
    expect(res.body.transactions).toHaveLength(5);
    expect(res.body.book.sections.map((s: { id: string }) => s.id)).toEqual(['bills', 'spending', 'savings']);
  });
});

describe('export requests that make no sense', () => {
  const status = async (query: string) => (await raw(`/books/${bookId}/export?${query}`)).status;

  it('are refused with a reason', async () => {
    expect(await status('what=everything&format=csv')).toBe(400);
    expect(await status('what=budget&format=json')).toBe(400);
    expect(await status('what=transactions&from=2026-10&to=2026-09')).toBe(400);
    expect(await status('what=transactions&from=2026-13')).toBe(400);
    expect(await status(`what=budget&format=csv&category=${salaryId}`)).toBe(400);
    expect(await status('what=transactions&category=0123456789abcdef01234567')).toBe(404);
  });

  it("can't reach another book's category", async () => {
    const other = await createBook(owner.accessToken, 'Other');
    const res = await api('GET', `/books/${other.id}/categories`, { token: owner.accessToken });
    const foreign = res.body[0].id as string;
    expect(await status(`what=transactions&category=${foreign}`)).toBe(404);
  });
});

describe('budget month from salary day', () => {
  const setStart = (monthStartDay: number) => api('PATCH', `/books/${bookId}`, { token: owner.accessToken, body: { monthStartDay } });

  it('October runs 25 Sep – 24 Oct when salary comes on the 25th', async () => {
    await entry(heads.Groceries!, 300, '2026-09-25', 'start of October');
    await entry(heads.Groceries!, 400, '2026-10-24', 'end of October');
    await entry(heads.Groceries!, 500, '2026-10-25', 'start of November');
    expect((await setStart(25)).body).toMatchObject({ monthStartDay: 25 });

    const october = await api('GET', `/books/${bookId}/transactions?month=2026-10`, { token: owner.accessToken });
    expect(october.body.map((t: { note: string }) => t.note).sort()).toEqual(['', 'Veg', 'end of October', 'start of October']);
    const budget = await api('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken });
    // 12 Sep's Big shop falls in September now; 3 Oct's Veg plus the two above are October's.
    expect(budget.body.lines.find((l: { categoryId: string }) => l.categoryId === heads.Groceries).spent).toBe(rs(1200 + 300 + 400));
    const summary = await api('GET', `/books/${bookId}/summary?month=2026-11`, { token: owner.accessToken });
    expect(summary.body.expense).toBe(rs(500));

    const trends = await api('GET', `/books/${bookId}/trends?end=2026-11&months=3`, { token: owner.accessToken });
    expect(trends.body.months.map((m: { expense: number }) => m.expense)).toEqual([rs(10000 + 5500), rs(1200 + 3000 + 300 + 400), rs(500)]);

    const lines = await csv('what=transactions&format=csv&from=2026-11&to=2026-11');
    expect(lines.slice(1).map((l) => l.slice(0, 10))).toEqual(['2026-10-25']);
  });

  it('a monthly entry on the 28th is due in the budget month it falls in', async () => {
    await setStart(25);
    await api('POST', `/books/${bookId}/recurring`, {
      token: owner.accessToken,
      body: { type: 'expense', amount: rs(999), categoryId: heads.Rent, note: 'Internet', dayOfMonth: 28, startMonth: '2026-10' },
    });
    const budget = await api('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken });
    expect(budget.body.lines.find((l: { categoryId: string }) => l.categoryId === heads.Rent).due.date).toBe('2026-09-28');
  });

  it('book settings are checked', async () => {
    const patch = (body: object) => api('PATCH', `/books/${bookId}`, { token: owner.accessToken, body });
    expect((await patch({ monthStartDay: 29 })).status).toBe(400);
    expect((await patch({ timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect((await patch({ numberLocale: 'xx-YY' })).status).toBe(400);
    const ok = await patch({ timeZone: 'Asia/Dubai', numberLocale: 'en-US', alertAt: 90 });
    expect(ok.body).toMatchObject({ timeZone: 'Asia/Dubai', numberLocale: 'en-US', alertAt: 90, monthStartDay: 1 });
  });
});

describe('carrying unspent money over', () => {
  it('what is left (or overspent) in a spending category moves into the next month', async () => {
    const on = await api('PATCH', `/books/${bookId}/categories/${heads.Groceries}/budget`, { token: owner.accessToken, body: { rollover: true } });
    expect(on.body).toMatchObject({ rollover: true });
    // Pretend it was turned on in September (it normally counts from the month it's switched on).
    const { collections } = await import('../src/db.ts');
    const { ObjectId } = await import('mongodb');
    await (await collections()).categories.updateOne({ _id: new ObjectId(heads.Groceries!) }, { $set: { rolloverFrom: '2026-09' } });

    const line = async (month: string) =>
      (await api('GET', `/books/${bookId}/budget/${month}`, { token: owner.accessToken })).body.lines.find((l: { categoryId: string }) => l.categoryId === heads.Groceries);
    // September: 5,000 planned, 5,500 spent → 500 over, carried into October as −500.
    expect(await line('2026-09')).toMatchObject({ rolloverIn: 0, remaining: rs(-500) });
    expect(await line('2026-10')).toMatchObject({ planned: rs(6000), rolloverIn: rs(-500), spent: rs(1200), remaining: rs(4300) });
    // November follows October's plan: 6,000 plus the 4,300 left.
    expect(await line('2026-11')).toMatchObject({ planned: rs(6000), rolloverIn: rs(4300), remaining: rs(10300) });
    // Bills and other categories don't carry.
    const rent = (await api('GET', `/books/${bookId}/budget/2026-10`, { token: owner.accessToken })).body.lines.find((l: { categoryId: string }) => l.categoryId === heads.Rent);
    expect(rent.rolloverIn).toBe(0);

    await api('PATCH', `/books/${bookId}/categories/${heads.Groceries}/budget`, { token: owner.accessToken, body: { rollover: false } });
    expect(await line('2026-11')).toMatchObject({ rolloverIn: 0, remaining: rs(6000) });
  });
});
