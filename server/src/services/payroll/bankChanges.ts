import { notifyPermission } from '../notifications.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { sendTemplate } from '../mailer.js';

/**
 * Changes to where somebody is paid (BankDetailChange).
 *
 * The first details on file apply at once — that is onboarding. A change to
 * details already on file waits for approval by somebody other than the person
 * who entered it, or by that same person after a day (a one-person company
 * still gets a cooling-off period and the employee's e-mail). Until then pay
 * keeps going to the account on file.
 */

export const BANK_FIELDS = ['bankAccountName', 'bankAccountNumber', 'bankIfsc', 'bankName'] as const;
type BankField = (typeof BANK_FIELDS)[number];
export type BankDetails = Partial<Record<BankField, string | null>>;

/** A requester may approve their own change only after this long. */
export const SELF_APPROVAL_AFTER_MS = 24 * 3_600_000;

const norm = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};
const ending = (n: string | null | undefined) => (n ? String(n).replace(/\s+/g, '').slice(-4) : '');

export class BankChangeError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string
  ) {
    super(message);
  }
}

/**
 * Route an update to someone's bank details. Returns the fields to write now
 * (first details) and the pending change, if one was opened instead.
 */
export async function routeBankUpdate(opts: {
  accountId: string;
  orgId: string;
  employeeId: string;
  userId: string;
  current: BankDetails | null;
  incoming: BankDetails;
}) {
  const before = Object.fromEntries(BANK_FIELDS.map((k) => [k, norm(opts.current?.[k])])) as Record<BankField, string | null>;
  const after = Object.fromEntries(BANK_FIELDS.map((k) => [k, k in opts.incoming ? norm(opts.incoming[k]) : before[k]])) as Record<BankField, string | null>;
  const changed = BANK_FIELDS.some((k) => before[k] !== after[k]);
  if (!changed) return { apply: {} as BankDetails, pending: null };

  const row = {
    accountId: opts.accountId,
    orgId: opts.orgId,
    employeeId: opts.employeeId,
    oldAccountName: before.bankAccountName,
    oldAccountNumber: before.bankAccountNumber,
    oldIfsc: before.bankIfsc,
    oldBankName: before.bankName,
    newAccountName: after.bankAccountName,
    newAccountNumber: after.bankAccountNumber,
    newIfsc: after.bankIfsc,
    newBankName: after.bankName,
    requestedByUserId: opts.userId,
  };

  /* Nothing to divert yet: the first account on file is onboarding, recorded and applied. */
  if (!before.bankAccountNumber && !before.bankIfsc) {
    await payrollPrisma.bankDetailChange.create({ data: { ...row, status: 'APPROVED', decidedByUserId: opts.userId, decidedAt: new Date(), note: 'First bank details on file.' } });
    return { apply: after as BankDetails, pending: null };
  }

  /* One open change per person: a newer request replaces an older one. */
  await payrollPrisma.bankDetailChange.updateMany({
    where: { orgId: opts.orgId, employeeId: opts.employeeId, status: 'PENDING' },
    data: { status: 'CANCELLED', decidedByUserId: opts.userId, decidedAt: new Date(), note: 'Replaced by a newer change.' },
  });
  const pending = await payrollPrisma.bankDetailChange.create({ data: row });
  await tellEmployee(opts.accountId, opts.orgId, opts.employeeId, after.bankAccountNumber).catch(() => undefined);
  /* Whoever may approve pay runs sees it waiting, in whichever app they have open. */
  const who = await peoplePrisma.employee.findFirst({ where: { orgId: opts.orgId, id: opts.employeeId }, select: { name: true } });
  await notifyPermission(opts.accountId, opts.orgId, 'PAYROLL::Payroll Runs::APPROVE', { kind: 'payroll.bank_change', title: `Bank account change for ${who?.name || 'an employee'} waits for approval`, link: { app: 'payroll', screen: 'bankChanges' } }, { except: opts.userId });
  return { apply: {} as BankDetails, pending };
}

/** The person being paid hears about it on their own address, not the requester's. */
async function tellEmployee(accountId: string, orgId: string, employeeId: string, newNumber: string | null) {
  const person = await peoplePrisma.employee.findFirst({ where: { orgId, id: employeeId }, select: { name: true, email: true, workEmail: true } });
  const to = person?.workEmail || person?.email;
  if (!to) return;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  await sendTemplate({
    templateKey: 'payroll.bank_change_requested',
    to,
    toName: person?.name,
    accountId,
    orgId,
    relatedType: 'Employee',
    relatedId: employeeId,
    transactional: true,
    data: { employeeName: person?.name || '', orgName: org?.name || '', newAccountEnding: ending(newNumber) || '—' },
  });
}

/** Approve a pending change: it takes effect now. */
export async function approveBankChange(orgId: string, id: string, userId: string, now = new Date()) {
  const change = await payrollPrisma.bankDetailChange.findFirst({ where: { orgId, id } });
  if (!change) throw new BankChangeError(404, 'No such change.', 'NOT_FOUND');
  if (change.status !== 'PENDING') throw new BankChangeError(409, 'This change has already been decided.', 'NOT_PENDING');
  if (change.requestedByUserId === userId && now.getTime() - change.requestedAt.getTime() < SELF_APPROVAL_AFTER_MS) {
    throw new BankChangeError(
      409,
      'Somebody else must approve a bank change you entered — or you, 24 hours after entering it. Until then pay goes to the account on file.',
      'SELF_APPROVAL_TOO_SOON'
    );
  }
  const data = {
    bankAccountName: change.newAccountName,
    bankAccountNumber: change.newAccountNumber,
    bankIfsc: change.newIfsc,
    bankName: change.newBankName,
  };
  /* Claimed while still pending, then applied: two approvers at once cannot both move the money (A-13). */
  const claimed = await payrollPrisma.bankDetailChange.updateMany({ where: { id: change.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedByUserId: userId, decidedAt: now } });
  if (claimed.count !== 1) throw new BankChangeError(409, 'This change has already been decided.', 'NOT_PENDING');
  await payrollPrisma.employeePayrollProfile.updateMany({ where: { orgId, employeeId: change.employeeId }, data });
  return payrollPrisma.bankDetailChange.findUniqueOrThrow({ where: { id: change.id } });
}

export async function rejectBankChange(orgId: string, id: string, userId: string, note?: string | null) {
  const change = await payrollPrisma.bankDetailChange.findFirst({ where: { orgId, id } });
  if (!change) throw new BankChangeError(404, 'No such change.', 'NOT_FOUND');
  if (change.status !== 'PENDING') throw new BankChangeError(409, 'This change has already been decided.', 'NOT_PENDING');
  return payrollPrisma.bankDetailChange.update({
    where: { id: change.id },
    data: { status: 'REJECTED', decidedByUserId: userId, decidedAt: new Date(), note: note?.slice(0, 300) || null },
  });
}

/** Account number shown as its last four. */
export const maskNumber = (n: string | null | undefined) => (n ? `••••${ending(n)}` : null);
