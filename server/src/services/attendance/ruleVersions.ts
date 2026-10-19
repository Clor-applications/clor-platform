import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * Every saved change to how days are scored: the company rules (Attendance
 * rules) and each shift's timings, grace and thresholds. Kept so a question
 * like "why did March count late from 5 minutes and April from 10" has an
 * answer. A failure to record never blocks the save.
 */
export async function recordRuleVersion(accountId: string, orgId: string, userId: string, entry: { kind: 'RULES' | 'SHIFT'; ref?: string | null; name?: string | null; before: unknown; after: unknown }) {
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const last = await peoplePrisma.attendanceRuleVersion.findFirst({ where: { orgId }, orderBy: { version: 'desc' }, select: { version: true } });
      try {
        return await peoplePrisma.attendanceRuleVersion.create({
          data: { accountId, orgId, version: (last?.version || 0) + 1, rulesJson: JSON.stringify(entry), changedByUserId: userId },
        });
      } catch (e: any) {
        if (String(e?.code) !== 'P2002') throw e; /* two saves at once: take the next number */
      }
    }
  } catch (e) {
    console.error('[rule-versions]', e instanceof Error ? e.message : e);
  }
  return null;
}
