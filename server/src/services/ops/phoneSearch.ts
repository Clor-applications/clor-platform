import { platformPrisma } from '../../utils/platformPrisma.js';

/**
 * Accounts with a phone number ending in these digits, on a person or a
 * branch. Numbers are kept as typed ("+91 98450 12345"), so both sides are
 * compared as digits only. The last ten digits are used, so "+91" or a
 * leading 0 on either side does not matter. Callers run inside outsideTenant.
 */
export async function accountsByPhone(q: string, limit = 50): Promise<string[]> {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 6) return [];
  const pattern = `%${digits.slice(-10)}%`;
  const rows = await platformPrisma.$queryRaw<{ accountId: string }[]>`
    SELECT DISTINCT "accountId" FROM (
      SELECT "accountId" FROM "User" WHERE phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE ${pattern}
      UNION
      SELECT "accountId" FROM "Branch" WHERE phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE ${pattern}
    ) t LIMIT ${limit}`;
  return rows.map((r) => r.accountId);
}
