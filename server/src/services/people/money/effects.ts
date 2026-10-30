import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { ApprovalError, beforeApproving, onApproved } from '../approvals/engine.js';
import { approveAdvance, approveClaim } from './expenses.js';
import { approveAsk } from './salaryAdvance.js';

/**
 * What approving a money request does. Each effect finds its record by the
 * request (or, while the request was still being made, by the key it was
 * made with), so a request typed by hand through the generic route, with no
 * record behind it, never pays anyone: it is refused before it is approved.
 */

const PENDING = 'pending:';
const linkWhere = (request: { id: string; idempotencyKey: string | null }, prefix: string) => ({
  OR: [{ approvalRequestId: request.id }, ...(request.idempotencyKey?.startsWith(`${prefix}:`) ? [{ approvalRequestId: `${PENDING}${request.idempotencyKey.slice(prefix.length + 1)}` }] : [])],
});

export function registerMoneyEffects() {
  onApproved('EXPENSE_CLAIM', ({ request }) => approveClaim(request));
  onApproved('EMPLOYEE_ADVANCE', ({ request }) => approveAdvance(request));
  onApproved('SALARY_ADVANCE', ({ request, actor }) => approveAsk(request, actor.userId || request.requesterUserId));

  beforeApproving('EXPENSE_CLAIM', async (request) => {
    const c = await peoplePrisma.expenseClaim.findFirst({ where: { orgId: request.orgId, ...linkWhere(request, 'expense-claim') }, select: { status: true } });
    if (!c) throw new ApprovalError('No claim was sent with this request. Reject it.', 409, 'NO_RECORD');
    if (c.status !== 'SUBMITTED') throw new ApprovalError('This claim is no longer waiting. Reject the request.', 409, 'STALE');
  });
  beforeApproving('EMPLOYEE_ADVANCE', async (request) => {
    const a = await peoplePrisma.employeeAdvance.findFirst({ where: { orgId: request.orgId, ...linkWhere(request, 'employee-advance') }, select: { status: true } });
    if (!a) throw new ApprovalError('No advance was asked with this request. Reject it.', 409, 'NO_RECORD');
    if (a.status !== 'WAITING') throw new ApprovalError('This advance is no longer waiting. Reject the request.', 409, 'STALE');
  });
  beforeApproving('SALARY_ADVANCE', async (request) => {
    const a = await peoplePrisma.salaryAdvanceAsk.findFirst({ where: { orgId: request.orgId, ...linkWhere(request, 'salary-advance') }, select: { status: true } });
    if (!a) throw new ApprovalError('No salary advance was asked with this request. Reject it.', 409, 'NO_RECORD');
    if (a.status !== 'WAITING') throw new ApprovalError('This salary advance is no longer waiting. Reject the request.', 409, 'STALE');
  });
}

/** Salary advances whose request was rejected or withdrawn since they were read. */
export async function catchUpAsks(orgId: string, employeeId?: string) {
  const open = await peoplePrisma.salaryAdvanceAsk.findMany({ where: { orgId, status: 'WAITING', ...(employeeId ? { employeeId } : {}), approvalRequestId: { not: null } }, select: { id: true, approvalRequestId: true } });
  const ids = open.map((a) => a.approvalRequestId!).filter((id) => !id.startsWith(PENDING));
  if (!ids.length) return;
  const closed = await peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: ids }, status: { in: ['REJECTED', 'WITHDRAWN'] } }, select: { id: true, status: true } });
  for (const r of closed) await peoplePrisma.salaryAdvanceAsk.updateMany({ where: { orgId, approvalRequestId: r.id, status: 'WAITING' }, data: { status: r.status } });
}
