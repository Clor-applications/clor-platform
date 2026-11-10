import { peoplePrisma } from '../../../utils/peoplePrisma.js';

/**
 * Notice owed, served and short (W15), from the employment type's notice days
 * and the day the resignation came. Written on the separation event when
 * someone leaves (leaving.ts) and read by Payroll's final settlement
 * (finalSettlement.ts), which recovers the shortfall unless HR waived it.
 *
 * Days are calendar days, the resignation day and the last day both counted.
 */
export type Notice = { noticeDays: number | null; resignedOn: string | null; servedDays: number | null; shortfallDays: number | null; noticeWaived: boolean };

export async function noticeFor(orgId: string, p: { employeeTypeId?: string | null; lastDay: string; resignedOn?: string | null; noticeWaived?: boolean | null }): Promise<Notice> {
  const owed = p.employeeTypeId ? (await peoplePrisma.employeeType.findFirst({ where: { id: p.employeeTypeId, orgId }, select: { noticeDays: true } }))?.noticeDays ?? null : null;
  const from = p.resignedOn || null;
  const served = from ? Math.max(0, Math.round((Date.parse(`${p.lastDay}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1) : null;
  const short = owed != null && served != null && !p.noticeWaived ? Math.max(0, owed - served) : null;
  return { noticeDays: owed, resignedOn: from, servedDays: served, shortfallDays: short, noticeWaived: Boolean(p.noticeWaived) };
}
