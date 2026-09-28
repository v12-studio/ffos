# FFOS Budget Planner — Plan

> **Status (2026-09-28): B1 core built**, shaped by the owner's workflow — plan a calendar month by
> entering income and splitting it into budget heads (expense categories); whatever isn't allocated is
> "saved this month". Every expense is recorded against a head; the add sheet shows what's left and
> warns (but still saves) when a head goes over. Budget tab, plan editor, copy last month, Overview
> snapshot, Members moved into Settings on phones. Not yet: start day ≠ 1st, groups, rollover, pace,
> recurring, goals, loans (phases B2–B6 below).

Turns FFOS from "record what happened" into "decide where money goes, then track against it".
Everything is per **book**: a shared "Home" book has one household budget that all members see.

## 1. How the budget works (the model)

**Zero-based monthly plan** — give every rupee of expected income a job:

```
 Expected income                        ₹1,20,000
 − Fixed bills (rent, EMIs, subscriptions)  ₹48,000
 − Savings & goals (SIP, emergency fund)    ₹25,000
 − Annual expenses set-aside                 ₹6,500
 − Spending budgets (groceries, fuel…)     ₹38,000
 ─────────────────────────────────────────────────
 = Left to assign                            ₹2,500   ← aim for ₹0
```

Then, through the month, every transaction reduces the matching budget line, so the family always sees
**what's left** per category and **how much is safe to spend per day** until the next salary.

### Building blocks

| Concept | What it is | Example |
|---|---|---|
| **Budget period** | A month that starts on the book's chosen day (salary day), e.g. 25 Sep – 24 Oct | Salary on the 25th |
| **Category groups** | Every category belongs to one group: Income, Bills, Living, Lifestyle, Savings, Debt | Groceries → Living; SIP → Savings |
| **Budget lines** | Planned amount per category for a period | Groceries ₹12,000 |
| **Income plan** | Expected income per source for the period | Salary ₹1,00,000, Rent received ₹20,000 |
| **Recurring items** | Bills, subscriptions, SIPs, salary that repeat on a schedule | Netflix ₹649 on the 5th |
| **Loans / EMIs** | Principal, rate, tenure → EMI schedule, remaining balance | Home loan EMI ₹32,000 |
| **Annual expenses (sinking funds)** | Big yearly/irregular costs saved for monthly | Car insurance ₹24,000 due in March → ₹4,000/month |
| **Savings goals** | Target + date → monthly contribution and progress | Emergency fund ₹3,00,000 by Dec 2027 |
| **Rollover** | Unspent budget carries to next month (per category, optional); overspend is shown as a deficit | Unspent ₹800 of clothing rolls over |

Savings and investments are **not counted as spending** in reports — they show as money saved.

## 2. Screens

Bottom tabs become: **Overview · Transactions · (+) · Budget · Settings**.
Members moves into the book menu (top bar) and Settings — it's used rarely compared to the budget.

### Budget tab (the main new screen)
```
 ┌ October budget · 25 Sep – 24 Oct ──── ◀ ▶ ┐
 │ Left to assign  ₹2,500        [Assign]    │
 │ Spent ₹41,200 of ₹1,17,500 · 12 days left │
 │ Safe to spend today  ₹1,150               │
 └───────────────────────────────────────────┘
 BILLS                     ₹48,000  paid 3/5
   Rent            ₹25,000  ✓ paid
   Home loan EMI   ₹18,000  due 5 Oct
 LIVING                    ₹38,000  62% used
   Groceries  ██████████░░  ₹9,800 / ₹12,000   ⚠ ahead of pace
   Fuel       █████░░░░░░░  ₹2,100 / ₹5,000
 SAVINGS & GOALS           ₹25,000
   SIP             ₹15,000  ✓
   Emergency fund  ₹10,000  ₹1,40,000 of ₹3,00,000
 ANNUAL EXPENSES            ₹6,500
   Car insurance    ₹4,000/mo · due Mar · ₹16,000 saved
```
- Tap a line → sheet: change planned amount, see its transactions, rollover on/off,
  suggestions ("last 3 months average ₹11,400").
- Colours: on track / ahead of pace (spending faster than the month is passing) / over budget.

### First-time setup wizard (per book, ~2 minutes)
1. Budget start day (salary day) → 2. Expected income → 3. Fixed bills & EMIs →
4. Savings goals & annual expenses → 5. Spending budgets, pre-filled from the last 3 months' averages
(or a 50/30/20 split if there's no history) → Review "Left to assign" → Done.

### Plan screen (inside Budget)
- **Upcoming** — bills, EMIs and annual expenses due in the next 30 days; *Mark paid* creates the transaction.
- **Goals** — progress bars, monthly contribution needed, projected completion date.
- **Loans** — EMI schedule, principal vs interest paid, months remaining.
- **12-month outlook** — expected income vs planned outgoings per month; flags months where
  annual expenses bunch up (e.g. school fees + insurance in April).

### Overview (updated)
Safe-to-spend today, top 3 categories closest to their limit, next 3 bills due, savings rate this month.

### Month-end review
When a period closes: planned vs actual per group, amount saved, biggest overspends,
and one-tap **"Start next month from this plan"** (copies lines, applies rollovers).

## 3. Calculations (server-side, unit-tested)

| Figure | Formula |
|---|---|
| Period range | From `startDay` of month M to `startDay − 1` of M+1 (days clamped to 28 for Feb safety) |
| Left to assign | planned income − Σ planned lines (bills + savings + sinking + spending) |
| Line available | planned + rollover in − actual spent |
| Pace | actual ÷ planned vs days elapsed ÷ days in period; "ahead of pace" if > 1.1× (Living/Lifestyle only) |
| Safe to spend today | (Σ available in Living + Lifestyle) ÷ days left, floor 0 |
| Sinking fund monthly | (target − saved) ÷ periods until due |
| Goal monthly | (target − saved) ÷ periods until target date |
| EMI | P·r·(1+r)ⁿ / ((1+r)ⁿ − 1), r = annual rate ÷ 12 |
| Savings rate | Savings-group actual ÷ actual income |

## 4. Data model changes

```ts
books        + budgetStartDay: 1..28 (default 1), rolloverDefault: boolean
categories   + group: 'income'|'bills'|'living'|'lifestyle'|'savings'|'debt', rollover?: boolean

budgets      { bookId, period: '2026-10', startDate, endDate,
               income: [{ categoryId, planned }],
               lines:  [{ categoryId, planned, rollover: boolean, rolloverIn: number }],
               status: 'draft'|'active'|'closed', version, createdBy, updatedBy }
               unique { bookId, period }

recurring    { bookId, kind: 'bill'|'subscription'|'income'|'sip', name, amount, categoryId,
               rule: { freq: 'monthly'|'weekly'|'yearly'|'custom', interval, dayOfMonth?, endDate? },
               nextDue, autoCreate: boolean, active }

loans        { bookId, name, principal, annualRatePct, tenureMonths, startDate, emiDay, categoryId,
               prepayments: [{ date, amount }] }

goals        { bookId, kind: 'goal'|'annual', name, target, dueDate, categoryId,
               recurrence?: 'yearly' (annual expenses renew after due), archived }

transactions + recurringId?, loanId?, goalId?, occurrenceDate?
               unique partial { recurringId, occurrenceDate }   // no duplicate auto-entries
```
512 MB is ample: one budget document per book per month is ~2 KB.

## 5. API (all under `/books/:bookId`, RBAC as today)

```
GET  /budget/:period              → plan + actuals + computed figures (one call renders the Budget tab)
PUT  /budget/:period              → save plan (budget.manage; version check → 409 on conflict)
POST /budget/:period/copy-from/:p → start from another month's plan (+ rollovers)
GET  /budget/:period/suggestions  → 3-month averages, 50/30/20 split
CRUD /recurring   /loans   /goals  (plan.manage)
POST /recurring/:id/pay | /loans/:id/pay | /goals/:id/contribute   → creates the linked transaction
GET  /upcoming?days=30            GET /forecast?months=12          GET /review/:period
POST /catch-up                     → create due auto-entries (idempotent), called on app open
```
Permissions: everyone views; **editor+** plans budgets, recurring items, loans and goals;
contributors keep adding transactions (which count against the budget).

## 6. Implementation phases

| Phase | Delivers | Size |
|---|---|---|
| **B1. Budget core** | Start day + period ranges (Overview/Transactions switch to periods), category groups, budgets collection, Budget tab with planned vs actual, left to assign, pace colours, copy last month, line edit sheet | Large |
| **B2. Setup wizard & suggestions** | 5-step wizard, 3-month averages, 50/30/20 starter | Medium |
| **B3. Recurring bills & income** | Recurring rules, catch-up auto-entries, Upcoming list, mark paid, bills feed budget lines | Medium |
| **B4. Goals & annual expenses** | Goals, sinking funds, monthly set-aside, contributions, progress | Medium |
| **B5. Loans / EMIs** | EMI calculator, schedule, remaining balance, EMI as recurring bill | Medium |
| **B6. Insights** | Rollover, safe-to-spend, Overview widgets, month-end review, 12-month outlook, in-app alerts at 80% / 100% | Medium |
| Later | Accounts & balances (for a true balance forecast), web push reminders, budget per member | — |

B1 alone already makes it a budget planner; each later phase adds on without reworking B1.

**Testing:** unit tests for every formula in §3 (period boundaries incl. Feb and 31-day months,
rollover, pace, EMI, sinking funds), API permission tests per role, and a browser walkthrough per phase.

## 7. Decisions (recommended defaults)

1. **Budget style:** zero-based "Left to assign" (can be ignored — works as simple limits too).
2. **Period start:** per book, default the 1st; set to salary day if paid mid-month.
3. **Rollover:** off by default, switchable per category.
4. **Savings/SIPs:** own group, excluded from "spending" totals.
5. **Navigation:** Budget replaces Members in the tab bar.
