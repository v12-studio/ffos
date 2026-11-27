import { z } from 'zod';
import { HEAD_GROUPS } from './categories.ts';
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
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

// ── books & sharing ──
export const bookCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  currency: currencySchema.default('INR'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

export const bookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  currency: currencySchema.optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
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
});

/** New display order for one kind of category: every live id of that kind, in order. */
export const categoryOrderSchema = z.object({
  kind: z.enum(['income', 'expense']),
  ids: z.array(objectIdSchema).max(200),
});

const transactionFields = {
  type: z.enum(['income', 'expense']),
  amount: amountSchema,
  date: dateSchema,
  categoryId: objectIdSchema,
  note: z.string().trim().max(200).optional().default(''),
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

export const recurringCreateSchema = z.object({
  type: transactionFields.type,
  amount: transactionFields.amount,
  categoryId: transactionFields.categoryId,
  note: transactionFields.note,
  dayOfMonth: dayOfMonthSchema,
  /** First month it's due (YYYY-MM). */
  startMonth: monthSchema,
});

export const recurringUpdateSchema = z.object({
  type: transactionFields.type.optional(),
  amount: amountSchema.optional(),
  categoryId: objectIdSchema.optional(),
  note: z.string().trim().max(200).optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  active: z.boolean().optional(),
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
      .max(100, 'Too many budget heads'),
    /** Version the client started from; omit when creating the month's first plan. */
    version: z.number().int().nonnegative().optional(),
  })
  .refine((b) => new Set(b.lines.map((l) => l.categoryId)).size === b.lines.length, {
    message: 'Each budget head can appear only once',
    path: ['lines'],
  });

export const budgetCopySchema = z.object({ from: monthSchema });

/** How an expense category behaves as a budget head. Set by whoever plans the budget. */
export const categoryBudgetSchema = z.object({
  group: z.enum(HEAD_GROUPS).optional(),
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
