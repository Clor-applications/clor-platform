import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { round2 } from '../../../utils/money.js';
import { istDate } from '../../attendance/compute.js';
import { sendNotice, usersWithPermission } from '../../notifications.js';
import { ownPlanRefusal, resolveOwners } from '../checklists.js';
import { NO_SETTLEMENT } from '../lifecycle/leaving.js';
import { LEAVING_WITHDRAWN_NOTE } from '../lifecycle/stayOn.js';
import { countFrom, workingCalendar } from '../lifecycle/workdays.js';
import { registerRecipe } from './automations.js';
import { addDays } from '../../../utils/istDate.js';

/**
 * No-dues sign-off and the final-pay clock (WORKFLOW-GAP-RESEARCH-2026-10-30 A9, A10, 4.3).
 *
 * On a leaving, the plan gets a Clearance section: one line per department (the manager for the
 * handover, IT for what they hold from the asset register, admin for ID card and keys, accounts for
 * advances, loans and claims, with the amounts CLOR found) and any the company adds. Each line has an
 * owner, things to hand back, money owed either way, and a sign-off by its owner or HR.
 *
 * Clearance never holds up the statutory final wages (Code on Wages 2019 s.17(2): wages within two
 * working days of leaving): an open line is a warning. The clock runs from the last working day, counted
 * in the person's working days (their weekly offs and holidays skipped, as the plan's "Final wages paid"
 * step counts them), or by Payroll's own due date once Payroll drafts the settlement. An absconding hold
 * (people/absconding.ts) shows as held; it never zeroes what is owed.
 *
 * Reading: every line shows to whoever sees the person, but its money (who owes whom, the amount, the note)
 * and the totals only to HR and that line's owner. Accounts' figures are not a manager's or IT's to read.
 * Nobody signs on their own leaving (JCL-007), unless they are the only one who can.
 *
 * Rows carry the last day they were made for. A last day that moves takes the rows with it (`carryLines`);
 * a leaving withdrawn marks them WITHDRAWN, kept on the record and out of everything else.
 */

export const DEPTS = ['MANAGER', 'IT', 'ADMIN', 'FINANCE', 'CUSTOM'] as const;
export type Dept = (typeof DEPTS)[number];
export const DEPT_WORD: Record<Dept, string> = { MANAGER: 'Manager', IT: 'IT', ADMIN: 'Admin', FINANCE: 'Accounts', CUSTOM: 'Other' };
type Item = { title: string; assetId?: string | null; tag?: string | null; returned: boolean };
type Who = { accountId: string; orgId: string; userId: string };

export class ClearanceError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

const today = () => istDate(new Date());
/* Paise shown as two figures, or none: ₹1,250.50, not ₹1,250.5. */
const money = (n: number) => `₹${n.toLocaleString('en-IN', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

async function refuseOwnPlan(who: Who, employeeId: string) {
  if (await ownPlanRefusal(who, { employeeId, owner: 'HR' })) throw new ClearanceError('This is your own leaving: someone else signs it.', 403, 'OWN_PLAN');
}
async function refuseOutsider(orgId: string, userId: string) {
  if (!(await platformPrisma.userOrgMembership.findFirst({ where: { orgId, userId }, select: { id: true } }))) throw new ClearanceError('That person is not in this company.');
}

/** Leaving and not one of the kinds with no settlement (a duplicate record, someone who never joined). */
async function leaverOf(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, accountId: true, name: true, status: true, dateOfJoining: true, dateOfLeaving: true, leavingType: true, reportingManagerId: true, userId: true, areaId: true, branchId: true } });
  if (!e) throw new ClearanceError('No such employee.', 404);
  return e;
}
const isLeaving = (e: { status: string; dateOfLeaving: string | null; leavingType: string | null }) => Boolean(e.dateOfLeaving && (e.status === 'ON_NOTICE' || e.status === 'LEFT') && !NO_SETTLEMENT.has(String(e.leavingType || '')));

/**
 * A last day that moved takes this stint's lines with it, signatures and all (the date is editable and the
 * leaving route can reset it). Lines from before the latest joining are an earlier stint's, and stay.
 */
async function carryLines(orgId: string, e: { id: string; dateOfJoining: string | null; dateOfLeaving: string | null }) {
  if (!e.dateOfLeaving) return;
  const where = { orgId, employeeId: e.id };
  const older = await peoplePrisma.clearanceLine.findFirst({ where: { ...where, leavingDate: { not: e.dateOfLeaving, gte: e.dateOfJoining || '' }, status: { not: 'WITHDRAWN' } }, orderBy: { leavingDate: 'desc' }, select: { leavingDate: true } });
  if (!older) return;
  await peoplePrisma.clearanceLine.deleteMany({ where: { ...where, leavingDate: e.dateOfLeaving, status: 'WITHDRAWN' } });
  /* Two reads at once: the unique row refuses the slower; the lines have moved either way. */
  await peoplePrisma.clearanceLine.updateMany({ where: { ...where, leavingDate: older.leavingDate, status: { not: 'WITHDRAWN' } }, data: { leavingDate: e.dateOfLeaving } }).catch((err) => { if (err?.code !== 'P2002') throw err; });
}

/** What accounts should look at: open advances, approved claims not yet paid, Payroll loans still owed. A Payroll that cannot be read is "not checked", never "no loans". */
export async function financeFound(orgId: string, employeeId: string) {
  const [advances, claims, loans] = await Promise.all([
    peoplePrisma.employeeAdvance.findMany({ where: { orgId, employeeId, status: 'PAID' }, select: { number: true, amount: true, settledAmount: true, returnedAmount: true, recoveredAmount: true } }),
    peoplePrisma.expenseClaim.findMany({ where: { orgId, employeeId, status: { in: ['APPROVED', 'PAYING'] } }, select: { number: true, approvedTotal: true, claimedTotal: true } }),
    payrollPrisma.payrollLoan.findMany({ where: { orgId, employeeId, status: 'ACTIVE' }, select: { type: true, outstandingBalance: true } }).catch((e) => {
      console.error('[clearance] Payroll loans not read:', e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  const lines: Array<{ what: string; direction: 'OWES' | 'OWED'; amount: number }> = [];
  for (const a of advances) {
    const open = round2(Number(a.amount) - Number(a.settledAmount) - Number(a.returnedAmount) - Number(a.recoveredAmount));
    if (open > 0) lines.push({ what: `Advance ${a.number} not yet accounted for`, direction: 'OWES', amount: open });
  }
  for (const c of claims) {
    const amt = round2(Number(c.approvedTotal ?? c.claimedTotal));
    if (amt > 0) lines.push({ what: `Expense claim ${c.number} approved, not yet paid`, direction: 'OWED', amount: amt });
  }
  for (const l of loans || []) {
    const owed = round2(Number(l.outstandingBalance));
    if (owed > 0) lines.push({ what: l.type === 'SALARY_ADVANCE' ? 'Salary advance still to recover' : 'Loan still to recover', direction: 'OWES', amount: owed });
  }
  const net = round2(lines.reduce((t, l) => t + (l.direction === 'OWES' ? l.amount : -l.amount), 0));
  return { lines, net, direction: net > 0 ? 'OWES' : net < 0 ? 'OWED' : 'NONE', amount: Math.abs(net), loansUnknown: loans === null };
}

/**
 * The default lines for a leaving, made once: the unique (person, last day, department, label) row makes
 * two openings of the plan at once, or the job beside them, write one set.
 */
export async function ensureClearance(who: { accountId: string; orgId: string; userId: string | null }, employeeId: string) {
  const e = await leaverOf(who.orgId, employeeId);
  if (!isLeaving(e)) return 0;
  const leavingDate = e.dateOfLeaving!;
  await carryLines(who.orgId, e);
  if (await peoplePrisma.clearanceLine.count({ where: { orgId: who.orgId, employeeId, leavingDate, status: { not: 'WITHDRAWN' } } })) return 0;
  /* Withdrawn, then leaving again on the same day: a fresh set, not last time's sign-offs. */
  await peoplePrisma.clearanceLine.deleteMany({ where: { orgId: who.orgId, employeeId, leavingDate, status: 'WITHDRAWN' } });
  const [owners, assets, found] = await Promise.all([
    resolveOwners(who, e),
    peoplePrisma.peopleRecord.findMany({ where: { orgId: who.orgId, kind: 'assets', status: 'ASSIGNED', employeeId }, select: { id: true, title: true, details: true }, orderBy: { title: 'asc' } }),
    financeFound(who.orgId, employeeId),
  ]);
  const items = assets.map((a) => ({ title: a.title, assetId: a.id, tag: ((a.details as any)?.assetTag as string) || null, returned: false }));
  const base = { accountId: e.accountId, orgId: who.orgId, employeeId, leavingDate };
  const financeNote = [...found.lines.map((l) => `${l.what}: ${money(l.amount)}`), found.loansUnknown ? 'Payroll loans not checked: Payroll could not be read' : null].filter(Boolean).join('; ').slice(0, 500) || null;
  const made = await peoplePrisma.clearanceLine.createMany({
    data: [
      { ...base, dept: 'MANAGER', label: 'Handover', ownerUserId: owners.MANAGER, items: [{ title: 'Work handed over', returned: false }], sortOrder: 0 },
      { ...base, dept: 'IT', label: 'Laptop, devices and accounts', ownerUserId: owners.IT, items: items.length ? items : [], sortOrder: 1 },
      { ...base, dept: 'ADMIN', label: 'ID card, keys and access', ownerUserId: owners.HR, items: [{ title: 'ID card', returned: false }, { title: 'Keys', returned: false }], sortOrder: 2 },
      { ...base, dept: 'FINANCE', label: 'Advances, loans and claims', ownerUserId: owners.PAYROLL, direction: found.direction, amount: found.amount, note: financeNote, sortOrder: 3 },
    ],
    skipDuplicates: true,
  });
  return made.count;
}

const shapeItems = (raw: unknown): Item[] => (Array.isArray(raw) ? raw : []).map((i: any) => ({ title: String(i?.title || '').slice(0, 120), assetId: i?.assetId || null, tag: i?.tag || null, returned: Boolean(i?.returned) })).filter((i) => i.title);

/**
 * The plan's Clearance section: the lines with owners' names, the totals each way, and what accounts should
 * check now. `onlyMine` is an owner outside the person's team, who sees just their own lines; `ownPlan` is
 * someone reading their own leaving, who signs nothing on it.
 */
export async function clearanceFor(orgId: string, employeeId: string, viewer: { userId: string; hr: boolean; ownPlan?: boolean; onlyMine?: boolean }) {
  const e = await leaverOf(orgId, employeeId);
  if (!e.dateOfLeaving) return { leaving: false, lines: [], totals: null, open: 0, found: null };
  await carryLines(orgId, e);
  const rows = await peoplePrisma.clearanceLine.findMany({ where: { orgId, employeeId, leavingDate: e.dateOfLeaving, status: { not: 'WITHDRAWN' }, ...(viewer.onlyMine ? { ownerUserId: viewer.userId } : {}) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  const users = new Map((await platformPrisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.ownerUserId, r.signedByUserId]).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  /* An asset returned in the register counts here too, whichever screen it was marked on. */
  const assetIds = rows.flatMap((r) => shapeItems(r.items).map((i) => i.assetId)).filter(Boolean) as string[];
  const back = new Set(assetIds.length ? (await peoplePrisma.peopleRecord.findMany({ where: { orgId, id: { in: assetIds }, status: { not: 'ASSIGNED' } }, select: { id: true } })).map((a) => a.id) : []);
  const isMine = (r: { ownerUserId: string | null }) => Boolean(r.ownerUserId) && r.ownerUserId === viewer.userId;
  const lines = rows.map((r) => ({
    id: r.id,
    dept: r.dept,
    deptWord: DEPT_WORD[r.dept as Dept] || r.dept,
    label: r.label,
    ownerUserId: r.ownerUserId,
    ownerName: r.ownerUserId ? users.get(r.ownerUserId) || null : null,
    items: shapeItems(r.items).map((i) => ({ ...i, returned: i.returned || Boolean(i.assetId && back.has(i.assetId)) })),
    ...(viewer.hr || isMine(r) ? { direction: r.direction, amount: Number(r.amount), note: r.note } : { moneyHidden: true }),
    status: r.status,
    signedBy: r.signedByUserId ? users.get(r.signedByUserId) || null : null,
    signedAt: r.signedAt,
    updatedAt: r.updatedAt,
    canSign: !viewer.ownPlan && (viewer.hr || isMine(r)),
    mine: isMine(r),
  }));
  /* The sum of what this reader may see; nothing at all for someone who may see none of it. */
  const shown = rows.filter((r) => viewer.hr || isMine(r));
  const sum = (d: string) => round2(shown.filter((r) => r.direction === d).reduce((t, r) => t + Number(r.amount), 0));
  return {
    leaving: isLeaving(e),
    lastDay: e.dateOfLeaving,
    lines,
    totals: shown.length ? { owes: sum('OWES'), owed: sum('OWED') } : null,
    open: lines.filter((l) => l.status !== 'CLEAR').length,
    found: viewer.hr ? await financeFound(orgId, employeeId) : null,
  };
}

export type LineInput = {
  direction?: 'NONE' | 'OWES' | 'OWED';
  amount?: number;
  note?: string | null;
  items?: Array<{ title: string; returned: boolean; assetId?: string | null }>;
  ownerUserId?: string | null;
  sign?: boolean;
  /** The line as the caller last saw it: a change made since is not overwritten. */
  seenAt?: string;
};

async function lineIn(orgId: string, id: string) {
  const l = await peoplePrisma.clearanceLine.findFirst({ where: { id, orgId } });
  if (!l) throw new ClearanceError('No such line.', 404);
  return l;
}

/**
 * Changes one line: its owner (HR only), the money either way, the note, what came back; or signs it off
 * (its owner or HR), or opens it again (HR). A sign-off checks the line is still open in the same write, so
 * two clicks sign once; a change made by someone else since the caller loaded the line is refused.
 */
export async function updateLine(who: Who, id: string, input: LineInput, can: { hr: boolean }) {
  const line = await lineIn(who.orgId, id);
  if (line.status === 'WITHDRAWN') throw new ClearanceError('This leaving was withdrawn.', 409, 'WITHDRAWN');
  await refuseOwnPlan(who, line.employeeId);
  const mine = Boolean(line.ownerUserId) && line.ownerUserId === who.userId;
  if (!can.hr && !mine) throw new ClearanceError('Only the owner of this line or HR can sign it off.', 403);
  if (input.ownerUserId !== undefined && !can.hr) throw new ClearanceError('Only HR can hand a line to someone else.', 403);
  if (input.seenAt && new Date(input.seenAt).getTime() !== line.updatedAt.getTime()) throw new ClearanceError('Someone changed this line since you opened it. Open it again.', 409, 'STALE');
  if (input.sign === false && !can.hr) throw new ClearanceError('Only HR can open a signed line again.', 403);
  if (line.status === 'CLEAR' && input.sign !== false) throw new ClearanceError('This line is signed off. HR can open it again.', 409, 'SIGNED');
  const data: Record<string, unknown> = {};
  if (input.direction !== undefined) {
    if (!['NONE', 'OWES', 'OWED'].includes(input.direction)) throw new ClearanceError('Choose who owes whom.');
    data.direction = input.direction;
  }
  if (input.amount !== undefined) {
    const a = Number(input.amount);
    if (!Number.isFinite(a) || a < 0 || a > 100_000_000) throw new ClearanceError('Enter the amount as a positive number.');
    data.amount = round2(a);
  }
  const direction = (data.direction ?? line.direction) as string;
  const amount = Number(data.amount ?? line.amount);
  if (direction !== 'NONE' && !(amount > 0)) throw new ClearanceError('Enter how much is owed.');
  if (direction === 'NONE' && amount > 0 && input.amount !== undefined) throw new ClearanceError('Say who owes whom, or leave the amount at 0.');
  if (direction === 'NONE') data.amount = 0;
  if (input.note !== undefined) data.note = input.note ? String(input.note).trim().slice(0, 500) || null : null;
  let returnedAssets: string[] = [];
  if (input.items !== undefined) {
    const before = shapeItems(line.items);
    const next = (input.items || []).slice(0, 40).map((i) => ({ title: String(i.title || '').trim().slice(0, 120), assetId: i.assetId || null, returned: Boolean(i.returned) })).filter((i) => i.title);
    /* Asset lines come from the register and stay; a returned asset is marked Returned there too. */
    for (const b of before.filter((x) => x.assetId)) if (!next.some((n) => n.assetId === b.assetId)) next.push({ ...b, assetId: b.assetId || null });
    returnedAssets = next.filter((n) => n.assetId && n.returned && !before.find((b) => b.assetId === n.assetId)?.returned).map((n) => n.assetId!) as string[];
    data.items = next.map((n) => ({ ...n, tag: before.find((b) => b.assetId && b.assetId === n.assetId)?.tag || null }));
  }
  if (input.ownerUserId !== undefined) {
    if (input.ownerUserId) await refuseOutsider(who.orgId, input.ownerUserId);
    data.ownerUserId = input.ownerUserId || null;
  }
  if (input.sign === true) {
    Object.assign(data, { status: 'CLEAR', signedByUserId: who.userId, signedAt: new Date() });
  } else if (input.sign === false) {
    Object.assign(data, { status: 'OPEN', signedByUserId: null, signedAt: null });
  }
  const r = await peoplePrisma.clearanceLine.updateMany({ where: { id: line.id, orgId: who.orgId, updatedAt: line.updatedAt, ...(input.sign === false ? {} : { status: 'OPEN' }) }, data: data as any });
  if (!r.count) throw new ClearanceError('Someone changed this line at the same time. Open it again.', 409, 'STALE');
  if (returnedAssets.length) {
    const assets = await peoplePrisma.peopleRecord.findMany({ where: { orgId: who.orgId, id: { in: returnedAssets }, kind: 'assets', status: 'ASSIGNED', employeeId: line.employeeId }, select: { id: true, title: true, details: true } });
    await peoplePrisma.peopleRecord.updateMany({ where: { orgId: who.orgId, id: { in: assets.map((a) => a.id) }, status: 'ASSIGNED' }, data: { status: 'RETURNED' } });
    /* The plan's "Return <asset>" step is the same fact: ticked with it. */
    for (const a of assets) {
      /* The exact step (checklists.ts words it): returning "Laptop" is not returning "Laptop charger". */
      const tag = (a.details as any)?.assetTag;
      await peoplePrisma.checklistTask.updateMany({ where: { orgId: who.orgId, employeeId: line.employeeId, kind: 'LEAVING', doneAt: null, title: `Return ${a.title}${tag ? ` (${tag})` : ''}`.slice(0, 200) }, data: { doneAt: new Date(), doneByUserId: who.userId, note: 'Ticked back on the no-dues line.' } });
    }
  }
  return lineIn(who.orgId, id);
}

/** HR adds a line of the company's own (a library book, a uniform). */
export async function addLine(who: Who, employeeId: string, input: { label?: string; ownerUserId?: string | null }) {
  const e = await leaverOf(who.orgId, employeeId);
  if (!isLeaving(e)) throw new ClearanceError('They are not leaving.', 409);
  await refuseOwnPlan(who, employeeId);
  if (input.ownerUserId) await refuseOutsider(who.orgId, input.ownerUserId);
  await carryLines(who.orgId, e);
  const label = String(input.label || '').trim().slice(0, 80);
  if (label.length < 2) throw new ClearanceError('Name the line.');
  const made = await peoplePrisma.clearanceLine.createMany({ data: [{ accountId: e.accountId, orgId: who.orgId, employeeId, leavingDate: e.dateOfLeaving!, dept: 'CUSTOM', label, ownerUserId: input.ownerUserId || null, sortOrder: 10 }], skipDuplicates: true });
  if (!made.count) throw new ClearanceError('There is already a line with that name.', 409, 'DUPLICATE');
  return peoplePrisma.clearanceLine.findFirst({ where: { orgId: who.orgId, employeeId, leavingDate: e.dateOfLeaving!, dept: 'CUSTOM', label } });
}

export async function removeLine(who: Who, id: string) {
  const line = await lineIn(who.orgId, id);
  await refuseOwnPlan(who, line.employeeId);
  if (line.dept !== 'CUSTOM') throw new ClearanceError('Only lines the company added can be removed.', 409);
  if (line.status === 'CLEAR') throw new ClearanceError('A signed line stays on the record.', 409);
  await peoplePrisma.clearanceLine.deleteMany({ where: { id: line.id, orgId: who.orgId, status: 'OPEN' } });
  return line;
}

// ---------------------------------------------------------------------------
// The final-pay clock
// ---------------------------------------------------------------------------

export const FINAL_PAY_RULE = 'Code on Wages 2019 s.17(2): wages are paid within two working days of the last day. Clearance does not hold them up. Check with your adviser how it applies to you.';

/** Working days between today and the due date (0 on the day, negative once past). */
function workingDaysTo(due: string, from: string, works: (d: string) => boolean) {
  if (due === from) return 0;
  const step = due > from ? 1 : -1;
  let n = 0;
  for (let d = from, guard = 0; d !== due && guard < 400; guard++) {
    d = new Date(Date.parse(`${d}T00:00:00Z`) + step * 86_400_000).toISOString().slice(0, 10);
    if (works(d) || d === due) n += step;
  }
  return n;
}

/**
 * One leaver's clock: the last day, the date final pay is due, working days left, Payroll's settlement
 * state (with its id to open), and a hold from the absence case if one is in force. Paid means Payroll's
 * settlement is paid, or the plan's "Final wages paid" step is ticked: a small company without Payroll pays
 * by hand and ticks that step, as the Leaving board reads it (lifecycle/board.ts).
 */
export async function finalPayOf(orgId: string, e: { id: string; dateOfJoining?: string | null; dateOfLeaving: string | null; areaId?: string | null; branchId?: string | null; leavingType?: string | null; status?: string }, t = today()) {
  if (!e.dateOfLeaving || NO_SETTLEMENT.has(String(e.leavingType || ''))) return null;
  const lastDay = e.dateOfLeaving;
  /* Only this stint's steps: a rehire's tick from an earlier leaving paid that leaving, not this one. */
  const joined = e.dateOfJoining !== undefined ? e.dateOfJoining : (await peoplePrisma.employee.findFirst({ where: { id: e.id, orgId }, select: { dateOfJoining: true } }))?.dateOfJoining ?? null;
  const since = joined ? new Date(`${joined}T00:00:00+05:30`) : null;
  let payrollUnknown = false;
  const [settlement, hold, works, steps] = await Promise.all([
    payrollPrisma.finalSettlement.findFirst({ where: { orgId, employeeId: e.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, dueDate: true, paidAt: true, leavingDate: true } }).catch((err) => {
      console.error('[final pay] Payroll settlement not read:', err instanceof Error ? err.message : err);
      payrollUnknown = true;
      return null;
    }),
    peoplePrisma.absenceCase.findFirst({ where: { orgId, employeeId: e.id, heldAt: { not: null }, holdReleasedAt: null }, select: { holdReason: true, heldAt: true } }),
    workingCalendar(orgId, e, lastDay),
    peoplePrisma.checklistTask.findMany({ where: { orgId, employeeId: e.id, kind: 'LEAVING', ...(since ? { createdAt: { gte: since } } : {}), OR: [{ title: { contains: 'final wages', mode: 'insensitive' } }, { title: { contains: 'final settlement', mode: 'insensitive' } }] }, orderBy: { createdAt: 'desc' }, select: { title: true, doneAt: true, note: true } }),
  ]);
  const current = settlement && settlement.leavingDate === lastDay ? settlement : null;
  const due = current?.dueDate || countFrom(lastDay, 2, works);
  /* The newest step: an older one is an earlier leaving's, and one closed by a withdrawal paid nothing. */
  const step = steps.find((s) => s.title === 'Final wages paid') || steps[0];
  const paidOnPlan = Boolean(step?.doneAt && step.note !== LEAVING_WITHDRAWN_NOTE);
  const paid = current?.status === 'PAID' || paidOnPlan;
  return {
    lastDay,
    dueDate: due,
    daysLeft: workingDaysTo(due, t, works),
    started: lastDay <= t,
    overdue: !paid && due < t,
    settlement: current ? { id: current.id, status: current.status } : null,
    paid,
    paidOnPlan: paid && current?.status !== 'PAID',
    payrollUnknown,
    held: hold ? { reason: hold.holdReason, since: hold.heldAt } : null,
    rule: FINAL_PAY_RULE,
  };
}

/** Home's banner: leavers whose last day has come and whose final pay is not marked paid, nearest due first. */
export async function finalPayBoard(orgId: string, opts: { scopeIds?: string[] | null; today?: string } = {}) {
  const t = opts.today || today();
  const since = new Date(Date.parse(`${t}T00:00:00Z`) - 45 * 86_400_000).toISOString().slice(0, 10);
  const people = await peoplePrisma.employee.findMany({
    where: { orgId, status: { in: ['ON_NOTICE', 'LEFT'] }, dateOfLeaving: { gte: since, lte: t }, ...(opts.scopeIds ? { id: { in: opts.scopeIds } } : {}) },
    select: { id: true, name: true, dateOfJoining: true, dateOfLeaving: true, leavingType: true, areaId: true, branchId: true, status: true },
    /* The most recent first: the cap never drops someone whose clock is running in favour of an older leaver already paid. */
    orderBy: [{ dateOfLeaving: 'desc' }, { id: 'asc' }],
    take: 50,
  });
  const rows = [];
  for (const p of people) {
    const clock = await finalPayOf(orgId, p, t);
    if (!clock || clock.paid) continue;
    rows.push({ employeeId: p.id, name: p.name, ...clock });
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---------------------------------------------------------------------------
// Recipes (services/people/engagement/automations.ts)
// ---------------------------------------------------------------------------

/**
 * The owner and HR hear the working day before final pay is due, and on the day, once each, unless it is
 * paid or held. A weekend in between is still "one working day left": the key has no date in it, so that
 * stays one notice.
 */
registerRecipe('finalPayDue', async ({ accountId, orgId, today: t }) => {
  const board = await finalPayBoard(orgId, { today: t });
  /*
   * One working day left, due today, or already past: a run that missed its day (the day's run had gone before a
   * resignation came in that evening) catches up on the next one. The dedupe keys keep it to one of each.
   */
  const due = board.filter((b) => (b.daysLeft <= 1 || b.dueDate <= t) && !b.held);
  if (!due.length) return { count: 0, recipients: [] };
  const to = await usersWithPermission(accountId, orgId, 'PEOPLE::Employees::EDIT');
  let count = 0;
  for (const b of due) {
    const onTheDay = b.dueDate <= t;
    const when = b.dueDate === t ? 'is due today' : b.dueDate < t ? `was due on ${longDay(b.dueDate)}` : addDays(t, 1) === b.dueDate ? 'is due tomorrow' : `is due on ${longDay(b.dueDate)}`;
    count += await sendNotice(accountId, orgId, to, {
      kind: 'people.final_pay',
      title: `Final pay for ${b.name} ${when}`,
      body: `Last day ${b.lastDay}. ${b.payrollUnknown ? 'Payroll could not be read just now.' : b.settlement ? `Payroll settlement: ${b.settlement.status.toLowerCase()}.` : 'Payroll has no settlement for them yet.'}`,
      link: { app: 'people', screen: 'leavers', params: { open: b.employeeId } },
    }, { dedupeKey: `final-pay:${b.employeeId}:${b.dueDate}:${onTheDay ? 'on-the-day' : 'day-before'}` });
  }
  return { count, recipients: due.map((b) => b.name) };
});

/** On the last working day, each owner with a line still open hears once. */
registerRecipe('clearanceDue', async ({ accountId, orgId, today: t }) => {
  /* Whoever really leaves today: not a line whose person stayed on or whose day moved. Lines exist once a plan has been read, so they are made here too. */
  const leavers = (await peoplePrisma.employee.findMany({ where: { orgId, dateOfLeaving: t, status: { in: ['ON_NOTICE', 'LEFT'] } }, select: { id: true, status: true, dateOfLeaving: true, leavingType: true } })).filter(isLeaving);
  for (const l of leavers) await ensureClearance({ accountId, orgId, userId: null }, l.id);
  const open = await peoplePrisma.clearanceLine.findMany({ where: { orgId, employeeId: { in: leavers.map((l) => l.id) }, leavingDate: t, status: 'OPEN', ownerUserId: { not: null } } });
  if (!open.length) return { count: 0, recipients: [] };
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(open.map((l) => l.employeeId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const byOwner = new Map<string, typeof open>();
  for (const l of open) byOwner.set(l.ownerUserId!, [...(byOwner.get(l.ownerUserId!) || []), l]);
  let count = 0;
  const who: string[] = [];
  for (const [userId, lines] of byOwner) {
    const n = await sendNotice(accountId, orgId, [userId], {
      kind: 'people.clearance',
      title: lines.length === 1 ? `Sign off ${lines[0].label.toLowerCase()} for ${names.get(lines[0].employeeId) || 'a leaver'}` : `${lines.length} no-dues lines to sign off today`,
      body: lines.map((l) => `${names.get(l.employeeId) || 'Someone'}: ${l.label}`).join('\n'),
      link: { app: 'people', screen: 'leavers', params: { open: lines[0].employeeId } },
    }, { dedupeKey: `clearance:${userId}:${t}` });
    count += n;
    if (n) who.push(...lines.map((l) => names.get(l.employeeId) || ''));
  }
  return { count, recipients: who.filter(Boolean) };
});
