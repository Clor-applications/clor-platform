import { createHash, randomUUID } from 'node:crypto';

import type { Prisma } from '../../../generated/people/index.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { round2 } from '../../../utils/money.js';
import { verifiedMime } from '../../fileType.js';
import { notifyPermission, notifyUsers } from '../../notifications.js';
import type { Actor } from '../changeLog.js';
import { ApprovalError, PORTAL_PREFIX, activeRule, reply, submitRequest, withdraw, type RequestType, type StepSpec } from '../approvals/engine.js';
import { adjustmentState, draftAdjustment, payCap, periodToPayIn, todayIst } from './payrollBridge.js';
import { isValidGstinChecksum } from '../../../utils/gstin.js';

/**
 * Expense claims and advances (WORKFLOW-GAP-RESEARCH 30 Oct 2026, 4.1).
 *
 * A person adds what they spent for work from the employee app, one bill at
 * a time, each with its photo or PDF; the bills wait in a draft until they
 * send them together as a claim, set against an advance they hold if they
 * like. The claim goes through the company's approval rule (EXPENSE_CLAIM;
 * by default the manager, then HR above ₹5,000), and an approver may allow
 * less than asked on a bill, saying why. Approved, the advance is used up
 * first; what is left is paid with salary (a draft reimbursement earning in
 * Payroll) or paid now (recorded here, and listed for Books with the GSTIN
 * and tax kept for input tax credit).
 *
 * An advance is asked the same way (EMPLOYEE_ADVANCE), paid by HR, set
 * against claims as they are approved, and what is left is given back or
 * taken from salary within half the month's pay.
 *
 * Who sees what: a person sees their own only; an approver sees what waits on
 * them; HR and owners (People › Expenses) see and pay everyone's.
 */

export class MoneyError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

export type Me = { accountId: string; orgId: string; employeeId: string; correlationId: string };
export type Staff = { accountId: string; orgId: string; userId: string; correlationId: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 1_000_000;
export const BILL_MAX_BYTES = 5 * 1024 * 1024;
const BILL_MIMES = /^(application\/pdf|image\/(jpeg|png|webp))$/;
const OPEN_CLAIM = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAYING', 'WITH_SALARY', 'PAID', 'SETTLED'];
const num = (v: unknown) => (v == null ? 0 : Number(v));
export const inr = (n: number) => `₹${round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PENDING = 'pending:';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** A small business's usual heads. Food and drink: GST credit is blocked under s.17(5), with narrow exceptions. */
const DEFAULT_CATEGORIES: Array<[string, boolean]> = [
  ['Travel', false], ['Local conveyance', false], ['Fuel', false], ['Food and meals', true], ['Hotel stay', false],
  ['Courier and postage', false], ['Phone and internet', false], ['Office supplies', false], ['Client meeting', false], ['Other', false],
];

export async function categories(accountId: string, orgId: string, opts: { all?: boolean } = {}) {
  if (!(await peoplePrisma.expenseCategory.count({ where: { orgId } }))) {
    await peoplePrisma.expenseCategory.createMany({ data: DEFAULT_CATEGORIES.map(([name, creditBlocked]) => ({ accountId, orgId, name, creditBlocked })), skipDuplicates: true });
  }
  const rows = await peoplePrisma.expenseCategory.findMany({ where: { orgId, ...(opts.all ? {} : { active: true }) }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] });
  return rows.map((c) => ({ id: c.id, name: c.name, limitPerBill: c.limitPerBill == null ? null : Number(c.limitPerBill), creditBlocked: c.creditBlocked, active: c.active }));
}

export async function saveCategory(who: { accountId: string; orgId: string }, input: { id?: string; name?: unknown; limitPerBill?: unknown; creditBlocked?: unknown; active?: unknown }) {
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new MoneyError('Name the category.');
  const limit = input.limitPerBill === '' || input.limitPerBill == null ? null : Number(input.limitPerBill);
  if (limit != null && (!Number.isFinite(limit) || limit <= 0 || limit > MAX_AMOUNT)) throw new MoneyError('A limit is an amount above nothing, or blank for none.');
  const data = { name, limitPerBill: limit == null ? null : round2(limit), creditBlocked: Boolean(input.creditBlocked), active: input.active === undefined ? true : Boolean(input.active) };
  try {
    if (input.id) {
      const r = await peoplePrisma.expenseCategory.updateMany({ where: { id: input.id, orgId: who.orgId }, data });
      if (!r.count) throw new MoneyError('No such category.', 404);
      return peoplePrisma.expenseCategory.findFirstOrThrow({ where: { id: input.id, orgId: who.orgId } });
    }
    return await peoplePrisma.expenseCategory.create({ data: { accountId: who.accountId, orgId: who.orgId, ...data } });
  } catch (e: any) {
    if (e?.code === 'P2002') throw new MoneyError(`"${name}" is already in the list.`, 409, 'DUPLICATE');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The next EXP-0001 / ADV-0001 for the company, under a lock held until the row is written. */
async function nextNumber(tx: Prisma.TransactionClient, orgId: string, kind: 'claim' | 'advance') {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-money-number:${kind}:${orgId}`}))`;
  const prefix = kind === 'claim' ? 'EXP' : 'ADV';
  const last = kind === 'claim'
    ? await tx.expenseClaim.findFirst({ where: { orgId }, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], select: { number: true } })
    : await tx.employeeAdvance.findFirst({ where: { orgId }, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], select: { number: true } });
  const n = Number(String(last?.number || '').replace(/^\D+-/, '')) || 0;
  return `${prefix}-${String(n + 1).padStart(4, '0')}`;
}

const lock = (tx: Prisma.TransactionClient, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

async function personOf(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, name: true, code: true, userId: true, status: true } });
  if (!e) throw new MoneyError('No such person.', 404);
  return e;
}

/** Who asks: their CLOR sign-in when linked, else the employee app's `portal:<id>`. */
const requesterOf = (e: { id: string; userId: string | null }) => e.userId || `${PORTAL_PREFIX}${e.id}`;
const requesterIds = (e: { id: string; userId: string | null }) => [`${PORTAL_PREFIX}${e.id}`, ...(e.userId ? [e.userId] : [])];

/** The default rule for a money request when the company has none: the one a small business would set. */
const DEFAULT_RULES: Record<'EXPENSE_CLAIM' | 'EMPLOYEE_ADVANCE' | 'SALARY_ADVANCE', { name: string; steps: StepSpec[] }> = {
  EXPENSE_CLAIM: { name: 'Expense claims (default: the manager, then HR once the month passes ₹5,000)', steps: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
    { order: 2, approver: { kind: 'HR' }, condition: { field: 'monthTotal', op: 'gt', value: '5000' }, dueDays: 2, overdue: { action: 'REMIND' } },
  ] },
  EMPLOYEE_ADVANCE: { name: 'Advances (default: the manager, then HR once the month passes ₹5,000)', steps: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
    { order: 2, approver: { kind: 'HR' }, condition: { field: 'monthTotal', op: 'gt', value: '5000' }, dueDays: 2, overdue: { action: 'REMIND' } },
  ] },
  SALARY_ADVANCE: { name: 'Salary advances (default: HR decides)', steps: [{ order: 1, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } }] },
};

export async function ensureRule(who: { accountId: string; orgId: string }, type: keyof typeof DEFAULT_RULES) {
  if (await activeRule(who.orgId, type)) return;
  /* Two people asking at once must not write two first versions. */
  await peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-rule:${type}:${who.orgId}`);
    if (await tx.approvalRule.findFirst({ where: { orgId: who.orgId, requestType: type, active: true }, select: { id: true } })) return;
    const latest = await tx.approvalRule.findFirst({ where: { orgId: who.orgId, requestType: type }, orderBy: { version: 'desc' }, select: { version: true } });
    if (latest) return; /* A rule the company retired on purpose stays retired: asking says there is no rule. */
    await tx.approvalRule.create({ data: { accountId: who.accountId, orgId: who.orgId, requestType: type, name: DEFAULT_RULES[type].name, version: 1, active: true, steps: DEFAULT_RULES[type].steps as unknown as Prisma.InputJsonValue, createdByUserId: null } });
  });
}

/** Sends a money request through the approval engine; refusals come back as plain MoneyErrors. */
export async function sendForApproval(e: { id: string; name: string; userId: string | null }, who: { accountId: string; orgId: string; correlationId: string }, type: RequestType & keyof typeof DEFAULT_RULES, title: string, payload: Record<string, unknown>, key: string) {
  await ensureRule(who, type);
  const actor: Actor = { accountId: who.accountId, orgId: who.orgId, userId: requesterOf(e), source: 'SELF_SERVICE', correlationId: who.correlationId, reason: 'Asked in the employee app' };
  try {
    return await submitRequest(actor, { requestType: type, subjectEmployeeId: e.id, title, payload: { employeeId: e.id, ...payload }, idempotencyKey: key });
  } catch (err) {
    if (err instanceof ApprovalError) throw new MoneyError(err.message, err.status, err.code);
    throw err;
  }
}

/** A link from a record to its approval request: `pending:<uuid>` until the engine names the request. */
export const pendingLink = () => randomUUID();
export const linkMatches = (stored: string | null | undefined, request: { id: string; idempotencyKey: string | null }, prefix: string) =>
  Boolean(stored) && (stored === request.id || (stored!.startsWith(PENDING) && request.idempotencyKey === `${prefix}:${stored!.slice(PENDING.length)}`));

/** Decisions the engine made since the record was read: rejected or withdrawn requests close the record. */
async function catchUp(orgId: string, kind: 'claim' | 'advance' | 'ask', rows: Array<{ id: string; status: string; approvalRequestId: string | null }>) {
  const open = rows.filter((r) => (kind === 'claim' ? r.status === 'SUBMITTED' : r.status === 'WAITING') && r.approvalRequestId && !r.approvalRequestId.startsWith(PENDING));
  if (!open.length) return false;
  const requests = await peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: open.map((r) => r.approvalRequestId!) } }, select: { id: true, status: true } });
  const by = new Map(requests.map((r) => [r.id, r.status]));
  let changed = false;
  for (const r of open) {
    const s = by.get(r.approvalRequestId!);
    if (s !== 'REJECTED' && s !== 'WITHDRAWN') continue;
    const where = { id: r.id, orgId, status: r.status };
    if (kind === 'claim') {
      /* Withdrawn: the bills go back to the person's one draft to change and send again. Not approved: closed, with the approver's reason. */
      if (s === 'WITHDRAWN') await backToDraft(orgId, r.id, 'SUBMITTED');
      else await peoplePrisma.expenseClaim.updateMany({ where, data: { status: 'REJECTED', decidedAt: new Date() } });
    } else if (kind === 'advance') {
      await peoplePrisma.employeeAdvance.updateMany({ where, data: { status: s } });
    } else {
      await peoplePrisma.salaryAdvanceAsk.updateMany({ where, data: { status: s } });
    }
    changed = true;
  }
  return changed;
}

/**
 * A claim's bills go back to be changed and sent again. A person has one
 * draft, always: when one is open already the bills join it and the old
 * claim goes; otherwise the claim becomes the draft. Either way what an
 * approver allowed is cleared, since it was allowed on the claim that is gone.
 */
async function backToDraft(orgId: string, claimId: string, from: 'SUBMITTED' | 'REJECTED') {
  const claim = await peoplePrisma.expenseClaim.findFirst({ where: { id: claimId, orgId }, select: { employeeId: true } });
  if (!claim) return;
  await peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-draft:${claim.employeeId}`);
    const c = await tx.expenseClaim.findFirst({ where: { id: claimId, orgId, status: from } });
    if (!c) return;
    await tx.expenseLine.updateMany({ where: { claimId: c.id, orgId }, data: { approvedAmount: null, cutReason: null } });
    const draft = await tx.expenseClaim.findFirst({ where: { orgId, employeeId: c.employeeId, status: 'DRAFT', id: { not: c.id } }, orderBy: { createdAt: 'asc' } });
    if (draft) {
      await tx.expenseLine.updateMany({ where: { claimId: c.id, orgId }, data: { claimId: draft.id } });
      const lines = await tx.expenseLine.findMany({ where: { claimId: draft.id, orgId }, select: { amount: true } });
      await tx.expenseClaim.update({ where: { id: draft.id }, data: { claimedTotal: round2(lines.reduce((t, l) => t + num(l.amount), 0)) } });
      await tx.expenseClaim.delete({ where: { id: c.id } });
    } else {
      await tx.expenseClaim.update({ where: { id: c.id }, data: { status: 'DRAFT', approvalRequestId: null, submittedAt: null, decidedAt: null, approvedTotal: null, advanceId: null } });
    }
  });
}

/** The person's one draft. Two left by an older build are folded into the first. */
async function theDraft(tx: Prisma.TransactionClient, orgId: string, employeeId: string) {
  const drafts = await tx.expenseClaim.findMany({ where: { orgId, employeeId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' } });
  if (drafts.length > 1) {
    for (const d of drafts.slice(1)) {
      await tx.expenseLine.updateMany({ where: { claimId: d.id, orgId }, data: { claimId: drafts[0].id } });
      await tx.expenseClaim.delete({ where: { id: d.id } });
    }
    const lines = await tx.expenseLine.findMany({ where: { claimId: drafts[0].id, orgId }, select: { amount: true } });
    return tx.expenseClaim.update({ where: { id: drafts[0].id }, data: { claimedTotal: round2(lines.reduce((t, l) => t + num(l.amount), 0)) } });
  }
  return drafts[0] || null;
}

/**
 * Claims paid with salary wait for Payroll: approved there (or paid on a
 * payslip), they are paid; cancelled or deleted there, they are to pay
 * again. Advances being taken from salary count as recovered only once
 * Payroll approves the deduction.
 */
async function syncPayroll(orgId: string, claims: Array<{ id: string; status: string; payrollAdjustmentId: string | null }>, advances: Array<{ id: string; recoveringAmount: unknown; payrollAdjustmentId: string | null }> = []) {
  let changed = false;
  for (const c of claims.filter((x) => x.status === 'WITH_SALARY' && x.payrollAdjustmentId)) {
    const st = await adjustmentState(orgId, c.payrollAdjustmentId!);
    if (st.status === 'APPROVED' || st.status === 'CONSUMED') {
      changed = (await peoplePrisma.expenseClaim.updateMany({ where: { id: c.id, orgId, status: 'WITH_SALARY' }, data: { status: 'PAID' } })).count > 0 || changed;
    } else if (st.status === 'CANCELLED' || st.status === 'GONE') {
      changed = (await peoplePrisma.expenseClaim.updateMany({ where: { id: c.id, orgId, status: 'WITH_SALARY' }, data: { status: 'APPROVED', payMode: null, paidOn: null, paidByUserId: null, payrollAdjustmentId: null, payrollPeriodName: null } })).count > 0 || changed;
    }
  }
  for (const a of advances.filter((x) => num(x.recoveringAmount) > 0 && x.payrollAdjustmentId)) {
    const st = await adjustmentState(orgId, a.payrollAdjustmentId!);
    if (st.status === 'DRAFT') continue;
    await peoplePrisma.$transaction(async (tx) => {
      await lock(tx, `people-money-advance-row:${a.id}`);
      const row = await tx.employeeAdvance.findFirst({ where: { id: a.id, orgId } });
      if (!row || num(row.recoveringAmount) <= 0) return;
      if (st.status === 'APPROVED' || st.status === 'CONSUMED') {
        const recovered = round2(num(row.recoveredAmount) + num(row.recoveringAmount));
        const left = advanceOpen({ ...row, recoveredAmount: recovered, recoveringAmount: 0 });
        await tx.employeeAdvance.update({ where: { id: row.id }, data: { recoveredAmount: recovered, recoveringAmount: 0, ...(left <= 0 && row.status === 'PAID' ? { status: 'CLOSED', closedAt: new Date() } : {}) } });
      } else {
        await tx.employeeAdvance.update({ where: { id: row.id }, data: { recoveringAmount: 0 } });
      }
    });
    changed = true;
  }
  return changed;
}

/** What the approvers last said on a request (a reason for not approving, a question), for the person. */
async function lastWords(orgId: string, requestIds: string[]) {
  const ids = requestIds.filter((id) => id && !id.startsWith(PENDING));
  if (!ids.length) return new Map<string, { status: string; comment: string | null; canReply: boolean }>();
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, status: true, steps: { where: { comment: { not: null }, decidedAt: { not: null } }, orderBy: { decidedAt: 'desc' }, take: 1, select: { comment: true, status: true } } } });
  return new Map(rows.map((r) => [r.id, { status: r.status, comment: r.steps[0]?.comment && r.steps[0].status !== 'SKIPPED' ? r.steps[0].comment : null, canReply: r.status === 'MORE_INFO' }]));
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

/** data:<mime>;base64,… The bytes must prove the type (A-42): a PDF, JPEG, PNG or WebP up to 5 MB. */
export function decodeBill(input: unknown): { mime: string; data: Buffer; sha256: string } | { error: string } {
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(input || ''));
  if (!m) return { error: 'The bill did not come through. Take the photo again.' };
  const mime = m[1].toLowerCase();
  if (!BILL_MIMES.test(mime)) return { error: 'A bill is a photo (JPEG, PNG, WebP) or a PDF.' };
  const data = Buffer.from(m[2], 'base64');
  if (!data.length) return { error: 'The bill is empty.' };
  if (data.length > BILL_MAX_BYTES) return { error: 'Bills up to 5 MB. Take the photo again, a little further away.' };
  if (!verifiedMime(data, mime, (t) => BILL_MIMES.test(t))) return { error: 'That file is not a photo or PDF. Upload the bill itself.' };
  return { mime, data, sha256: createHash('sha256').update(data).digest('hex') };
}

// ---------------------------------------------------------------------------
// The person's own: adding bills, sending a claim
// ---------------------------------------------------------------------------

type LineInput = { spentOn?: unknown; categoryId?: unknown; amount?: unknown; merchant?: unknown; note?: unknown; companyGstin?: unknown; supplierGstin?: unknown; taxAmount?: unknown; bill?: unknown; billName?: unknown; notDuplicate?: unknown };

export async function addLine(me: Me, input: LineInput) {
  const e = await personOf(me.orgId, me.employeeId);
  if (e.status === 'LEFT') throw new MoneyError('You have left the company, so you cannot add bills here. Ask HR.', 403);
  const spentOn = String(input.spentOn || '').slice(0, 10);
  if (!ISO.test(spentOn)) throw new MoneyError('When did you spend it?');
  if (spentOn > todayIst()) throw new MoneyError('That date is in the future.');
  if (spentOn < addDays(todayIst(), -365)) throw new MoneyError('Bills older than a year cannot be claimed here. Ask HR.');
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new MoneyError('How much did you spend?');
  if (amount > MAX_AMOUNT) throw new MoneyError('That is more than ₹10,00,000. Ask HR to pay it directly.');
  const merchant = String(input.merchant ?? '').trim().slice(0, 120);
  if (!merchant) throw new MoneyError('Where did you spend it? The shop, cab or hotel.');
  const category = await peoplePrisma.expenseCategory.findFirst({ where: { id: String(input.categoryId || ''), orgId: me.orgId, active: true } });
  if (!category) throw new MoneyError('Choose what it was for.');
  const companyGstin = Boolean(input.companyGstin);
  const supplierGstin = String(input.supplierGstin ?? '').trim().toUpperCase() || null;
  if (supplierGstin && !isValidGstinChecksum(supplierGstin)) throw new MoneyError('That GSTIN does not check out. It is 15 characters, like 29ABCDE1234F1Z5; check each one against the bill.');
  const tax = input.taxAmount === '' || input.taxAmount == null ? null : round2(Number(input.taxAmount));
  if (tax != null && (!Number.isFinite(tax) || tax < 0 || tax > amount)) throw new MoneyError('The GST on the bill is part of the amount, so it cannot be more.');
  let bill: { mime: string; data: Buffer; sha256: string } | null = null;
  if (input.bill) {
    const d = decodeBill(input.bill);
    if ('error' in d) throw new MoneyError(d.error);
    bill = d;
  }
  const note = String(input.note ?? '').trim().slice(0, 300) || null;

  return peoplePrisma.$transaction(async (tx) => {
    /* One writer per person's draft, and one per bill across the company: the same photo sent twice at once is caught. */
    await lock(tx, `people-money-draft:${me.employeeId}`);
    if (bill) {
      await lock(tx, `people-money-bill:${me.orgId}:${bill.sha256}`);
      const same = await tx.expenseBill.findMany({ where: { orgId: me.orgId, sha256: bill.sha256 }, select: { id: true } });
      if (same.length) {
        const used = await tx.expenseLine.findFirst({ where: { orgId: me.orgId, billId: { in: same.map((b) => b.id) }, claim: { status: { in: OPEN_CLAIM } } }, select: { employeeId: true, claim: { select: { number: true } } } });
        if (used) throw new MoneyError(used.employeeId === me.employeeId ? `This bill is already on ${used.claim.number}.` : 'This bill has already been claimed.', 409, 'DUPLICATE_BILL');
      }
    }
    /* Same amount, day and place: the person's own is asked about; a colleague's (one meal, two claims) goes to the approver as a flag. */
    const twins = await tx.expenseLine.findMany({ where: { orgId: me.orgId, spentOn, amount, merchant: { equals: merchant, mode: 'insensitive' }, claim: { status: { in: OPEN_CLAIM } } }, select: { id: true, employeeId: true, claim: { select: { number: true } } }, take: 5 });
    const mine = twins.find((t) => t.employeeId === me.employeeId);
    if (mine && !input.notDuplicate) {
      throw new MoneyError(`You already have ${inr(amount)} at ${merchant} on that day (${mine.claim.number}). Is this a different bill?`, 409, 'POSSIBLE_DUPLICATE');
    }
    const twin = mine || twins[0] || null;
    let claim = await theDraft(tx, me.orgId, me.employeeId);
    if (!claim) claim = await tx.expenseClaim.create({ data: { accountId: me.accountId, orgId: me.orgId, employeeId: me.employeeId, number: await nextNumber(tx, me.orgId, 'claim'), title: 'Spent for work' } });
    const billRow = bill ? await tx.expenseBill.create({ data: { accountId: me.accountId, orgId: me.orgId, employeeId: me.employeeId, name: String(input.billName || 'bill').trim().slice(0, 120) || 'bill', mime: bill.mime, size: bill.data.length, sha256: bill.sha256, data: bill.data } }) : null;
    const line = await tx.expenseLine.create({
      data: {
        accountId: me.accountId, orgId: me.orgId, claimId: claim.id, employeeId: me.employeeId, spentOn, categoryId: category.id, categoryName: category.name,
        merchant, amount, note, billId: billRow?.id ?? null, companyGstin, supplierGstin, taxAmount: tax, duplicateOf: twin ? twin.id : null,
      },
    });
    await tx.expenseClaim.update({ where: { id: claim.id }, data: { claimedTotal: round2(num(claim.claimedTotal) + amount) } });
    return { lineId: line.id, claimId: claim.id, overLimit: category.limitPerBill != null && amount > Number(category.limitPerBill) ? Number(category.limitPerBill) : null };
  });
}

export async function removeLine(me: Me, lineId: string) {
  return peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-draft:${me.employeeId}`);
    const line = await tx.expenseLine.findFirst({ where: { id: lineId, orgId: me.orgId, employeeId: me.employeeId }, include: { claim: true } });
    if (!line) throw new MoneyError('No such bill.', 404);
    if (line.claim.status !== 'DRAFT') throw new MoneyError('This bill has been sent. Withdraw the claim first.', 409);
    await tx.expenseLine.delete({ where: { id: line.id } });
    if (line.billId) await tx.expenseBill.deleteMany({ where: { id: line.billId, orgId: me.orgId } });
    const left = await tx.expenseLine.findMany({ where: { claimId: line.claimId }, select: { amount: true } });
    await tx.expenseClaim.update({ where: { id: line.claimId }, data: { claimedTotal: round2(left.reduce((t, l) => t + num(l.amount), 0)) } });
    return { ok: true };
  });
}

/** What is left on an advance: paid, less what claims used, what was given back, and what salary took or is taking. */
export const advanceOpen = (a: { amount: unknown; settledAmount: unknown; returnedAmount: unknown; recoveredAmount: unknown; recoveringAmount?: unknown }) => round2(num(a.amount) - num(a.settledAmount) - num(a.returnedAmount) - num(a.recoveredAmount) - num(a.recoveringAmount));

/** The first day of this month in India, as a moment. */
const monthStart = () => new Date(`${todayIst().slice(0, 8)}01T00:00:00+05:30`);

/**
 * What the person has sent this month (this one included), so the approval
 * rule can go by the month's total: five ₹4,000 claims are ₹20,000, not five
 * claims under ₹5,000.
 */
async function sentThisMonth(tx: Prisma.TransactionClient, orgId: string, employeeId: string, kind: 'claim' | 'advance') {
  const since = monthStart();
  if (kind === 'claim') {
    const rows = await tx.expenseClaim.findMany({ where: { orgId, employeeId, submittedAt: { gte: since }, status: { notIn: ['DRAFT', 'REJECTED'] } }, select: { claimedTotal: true } });
    return round2(rows.reduce((t, r) => t + num(r.claimedTotal), 0));
  }
  const rows = await tx.employeeAdvance.findMany({ where: { orgId, employeeId, createdAt: { gte: since }, status: { notIn: ['REJECTED', 'WITHDRAWN'] } }, select: { amount: true } });
  return round2(rows.reduce((t, r) => t + num(r.amount), 0));
}

export async function submitClaim(me: Me, claimId: string, input: { title?: unknown; advanceId?: unknown }) {
  const e = await personOf(me.orgId, me.employeeId);
  let advanceId: string | null = null;
  if (input.advanceId) {
    const adv = await peoplePrisma.employeeAdvance.findFirst({ where: { id: String(input.advanceId), orgId: me.orgId, employeeId: me.employeeId, status: 'PAID' } });
    if (!adv || advanceOpen(adv) <= 0) throw new MoneyError('That advance is not open any more.', 409);
    advanceId = adv.id;
  }
  const key = pendingLink();
  /*
   * Under the draft's lock, the bills are read and the claim is taken in one
   * go: a bill added at the same moment either makes it in, counted, or waits
   * for the next draft; never in the claim and out of its total. A double tap
   * sends one claim.
   */
  const sent = await peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-draft:${me.employeeId}`);
    const claim = await tx.expenseClaim.findFirst({ where: { id: claimId, orgId: me.orgId, employeeId: me.employeeId }, include: { lines: true } });
    if (!claim) throw new MoneyError('No such claim.', 404);
    if (claim.status !== 'DRAFT') throw new MoneyError('This claim has already been sent.', 409, 'NOT_DRAFT');
    if (!claim.lines.length) throw new MoneyError('Add a bill first.');
    const title = String(input.title ?? '').trim().slice(0, 120) || claim.title;
    const total = round2(claim.lines.reduce((t, l) => t + num(l.amount), 0));
    await tx.expenseClaim.update({ where: { id: claim.id }, data: { status: 'SUBMITTED', title, advanceId, claimedTotal: total, submittedAt: new Date(), approvalRequestId: `${PENDING}${key}` } });
    return { claim, title, total, monthTotal: await sentThisMonth(tx, me.orgId, me.employeeId, 'claim') };
  });
  const { claim, title, total, monthTotal } = sent;
  try {
    const r = await sendForApproval(e, me, 'EXPENSE_CLAIM', `${e.name}: ${title} · ${inr(total)} (${claim.number})`, { amount: total, monthTotal, claimId: claim.id, number: claim.number, bills: claim.lines.length }, `expense-claim:${key}`);
    await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, orgId: me.orgId, approvalRequestId: `${PENDING}${key}` }, data: { approvalRequestId: r.request.id } });
  } catch (err) {
    await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, orgId: me.orgId, approvalRequestId: `${PENDING}${key}` }, data: { status: 'DRAFT', submittedAt: null, approvalRequestId: null } });
    throw err;
  }
  return claimFor(me, claim.id);
}

/** The person's own request behind one of their records, for answering or withdrawing it from the app. */
async function ownRequest(me: Me, approvalRequestId: string | null) {
  if (!approvalRequestId || approvalRequestId.startsWith(PENDING)) throw new MoneyError('This is not waiting for a decision.', 409);
  const e = await personOf(me.orgId, me.employeeId);
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: approvalRequestId, orgId: me.orgId, subjectEmployeeId: e.id, requesterUserId: { in: requesterIds(e) } }, select: { id: true, requesterUserId: true } });
  if (!r) throw new MoneyError('No such request.', 404);
  return r;
}

const asMoney = async <T>(p: Promise<T>) => {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApprovalError) throw new MoneyError(err.message, err.status, err.code);
    throw err;
  }
};

export async function withdrawMine(me: Me, kind: 'claim' | 'advance' | 'ask', id: string) {
  const row = kind === 'claim'
    ? await peoplePrisma.expenseClaim.findFirst({ where: { id, orgId: me.orgId, employeeId: me.employeeId } })
    : kind === 'advance'
      ? await peoplePrisma.employeeAdvance.findFirst({ where: { id, orgId: me.orgId, employeeId: me.employeeId } })
      : await peoplePrisma.salaryAdvanceAsk.findFirst({ where: { id, orgId: me.orgId, employeeId: me.employeeId } });
  if (!row) throw new MoneyError('Not found.', 404);
  const r = await ownRequest(me, row.approvalRequestId);
  await asMoney(withdraw({ accountId: me.accountId, orgId: me.orgId, userId: r.requesterUserId, source: 'SELF_SERVICE', correlationId: me.correlationId }, r.id));
  await catchUp(me.orgId, kind, [row]);
  return { ok: true };
}

export async function answerMine(me: Me, kind: 'claim' | 'advance' | 'ask', id: string, note: string) {
  const text = String(note || '').trim();
  if (!text) throw new MoneyError('Write your answer.');
  const row = kind === 'claim'
    ? await peoplePrisma.expenseClaim.findFirst({ where: { id, orgId: me.orgId, employeeId: me.employeeId } })
    : kind === 'advance'
      ? await peoplePrisma.employeeAdvance.findFirst({ where: { id, orgId: me.orgId, employeeId: me.employeeId } })
      : await peoplePrisma.salaryAdvanceAsk.findFirst({ where: { id, orgId: me.orgId, employeeId: me.employeeId } });
  if (!row) throw new MoneyError('Not found.', 404);
  const r = await ownRequest(me, row.approvalRequestId);
  await asMoney(reply({ accountId: me.accountId, orgId: me.orgId, userId: r.requesterUserId, source: 'SELF_SERVICE', correlationId: me.correlationId }, r.id, text));
  return { ok: true };
}

/** A claim that was not approved, opened again as a draft to change and send again. */
export async function reopenClaim(me: Me, claimId: string) {
  const claim = await peoplePrisma.expenseClaim.findFirst({ where: { id: claimId, orgId: me.orgId, employeeId: me.employeeId, status: 'REJECTED' }, select: { id: true } });
  if (!claim) throw new MoneyError('Only a claim that was not approved can be opened again.', 409);
  await backToDraft(me.orgId, claim.id, 'REJECTED');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Advances asked by the person
// ---------------------------------------------------------------------------

export async function askAdvance(me: Me, input: { purpose?: unknown; amount?: unknown; neededBy?: unknown }) {
  const e = await personOf(me.orgId, me.employeeId);
  if (e.status === 'LEFT') throw new MoneyError('You have left the company. Ask HR.', 403);
  const purpose = String(input.purpose ?? '').trim().slice(0, 200);
  if (purpose.length < 3) throw new MoneyError('Say what it is for: the trip or the purchase.');
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new MoneyError('How much do you need?');
  if (amount > MAX_AMOUNT) throw new MoneyError('That is more than ₹10,00,000. Ask HR directly.');
  const neededBy = input.neededBy ? String(input.neededBy).slice(0, 10) : null;
  if (neededBy && (!ISO.test(neededBy) || neededBy < todayIst())) throw new MoneyError('The date you need it by is in the past.');
  const key = pendingLink();
  const row = await peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-advance:${me.employeeId}`);
    /* A double tap: the same ask, a moment ago, is the one already made. */
    const twin = await tx.employeeAdvance.findFirst({ where: { orgId: me.orgId, employeeId: me.employeeId, status: 'WAITING', amount, purpose, createdAt: { gte: new Date(Date.now() - 2 * 60_000) } } });
    if (twin) return { row: twin, fresh: false, monthTotal: 0 };
    const settleBy = addDays(neededBy || todayIst(), 30);
    const created = await tx.employeeAdvance.create({ data: { accountId: me.accountId, orgId: me.orgId, employeeId: me.employeeId, number: await nextNumber(tx, me.orgId, 'advance'), purpose, amount, neededBy, settleBy, status: 'WAITING', approvalRequestId: `${PENDING}${key}` } });
    return { row: created, fresh: true, monthTotal: await sentThisMonth(tx, me.orgId, me.employeeId, 'advance') };
  });
  if (!row.fresh) return row.row;
  try {
    const r = await sendForApproval(e, me, 'EMPLOYEE_ADVANCE', `${e.name}: advance ${inr(amount)} for ${purpose} (${row.row.number})`, { amount, monthTotal: row.monthTotal ?? amount, advanceId: row.row.id, number: row.row.number, purpose, neededBy }, `employee-advance:${key}`);
    await peoplePrisma.employeeAdvance.updateMany({ where: { id: row.row.id, orgId: me.orgId, approvalRequestId: `${PENDING}${key}` }, data: { approvalRequestId: r.request.id } });
  } catch (err) {
    await peoplePrisma.employeeAdvance.deleteMany({ where: { id: row.row.id, orgId: me.orgId, approvalRequestId: `${PENDING}${key}` } });
    throw err;
  }
  return peoplePrisma.employeeAdvance.findFirstOrThrow({ where: { id: row.row.id, orgId: me.orgId } });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const CLAIM_WORDS: Record<string, string> = { DRAFT: 'Not sent yet', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved, to be paid', REJECTED: 'Not approved', PAYING: 'Being paid', WITH_SALARY: 'With salary, waiting for Payroll', PAID: 'Paid', SETTLED: 'Set against your advance' };
const ADVANCE_WORDS: Record<string, string> = { WAITING: 'Waiting for approval', APPROVED: 'Approved, to be paid', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn', PAID: 'Paid to you', CLOSED: 'Settled' };

type ClaimRow = Prisma.ExpenseClaimGetPayload<{ include: { lines: true } }>;

function shapeClaim(c: ClaimRow, extra: { words?: { status: string; comment: string | null; canReply: boolean }; categories?: Map<string, { limitPerBill: number | null; creditBlocked: boolean }>; advanceNumber?: string | null; employee?: { name: string; code: string | null } } = {}) {
  const lines = [...c.lines].sort((a, b) => a.spentOn.localeCompare(b.spentOn) || a.createdAt.getTime() - b.createdAt.getTime());
  const approved = c.approvedTotal != null ? num(c.approvedTotal) : null;
  const settled = num(c.advanceSettled);
  const moreInfo = extra.words?.status === 'MORE_INFO';
  return {
    id: c.id, number: c.number, title: c.title, status: c.status,
    statusLabel: moreInfo ? 'More information asked for' : CLAIM_WORDS[c.status] || c.status,
    employeeId: c.employeeId, employeeName: extra.employee?.name ?? null, employeeCode: extra.employee?.code ?? null,
    claimed: num(c.claimedTotal), approved, advanceId: c.advanceId, advanceNumber: extra.advanceNumber ?? null, advanceSettled: settled,
    toPay: approved == null ? null : round2(approved - settled),
    payMode: c.payMode, paidOn: c.paidOn, paidMethod: c.paidMethod, paidReference: c.paidReference, payrollPeriodName: c.payrollPeriodName, booksStatus: c.booksStatus,
    submittedAt: c.submittedAt, decidedAt: c.decidedAt, createdAt: c.createdAt, approvalRequestId: c.approvalRequestId && !c.approvalRequestId.startsWith(PENDING) ? c.approvalRequestId : null,
    comment: extra.words?.comment ?? null, canReply: Boolean(extra.words?.canReply), canWithdraw: c.status === 'SUBMITTED', canReopen: c.status === 'REJECTED',
    lines: lines.map((l) => {
      const cat = l.categoryId ? extra.categories?.get(l.categoryId) : undefined;
      return {
        id: l.id, spentOn: l.spentOn, categoryId: l.categoryId, category: l.categoryName, merchant: l.merchant, amount: num(l.amount),
        approvedAmount: l.approvedAmount == null ? null : num(l.approvedAmount), cutReason: l.cutReason, note: l.note, billId: l.billId,
        companyGstin: l.companyGstin, supplierGstin: l.supplierGstin, taxAmount: l.taxAmount == null ? null : num(l.taxAmount),
        overLimit: cat?.limitPerBill != null && num(l.amount) > cat.limitPerBill ? cat.limitPerBill : null,
        creditBlocked: Boolean(cat?.creditBlocked), possibleDuplicate: Boolean(l.duplicateOf),
      };
    }),
  };
}

function shapeAdvance(a: Prisma.EmployeeAdvanceGetPayload<object>, extra: { words?: { status: string; comment: string | null; canReply: boolean }; employee?: { name: string; code: string | null } } = {}) {
  const open = a.status === 'PAID' ? advanceOpen(a) : 0;
  return {
    id: a.id, number: a.number, purpose: a.purpose, amount: num(a.amount), neededBy: a.neededBy, settleBy: a.settleBy, status: a.status,
    statusLabel: extra.words?.status === 'MORE_INFO' ? 'More information asked for' : ADVANCE_WORDS[a.status] || a.status,
    employeeId: a.employeeId, employeeName: extra.employee?.name ?? null, employeeCode: extra.employee?.code ?? null,
    paidOn: a.paidOn, paidMethod: a.paidMethod, paidReference: a.paidReference, booksStatus: a.booksStatus,
    settled: num(a.settledAmount), returned: num(a.returnedAmount), recovered: num(a.recoveredAmount), recovering: num(a.recoveringAmount), open,
    overdue: a.status === 'PAID' && open > 0 && Boolean(a.settleBy) && a.settleBy! < todayIst(),
    comment: extra.words?.comment ?? null, canReply: Boolean(extra.words?.canReply), canWithdraw: a.status === 'WAITING', createdAt: a.createdAt,
    approvalRequestId: a.approvalRequestId && !a.approvalRequestId.startsWith(PENDING) ? a.approvalRequestId : null,
  };
}

async function categoryMap(orgId: string) {
  return new Map((await peoplePrisma.expenseCategory.findMany({ where: { orgId } })).map((c) => [c.id, { limitPerBill: c.limitPerBill == null ? null : Number(c.limitPerBill), creditBlocked: c.creditBlocked }]));
}

export async function claimFor(me: Me, claimId: string) {
  const c = await peoplePrisma.expenseClaim.findFirst({ where: { id: claimId, orgId: me.orgId, employeeId: me.employeeId }, include: { lines: true } });
  if (!c) throw new MoneyError('No such claim.', 404);
  const words = await lastWords(me.orgId, [c.approvalRequestId || '']);
  return shapeClaim(c, { words: words.get(c.approvalRequestId || ''), categories: await categoryMap(me.orgId) });
}

/** Everything the employee app's money card shows: my bills, claims, advances and salary advances. */
export async function myMoney(me: Me) {
  const read = () => Promise.all([
    peoplePrisma.expenseClaim.findMany({ where: { orgId: me.orgId, employeeId: me.employeeId }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 40 }),
    peoplePrisma.employeeAdvance.findMany({ where: { orgId: me.orgId, employeeId: me.employeeId }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  if ((await peoplePrisma.expenseClaim.count({ where: { orgId: me.orgId, employeeId: me.employeeId, status: 'DRAFT' } })) > 1) {
    await peoplePrisma.$transaction(async (tx) => { await lock(tx, `people-money-draft:${me.employeeId}`); await theDraft(tx, me.orgId, me.employeeId); });
  }
  let [claims, advances] = await read();
  const a = await catchUp(me.orgId, 'claim', claims);
  const b = await catchUp(me.orgId, 'advance', advances);
  const c = await syncPayroll(me.orgId, claims, advances);
  if (a || b || c) [claims, advances] = await read();
  const [cats, catMap, words, merchants] = await Promise.all([
    categories(me.accountId, me.orgId),
    categoryMap(me.orgId),
    lastWords(me.orgId, [...claims, ...advances].map((r) => r.approvalRequestId || '')),
    /* My own past shops and cabs only: what others spent where is theirs. */
    peoplePrisma.expenseLine.findMany({ where: { orgId: me.orgId, employeeId: me.employeeId }, distinct: ['merchant'], orderBy: { createdAt: 'desc' }, take: 30, select: { merchant: true } }),
  ]);
  const advNumbers = new Map(advances.map((x) => [x.id, x.number]));
  return {
    categories: cats,
    merchants: merchants.map((m) => m.merchant),
    draft: (() => { const d = claims.filter((x) => x.status === 'DRAFT').sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0]; return d ? shapeClaim(d, { categories: catMap }) : null; })(),
    claims: claims.filter((c) => c.status !== 'DRAFT').map((c) => shapeClaim(c, { words: words.get(c.approvalRequestId || ''), categories: catMap, advanceNumber: c.advanceId ? advNumbers.get(c.advanceId) ?? null : null })),
    advances: advances.map((x) => shapeAdvance(x, { words: words.get(x.approvalRequestId || '') })),
  };
}

// ---------------------------------------------------------------------------
// Approvers and HR
// ---------------------------------------------------------------------------

/** Is this user one the request waits on, or one who decided a step of it? */
export async function involvedIn(orgId: string, requestId: string | null, userId: string) {
  if (!requestId || requestId.startsWith(PENDING)) return false;
  const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, requestId }, select: { candidateUserIds: true, decidedByUserId: true } });
  return steps.some((s) => ((s.candidateUserIds as string[]) || []).includes(userId) || s.decidedByUserId === userId);
}

/** The record behind a money request, for its approval drawer: the claim with its bills, the advance, or the salary advance with the pay cap. */
export async function detailForRequest(orgId: string, requestId: string, userId: string, mayViewAll: boolean) {
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId }, select: { id: true, requestType: true, subjectEmployeeId: true, status: true, currentStep: true, idempotencyKey: true, payload: true, steps: { select: { candidateUserIds: true, status: true, order: true } } } });
  if (!request) throw new MoneyError('No such request.', 404);
  /* What the person had sent this month when this one was asked: five small claims show as the month they make. */
  const monthTotal = Number((request.payload as any)?.monthTotal) || null;
  if (!mayViewAll && !(await involvedIn(orgId, requestId, userId))) throw new MoneyError('No such request.', 404);
  const employee = request.subjectEmployeeId ? await peoplePrisma.employee.findFirst({ where: { id: request.subjectEmployeeId, orgId }, select: { name: true, code: true } }) : null;
  const waitingOnMe = request.status === 'WAITING' && request.steps.some((s) => s.status === 'WAITING' && s.order === request.currentStep && ((s.candidateUserIds as string[]) || []).includes(userId));
  const linkOr = (prefix: string) => ({ OR: [{ approvalRequestId: request.id }, ...(request.idempotencyKey?.startsWith(`${prefix}:`) ? [{ approvalRequestId: `${PENDING}${request.idempotencyKey.slice(prefix.length + 1)}` }] : [])] });
  if (request.requestType === 'EXPENSE_CLAIM') {
    const c = await peoplePrisma.expenseClaim.findFirst({ where: { orgId, ...linkOr('expense-claim') }, include: { lines: true } });
    if (!c) return { kind: 'EXPENSE_CLAIM', record: null, waitingOnMe };
    const adv = c.advanceId ? await peoplePrisma.employeeAdvance.findFirst({ where: { id: c.advanceId, orgId } }) : null;
    return { kind: 'EXPENSE_CLAIM', waitingOnMe, monthTotal, record: shapeClaim(c, { categories: await categoryMap(orgId), advanceNumber: adv?.number ?? null, employee: employee ?? undefined }), advance: adv ? shapeAdvance(adv) : null };
  }
  if (request.requestType === 'EMPLOYEE_ADVANCE') {
    const a = await peoplePrisma.employeeAdvance.findFirst({ where: { orgId, ...linkOr('employee-advance') } });
    const others = a ? await peoplePrisma.employeeAdvance.findMany({ where: { orgId, employeeId: a.employeeId, status: 'PAID', id: { not: a.id } } }) : [];
    return { kind: 'EMPLOYEE_ADVANCE', waitingOnMe, record: a ? shapeAdvance(a, { employee: employee ?? undefined }) : null, openElsewhere: round2(others.reduce((t, o) => t + advanceOpen(o), 0)) };
  }
  if (request.requestType === 'SALARY_ADVANCE') {
    const { askDetail } = await import('./salaryAdvance.js');
    return { kind: 'SALARY_ADVANCE', waitingOnMe, ...(await askDetail(orgId, request, employee)) };
  }
  throw new MoneyError('Not a money request.', 404);
}

/**
 * An approver allows less than was asked on some bills, each with the reason
 * the person reads. Only someone the claim waits on now may, and only before
 * the claim is decided.
 */
export async function sanction(staff: Staff, claimId: string, input: { lines?: unknown }) {
  const claim = await peoplePrisma.expenseClaim.findFirst({ where: { id: claimId, orgId: staff.orgId }, include: { lines: true } });
  if (!claim) throw new MoneyError('No such claim.', 404);
  if (claim.status !== 'SUBMITTED' || !claim.approvalRequestId || claim.approvalRequestId.startsWith(PENDING)) throw new MoneyError('This claim is not waiting for a decision.', 409);
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: claim.approvalRequestId, orgId: staff.orgId }, include: { steps: true } });
  const step = request?.steps.find((s) => s.order === request.currentStep && s.status === 'WAITING');
  if (!request || request.status !== 'WAITING' || !step || !((step.candidateUserIds as string[]) || []).includes(staff.userId)) throw new MoneyError('This claim is not waiting on you.', 403, 'NOT_APPROVER');
  const asked = Array.isArray(input.lines) ? input.lines : [];
  const byId = new Map(claim.lines.map((l) => [l.id, l]));
  const changes: Array<{ id: string; approvedAmount: number | null; cutReason: string | null }> = [];
  for (const raw of asked as Array<Record<string, unknown>>) {
    const line = byId.get(String(raw?.id || ''));
    if (!line) throw new MoneyError('That bill is not on this claim.', 400);
    const amount = num(line.amount);
    const allowed = raw.approvedAmount === null || raw.approvedAmount === '' || raw.approvedAmount === undefined ? amount : round2(Number(raw.approvedAmount));
    if (!Number.isFinite(allowed) || allowed < 0 || allowed > amount) throw new MoneyError(`Allow between ₹0 and ${inr(amount)} for ${line.merchant}.`);
    const reason = String(raw.reason ?? '').trim().slice(0, 300) || null;
    if (allowed < amount && !reason) throw new MoneyError(`Say why less is allowed for ${line.merchant}. They read this.`);
    changes.push({ id: line.id, approvedAmount: allowed < amount ? allowed : null, cutReason: allowed < amount ? reason : null });
  }
  await peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-claim:${claim.id}`);
    const fresh = await tx.expenseClaim.findFirst({ where: { id: claim.id, orgId: staff.orgId, status: 'SUBMITTED' }, select: { id: true } });
    if (!fresh) throw new MoneyError('This claim was just decided.', 409);
    for (const c of changes) await tx.expenseLine.updateMany({ where: { id: c.id, claimId: claim.id, orgId: staff.orgId }, data: { approvedAmount: c.approvedAmount, cutReason: c.cutReason } });
  });
  const c = await peoplePrisma.expenseClaim.findFirstOrThrow({ where: { id: claim.id, orgId: staff.orgId }, include: { lines: true } });
  return shapeClaim(c, { categories: await categoryMap(staff.orgId) });
}

/**
 * Final approval of a claim: what is allowed is fixed, the advance it names
 * is used up first (under a lock on the advance, so two claims approved at
 * once never take the same rupee twice), and the rest waits to be paid.
 */
export async function approveClaim(request: { id: string; orgId: string; accountId: string; idempotencyKey: string | null }) {
  const done = await peoplePrisma.$transaction(async (tx) => {
    const claim = await tx.expenseClaim.findFirst({ where: { orgId: request.orgId, status: 'SUBMITTED', OR: [{ approvalRequestId: request.id }, ...(request.idempotencyKey?.startsWith('expense-claim:') ? [{ approvalRequestId: `${PENDING}${request.idempotencyKey.slice('expense-claim:'.length)}` }] : [])] }, include: { lines: true } });
    if (!claim) return null;
    await lock(tx, `people-money-claim:${claim.id}`);
    const approved = round2(claim.lines.reduce((t, l) => t + (l.approvedAmount == null ? num(l.amount) : num(l.approvedAmount)), 0));
    let settled = 0;
    if (claim.advanceId) {
      await lock(tx, `people-money-advance-row:${claim.advanceId}`);
      const adv = await tx.employeeAdvance.findFirst({ where: { id: claim.advanceId, orgId: request.orgId, status: 'PAID' } });
      if (adv) {
        settled = Math.min(advanceOpen(adv), approved);
        if (settled > 0) {
          const left = round2(advanceOpen(adv) - settled);
          await tx.employeeAdvance.update({ where: { id: adv.id }, data: { settledAmount: round2(num(adv.settledAmount) + settled), ...(left <= 0 ? { status: 'CLOSED', closedAt: new Date() } : {}) } });
        }
      }
    }
    const toPay = round2(approved - settled);
    const r = await tx.expenseClaim.updateMany({ where: { id: claim.id, status: 'SUBMITTED' }, data: { status: toPay > 0 ? 'APPROVED' : 'SETTLED', approvedTotal: approved, advanceSettled: settled || null, decidedAt: new Date(), approvalRequestId: request.id, booksStatus: 'TO_RECORD' } });
    if (!r.count) return null;
    return { claim, approved, settled, toPay };
  });
  if (!done) return { skipped: 'No claim waits on this request.' };
  if (done.toPay > 0) {
    const e = await peoplePrisma.employee.findFirst({ where: { id: done.claim.employeeId, orgId: request.orgId }, select: { name: true } });
    await notifyPermission(request.accountId, request.orgId, 'PEOPLE::Expenses::EDIT', { kind: 'people.expense', title: `To pay: ${e?.name || 'expenses'} ${inr(done.toPay)} (${done.claim.number})`, link: { app: 'people', screen: 'expenses' } as any }).catch(() => undefined);
  }
  return { claimId: done.claim.id, approved: done.approved, setAgainstAdvance: done.settled, toPay: done.toPay };
}

export async function approveAdvance(request: { id: string; orgId: string; accountId: string; idempotencyKey: string | null }) {
  const key = request.idempotencyKey?.startsWith('employee-advance:') ? `${PENDING}${request.idempotencyKey.slice('employee-advance:'.length)}` : null;
  const a = await peoplePrisma.employeeAdvance.findFirst({ where: { orgId: request.orgId, status: 'WAITING', OR: [{ approvalRequestId: request.id }, ...(key ? [{ approvalRequestId: key }] : [])] } });
  if (!a) return { skipped: 'No advance waits on this request.' };
  await peoplePrisma.employeeAdvance.updateMany({ where: { id: a.id, status: 'WAITING' }, data: { status: 'APPROVED', approvalRequestId: request.id } });
  await notifyPermission(request.accountId, request.orgId, 'PEOPLE::Expenses::EDIT', { kind: 'people.expense', title: `To pay: advance ${inr(num(a.amount))} (${a.number})`, link: { app: 'people', screen: 'expenses', params: { tab: 'advances' } } as any }).catch(() => undefined);
  return { advanceId: a.id, approved: num(a.amount) };
}

/** Pay an approved claim: with salary (a draft reimbursement earning in Payroll), or now (recorded here, listed for Books). */
export async function payClaim(staff: Staff, claimId: string, input: { mode?: unknown; paidOn?: unknown; method?: unknown; reference?: unknown }) {
  const mode = String(input.mode || '').toUpperCase();
  if (mode !== 'SALARY' && mode !== 'NOW') throw new MoneyError('Pay with salary, or paid now.');
  const claim = await peoplePrisma.expenseClaim.findFirst({ where: { id: claimId, orgId: staff.orgId }, include: { lines: true } });
  if (!claim) throw new MoneyError('No such claim.', 404);
  const stuck = claim.status === 'PAYING' && claim.updatedAt.getTime() < Date.now() - 120_000 && mode === 'SALARY';
  if (claim.status !== 'APPROVED' && !stuck) throw new MoneyError(['PAID', 'PAYING', 'WITH_SALARY'].includes(claim.status) ? 'This claim has already been paid.' : 'Only an approved claim can be paid.', 409, 'NOT_PAYABLE');
  const toPay = round2(num(claim.approvedTotal) - num(claim.advanceSettled));
  if (mode === 'NOW') {
    const paidOn = String(input.paidOn || todayIst()).slice(0, 10);
    if (!ISO.test(paidOn) || paidOn > todayIst()) throw new MoneyError('When was it paid? Today or before.');
    const method = String(input.method || '').toUpperCase();
    if (!['CASH', 'BANK', 'UPI'].includes(method)) throw new MoneyError('Paid by cash, bank transfer or UPI?');
    const reference = String(input.reference ?? '').trim().slice(0, 80) || null;
    const r = await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, orgId: staff.orgId, status: 'APPROVED' }, data: { status: 'PAID', payMode: 'NOW', paidOn, paidMethod: method, paidReference: reference, paidByUserId: staff.userId, booksStatus: 'TO_RECORD' } });
    if (!r.count) throw new MoneyError('This claim has already been paid.', 409, 'NOT_PAYABLE');
  } else {
    /* Taken first, so two clicks (or two people) make one payroll line. One left half-way (PAYING for over two minutes) may be taken again: the key finds the line already made. */
    const taken = await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, orgId: staff.orgId, OR: [{ status: 'APPROVED' }, { status: 'PAYING', updatedAt: { lt: new Date(Date.now() - 120_000) } }] }, data: { status: 'PAYING' } });
    if (!taken.count) throw new MoneyError('This claim has already been paid.', 409, 'NOT_PAYABLE');
    let handed;
    try {
      handed = await draftAdjustment({ accountId: staff.accountId, orgId: staff.orgId, userId: staff.userId, employeeId: claim.employeeId, key: `expense-claim:${claim.id}`, type: 'EARNING', amount: toPay, reason: `Expenses ${claim.number}: ${claim.title}` });
    } catch (e) {
      await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, status: 'PAYING' }, data: { status: 'APPROVED' } });
      throw e;
    }
    if (!handed.sent) {
      await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, status: 'PAYING' }, data: { status: 'APPROVED' } });
      throw new MoneyError(handed.why, 409, 'PAYROLL_NOT_READY');
    }
    /* Paid only once Payroll approves the line: until then it waits there (syncPayroll). */
    await peoplePrisma.expenseClaim.updateMany({ where: { id: claim.id, status: 'PAYING' }, data: { status: 'WITH_SALARY', payMode: 'SALARY', paidOn: todayIst(), paidByUserId: staff.userId, payrollAdjustmentId: handed.adjustmentId, payrollPeriodName: handed.periodName } });
  }
  const e = await peoplePrisma.employee.findFirst({ where: { id: claim.employeeId, orgId: staff.orgId }, select: { userId: true } });
  if (e?.userId) await notifyUsers(staff.accountId, staff.orgId, [e.userId], { kind: 'people.expense', title: `Paid: ${claim.number} ${inr(toPay)}`, body: mode === 'SALARY' ? 'With your salary.' : null }).catch(() => undefined);
  const fresh = await peoplePrisma.expenseClaim.findFirstOrThrow({ where: { id: claim.id, orgId: staff.orgId }, include: { lines: true } });
  return shapeClaim(fresh, { categories: await categoryMap(staff.orgId) });
}

export async function payAdvance(staff: Staff, advanceId: string, input: { paidOn?: unknown; method?: unknown; reference?: unknown }) {
  const paidOn = String(input.paidOn || todayIst()).slice(0, 10);
  if (!ISO.test(paidOn) || paidOn > todayIst()) throw new MoneyError('When was it paid? Today or before.');
  const method = String(input.method || '').toUpperCase();
  if (!['CASH', 'BANK', 'UPI'].includes(method)) throw new MoneyError('Paid by cash, bank transfer or UPI?');
  const r = await peoplePrisma.employeeAdvance.updateMany({ where: { id: advanceId, orgId: staff.orgId, status: 'APPROVED' }, data: { status: 'PAID', paidOn, paidMethod: method, paidReference: String(input.reference ?? '').trim().slice(0, 80) || null, paidByUserId: staff.userId, booksStatus: 'TO_RECORD' } });
  if (!r.count) {
    const a = await peoplePrisma.employeeAdvance.findFirst({ where: { id: advanceId, orgId: staff.orgId }, select: { status: true } });
    if (!a) throw new MoneyError('No such advance.', 404);
    throw new MoneyError(a.status === 'PAID' || a.status === 'CLOSED' ? 'This advance has already been paid.' : 'Only an approved advance can be paid.', 409, 'NOT_PAYABLE');
  }
  return shapeAdvance(await peoplePrisma.employeeAdvance.findFirstOrThrow({ where: { id: advanceId, orgId: staff.orgId } }));
}

/** What is left of an advance comes back: given back in cash, or taken from salary within half the month's pay. */
export async function closeAdvance(staff: Staff, advanceId: string, how: 'RETURNED' | 'RECOVER', input: { amount?: unknown } = {}) {
  const out = await peoplePrisma.$transaction(async (tx) => {
    await lock(tx, `people-money-advance-row:${advanceId}`);
    const a = await tx.employeeAdvance.findFirst({ where: { id: advanceId, orgId: staff.orgId } });
    if (!a) throw new MoneyError('No such advance.', 404);
    if (a.status !== 'PAID') throw new MoneyError('Only an advance that was paid and is still open can be settled.', 409, 'NOT_OPEN');
    if (how === 'RECOVER' && num(a.recoveringAmount) > 0) throw new MoneyError(`${inr(num(a.recoveringAmount))} of this advance is already waiting in Payroll. Approve or cancel it there first.`, 409, 'RECOVERY_WAITING');
    const open = advanceOpen(a);
    if (open <= 0) throw new MoneyError(num(a.recoveringAmount) > 0 ? 'The rest of this advance is already waiting in Payroll.' : 'Nothing is left on this advance.', 409, 'NOT_OPEN');
    if (how === 'RETURNED') {
      const amount = input.amount === undefined || input.amount === '' ? open : round2(Number(input.amount));
      if (!Number.isFinite(amount) || amount <= 0 || amount > open) throw new MoneyError(`Given back: between ₹1 and ${inr(open)}.`);
      const left = round2(open - amount);
      await tx.employeeAdvance.update({ where: { id: a.id }, data: { returnedAmount: round2(num(a.returnedAmount) + amount), ...(left <= 0 && num(a.recoveringAmount) <= 0 ? { status: 'CLOSED', closedAt: new Date() } : {}) } });
      return { returned: amount, left };
    }
    const period = await periodToPayIn(staff.orgId);
    const already = period ? (await adjustmentState(staff.orgId, `advance-recover:${a.id}:${period.id}`)).status : 'GONE';
    if (period && already !== 'GONE' && already !== 'CANCELLED') {
      throw new MoneyError(`Some of this advance already comes off ${period.name}'s pay. Take the rest next month, or ask for it back.`, 409, 'RECOVERY_WAITING');
    }
    /* The room counts every deduction already added for the month, waiting or approved, and draft loans too. */
    const cap = await payCap(staff.orgId, a.employeeId);
    const amount = cap ? Math.min(open, cap.room) : open;
    if (amount <= 0) throw new MoneyError("Nothing more can come off this month's pay: deductions already reach half of it. Ask for it back, or try next month.", 409, 'OVER_CAP');
    const handed = await draftAdjustment({ accountId: staff.accountId, orgId: staff.orgId, userId: staff.userId, employeeId: a.employeeId, key: `advance-recover:${a.id}:<period>`, type: 'DEDUCTION', amount, reason: `Advance ${a.number} not used: ${a.purpose}` });
    if (!handed.sent) throw new MoneyError(handed.why, 409, 'PAYROLL_NOT_READY');
    /* Counted as recovered once Payroll approves it (syncPayroll); until then it is "being taken from salary". */
    await tx.employeeAdvance.update({ where: { id: a.id }, data: { recoveringAmount: amount, payrollAdjustmentId: handed.adjustmentId } });
    return { recovered: amount, left: round2(open - amount), periodName: handed.periodName, capped: amount < open };
  }, { timeout: 30_000 });
  return { ...out, advance: shapeAdvance(await peoplePrisma.employeeAdvance.findFirstOrThrow({ where: { id: advanceId, orgId: staff.orgId } })) };
}

/** HR's lists: claims by status, and advances. */
export async function listClaims(orgId: string, filter: { status?: string; employeeId?: string }) {
  const where: Prisma.ExpenseClaimWhereInput = { orgId, status: { not: 'DRAFT' }, ...(filter.employeeId ? { employeeId: filter.employeeId } : {}) };
  if (filter.status === 'TO_PAY') where.status = 'APPROVED';
  else if (filter.status === 'WAITING') where.status = 'SUBMITTED';
  else if (filter.status === 'BOOKS') Object.assign(where, { status: { in: DECIDED }, booksStatus: 'TO_RECORD' });
  else if (filter.status === 'DONE') where.status = { in: ['PAID', 'SETTLED', 'WITH_SALARY'] };
  let rows = await peoplePrisma.expenseClaim.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 500 });
  if ((await catchUp(orgId, 'claim', rows)) || (await syncPayroll(orgId, rows))) rows = await peoplePrisma.expenseClaim.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 500 });
  const [people, catMap, advs] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } }),
    categoryMap(orgId),
    peoplePrisma.employeeAdvance.findMany({ where: { orgId, id: { in: rows.map((r) => r.advanceId).filter(Boolean) as string[] } }, select: { id: true, number: true } }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const advNo = new Map(advs.map((a) => [a.id, a.number]));
  return rows.map((c) => shapeClaim(c, { categories: catMap, employee: byId.get(c.employeeId), advanceNumber: c.advanceId ? advNo.get(c.advanceId) ?? null : null }));
}

export async function listAdvances(orgId: string) {
  let rows = await peoplePrisma.employeeAdvance.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 500 });
  if ((await catchUp(orgId, 'advance', rows)) || (await syncPayroll(orgId, [], rows))) rows = await peoplePrisma.employeeAdvance.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 500 });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p]));
  return rows.map((a) => shapeAdvance(a, { employee: people.get(a.employeeId) }));
}

export async function claimForStaff(orgId: string, claimId: string) {
  const first = await peoplePrisma.expenseClaim.findFirst({ where: { id: claimId, orgId, status: { not: 'DRAFT' } }, include: { lines: true } });
  if (!first) throw new MoneyError('No such claim.', 404);
  const c = (await syncPayroll(orgId, [first])) ? await peoplePrisma.expenseClaim.findFirstOrThrow({ where: { id: claimId, orgId }, include: { lines: true } }) : first;
  const e = await peoplePrisma.employee.findFirst({ where: { id: c.employeeId, orgId }, select: { name: true, code: true } });
  return shapeClaim(c, { categories: await categoryMap(orgId), employee: e ?? undefined });
}

/** Marked as entered in Books: the paid-now claims and advances someone has posted there by hand. */
export async function markRecorded(orgId: string, input: { claimIds?: unknown; advanceIds?: unknown }) {
  const claimIds = Array.isArray(input.claimIds) ? input.claimIds.map(String).slice(0, 500) : [];
  const advanceIds = Array.isArray(input.advanceIds) ? input.advanceIds.map(String).slice(0, 500) : [];
  const [a, b] = await Promise.all([
    claimIds.length ? peoplePrisma.expenseClaim.updateMany({ where: { orgId, id: { in: claimIds }, booksStatus: 'TO_RECORD' }, data: { booksStatus: 'RECORDED' } }) : { count: 0 },
    advanceIds.length ? peoplePrisma.employeeAdvance.updateMany({ where: { orgId, id: { in: advanceIds }, booksStatus: 'TO_RECORD' }, data: { booksStatus: 'RECORDED' } }) : { count: 0 },
  ]);
  return { recorded: a.count + b.count };
}

/** A bill's file: for its owner, someone the claim waits on or decided, or HR. */
export async function billFile(orgId: string, billId: string, who: { employeeId?: string; userId?: string; mayViewAll?: boolean }) {
  const bill = await peoplePrisma.expenseBill.findFirst({ where: { id: billId, orgId } });
  if (!bill) throw new MoneyError('No such bill.', 404);
  if (who.employeeId) {
    if (bill.employeeId !== who.employeeId) throw new MoneyError('No such bill.', 404);
  } else if (!who.mayViewAll) {
    const line = await peoplePrisma.expenseLine.findFirst({ where: { orgId, billId }, select: { claim: { select: { approvalRequestId: true } } } });
    if (!line || !(await involvedIn(orgId, line.claim.approvalRequestId, who.userId || ''))) throw new MoneyError('No such bill.', 404);
  }
  return { name: bill.name, mime: bill.mime, data: Buffer.from(bill.data) };
}

// ---------------------------------------------------------------------------
// Reports and the Books list
// ---------------------------------------------------------------------------

const DECIDED = ['APPROVED', 'PAYING', 'WITH_SALARY', 'PAID', 'SETTLED'];

/** Approved spend by person, category and month (by the day on the bill), and the advances still open. */
export async function report(orgId: string, range: { from?: string; to?: string }) {
  const from = range.from && ISO.test(range.from) ? range.from : addDays(todayIst(), -365);
  const to = range.to && ISO.test(range.to) ? range.to : todayIst();
  const lines = await peoplePrisma.expenseLine.findMany({ where: { orgId, spentOn: { gte: from, lte: to }, claim: { status: { in: DECIDED } } }, select: { employeeId: true, categoryName: true, spentOn: true, amount: true, approvedAmount: true, taxAmount: true, companyGstin: true } });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(lines.map((l) => l.employeeId))] } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p]));
  const sum = (key: (l: (typeof lines)[number]) => string) => {
    const m = new Map<string, { key: string; amount: number; bills: number; gst: number }>();
    for (const l of lines) {
      const k = key(l);
      const row = m.get(k) || { key: k, amount: 0, bills: 0, gst: 0 };
      row.amount = round2(row.amount + (l.approvedAmount == null ? num(l.amount) : num(l.approvedAmount)));
      row.bills += 1;
      if (l.companyGstin) row.gst = round2(row.gst + num(l.taxAmount));
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const byPerson = sum((l) => l.employeeId).map((r) => ({ ...r, name: people.get(r.key)?.name || 'Unknown', code: people.get(r.key)?.code || null }));
  const byMonth = sum((l) => l.spentOn.slice(0, 7)).sort((a, b) => b.key.localeCompare(a.key));
  const advances = (await listAdvances(orgId)).filter((a) => a.status === 'PAID' && a.open > 0);
  const waiting = await peoplePrisma.expenseClaim.aggregate({ where: { orgId, status: 'SUBMITTED' }, _sum: { claimedTotal: true }, _count: true });
  const toPay = await peoplePrisma.expenseClaim.findMany({ where: { orgId, status: 'APPROVED' }, select: { approvedTotal: true, advanceSettled: true } });
  return {
    from, to,
    total: round2(lines.reduce((t, l) => t + (l.approvedAmount == null ? num(l.amount) : num(l.approvedAmount)), 0)),
    byPerson, byCategory: sum((l) => l.categoryName), byMonth,
    openAdvances: advances, openAdvanceTotal: round2(advances.reduce((t, a) => t + a.open, 0)),
    waiting: { count: waiting._count, amount: num(waiting._sum.claimedTotal) },
    toPay: { count: toPay.length, amount: round2(toPay.reduce((t, c) => t + num(c.approvedTotal) - num(c.advanceSettled), 0)) },
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  /* A cell that starts like a formula is quoted as text, so a spreadsheet never runs it. */
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/**
 * Line by line, for a spreadsheet or for entering in Books. `books`: every
 * decided bill not yet marked as entered there, however it was paid (with
 * salary, now, or set against an advance), with what Books needs for input
 * tax credit (the supplier's GSTIN, the GST on the bill, whether the bill
 * names the company, whether credit is usually blocked), the advance a claim
 * used and how much of it, and the advances paid out.
 */
export async function exportCsv(orgId: string, kind: 'claims' | 'books', range: { from?: string; to?: string }) {
  const from = range.from && ISO.test(range.from) ? range.from : addDays(todayIst(), -365);
  const to = range.to && ISO.test(range.to) ? range.to : todayIst();
  const where: Prisma.ExpenseClaimWhereInput = kind === 'books' ? { orgId, status: { in: DECIDED }, booksStatus: 'TO_RECORD' } : { orgId, status: { in: DECIDED }, lines: { some: { spentOn: { gte: from, lte: to } } } };
  const claims = await peoplePrisma.expenseClaim.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'asc' }, take: 5000 });
  const [people, catMap, advs] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(claims.map((c) => c.employeeId))] } }, select: { id: true, name: true, code: true } }),
    categoryMap(orgId),
    peoplePrisma.employeeAdvance.findMany({ where: { orgId, id: { in: claims.map((c) => c.advanceId).filter(Boolean) as string[] } }, select: { id: true, number: true } }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const advNo = new Map(advs.map((a) => [a.id, a.number]));
  const how = (c: (typeof claims)[number]) => (c.payMode === 'SALARY' ? `With salary${c.payrollPeriodName ? ` (${c.payrollPeriodName})` : ''}${c.status === 'WITH_SALARY' ? ', waiting for Payroll' : ''}` : c.payMode === 'NOW' ? 'Paid now' : c.status === 'SETTLED' ? 'Set against advance' : 'Not paid yet');
  const rows: unknown[][] = [['Claim', 'Employee', 'Employee ID', 'Bill date', 'Category', 'Spent at', 'Claimed', 'Approved', 'Bill in company GSTIN', 'Supplier GSTIN', 'GST on bill', 'GST credit usually blocked', 'Advance used', 'Set against advance', 'Paid', 'Paid on', 'Paid by', 'Reference']];
  for (const c of claims) {
    const lines = [...c.lines].sort((a, b) => a.spentOn.localeCompare(b.spentOn));
    lines.forEach((l, i) => {
      if (kind === 'claims' && (l.spentOn < from || l.spentOn > to)) return;
      rows.push([
        c.number, byId.get(c.employeeId)?.name || '', byId.get(c.employeeId)?.code || '', l.spentOn, l.categoryName, l.merchant, num(l.amount).toFixed(2),
        (l.approvedAmount == null ? num(l.amount) : num(l.approvedAmount)).toFixed(2), l.companyGstin ? 'Yes' : 'No', l.supplierGstin || '', l.taxAmount == null ? '' : num(l.taxAmount).toFixed(2),
        l.categoryId && catMap.get(l.categoryId)?.creditBlocked ? 'Yes' : 'No',
        /* The set-off is the claim's, so it is written once, on its first bill. */
        c.advanceId ? advNo.get(c.advanceId) || '' : '', i === 0 && num(c.advanceSettled) ? num(c.advanceSettled).toFixed(2) : '',
        how(c), c.paidOn || '', c.paidMethod || '', c.paidReference || '',
      ]);
    });
  }
  if (kind === 'books') {
    const advances = await peoplePrisma.employeeAdvance.findMany({ where: { orgId, status: { in: ['PAID', 'CLOSED'] }, booksStatus: 'TO_RECORD' }, orderBy: { createdAt: 'asc' } });
    const more = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: advances.map((a) => a.employeeId) } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p]));
    for (const a of advances) rows.push([a.number, more.get(a.employeeId)?.name || '', more.get(a.employeeId)?.code || '', a.paidOn || '', 'Advance to employee', a.purpose, num(a.amount).toFixed(2), num(a.amount).toFixed(2), 'No', '', '', 'No', '', '', 'Paid now', a.paidOn || '', a.paidMethod || '', a.paidReference || '']);
  }
  return csv(rows);
}
