import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { routeBankUpdate } from './bankChanges.js';

/**
 * Payroll's write interface for what a joiner sends (docs/people/03 contract
 * PI-02, the write twin of statutoryRead.ts). People calls this once HR has
 * checked a joiner's PAN, UAN, ESIC, bank and PF nominees; it never touches
 * the payroll client itself (AGENT_RULES rule 1).
 *
 * What it does, all of it Payroll's own rules:
 * - PAN, UAN and ESIC go on the payroll profile (made if the person has none).
 * - Bank details go through routeBankUpdate: the first account on file
 *   applies at once; a different account than the one on file opens a
 *   BankDetailChange that waits for Payroll's approval, as any other change.
 * - The PF nominees replace those on file.
 * - One audit line, with masked values only.
 */

export const NOMINEE_RELATIONS = ['SPOUSE', 'SON', 'DAUGHTER', 'FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'OTHER'] as const;

export type JoiningNominee = { name: string; relation: string; sharePercent: number; dateOfBirth?: string | null };
export type JoiningStatutory = {
  pan?: string | null;
  uan?: string | null;
  esicNumber?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  nominees?: JoiningNominee[];
};

const tail = (v: string | null | undefined, keep = 4) => {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.length <= keep ? '*'.repeat(s.length) : `${'*'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
};

export async function applyJoiningStatutory(opts: { accountId: string; orgId: string; branchId?: string | null; employeeId: string; userId: string; correlationId?: string | null; values: JoiningStatutory }) {
  const { accountId, orgId, employeeId, userId, values } = opts;
  let profile = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId } });
  const ids: Record<string, string> = {};
  if (values.pan) ids.pan = values.pan;
  if (values.uan) ids.uan = values.uan;
  if (values.esicNumber) ids.esiNumber = values.esicNumber;
  profile = profile
    ? await payrollPrisma.employeePayrollProfile.update({ where: { id: profile.id }, data: ids })
    : await payrollPrisma.employeePayrollProfile.create({ data: { accountId, orgId, employeeId, createdByUserId: userId, ...ids } });

  let bank: 'APPLIED' | 'PENDING' | 'NONE' = 'NONE';
  if (values.bankAccountNumber || values.bankIfsc) {
    const incoming = { bankAccountName: values.bankAccountName ?? null, bankAccountNumber: values.bankAccountNumber ?? null, bankIfsc: values.bankIfsc ?? null, bankName: values.bankName ?? null };
    const routed = await routeBankUpdate({ accountId, orgId, employeeId, userId, current: profile, incoming });
    if (routed.pending) bank = 'PENDING';
    else if (Object.keys(routed.apply).length) {
      await payrollPrisma.employeePayrollProfile.update({ where: { id: profile.id }, data: routed.apply });
      bank = 'APPLIED';
    }
  }

  let nominees = 0;
  if (values.nominees?.length) {
    await payrollPrisma.$transaction(async (tx) => {
      await tx.pfNominee.deleteMany({ where: { orgId, employeeId } });
      for (const n of values.nominees!) {
        await tx.pfNominee.create({ data: { accountId, orgId, employeeId, name: n.name, relation: n.relation, sharePercent: n.sharePercent, dateOfBirth: n.dateOfBirth || null, source: 'JOINING', createdByUserId: userId } });
      }
    });
    nominees = values.nominees.length;
  }

  await platformPrisma.auditLog.create({
    data: {
      accountId, orgId, branchId: opts.branchId || '', entity: 'EmployeePayrollProfile', entityId: profile.id, action: 'JOINING_STATUTORY',
      message: `Joining details checked in People went to Payroll: ${[ids.pan && 'PAN', ids.uan && 'UAN', ids.esiNumber && 'ESIC', bank !== 'NONE' && `bank (${bank === 'PENDING' ? 'waits for approval' : 'first on file'})`, nominees && `${nominees} PF nominee${nominees === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'nothing new'}`,
      metadata: JSON.stringify({ employeeId, pan: tail(ids.pan), uan: tail(ids.uan), esic: tail(ids.esiNumber), account: tail(values.bankAccountNumber), bank, nominees }),
      createdByUserId: userId, correlationId: opts.correlationId ? String(opts.correlationId).slice(0, 80) : null,
    },
  });
  return { profileId: profile.id, bank, nominees };
}

/** The PF nominees on file, for People's record (names and shares; nothing secret). */
export async function nomineesOf(orgId: string, employeeId: string) {
  const rows = await payrollPrisma.pfNominee.findMany({ where: { orgId, employeeId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ name: r.name, relation: r.relation, sharePercent: Number(r.sharePercent), dateOfBirth: r.dateOfBirth }));
}
