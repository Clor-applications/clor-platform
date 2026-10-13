import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { round2 } from '../utils/money.js';

/**
 * Foreign currency — requirement 8.
 *
 * The governing rule: **the general ledger is kept in one currency**, the org's
 * base currency. A document may be raised in any currency, but what reaches the
 * books is that document translated at a stored rate. Posting mixed currencies
 * into one ledger would make the trial balance a sum of unlike things — it
 * would still foot to zero and still be meaningless.
 *
 * Two consequences worth stating, because they are what makes this correct
 * rather than merely present:
 *
 *  - Rates are dated and looked up as of the document date, never "latest".
 *    Restating a closed period at today's rate changes reported results after
 *    the fact.
 *  - Settling a foreign receivable at a different rate produces a real gain or
 *    loss. It is posted to its own account rather than quietly adjusting
 *    revenue, which would misstate both.
 */

export class FxError extends Error {
  status = 400;
}

export const isBase = (currency: string, baseCurrency: string) =>
  String(currency || '').toUpperCase() === String(baseCurrency || '').toUpperCase();

/** Rounds to 2dp through integer minor units, the same way the ledger does. */
/* Re-exported, not redefined: currency conversion rounds the same way the
   ledger does, or a converted invoice and its entry disagree. */
export { round2 };

export async function baseCurrencyFor(accountId: string, orgId: string) {
  const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { baseCurrency: true } });
  return String(org?.baseCurrency || 'INR').toUpperCase();
}

/**
 * The rate in force for `currency` on `date`.
 *
 * Uses the most recent rate on or before the date rather than requiring an
 * exact match: nobody publishes a rate for every calendar day, and a weekend
 * invoice is normally carried at Friday's rate. A date earlier than any stored
 * rate is an error rather than a guess.
 */
export async function rateFor(opts: {
  accountId: string;
  orgId: string;
  currency: string;
  date: string;
  baseCurrency?: string;
}): Promise<number> {
  const base = opts.baseCurrency || (await baseCurrencyFor(opts.accountId, opts.orgId));
  const code = String(opts.currency || base).toUpperCase();
  if (isBase(code, base)) return 1;

  const known = await prisma.currency.findFirst({
    where: { orgId: opts.orgId, code, isActive: true },
    select: { id: true },
  });
  if (!known) throw new FxError(`${code} is not set up as a currency for this company`);

  const row = await prisma.exchangeRate.findFirst({
    where: { orgId: opts.orgId, code, date: { lte: String(opts.date).slice(0, 10) } },
    orderBy: { date: 'desc' },
    select: { rate: true, date: true },
  });
  if (!row) throw new FxError(`No exchange rate for ${code} on or before ${String(opts.date).slice(0, 10)}`);

  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new FxError(`Stored rate for ${code} is not usable`);
  return rate;
}

/** Document amount translated into the books. */
export const toBase = (amount: number, rate: number) => round2((Number(amount) || 0) * (Number(rate) || 0));

/**
 * The gain or loss from settling a foreign balance at a different rate.
 *
 * Positive means the base-currency value received exceeded what was booked —
 * a gain for a receivable.
 */
export const settlementDifference = (opts: {
  amount: number;
  bookedRate: number;
  settledRate: number;
}) => round2(toBase(opts.amount, opts.settledRate) - toBase(opts.amount, opts.bookedRate));

export const decimal = (n: number) => new Prisma.Decimal(round2(n).toFixed(2));
