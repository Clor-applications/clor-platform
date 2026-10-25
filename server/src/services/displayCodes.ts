import { randomInt } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Display codes: what people see, quote to support and find in the address.
 *
 *   Company  4831920657   ten digits, random, the last a check digit
 *   Account  4831920657   the code of the account's first company
 *   User     7305518264   ten digits, random, its own — not tied to a company
 *
 * The way Zoho does it: a number that says nothing about whom it names. The
 * first scheme (LD-09: KAVE-C100, KAVE-C100-U01) took letters from the
 * company's name and counted up, so every shared link and screenshot carried
 * part of a customer's name, the numbers told anyone how many companies had
 * those letters, a renamed company kept its old letters for ever, and a
 * person's ID belonged to whichever company they happened to join first.
 *
 * Old codes are kept in `legacyCode` and still find their company, so no link
 * or bookmark anybody saved stops working (the shell swaps the address for the
 * new code). Internal ids stay cuids and remain the only keys anything joins on.
 *
 * Codes are assigned once and never change or get reused. The check digit
 * (Luhn, the card-number one) catches a mistyped or transposed digit before a
 * lookup does.
 */

const DIGITS = 10;

/** The Luhn check digit for a string of digits. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** True for a ten-digit code whose last digit checks. */
export function isDisplayCode(code: unknown): boolean {
  const s = String(code ?? '');
  return /^[1-9][0-9]{9}$/.test(s) && checkDigit(s.slice(0, -1)) === Number(s.slice(-1));
}

/** A fresh random code: nine random digits (never a leading 0) and a check digit. */
export function newDisplayCode(): string {
  let body = String(randomInt(1, 10));
  while (body.length < DIGITS - 1) body += String(randomInt(0, 10));
  return body + String(checkDigit(body));
}

const isUniqueClash = (e: any) => String(e?.code) === 'P2002';

/** A company code nobody has ever had — not a live company, an account, nor a deleted company's record. */
async function unusedCompanyCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = newDisplayCode();
    const taken = await outsideTenant('display codes: is this company code free', async () => {
      const [org, account, closed] = await Promise.all([
        platformPrisma.org.count({ where: { OR: [{ code }, { legacyCode: code }] } }),
        platformPrisma.account.count({ where: { OR: [{ code }, { legacyCode: code }] } }),
        platformPrisma.orgClosure.count({ where: { orgCode: code } }),
      ]);
      return org + account + closed > 0;
    });
    if (!taken) return code;
  }
  throw new Error('Could not find a free company code');
}

/**
 * Gives a company its code and, if the account has none yet, makes it the
 * account's code. Safe to call twice. A unique-index clash means another
 * company took that number between the check and the write: try another.
 */
export async function assignOrgCode(accountId: string, orgId: string, _companyName?: string): Promise<string> {
  const current = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true } });
  let code = current?.code || '';
  for (let attempt = 0; attempt < 10 && !code; attempt++) {
    const next = await unusedCompanyCode();
    try {
      const r = await platformPrisma.org.updateMany({ where: { id: orgId, code: null }, data: { code: next } });
      if (r.count) code = next;
      else code = (await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true } }))?.code || '';
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
    }
  }
  if (!code) throw new Error('Could not assign a company code');
  await platformPrisma.account.updateMany({ where: { id: accountId, code: null }, data: { code } });
  return code;
}

/**
 * Gives a person their user ID, unless they already have one (then it is
 * kept: one ID per person, in every company they work in). `_orgId` is the
 * company they were added to; the ID no longer depends on it.
 */
export async function assignUserCode(userId: string, _orgId?: string): Promise<string> {
  const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { code: true } });
  if (user?.code) return user.code;
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = newDisplayCode();
    const taken = await platformPrisma.user.count({ where: { OR: [{ code }, { legacyCode: code }] } });
    if (taken) continue;
    try {
      const r = await platformPrisma.user.updateMany({ where: { id: userId, code: null }, data: { code } });
      if (r.count) return code;
      const now = await platformPrisma.user.findUnique({ where: { id: userId }, select: { code: true } });
      if (now?.code) return now.code;
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
    }
  }
  throw new Error('Could not assign a user code');
}

/**
 * The company a code names: its current code, or the code it had before
 * (KAVE-C100), so links saved before the change still open.
 */
export async function orgByCode<T extends object>(raw: unknown, select: T) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!code) return null;
  return platformPrisma.org.findFirst({ where: { OR: [{ code }, { legacyCode: code }] }, select: select as any });
}
