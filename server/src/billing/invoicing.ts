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
 *     books: { enabled, accountId, orgId, branchId, autoSend } }
 *
 * The series runs per financial year (April to March), as Indian invoices
 * do: CLOR/26-27/0001. The counter moves only when an invoice is issued, so a
 * discarded draft leaves no gap.
 */
export const INVOICING_KEY = 'billing.invoicing';

export type BooksLink = { enabled: boolean; accountId: string | null; orgId: string | null; branchId: string | null; autoSend: boolean };
/** Renewal invoices (billing/renewals.ts): drafted and issued this many days before a paid period ends. */
export type Renewals = { on: boolean; daysBefore: number };
export type Invoicing = { prefix: string; dueDays: number; footer: string | null; address: string | null; counters: Record<string, number>; books: BooksLink; renewals: Renewals };

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

export type InvoicingInput = { prefix?: string; dueDays?: number; footer?: string | null; address?: string | null; nextNumber?: number | null; renewalsOn?: boolean; renewalDaysBefore?: number };

/** Save the numbering and wording. `nextNumber` sets where this year's series carries on (never backwards past an issued one). */
export async function saveInvoicing(input: InvoicingInput, userId: string) {
  const problems: string[] = [];
  const prefix = input.prefix == null ? undefined : String(input.prefix).trim().toUpperCase();
  if (prefix !== undefined && !/^[A-Z0-9]{1,6}$/.test(prefix)) problems.push('The prefix is 1 to 6 capital letters or digits, like CLOR.');
  if (input.dueDays != null && !(Number.isInteger(input.dueDays) && input.dueDays >= 0 && input.dueDays <= 90)) problems.push('Payment is due within 0 to 90 days.');
  if (input.nextNumber != null && !(Number.isInteger(input.nextNumber) && input.nextNumber >= 1 && input.nextNumber <= 99999)) problems.push('The next number is a whole number from 1.');
  if (input.renewalDaysBefore != null && !(Number.isInteger(input.renewalDaysBefore) && input.renewalDaysBefore >= 0 && input.renewalDaysBefore <= 30)) problems.push('Renewal invoices go out 0 to 30 days before the period ends.');
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
