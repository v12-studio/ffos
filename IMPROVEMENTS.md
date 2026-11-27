# FFOS: what can be improved (customisation and ease of use)

Review date: 27 Nov 2026. Based on reading the code in `web/`, `api/` and `shared/`, plus `PLAN.md`,
`UI_PLAN.md` and `BUDGET_PLAN.md`. The screens weren't viewed in a browser for this review.

Effort: **S** = under a day, **M** = a few days, **L** = a week or more.

## Status (27 Nov 2026): built, not yet committed or deployed

Everything below was built in one pass. API tests: 130 passing (10 files). Typecheck and both builds pass.
**The screens haven't been checked in a browser yet.**

**Done:** 1.1 reset links (Settings → Users) and new recovery codes · 1.2 restore a JSON backup, CSV import
with undo · 1.3 "category" everywhere · 1.4 Book settings and Export in Settings · 1.5 currency picker with
warning · 1.6 per-book time zone and number style · 1.7 password eye · book colour · light/dark/system,
accent colour, text size · drag-to-reorder categories · custom budget sections (rename, add, remove, reorder)
· salary-day budget months · carry-over · warn level · repeat every 1/2/3/4/6/12 months, end after N times ·
tags · for whom · split · favourites · search filters (dates, amounts, tag, person, account, sort) with paging
· select many (category, tag, delete with undo) · merge and delete categories · sub-categories · accounts and
balances with transfers · Reports (12/24 months, by category, by person) · Overview cards and middle tab
choice · getting-started checklist · Help & guide · activity filters and paging · restore deleted books ·
book templates · WhatsApp invite · download my data · delete my account · write rate limit · reminder
notifications (needs VAPID keys on Netlify, see README).

**Not done, needs a decision or a service from you:**
- **Other languages**: every screen's text would need translating and checking by a native speaker.
- **Password reset by email or SMS**: needs an email or SMS provider (SMS costs per message).
- **Receipt photos**: needs file storage (the free database tier is too small for images).
- **Open public sign-up**: today it's invite-only by design.
- **Privacy policy and terms**: legal text. Help → Your data describes factually what's stored.
- **Database backups and error monitoring**: account-level setup in Atlas and a monitoring service.
- **Weekly repeating entries**: frequencies are monthly-based (1–12 months).

## Already good

- Adding an entry is fast: keypad, budget heads as quick picks, "₹X left" hint, works offline, undo on delete.
- Sharing is solid: books, five roles enforced by the server, invite links, activity log.
- The budget fits how a family thinks: bills / spending / savings, safe-to-spend per day, goals,
  allowances, the plan carries over each month, and (new) section order and flexible exports.
- App lock with PIN or fingerprint/Face ID, signed-in devices, recovery codes.

---

## 1. Fix first: problems that will cost users data, time or trust

| # | Problem | Why it matters | Fix | Effort |
|---|---|---|---|---|
| 1.1 | **No way back in after losing the password and the recovery codes.** There's no reset by the instance owner (planned in PLAN.md §3, not built), no reset by email or SMS, and no way to make new recovery codes. | A family member is locked out for good, and you can't help them. | Instance owner can create a one-time reset link for any user. "Make new recovery codes" in Settings → Password. Later: email reset for users who added an email. | M |
| 1.2 | **A backup can't be restored.** Export makes a JSON backup, but there's no import. There's also no way to import a bank statement CSV. | A "backup" that can't be loaded back isn't a backup. Starting from bank statements saves hours. | Import a JSON backup into a new book (owner/admin). CSV import with a column-matching step and a duplicate check. | M–L |
| 1.3 | **One idea, two names.** Settings says **Categories**; the Budget says **heads** / **budget heads**. They're the same thing. Likewise "Monthly entries" in Settings vs "Repeat every month" when adding. | New users will think heads and categories are different things and look for the wrong screen. | Use one word everywhere (suggest "category", with "budget" as the adjective: "budget categories"). Same for repeating entries. | S |
| 1.4 | **Book settings and Export are hard to find.** Name and currency live under Settings → Members → Manage → Book settings. Settings itself has no "Book settings" row. | People look for currency in Settings. | Add "Book settings" and "Export" rows to Settings → book section. Keep the Members links. | S |
| 1.5 | **Currency is a free-text box** ("INR") at book creation and in Book settings, and changing it relabels every amount without converting. | Users don't know ISO codes; one typo shows every amount in the wrong currency. | Searchable picker ("₹ Indian rupee"). Warn before changing it on a book that has entries. | S |
| 1.6 | **Date and number format are fixed to India.** "Today" is always Mumbai time (`shared/src/time.ts`), and amounts always use lakh grouping (`en-IN` in `shared/src/money.ts`). | Fine for families in India. Wrong for a family member abroad: their "today" and "this month" shift, and 1,00,000 reads oddly. | Per-book time zone and number style (lakh or million grouping), defaulting to today's behaviour. | M |
| 1.7 | **No show/hide toggle on password fields.** | Mistyped passwords on phones, then the login rate limit kicks in. | Eye button on every password field. | S |

## 2. Customisation: what can be set today and what's missing

| Area | Can customise today | Missing | Effort |
|---|---|---|---|
| **Look** | Nothing: light/dark follows the phone | Light / dark / system choice; accent colour; compact vs comfortable rows | S–M |
| **Book** | Name, currency | **Colour** (the API already accepts it, the screen has no picker); icon; **budget month start day** (salary day, e.g. 25th → 24th; in BUDGET_PLAN B1, not built); time zone and number format (1.6); starting set of categories when creating a book (household / trip / small business / blank) | S–L |
| **Budget** | Categories in the plan, amounts, each one's section, **section order** (new), goals, allowances | **Rename sections** ("Bills" → "Fixed costs"); **add sections** (EMIs & loans, Investments, Giving); **roll unspent money over** to next month (BUDGET_PLAN B6); alert levels (e.g. warn at 80%) | M–L |
| **Categories** | Name, icon, colour, order, hide | **Drag to reorder** (today: up/down arrows, one save per tap, while the Budget uses drag); **merge two categories** (move the entries, then hide one); delete an unused one; sub-categories (Food → Milk, Vegetables) | S–L |
| **Repeating entries** | Amount, day of month, category, note, pause, start month | **Other frequencies**: weekly, every 3/6 months, yearly (insurance, school fees); **end after N times** (EMIs); add automatically vs remind me | M |
| **Each entry** | Type, amount, category, date, note, repeat | **Tags**; **paid with** (cash / UPI / card / bank); **for whom** (member); **receipt photo**; **split** one bill across categories; **favourites** ("Milk ₹60" in one tap) | M–L each |
| **Overview** | Fixed layout | Choose and order the cards (safe to spend, bills due, recent, trends) | M |
| **Tab bar** | Fixed: Overview, Transactions, Add, Budget, Settings | Let people swap a tab (e.g. Reports instead of Budget) | S–M |
| **Alerts** | None | Bill due tomorrow, category at 80% / over, a member added something (web push; on iPhone this needs the app installed to the home screen) | L |
| **Language** | English only | Regional languages (e.g. Tamil, Hindi). The words already used ("seetu", "chit") suggest who the users are | L |
| **Export** | Done in this round: budget / transactions / everything, one category, any period, CSV / Excel / JSON | Scheduled monthly export by email (later) | — |

## 3. Ease of use: smaller improvements

| # | Improvement | Effort |
|---|---|---|
| 3.1 | **First-run guide.** A new owner lands on an empty Overview with 15 default categories. A 3-step start (currency and salary day → monthly income → pick budget categories from suggestions) gets them to a working budget in 2 minutes. BUDGET_PLAN B2 describes this. | M |
| 3.2 | **Search filters.** Search covers text, category, type and "mine", but no date range, amount range or sort, and stops at 200 results. | M |
| 3.3 | **Select many entries** to change their category or delete them together (fixing a wrong category used for months). | M |
| 3.4 | **Activity log** shows only the last 100 changes and can't be filtered by person or type. | S |
| 3.5 | **Reports.** Only a 6-month trend today. Add a yearly summary, one category over time, and spend per member (PLAN.md v1 item 10). | M |
| 3.6 | **Accounts and balances** (cash, bank, card, UPI) with transfers, so the app can answer "how much do we have?". In PLAN.md v1, not built. | L |
| 3.7 | **Deleted books can't be restored.** Deletion is a soft delete on the server, but there's no Restore screen. | S |
| 3.8 | **In-app help.** Short "what's this?" notes for roles, sections (bills vs spending vs savings), safe-to-spend and carried-over plans. | S |
| 3.9 | **Invite flow.** Show what each role can do right where the role is picked, and offer a WhatsApp share of the invite link. | S |

## 4. Only if the app is opened to the public

Today it's built for one family or group: one owner sets it up, and everyone else joins by invite.
Opening it to strangers needs:

- Open sign-up, with phone or email verification (SMS OTP costs money per message).
- Password reset that doesn't depend on the owner (email or OTP).
- **Delete my account and data**, and download my data. Privacy law (India's DPDP Act) expects both.
- Privacy policy and terms.
- An admin screen: users, disabling abusive accounts, usage.
- Rate limits on all write requests, not just login.
- Database backups (the free Atlas tier doesn't include automatic backups) and a storage plan (the free tier is 512 MB).
- Error tracking and uptime alerts, so you hear about problems before users do.

## Suggested order

1. **Quick wins (S):** 1.3 one name for categories, 1.4 Book settings and Export in Settings, 1.5 currency
   picker, 1.7 password eye, book colour picker, light/dark choice, drag to reorder categories.
2. **Safety (M):** 1.1 password reset by the owner and new recovery codes, 1.2 restore from backup.
3. **Budget (M–L):** salary-day month start, rename/add sections, rollover, alert levels.
4. **Entries (M):** repeat frequencies and EMIs, tags and "paid with", search filters, select many.
5. **Bigger (L):** first-run guide, reports, accounts and balances, alerts, languages.
6. **Public launch (L):** section 4.
