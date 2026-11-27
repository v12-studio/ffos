import { z } from 'zod';
import { BOOK_TEMPLATES, HEAD_GROUPS, MAX_SECTIONS, SECTION_ID } from './categories.ts';
import { NUMBER_LOCALES } from './money.ts';
import { ACCOUNT_KINDS } from './types.ts';
import { ASSIGNABLE_ROLES } from './rbac.ts';

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the phone number with country code, e.g. +919876543210'));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email'));

/** Optional email: empty string is treated as "not provided". */
export const optionalEmailSchema = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

export const nameSchema = z.string().trim().min(1, 'Name is required').max(60);

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. INR');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');

// ── auth ──
export const setupSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  password: passwordSchema,
});

export const registerSchema = setupSchema.extend({ inviteToken: z.string().min(10) });

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Password is required'),
  deviceName: z.string().trim().max(80).optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const recoverSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().min(6),
  newPassword: passwordSchema,
});

export const updateMeSchema = z.object({
  name: nameSchema.optional(),
  email: optionalEmailSchema,
  notify: z.object({ bills: z.boolean(), budget: z.boolean() }).optional(),
});

/** A browser's push subscription (PushSubscription.toJSON()). */
export const pushSubscribeSchema = z.object({
  endpoint: z.url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/) }),
});

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().max(1000) });

/** Reset with a link from the instance owner. */
export const resetWithLinkSchema = z.object({
  token: z.string().min(20).max(100),
  newPassword: passwordSchema,
});

/** Actions that need the password typed again. */
export const confirmPasswordSchema = z.object({ password: z.string().min(1, 'Enter your password') });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

// ── books & sharing ──
export const bookCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  currency: currencySchema.default('INR'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  /** Which categories it starts with. */
  template: z.enum(BOOK_TEMPLATES).optional().default('household'),
});

/** Activity: newest first, a page at a time (?before= the last one's time), optionally one person or kind. */
export const activityQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  userId: objectIdSchema.optional(),
  entity: z.enum(['transaction', 'category', 'member', 'book', 'budget', 'recurring']).optional(),
});

const timeZoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const bookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  currency: currencySchema.optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  timeZone: timeZoneSchema.optional(),
  monthStartDay: z.number().int().min(1, 'Pick a day from 1 to 28').max(28, 'Pick a day from 1 to 28').optional(),
  numberLocale: z.enum(NUMBER_LOCALES).optional(),
  alertAt: z.number().int().min(50).max(100).optional(),
});

export const inviteCreateSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
  phone: z.union([z.literal(''), phoneSchema]).optional().transform((v) => (v ? v : undefined)),
});

export const memberUpdateSchema = z.object({ role: z.enum(ASSIGNABLE_ROLES) });

export const transferSchema = z.object({ userId: objectIdSchema });

// ── ledger ──
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['income', 'expense']),
  icon: z.string().max(32).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  /** Make it a sub-category of this one (e.g. Milk inside Groceries). */
  parentId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

/** Amounts are integers in minor units (paise/cents). */
export const amountSchema = z
  .number()
  .int('Amount must be in minor units')
  .positive('Amount must be greater than zero')
  .max(1_000_000_000_00, 'Amount is too large');

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40).optional(),
  icon: z.string().max(32).optional(),
  color: colorSchema.optional(),
  archived: z.boolean().optional(),
  /** The category it sits inside; null makes it top-level. */
  parentId: objectIdSchema.nullable().optional(),
});

/** New display order for one kind of category: every live id of that kind, in order. */
export const categoryOrderSchema = z.object({
  kind: z.enum(['income', 'expense']),
  ids: z.array(objectIdSchema).max(200),
});

/** A label on an entry ("trip", "office", "kids"): short, no commas. */
export const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(24, 'Keep tags to 24 characters')
  .regex(/^[^,#]+$/, "Tags can't contain commas or #");

/** Up to 8 tags, without repeats (ignoring case). */
export const tagsSchema = z
  .array(tagSchema)
  .max(8, 'At most 8 tags')
  .transform((tags) => tags.filter((t, i) => tags.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i));

const transactionFields = {
  type: z.enum(['income', 'expense']),
  amount: amountSchema,
  date: dateSchema,
  categoryId: objectIdSchema,
  note: z.string().trim().max(200).optional().default(''),
  tags: tagsSchema.optional(),
  /** The member it was for (e.g. a child's school fees). Null clears it. */
  forMemberId: objectIdSchema.nullable().optional(),
  /** The account it was paid from or received into. Null clears it. */
  accountId: objectIdSchema.nullable().optional(),
};

export const transactionCreateSchema = z.object({
  ...transactionFields,
  /** Client-generated id so a retried or offline-queued save is only recorded once. */
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
  /** Also add this entry every month on the same day. */
  repeatMonthly: z.boolean().optional(),
});

export const transactionUpdateSchema = z.object(transactionFields).partial().extend({
  /** Version the client started editing from; a mismatch returns 409. */
  version: z.number().int().nonnegative(),
});

// ── recurring entries ──
export const dayOfMonthSchema = z.number().int().min(1, 'Pick a day from 1 to 31').max(31, 'Pick a day from 1 to 31');

/** How often a repeating entry comes round: every month, 2, 3 (quarterly), 4, 6 months, or yearly. */
export const REPEAT_EVERY = [1, 2, 3, 4, 6, 12] as const;
const everyMonthsSchema = z.union(REPEAT_EVERY.map((n) => z.literal(n)) as [z.ZodLiteral<1>, ...z.ZodLiteral<number>[]]);

export const recurringCreateSchema = z
  .object({
    type: transactionFields.type,
    amount: transactionFields.amount,
    categoryId: transactionFields.categoryId,
    note: transactionFields.note,
    dayOfMonth: dayOfMonthSchema,
    /** First month it's due (YYYY-MM). */
    startMonth: monthSchema,
    everyMonths: everyMonthsSchema.optional().default(1),
    /** Last month it's due, e.g. an EMI's final instalment. Null or absent: no end. */
    endMonth: monthSchema.nullable().optional(),
  })
  .refine((r) => !r.endMonth || r.endMonth >= r.startMonth, { message: 'It has to end after it starts', path: ['endMonth'] });

export const recurringUpdateSchema = z.object({
  type: transactionFields.type.optional(),
  amount: amountSchema.optional(),
  categoryId: objectIdSchema.optional(),
  note: z.string().trim().max(200).optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  active: z.boolean().optional(),
  everyMonths: everyMonthsSchema.optional(),
  endMonth: monthSchema.nullable().optional(),
});

export const recurringAddSchema = z.object({
  month: monthSchema,
  ids: z.array(objectIdSchema).min(1, 'Pick at least one entry').max(100),
});

export const recurringSkipSchema = z.object({ month: monthSchema });

// ── budget ──
/** Budget limits and income are minor units; zero is allowed (a head with no money yet). */
const budgetAmountSchema = z.number().int('Amount must be in minor units').min(0).max(1_000_000_000_00, 'Amount is too large');

export const budgetSaveSchema = z
  .object({
    income: budgetAmountSchema,
    lines: z
      .array(z.object({ categoryId: objectIdSchema, planned: budgetAmountSchema }))
      .max(100, 'Too many categories in one budget'),
    /** Version the client started from; omit when creating the month's first plan. */
    version: z.number().int().nonnegative().optional(),
  })
  .refine((b) => new Set(b.lines.map((l) => l.categoryId)).size === b.lines.length, {
    message: 'Each category can appear only once in the budget',
    path: ['lines'],
  });

export const budgetCopySchema = z.object({ from: monthSchema });

/** How an expense category behaves as a budget head. Set by whoever plans the budget. */
export const categoryBudgetSchema = z.object({
  /** Older app versions: the kind; the category moves to the first section of that kind. */
  group: z.enum(HEAD_GROUPS).optional(),
  section: z.string().regex(SECTION_ID).optional(),
  /** Spending categories: carry what's left (or overspent) into the next month's budget. */
  rollover: z.boolean().optional(),
  memberId: objectIdSchema.nullable().optional(),
  goal: z
    .object({
      target: amountSchema,
      by: monthSchema.nullable().optional().default(null),
      start: budgetAmountSchema.optional().default(0),
    })
    .nullable()
    .optional(),
});

/** The budget's sections, in order. A new section brings its own id (any unused one). */
export const sectionsSaveSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string().regex(SECTION_ID, 'Invalid section id'),
        name: z.string().trim().min(1, 'Give the section a name').max(24, 'Keep section names to 24 characters'),
        kind: z.enum(HEAD_GROUPS),
      }),
    )
    .min(HEAD_GROUPS.length)
    .max(MAX_SECTIONS, `At most ${MAX_SECTIONS} sections`)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'Each section needs its own id')
    .refine((list) => new Set(list.map((s) => s.name.toLowerCase())).size === list.length, 'Two sections have the same name')
    .refine((list) => HEAD_GROUPS.every((k) => list.some((s) => s.kind === k)), 'Keep at least one bills, one spending and one savings section'),
});

/** The order the budget's sections are listed in: every group exactly once. */
export const groupOrderSchema = z.object({
  groups: z
    .array(z.enum(HEAD_GROUPS))
    .length(HEAD_GROUPS.length, 'List every section once')
    .refine((g) => new Set(g).size === g.length, 'List every section once'),
});

/**
 * What to export. `what`: budget (plan vs actual per head), transactions, or everything together.
 * `from`/`to` limit it to a range of months (both optional; neither means all time).
 * `category` limits it to one head or category.
 */
export const EXPORT_KINDS = ['budget', 'transactions', 'everything'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_FORMATS = ['csv', 'xlsx', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const exportMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const exportQuerySchema = z
  .object({
    what: z.enum(EXPORT_KINDS).optional(),
    format: z.enum(EXPORT_FORMATS).optional(),
    from: exportMonthSchema.optional(),
    to: exportMonthSchema.optional(),
    category: objectIdSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The start month must be before the end month', path: ['to'] });

const signedAmountSchema = z.number().int('Amount must be in minor units').min(-1_000_000_000_00).max(1_000_000_000_00);

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1, 'Give the account a name').max(40),
  kind: z.enum(ACCOUNT_KINDS),
  openingBalance: signedAmountSchema.default(0),
  openingDate: dateSchema,
});

export const accountUpdateSchema = accountCreateSchema.partial().extend({ archived: z.boolean().optional() });

export const transferCreateSchema = z
  .object({
    fromAccountId: objectIdSchema,
    toAccountId: objectIdSchema,
    amount: amountSchema,
    date: dateSchema,
    note: z.string().trim().max(200).optional().default(''),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, { message: 'Pick two different accounts', path: ['toAccountId'] });

/** One change applied to many entries at once. */
export const transactionBulkSchema = z
  .object({
    ids: z.array(objectIdSchema).min(1, 'Pick at least one entry').max(500, 'At most 500 at a time'),
    action: z.enum(['delete', 'restore', 'category', 'addTag', 'removeTag']),
    categoryId: objectIdSchema.optional(),
    tag: tagSchema.optional(),
  })
  .refine((b) => b.action !== 'category' || b.categoryId, { message: 'Pick a category', path: ['categoryId'] })
  .refine((b) => !['addTag', 'removeTag'].includes(b.action) || b.tag, { message: 'Enter a tag', path: ['tag'] });

/** Move every entry, repeating entry and budget amount of one category into another, then hide it. */
export const categoryMergeSchema = z.object({ into: objectIdSchema });

/** Search across months. All optional. Amounts in minor units; dates inclusive. */
export const transactionSearchSchema = z.object({
  q: z.string().max(100).optional(),
  category: objectIdSchema.optional(),
  type: z.enum(['income', 'expense']).optional(),
  createdBy: objectIdSchema.optional(),
  forMember: objectIdSchema.optional(),
  account: objectIdSchema.optional(),
  tag: z.string().max(24).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  min: z.coerce.number().int().min(0).optional(),
  max: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['newest', 'oldest', 'largest', 'smallest']).optional(),
  page: z.coerce.number().int().min(0).max(1000).optional(),
});

/** Bulk import from a spreadsheet; the client parses the file and sends rows in batches. */
export const transactionImportSchema = z.object({
  /** Client-generated id shared by every batch of one import, so the whole import can be undone. */
  importId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  skipDuplicates: z.boolean().default(true),
  rows: z
    .array(
      z.object({
        type: z.enum(['income', 'expense']),
        amount: amountSchema,
        date: dateSchema,
        categoryId: objectIdSchema,
        note: z.string().trim().max(200).optional().default(''),
        tags: tagsSchema.optional(),
      }),
    )
    .min(1, 'Nothing to import')
    .max(1000, 'Send at most 1000 rows at a time'),
});

/** A JSON backup made by Export → Everything → JSON. Lenient: older backups lack some fields. */
export const backupSchema = z.object({
  format: z.literal('ffos-book-export'),
  version: z.literal(1),
  book: z.object({
    name: z.string().trim().min(1).max(40),
    currency: currencySchema,
    groupOrder: z.array(z.string()).optional(),
    sections: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(HEAD_GROUPS) })).optional(),
  }),
  categories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(40),
        kind: z.enum(['income', 'expense']),
        icon: z.string().max(32).optional().default('tag'),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().default('#64748b'),
        archived: z.boolean().optional().default(false),
        group: z.enum(HEAD_GROUPS).optional(),
        section: z.string().optional(),
        parentId: z.string().nullable().optional(),
        goal: z
          .object({ target: z.number().int().positive(), by: z.string().nullable().optional(), start: z.number().int().min(0).optional() })
          .nullable()
          .optional(),
      }),
    )
    .max(500),
  budgets: z
    .array(
      z.object({
        month: monthSchema,
        income: z.number().int().min(0),
        lines: z.array(z.object({ categoryId: z.string(), planned: z.number().int().min(0) })),
      }),
    )
    .optional()
    .default([]),
  recurring: z
    .array(
      z.object({
        type: z.enum(['income', 'expense']),
        amount: amountSchema,
        categoryId: z.string(),
        note: z.string().max(200).optional().default(''),
        dayOfMonth: dayOfMonthSchema,
        startMonth: monthSchema,
        everyMonths: z.number().int().min(1).max(12).optional(),
        endMonth: monthSchema.nullable().optional(),
        active: z.boolean().optional().default(true),
      }),
    )
    .optional()
    .default([]),
  transactions: z
    .array(
      z.object({
        date: dateSchema,
        type: z.enum(['income', 'expense']),
        amountMinor: amountSchema,
        categoryId: z.string(),
        note: z.string().max(200).optional().default(''),
        tags: z.array(z.string().max(24)).max(8).optional(),
        accountId: z.string().nullable().optional(),
      }),
    )
    .max(200_000),
  accounts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(40),
        kind: z.enum(ACCOUNT_KINDS),
        openingBalance: z.number().int(),
        openingDate: dateSchema,
        archived: z.boolean().optional().default(false),
      }),
    )
    .max(30)
    .optional()
    .default([]),
  transfers: z
    .array(z.object({ fromAccountId: z.string(), toAccountId: z.string(), amount: amountSchema, date: dateSchema, note: z.string().max(200).optional().default('') }))
    .max(50_000)
    .optional()
    .default([]),
});
export type BackupInput = z.input<typeof backupSchema>;

/** Mark a monthly bill paid for `month`, now rather than waiting for its day. */
export const recurringPaySchema = z.object({ month: monthSchema });

export type SetupInput = z.input<typeof setupSchema>;
export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type BookCreateInput = z.input<typeof bookCreateSchema>;
export type InviteCreateInput = z.input<typeof inviteCreateSchema>;
export type TransactionCreateInput = z.input<typeof transactionCreateSchema>;
export type TransactionUpdateInput = z.input<typeof transactionUpdateSchema>;
export type BudgetSaveInput = z.input<typeof budgetSaveSchema>;
export type CategoryBudgetInput = z.input<typeof categoryBudgetSchema>;
export type RecurringCreateInput = z.input<typeof recurringCreateSchema>;
export type RecurringUpdateInput = z.input<typeof recurringUpdateSchema>;
