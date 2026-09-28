# Family Finance OS (ffos) — Plan

Mobile-first PWA for tracking income, expenses, and future commitments, organised into
**shareable Books** with role-based access control (RBAC).

## 1. Architecture

```
 Phone (installed PWA) / Desktop browser
        │  HTTPS + Bearer JWT
        ▼
 GitHub Pages  ── static React app (no secrets)
        │
        ▼
 API: Netlify Functions (free plan, Node runtime)
        │  MongoDB driver (connection string in Netlify env vars)
        ▼
 MongoDB Atlas M0 (512 MB)
```

Why a separate API: GitHub Pages is static-only, and a MongoDB connection string in
frontend code would be public. Atlas Data API (the old browser-friendly option) was retired
in Sept 2025. Netlify Functions run the official `mongodb` driver without workarounds.
(Vercel was the first choice; switched to Netlify because Vercel sign-up needs a phone number the owner can't use.)
RBAC also *must* be enforced server-side, so an API layer is required regardless.

Atlas note: serverless IPs are dynamic, so Atlas network access must allow `0.0.0.0/0`;
protection comes from a strong DB password + a least-privilege DB user (readWrite on `ffos` only).

Storage estimate: ~300 bytes per transaction + ~400 bytes per activity-log entry →
512 MB still holds several hundred thousand edits across a handful of family users.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS, mobile-first, dark mode, safe-area insets |
| PWA | `vite-plugin-pwa` (Workbox): manifest, icons, offline shell, install prompt |
| Data fetching | TanStack Query (cache, refetch on focus, optimistic updates) |
| Offline store | Dexie (IndexedDB): cached data + outbox queue for offline adds |
| Routing | React Router with `HashRouter` (GitHub Pages has no SPA rewrites) |
| Forms/validation | React Hook Form + Zod (schemas shared with API) |
| Charts | Recharts |
| API | Hono on Netlify Functions (pre-bundled with esbuild), `mongodb` driver, Zod, `jose` (JWT), `bcryptjs` |
| Repo | Monorepo: `web/`, `api/`, `shared/` (Zod schemas, types, **role→permission map**) |
| CI/CD | GitHub Actions → build `web/` → deploy to Pages; Netlify auto-deploys `api/` |

## 3. Users & authentication

- **Login identifier:** phone number (E.164, e.g. `+91XXXXXXXXXX`), **email optional**.
- **Credential:** password (bcrypt). SMS OTP is *not* in v1 (every SMS costs money);
  it can be added later behind the same login screen.
- **Instance owner:** the first account created via `/setup` (works only while zero users
  exist). The instance owner can manage users and signup policy.
- **Signup policy — invite-only:** new users can register only through a valid book
  invite link (Section 4.4). No open public signup.
- **Sessions:** short access JWT (15 min, carries `userId` only — **never roles**) +
  rotating refresh token (30 days, hashed in DB, one per device, revocable from Settings → Devices).
- **App lock:** optional 4–6 digit PIN or device biometrics (WebAuthn passkey).
- **Recovery:** 8 one-time recovery codes at registration; the instance owner can also
  issue a password-reset link for another user (no SMS/email dependency).
- **Hardening:** login rate limit + lockout, CORS locked to the Pages origin, Zod validation
  on every request, no secrets in the frontend bundle.

## 4. Books & RBAC

### 4.1 Concept
- A **Book** is an isolated ledger: its own accounts, categories, members, transactions,
  recurring items, commitments, budgets and reports. Example books: *Personal*,
  *Home (with spouse)*, *Parents' expenses*, *Trip to Goa 2026*.
- Every user gets a private **Personal** book on registration.
- A user can create any number of books and belong to many; the app has a **book switcher**
  (top bar) and remembers the last-used book per device.
- Other users see **only** books they are members of, and only what their role allows
  **inside that book**. Nothing leaks across books.

### 4.2 Roles

| Role | Intended for |
|---|---|
| **Owner** | Creator of the book. Exactly one per book. Full control incl. delete & transfer. |
| **Admin** | Co-manager (e.g. spouse). Everything except delete book / transfer ownership. |
| **Editor** | Adds and edits **any** transaction; manages recurring & commitments. |
| **Contributor** | Adds transactions; edits/deletes **only their own**. Good for kids, a helper, a driver submitting fuel bills. |
| **Viewer** | Read-only: sees transactions, dashboard, reports. |

### 4.3 Permission matrix

Permissions are fine-grained strings; roles are named bundles of them, defined once in
`shared/rbac.ts` and used by both API (enforcement) and UI (hide/disable controls).

| Permission | Owner | Admin | Editor | Contributor | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `book.view` (dashboard, lists, reports) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `txn.create` | ✓ | ✓ | ✓ | ✓ | |
| `txn.update.own` / `txn.delete.own` | ✓ | ✓ | ✓ | ✓ | |
| `txn.update.any` / `txn.delete.any` | ✓ | ✓ | ✓ | | |
| `plan.manage` (recurring, commitments, mark paid) | ✓ | ✓ | ✓ | | |
| `budget.manage` | ✓ | ✓ | ✓ | | |
| `setup.manage` (accounts, categories, member labels; anyone with `txn.create` can add a category) | ✓ | ✓ | | | |
| `members.invite` / `members.manage` (change roles ≤ own, remove) | ✓ | ✓ | | | |
| `book.export` | ✓ | ✓ | ✓ | | |
| `book.settings` (name, currency, month start) | ✓ | ✓ | | | |
| `activity.view` | ✓ | ✓ | ✓ | | |
| `book.delete` / `book.transfer` | ✓ | | | | |

Rules:
- An admin can't assign a role higher than admin, and can't modify the owner or other admins.
- The owner can't leave a book without first transferring ownership.
- Anyone except the owner can **leave** a book themselves.
- The Personal book is always private: it can't be shared, transferred or deleted. To share, create another book.

### 4.4 Invitations (no SMS needed)
1. Owner/admin taps **Share book → Invite**, picks a role, optionally the invitee's phone.
2. API creates an invite (random token, stored hashed, expires in 7 days, single use)
   and returns a link: `https://<pages>/#/invite/<token>`.
3. Share via WhatsApp/any app using the Web Share API.
4. Invitee opens link → logs in (existing user) or registers (new user) → sees
   "Join *Home* as Editor?" → accept → membership created.
5. If a phone was specified, the invite only works for an account with that phone.
6. Pending invites are listed in book settings and can be revoked.

Also possible: **add existing user directly** by phone number (if they already have an
account) → they receive a pending invite shown in their app on next open.

### 4.5 Enforcement (server-side)
- All book data lives under `/api/v1/books/:bookId/...`.
- Middleware on every book route: load membership `{bookId, userId}` → 404 if absent
  (don't reveal a book exists) → attach `role` + permission set → route checks
  `can('txn.update.any')` or, for own-only, compares `createdBy` with the caller.
- **Every** query includes `bookId` in its filter — enforced by a small repository helper
  (`bookScoped(collection, bookId)`) so no route can forget it.
- Roles are read from the DB per request (one indexed lookup), so a role change or removal
  takes effect immediately — no waiting for tokens to expire.

### 4.6 Collaboration details
- **Attribution:** each transaction stores `createdBy`/`updatedBy`; the list shows an avatar
  chip ("added by Priya").
- **Activity log:** per book — who added/edited/deleted what, with a before/after diff.
  Admins can undo deletions (soft delete, restorable for 30 days).
- **Concurrent edits:** every doc has a `version` number; updates send the version they
  started from and get `409 Conflict` if someone else saved first → UI shows
  "This was changed by X, reload?".
- **Freshness:** refetch on app focus + every 60 s while open (no websockets on serverless).
- **Duplicate protection for recurring items:** unique index on
  `{recurringId, occurrenceDate}` so two members opening the app simultaneously can't
  create the same salary/rent entry twice.
- **Family member labels vs users:** labels ("Kids", "Grandma") are for tagging who money was
  spent on/by; a label can optionally be linked to a real user account in the book.

## 5. Features

### v1 (MVP)
1. **Books:** create, rename, switch, share, members & roles, invites, leave, transfer, delete.
2. **Dashboard (per book):** month income, expenses, net, account balances, budget progress,
   next 30 days of commitments, recent activity from other members.
3. **Transactions:** income / expense / transfer; amount, date, category, account, member
   label, note, tags, added-by. Grouped by day, search + filters (incl. "added by"),
   swipe to edit/delete (per permission).
4. **Quick add** (main mobile flow): number pad → category chips → save, into the current book.
5. **Accounts:** cash, bank, card, UPI/wallet, loan — per book. Running balances, transfers.
6. **Categories:** defaults seeded per new book, custom icon/color, sub-categories.
7. **Recurring items:** salary, rent, subscriptions, SIPs — auto-create or "due" reminder.
8. **Future commitments / planning:** EMIs & loans (amortization schedule), insurance,
   school fees, renewals, planned purchases; timeline of dues; "mark paid" → creates the
   transaction; **cash-flow forecast** for 3/6/12 months.
9. **Budgets:** monthly limit per category, warnings at 80%/100%.
10. **Reports:** monthly trend, category breakdown, income vs expense, yearly summary,
    member-wise and user-wise spend.
11. **Backup:** per-book export JSON/CSV, import JSON (owner/admin).
12. **Settings:** user (profile, theme, security, devices) and book (currency, month start day,
    members).

### Later (v2+)
- "All books" combined overview (only books you can view)
- Settle-up / who-owes-whom for shared trip books
- Savings goals, offline outbox sync, Web Push reminders for dues, SMS OTP
- Receipt photos (external storage), net worth tracking
- Custom roles per book (the permission-string design already allows this)

## 6. Data model (MongoDB collections)

Money is stored as **integers in minor units** (paise/cents). All docs carry `createdAt`,
`updatedAt`, `version`; soft delete via `deletedAt`.

```ts
// ── identity (global) ──
users        { _id, phone (unique), email? (unique sparse), passwordHash, name, avatarColor,
               isInstanceOwner, prefs: { theme, lastBookId }, recoveryCodeHashes[], pinHash?,
               disabledAt? }
sessions     { _id, userId, refreshTokenHash, deviceName, lastUsedAt, expiresAt (TTL) }
loginAttempts{ _id, phone, ip, at (TTL) }

// ── sharing ──
books        { _id, name, icon, color, currency, locale, monthStartDay, ownerId,
               isPersonal, deletedAt? }
bookMembers  { _id, bookId, userId, role: owner|admin|editor|contributor|viewer,
               invitedBy, joinedAt }                      unique { bookId, userId }; { userId }
invites      { _id, bookId, role, tokenHash (unique), phone?, createdBy,
               expiresAt (TTL), usedBy?, usedAt?, revokedAt? }
activity     { _id, bookId, userId, action: create|update|delete|restore|role_change|join|leave,
               entity, entityId, diff, at }               { bookId, at: -1 }; TTL 1 year

// ── book data (every doc has bookId, createdBy, updatedBy) ──
accounts     { bookId, name, type: cash|bank|card|wallet|loan, openingBalance, color, icon, archived }
categories   { bookId, name, kind: income|expense, parentId?, icon, color, archived, sort }
memberLabels { bookId, name, color, userId? }
transactions { bookId, type: income|expense|transfer, amount, date, accountId, toAccountId?,
               categoryId?, memberLabelId?, note, tags[], recurringId?, occurrenceDate?,
               commitmentId? }
               indexes: { bookId, date: -1 }, { bookId, categoryId, date: -1 },
                        { bookId, accountId, date: -1 }, { bookId, createdBy, date: -1 },
                        unique partial { recurringId, occurrenceDate }
recurring    { bookId, type, amount, categoryId, accountId, memberLabelId?, note,
               rule: { freq, interval, dayOfMonth?, endDate? }, nextDate, autoCreate, active }
commitments  { bookId, title, kind: emi|insurance|fee|purchase|bill|other, amount, dueDate,
               recurrence?, accountId?, categoryId?,
               loan?: { principal, ratePct, tenureMonths, startDate },
               status: upcoming|paid|skipped, paidTransactionId?, notes }
budgets      { bookId, month: "2026-10", categoryId, limit }   unique { bookId, month, categoryId }
```

Recurring items/commitments are processed **when any member opens the book**
(`POST /books/:id/catch-up`, idempotent via the unique index). No cron needed.

## 7. API surface (REST, `/api/v1`)

```
# auth & user
POST /auth/setup | /auth/register (with invite token) | /auth/login | /auth/refresh
     /auth/logout | /auth/recover
GET/PATCH /me      GET/DELETE /me/sessions      GET /me/invites (pending)

# books & sharing
GET/POST /books                      GET/PATCH/DELETE /books/:bookId
GET  /books/:bookId/members          PATCH/DELETE /books/:bookId/members/:userId
POST /books/:bookId/leave            POST /books/:bookId/transfer
GET/POST /books/:bookId/invites      DELETE /books/:bookId/invites/:id
GET  /invites/:token (preview)       POST /invites/:token/accept
GET  /books/:bookId/activity         POST /books/:bookId/restore/:entity/:id

# book data (all RBAC-checked)
CRUD /books/:bookId/{accounts,categories,member-labels,transactions,recurring,commitments,budgets}
POST /books/:bookId/commitments/:id/pay     POST /books/:bookId/catch-up
GET  /books/:bookId/reports/summary?from&to GET /books/:bookId/reports/forecast?months=6
GET  /books/:bookId/export                  POST /books/:bookId/import

# instance owner
GET /admin/users   PATCH /admin/users/:id (disable)   POST /admin/users/:id/reset-link
```

## 8. Mobile UX

- Top bar: **book switcher** (name + colour dot + role badge) and share button
- Bottom tab bar: **Home · Transactions · (+) · Plan · More**
- Floating (+) opens quick-add for the current book (hidden for viewers)
- Controls a user lacks permission for are hidden, not just disabled
- Thumb-reachable controls, 44px+ touch targets, bottom sheets, dark/light by system
- Desktop: same app, sidebar layout at ≥1024px, wider tables

## 9. Implementation phases

| Phase | Scope |
|---|---|
| 0. Setup | Monorepo, Vite+React+TS+Tailwind, Hono API on Netlify, Atlas + indexes, Actions → Pages |
| 1. Auth | Setup/login/refresh/logout, rate limiting, recovery codes, protected routes |
| 2. Books & RBAC core | Books CRUD, membership, `shared/rbac.ts`, book-scoped middleware + repository helper, book switcher, Personal book on signup, RBAC tests |
| 3. Core ledger | Accounts, categories (seeded per book), member labels, transactions CRUD with own/any rules, quick-add, dashboard |
| 4. Sharing | Invites + invite-based registration, members screen, role changes, leave/transfer, activity log, restore, conflict (409) handling |
| 5. Planning | Recurring rules, commitments, EMI schedule, idempotent catch-up, forecast |
| 6. Insights | Budgets, reports & charts, export/import |
| 7. PWA polish | Manifest/icons, offline shell, install prompt, app lock (PIN/passkey) |
| 8. v2 | All-books overview, settle-up, goals, offline sync, push reminders, OTP |

RBAC is built in Phase 2 — before any ledger feature — so every later endpoint is book-scoped
from day one rather than retrofitted.

**Testing:** a permission test matrix (every role × every endpoint → expected 2xx/403/404)
runs in CI against an in-memory MongoDB (`mongodb-memory-server`).

## 10. Accounts needed before implementation

1. GitHub repo (Pages enabled via Actions)
2. MongoDB Atlas M0 cluster → connection string
3. Netlify account connected to the repo (for `api/`)
4. Optional: custom domain (e.g. `app.example.com` + `api.example.com`)

## 11. Build status

**Minimal v1 — implemented (2026-09-28), ready for review**
- Monorepo (`shared/`, `api/`, `web/`), Netlify function bundle, GitHub Actions for CI and Pages deploy
- Auth: one-time setup, invite-only registration, phone + password login, rate limiting,
  rotating refresh tokens, recovery codes, profile, password change, device list/revoke
- Books & RBAC: create/switch/rename/delete books, 5 roles enforced server-side, invites (link, optional
  phone lock, single-use, 7-day expiry, revoke), role changes, remove, leave, transfer ownership, activity log
- Ledger (thin slice): default categories per book, income/expense add/edit/delete with own/any rules,
  optimistic concurrency (409), monthly dashboard summary, transactions list with search and filters
- PWA: manifest, icons, offline app shell, installable; responsive phone/desktop layouts, dark mode
- Tests: 29 API tests covering auth, invites, book isolation and the role matrix

**Next (core features, after review)**
- Accounts & transfers, member labels, custom categories UI
- Recurring items, commitments/EMIs, cash-flow forecast
- Budgets, reports & charts, export/import
- Restore deleted items, app lock (PIN/passkey), offline add queue

