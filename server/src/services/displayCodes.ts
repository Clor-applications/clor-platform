import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Display codes (LD-09): what people see, quote to support and type.
 *
 *   Company  INNO-C100       3–4 letters from the name, C, number. 100 unless
 *                            the letters are already taken (Innovate -> INNO-C101).
 *   Account  INNO-C100       the code of the account's first company
 *   User     INNO-C100-U01   home company code + U + number within that company
 *
 * The C keeps a code from ever reading like a document number (INV-2627-00001,
 * EXP-…, PO-…). Internal ids stay cuids and remain the only keys anything joins
 * on. Codes are assigned once and never change or get reused: renaming a
 * company does not rename it, and a user who leaves keeps their number.
 *
 * One user ID per person. Someone invited into another company (an accountant,
 * a CA working for many clients) keeps the ID from their home company, so one
 * login and one ID follow them everywhere.
 */

const FIRST_COMPANY_NUMBER = 100;
const FIRST_USER_NUMBER = 1;

/**
 * 3–4 letters from the company name, upper case: the first word's first four
 * letters ("Indus Solutions" -> INDU, "Clor Pvt Ltd" -> CLOR). A first word
 * with fewer than 3 letters takes letters from the whole name ("A1 Traders" ->
 * ATRA). Fewer than 3 letters in total -> CLOR. Mirrors the migration's SQL.
 */
export function codePrefix(name: string | null | undefined): string {
  const raw = String(name || '').trim();
  const first = (raw.split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
  if (first.length >= 3) return first;
  const all = raw.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
  return all.length >= 3 ? all : 'CLOR';
}

const isUniqueClash = (e: any) => String(e?.code) === 'P2002';

/**
 * Gives a company its code (next number for its letters, from 100) and, if the
 * account has none yet, makes it the account's code. Safe to call twice.
 * A unique-index clash means another company took that number first: try the next.
 */
export async function assignOrgCode(accountId: string, orgId: string, companyName: string): Promise<string> {
  const current = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true } });
  let code = current?.code || '';
  if (!code) {
    const prefix = codePrefix(companyName);
    for (let attempt = 0; attempt < 10 && !code; attempt++) {
      const top = await platformPrisma.org.aggregate({ where: { code: { startsWith: `${prefix}-C` } }, _max: { codeNumber: true } });
      const n = Math.max(FIRST_COMPANY_NUMBER, (top._max.codeNumber || 0) + 1);
      try {
        const r = await platformPrisma.org.updateMany({ where: { id: orgId, code: null }, data: { code: `${prefix}-C${n}`, codeNumber: n } });
        if (r.count) code = `${prefix}-C${n}`;
        else code = (await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true } }))?.code || '';
      } catch (e) {
        if (!isUniqueClash(e)) throw e;
      }
    }
    if (!code) throw new Error('Could not assign a company code');
  }
  await platformPrisma.account.updateMany({ where: { id: accountId, code: null }, data: { code } });
  return code;
}

/**
 * Gives a person their user ID in their home company, unless they already have
 * one (then it is kept: one ID per person, wherever they work).
 */
export async function assignUserCode(userId: string, orgId: string): Promise<string> {
  const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { code: true } });
  if (user?.code) return user.code;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true, name: true, accountId: true } });
  if (!org) throw new Error('Company not found for user code');
  const orgCode = org.code || (await assignOrgCode(org.accountId, orgId, org.name));
  for (let attempt = 0; attempt < 10; attempt++) {
    const top = await platformPrisma.user.aggregate({ where: { code: { startsWith: `${orgCode}-U` } }, _max: { codeNumber: true } });
    const n = Math.max(FIRST_USER_NUMBER, (top._max.codeNumber || 0) + 1);
    const code = `${orgCode}-U${String(n).padStart(2, '0')}`;
    try {
      const r = await platformPrisma.user.updateMany({ where: { id: userId, code: null }, data: { code, codeNumber: n } });
      if (r.count) return code;
      const now = await platformPrisma.user.findUnique({ where: { id: userId }, select: { code: true } });
      if (now?.code) return now.code;
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
    }
  }
  throw new Error('Could not assign a user code');
}
