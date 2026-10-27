import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../../features.js';
import { NOMINEE_RELATIONS, applyJoiningStatutory, type JoiningNominee, type JoiningStatutory } from '../../payroll/statutoryWrite.js';
import { type Actor, writeChangeLog } from '../changeLog.js';

/**
 * The statutory half of joining (HR-VIEW gap 2): PAN, UAN, ESIC, bank and
 * the PF nominees (Form 2), sent by the joiner on their invite.
 *
 * Joiner sends → HR sees it masked in the list, opens the approval view (the
 * one place it is shown in full, written to the access log) → approves. Only
 * then does it go to Payroll's record for the same employee id, through
 * Payroll's interface (services/payroll/statutoryWrite.ts), where a bank
 * account that differs from the one on file waits for Payroll's own bank
 * change approval. Once Payroll has it, the plain values here are replaced
 * by masked ones. A company without Payroll keeps the approved set here
 * (HELD) and it goes over when Payroll is switched on (pushHeld).
 */

export class StatutoryError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const UAN = /^\d{12}$/;
export const ESIC = /^(\d{10}|\d{17})$/;
export const ACCOUNT = /^\d{9,18}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v: unknown, upper = false) => {
  const s = String(v ?? '').replace(/\s+/g, upper ? '' : ' ').trim();
  return s ? (upper ? s.toUpperCase() : s) : null;
};
const digits = (v: unknown) => {
  const s = String(v ?? '').replace(/[\s-]/g, '');
  return s || null;
};

/** What the joiner (or HR, correcting) sent, checked field by field. Nothing given is fine: returns null. */
export function parseStatutory(raw: unknown): JoiningStatutory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: JoiningStatutory = {
    pan: clean(r.pan, true), uan: digits(r.uan), esicNumber: digits(r.esicNumber),
    bankAccountName: clean(r.bankAccountName)?.slice(0, 120) ?? null, bankAccountNumber: digits(r.bankAccountNumber), bankIfsc: clean(r.bankIfsc, true), bankName: clean(r.bankName)?.slice(0, 120) ?? null,
    nominees: [],
  };
  if (out.pan && !PAN.test(out.pan)) throw new StatutoryError('A PAN is five letters, four digits and a letter, like ABCDE1234F.');
  if (out.uan && !UAN.test(out.uan)) throw new StatutoryError('A UAN is 12 digits. Leave it blank if you have none yet.');
  if (out.esicNumber && !ESIC.test(out.esicNumber)) throw new StatutoryError('An ESIC number is 10 or 17 digits.');
  if (out.bankIfsc && !IFSC.test(out.bankIfsc)) throw new StatutoryError('An IFSC is 11 characters: four letters, a zero, then six letters or digits, like HDFC0001234.');
  if (out.bankAccountNumber && !ACCOUNT.test(out.bankAccountNumber)) throw new StatutoryError('A bank account number is 9 to 18 digits.');
  if (Boolean(out.bankAccountNumber) !== Boolean(out.bankIfsc)) throw new StatutoryError('Give the bank account number and the IFSC together.');
  const list = Array.isArray(r.nominees) ? r.nominees : [];
  if (list.length > 10) throw new StatutoryError('At most ten nominees.');
  for (const n of list as Array<Record<string, unknown>>) {
    const name = clean(n?.name)?.slice(0, 120);
    const relation = clean(n?.relation, true);
    const share = Number(n?.sharePercent);
    const dob = clean(n?.dateOfBirth);
    if (!name && !relation && !n?.sharePercent) continue;
    if (!name) throw new StatutoryError('Each nominee needs a name.');
    if (!relation || !(NOMINEE_RELATIONS as readonly string[]).includes(relation)) throw new StatutoryError('A nominee’s relation is spouse, son, daughter, father, mother, brother, sister or other.');
    if (!Number.isFinite(share) || share <= 0 || share > 100) throw new StatutoryError('Each nominee’s share is more than 0% and at most 100%.');
    if (dob && !ISO_DATE.test(dob)) throw new StatutoryError('Dates are YYYY-MM-DD.');
    out.nominees!.push({ name, relation, sharePercent: Math.round(share * 100) / 100, dateOfBirth: dob });
  }
  if (out.nominees!.length) {
    const total = out.nominees!.reduce((s, n) => s + n.sharePercent, 0);
    if (Math.abs(total - 100) > 0.01) throw new StatutoryError(`The nominees’ shares add up to ${Math.round(total * 100) / 100}%; they must add up to 100%.`);
  }
  const given = out.pan || out.uan || out.esicNumber || out.bankAccountNumber || out.nominees!.length;
  return given ? out : null;
}

const tail = (v: string | null | undefined, keep = 4) => {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.length <= keep ? '*'.repeat(s.length) : `${'*'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
};
const maskPan = (v: string | null | undefined) => {
  const s = String(v || '').trim();
  return s ? `${s.slice(0, 2)}${'*'.repeat(Math.max(3, s.length - 3))}${s.slice(-1)}` : '';
};

/** Masked, for every view but the approval view. Names and shares of nominees are not secret; their dates of birth are left out. */
export function maskStatutory(d: JoiningStatutory | null | undefined) {
  if (!d) return null;
  return {
    pan: maskPan(d.pan), uan: tail(d.uan), esicNumber: tail(d.esicNumber),
    bankAccountName: d.bankAccountName || '', bankAccountNumber: tail(d.bankAccountNumber), bankIfsc: d.bankIfsc || '', bankName: d.bankName || '',
    nominees: (d.nominees || []).map((n) => ({ name: n.name, relation: n.relation, sharePercent: n.sharePercent })),
  };
}
/** Is a stored set already masked (after it went to Payroll)? */
const isMasked = (d: any) => Boolean(d?.masked);

type Row = { id: string; employeeId: string; inviteId: string; data: unknown; status: string; decidedByUserId: string | null; decidedAt: Date | null; appliedAt: Date | null; bankOutcome: string | null; note: string | null; createdAt: Date };
const shape = (r: Row, full = false) => ({
  id: r.id, inviteId: r.inviteId, employeeId: r.employeeId, status: r.status, decidedByUserId: r.decidedByUserId, decidedAt: r.decidedAt, appliedAt: r.appliedAt, bankOutcome: r.bankOutcome, note: r.note, createdAt: r.createdAt,
  values: full && !isMasked(r.data) ? (r.data as JoiningStatutory) : isMasked(r.data) ? (r.data as any).values : maskStatutory(r.data as JoiningStatutory),
  masked: !(full && !isMasked(r.data)),
});

/** Saved with the joiner's submit, in the same transaction. */
export async function saveFromJoiner(tx: any, invite: { id: string; accountId: string; orgId: string; employeeId: string }, values: JoiningStatutory) {
  await tx.joinStatutory.deleteMany({ where: { inviteId: invite.id } });
  return tx.joinStatutory.create({ data: { accountId: invite.accountId, orgId: invite.orgId, employeeId: invite.employeeId, inviteId: invite.id, data: values as any } });
}

/** The masked summary for each invite, for lists. */
export async function summariesFor(orgId: string, inviteIds: string[]) {
  if (!inviteIds.length) return new Map<string, ReturnType<typeof shape>>();
  const rows = await peoplePrisma.joinStatutory.findMany({ where: { orgId, inviteId: { in: inviteIds } } });
  return new Map(rows.map((r) => [r.inviteId, shape(r)]));
}

/** The approval view: in full while it waits for a decision. The caller checks the grant and writes the access log. */
export async function forApproval(orgId: string, inviteId: string) {
  const row = await peoplePrisma.joinStatutory.findFirst({ where: { orgId, inviteId } });
  if (!row) throw new StatutoryError('The joiner sent no statutory details on this invite.', 404);
  return shape(row, row.status === 'SENT');
}

/** Approved sets waiting for Payroll, and those already applied, for a person's record (masked). */
export async function heldFor(orgId: string, employeeId: string) {
  const row = await peoplePrisma.joinStatutory.findFirst({ where: { orgId, employeeId, status: { in: ['HELD', 'SENT'] } }, orderBy: { createdAt: 'desc' } });
  return row ? shape(row) : null;
}

async function sendToPayroll(actor: Actor & { branchId?: string | null }, row: Row, values: JoiningStatutory) {
  const r = await applyJoiningStatutory({ accountId: actor.accountId, orgId: actor.orgId, branchId: actor.branchId, employeeId: row.employeeId, userId: actor.userId || 'system', correlationId: actor.correlationId, values });
  /* Payroll has it now; People keeps only what it may show. */
  return peoplePrisma.joinStatutory.update({ where: { id: row.id }, data: { status: 'APPLIED', appliedAt: new Date(), bankOutcome: r.bank, data: { masked: true, values: maskStatutory(values) } as any } });
}

/** HR approves (with any corrections): to Payroll if it is on, else held here. Logged in People's change log; Payroll writes its own audit line. */
export async function approveStatutory(actor: Actor & { branchId?: string | null }, inviteId: string, corrections?: unknown) {
  const row = await peoplePrisma.joinStatutory.findFirst({ where: { orgId: actor.orgId, inviteId } });
  if (!row) throw new StatutoryError('The joiner sent no statutory details on this invite.', 404);
  if (row.status !== 'SENT') throw new StatutoryError('These details have already been decided.', 409);
  const values = corrections && typeof corrections === 'object' ? parseStatutory({ ...(row.data as object), ...(corrections as object) }) : (row.data as JoiningStatutory);
  if (!values) throw new StatutoryError('Nothing to approve.');
  const claimed = await peoplePrisma.joinStatutory.updateMany({ where: { id: row.id, status: 'SENT' }, data: { status: 'HELD', decidedByUserId: actor.userId, decidedAt: new Date(), data: values as any } });
  if (claimed.count !== 1) throw new StatutoryError('These details have already been decided.', 409);
  const fields = (['pan', 'uan', 'esicNumber', 'bankAccountNumber', 'bankIfsc'] as const).filter((k) => values[k]);
  await peoplePrisma.$transaction(async (tx) => {
    await writeChangeLog(tx, actor, { kind: 'JoinStatutory', id: row.id, employeeId: row.employeeId }, [
      ...fields.map((k) => ({ field: k, before: null, after: null, redacted: true })),
      ...(values.nominees?.length ? [{ field: 'pfNominees', before: null, after: values.nominees.map((n) => `${n.name} (${n.relation.toLowerCase()}, ${n.sharePercent}%)`).join('; '), redacted: false }] : []),
    ]);
  });
  const fresh = (await peoplePrisma.joinStatutory.findUniqueOrThrow({ where: { id: row.id } })) as Row;
  const payrollOn = await isFeatureEnabled(actor.accountId, actor.orgId, 'payroll');
  const done = payrollOn ? await sendToPayroll(actor, fresh, values) : fresh;
  return { statutory: shape(done as Row), payroll: payrollOn ? 'SENT' : 'HELD_UNTIL_PAYROLL' };
}

export async function rejectStatutory(actor: Actor, inviteId: string, note?: string | null) {
  const row = await peoplePrisma.joinStatutory.findFirst({ where: { orgId: actor.orgId, inviteId } });
  if (!row) throw new StatutoryError('The joiner sent no statutory details on this invite.', 404);
  if (row.status !== 'SENT') throw new StatutoryError('These details have already been decided.', 409);
  /* Nothing kept that was not accepted. */
  const done = await peoplePrisma.joinStatutory.update({ where: { id: row.id }, data: { status: 'REJECTED', decidedByUserId: actor.userId, decidedAt: new Date(), note: String(note || '').slice(0, 300) || null, data: { masked: true, values: maskStatutory(row.data as JoiningStatutory) } as any } });
  await peoplePrisma.$transaction((tx) => writeChangeLog(tx, actor, { kind: 'JoinStatutory', id: row.id, employeeId: row.employeeId }, [{ field: 'joiningStatutory', before: null, after: `not accepted${note ? `: ${String(note).slice(0, 200)}` : ''}`, redacted: false }]));
  return shape(done as Row);
}

/** Payroll is on now: everything approved and held goes over. */
export async function pushHeld(actor: Actor & { branchId?: string | null }) {
  if (!(await isFeatureEnabled(actor.accountId, actor.orgId, 'payroll'))) throw new StatutoryError('Payroll is not on for this company, so the details stay in People.', 409);
  const rows = (await peoplePrisma.joinStatutory.findMany({ where: { orgId: actor.orgId, status: 'HELD' } })) as Row[];
  let sent = 0;
  for (const r of rows) {
    if (isMasked(r.data)) continue;
    await sendToPayroll(actor, r, r.data as JoiningStatutory);
    sent += 1;
  }
  return { sent };
}

export type { JoiningNominee };
