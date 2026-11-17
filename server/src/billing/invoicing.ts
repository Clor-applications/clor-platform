import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { PaymentsError } from './providers.js';

/**
 * How CLOR numbers and words its own invoices, and the CLOR Books connector:
 * the platform setting `billing.invoicing`, set in the operator console
 * (Money, Invoice settings). Nothing here is fixed in code.
 *
 *   { prefix, dueDays, footer, counters: { "26-27": 12 },
 *     address,
 *     books: { enabled, accountId, orgId, branchId, autoSend },
 *     renewals: { on, daysBefore },
 *     reminders: { on, daysBefore: [3], onDueDate, daysAfter: [7], cap, since } }
 *
 * The series runs per financial year (April to March), as Indian invoices
 * do: CLOR/26-27/0001. The counter moves only when an invoice is issued, so a
 * discarded draft leaves no gap.
 */
export const INVOICING_KEY = 'billing.invoicing';

export type BooksLink = { enabled: boolean; accountId: string | null; orgId: string | null; branchId: string | null; autoSend: boolean };
/** Renewal invoices (billing/renewals.ts): drafted and issued this many days before a paid period ends. */
export type Renewals = { on: boolean; daysBefore: number };
/**
 * Automatic reminders to pay an issued invoice (billing/invoiceReminders.ts):
 * so many days before the due date, on it, and so many days after, never more
 * than `cap` reminders for one invoice. OFF until a person switches it on.
 * `since` is the moment it was first switched on and is never moved: an
 * invoice issued before it is never reminded automatically.
 */
export type Reminders = { on: boolean; daysBefore: number[]; onDueDate: boolean; daysAfter: number[]; cap: number; since: string | null };
export type Invoicing = { prefix: string; dueDays: number; footer: string | null; address: string | null; counters: Record<string, number>; books: BooksLink; renewals: Renewals; reminders: Reminders };

export const REMINDER_LIMITS = { before: { max: 30, entries: 3 }, after: { max: 60, entries: 4 }, cap: { min: 1, max: 6 } } as const;
/** A list of days as saved: whole numbers from 1 to `max`, each once, at most `entries` of them. */
const daysOk = (v: unknown, max: number, entries: number): v is number[] =>
  Array.isArray(v) && v.length <= entries && v.every((n) => Number.isInteger(n) && n >= 1 && n <= max) && new Set(v).size === v.length;
const isoOrNull = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Anything not exactly right reads as the default, and anything but `on: true` reads as off. */
export function readReminders(value: unknown): Reminders {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const L = REMINDER_LIMITS;
  return {
    on: r.on === true,
    daysBefore: daysOk(r.daysBefore, L.before.max, L.before.entries) ? [...r.daysBefore].sort((a, b) => b - a) : [3],
    onDueDate: r.onDueDate !== false,
    daysAfter: daysOk(r.daysAfter, L.after.max, L.after.entries) ? [...r.daysAfter].sort((a, b) => a - b) : [7],
    cap: Number.isInteger(r.cap) && (r.cap as number) >= L.cap.min && (r.cap as number) <= L.cap.max ? (r.cap as number) : 3,
    since: isoOrNull(r.since),
  };
}

const str = (v: unknown, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function readInvoicing(value: unknown): Invoicing {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, any>;
  const b = (v.books && typeof v.books === 'object' ? v.books : {}) as Record<string, unknown>;
  const counters: Record<string, number> = {};
  for (const [k, n] of Object.entries(v.counters && typeof v.counters === 'object' ? v.counters : {})) if (/^\d{2}-\d{2}$/.test(k) && Number.isInteger(n) && (n as number) >= 0) counters[k] = n as number;
  return {
    prefix: /^[A-Z0-9]{1,6}$/.test(String(v.prefix || '')) ? String(v.prefix) : 'CLOR',
    dueDays: Number.isInteger(v.dueDays) && v.dueDays >= 0 && v.dueDays <= 90 ? v.dueDays : 15,
    footer: str(v.footer, 600),
    address: str(v.address, 400),
    counters,
    books: { enabled: b.enabled === true, accountId: str(b.accountId, 40), orgId: str(b.orgId, 40), branchId: str(b.branchId, 40), autoSend: b.autoSend === true },
    renewals: {
      on: v.renewals?.on !== false,
      daysBefore: Number.isInteger(v.renewals?.daysBefore) && v.renewals.daysBefore >= 0 && v.renewals.daysBefore <= 30 ? v.renewals.daysBefore : 7,
    },
    reminders: readReminders(v.reminders),
  };
}

export async function invoicing(): Promise<Invoicing> {
  const row = await outsideTenant('billing: invoice settings', () => platformPrisma.platformSetting.findUnique({ where: { key: INVOICING_KEY } }));
  return readInvoicing(row?.value);
}

/** The Indian financial year a date falls in, as "26-27". */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const formatNumber = (prefix: string, fy: string, n: number) => `${prefix}/${fy}/${String(n).padStart(4, '0')}`;

export type InvoicingInput = { prefix?: string; dueDays?: number; footer?: string | null; address?: string | null; nextNumber?: number | null; renewalsOn?: boolean; renewalDaysBefore?: number; remindersOn?: boolean; reminderDaysBefore?: number[]; reminderOnDueDate?: boolean; reminderDaysAfter?: number[]; reminderCap?: number };

/** Save the numbering and wording. `nextNumber` sets where this year's series carries on (never backwards past an issued one). */
export async function saveInvoicing(input: InvoicingInput, userId: string) {
  const problems: string[] = [];
  const prefix = input.prefix == null ? undefined : String(input.prefix).trim().toUpperCase();
  if (prefix !== undefined && !/^[A-Z0-9]{1,6}$/.test(prefix)) problems.push('The prefix is 1 to 6 capital letters or digits, like CLOR.');
  if (input.dueDays != null && !(Number.isInteger(input.dueDays) && input.dueDays >= 0 && input.dueDays <= 90)) problems.push('Payment is due within 0 to 90 days.');
  if (input.nextNumber != null && !(Number.isInteger(input.nextNumber) && input.nextNumber >= 1 && input.nextNumber <= 99999)) problems.push('The next number is a whole number from 1.');
  if (input.renewalDaysBefore != null && !(Number.isInteger(input.renewalDaysBefore) && input.renewalDaysBefore >= 0 && input.renewalDaysBefore <= 30)) problems.push('Renewal invoices go out 0 to 30 days before the period ends.');
  const L = REMINDER_LIMITS;
  if (input.remindersOn != null && typeof input.remindersOn !== 'boolean') problems.push('Say whether reminders are on: yes or no.');
  if (input.reminderOnDueDate != null && typeof input.reminderOnDueDate !== 'boolean') problems.push('Say whether to remind on the due date: yes or no.');
  if (input.reminderDaysBefore != null && !daysOk(input.reminderDaysBefore, L.before.max, L.before.entries))
    problems.push(`Reminders before the due date: at most ${L.before.entries}, each a whole number of days from 1 to ${L.before.max}, no day twice.`);
  if (input.reminderDaysAfter != null && !daysOk(input.reminderDaysAfter, L.after.max, L.after.entries))
    problems.push(`Reminders after the due date: at most ${L.after.entries}, each a whole number of days from 1 to ${L.after.max}, no day twice.`);
  if (input.reminderCap != null && !(Number.isInteger(input.reminderCap) && input.reminderCap >= L.cap.min && input.reminderCap <= L.cap.max))
    problems.push(`One invoice gets at most ${L.cap.min} to ${L.cap.max} reminders.`);
  if (problems.length) throw new PaymentsError('Check the invoice settings.', 400, problems);
  return outsideTenant('billing: save invoice settings', () =>
    platformPrisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({ where: { key: INVOICING_KEY }, create: { key: INVOICING_KEY, value: {}, updatedByUserId: userId }, update: {} });
      await tx.$queryRaw`SELECT key FROM "PlatformSetting" WHERE key = ${INVOICING_KEY} FOR UPDATE`;
      const row = await tx.platformSetting.findUnique({ where: { key: INVOICING_KEY } });
      const cur = readInvoicing(row?.value);
      const fy = financialYear(new Date());
      const next: Invoicing = { ...cur, counters: { ...cur.counters } };
      if (prefix !== undefined) next.prefix = prefix;
      if (input.dueDays != null) next.dueDays = input.dueDays;
      if (input.footer !== undefined) next.footer = str(input.footer, 600);
      if (input.address !== undefined) next.address = str(input.address, 400);
      if (input.renewalsOn !== undefined || input.renewalDaysBefore != null) next.renewals = { on: input.renewalsOn ?? cur.renewals.on, daysBefore: input.renewalDaysBefore ?? cur.renewals.daysBefore };
      if (input.remindersOn != null || input.reminderDaysBefore != null || input.reminderOnDueDate != null || input.reminderDaysAfter != null || input.reminderCap != null) {
        const on = input.remindersOn ?? cur.reminders.on;
        next.reminders = {
          on,
          daysBefore: input.reminderDaysBefore != null ? [...input.reminderDaysBefore].sort((a, b) => b - a) : cur.reminders.daysBefore,
          onDueDate: input.reminderOnDueDate ?? cur.reminders.onDueDate,
          daysAfter: input.reminderDaysAfter != null ? [...input.reminderDaysAfter].sort((a, b) => a - b) : cur.reminders.daysAfter,
          cap: input.reminderCap ?? cur.reminders.cap,
          /* Stamped the first time it is switched on, and never moved: switching off and on again does not reach back. */
          since: cur.reminders.since ?? (on ? new Date().toISOString() : null),
        };
      }
      if (input.nextNumber != null) {
        const used = cur.counters[fy] || 0;
        if (input.nextNumber <= used) throw new PaymentsError(`This year’s series already reached ${formatNumber(prefix ?? cur.prefix, fy, used)}. The next number must be after it.`, 400);
        next.counters[fy] = input.nextNumber - 1;
      }
      await tx.platformSetting.update({ where: { key: INVOICING_KEY }, data: { value: next as any, updatedByUserId: userId } });
      return next;
    }),
  );
}

/** Save the CLOR Books connector's settings. */
export async function saveBooksLink(input: Partial<BooksLink>, userId: string) {
  return outsideTenant('billing: save the CLOR Books connector', () =>
    platformPrisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({ where: { key: INVOICING_KEY }, create: { key: INVOICING_KEY, value: {}, updatedByUserId: userId }, update: {} });
      await tx.$queryRaw`SELECT key FROM "PlatformSetting" WHERE key = ${INVOICING_KEY} FOR UPDATE`;
      const row = await tx.platformSetting.findUnique({ where: { key: INVOICING_KEY } });
      const cur = readInvoicing(row?.value);
      const books: BooksLink = {
        enabled: input.enabled ?? cur.books.enabled,
        accountId: input.accountId !== undefined ? str(input.accountId, 40) : cur.books.accountId,
        orgId: input.orgId !== undefined ? str(input.orgId, 40) : cur.books.orgId,
        branchId: input.branchId !== undefined ? str(input.branchId, 40) : cur.books.branchId,
        autoSend: input.autoSend ?? cur.books.autoSend,
      };
      if (books.enabled && !(books.accountId && books.orgId && books.branchId)) throw new PaymentsError('Choose CLOR’s Books company and branch before switching the connector on.', 400);
      const next = { ...cur, books };
      await tx.platformSetting.update({ where: { key: INVOICING_KEY }, data: { value: next as any, updatedByUserId: userId } });
      return next;
    }),
  );
}
