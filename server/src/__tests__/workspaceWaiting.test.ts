import { afterAll, describe, expect, it, vi } from 'vitest';

/*
 * Workspace, Overview: what waits on this person in each app (services/
 * workspace/waiting.ts). The apps' own rules are tested with each app; this
 * is about what is asked, what is counted, and that only what the reader may
 * decide, and did not make, is counted.
 */
const state = vi.hoisted(() => ({ entitled: new Set(['people', 'accounting', 'payroll']), mayApprove: true, peopleFails: false, payrollWhere: [] as any[] }));
vi.mock('../services/subscriptions.js', () => ({ isAppEntitled: async (_a: string, app: string) => state.entitled.has(app) }));
vi.mock('../services/features.js', () => ({ isFeatureEnabled: async () => true }));
vi.mock('../services/access.js', () => ({ resolveRoleIds: async () => ['role-ws'] }));
vi.mock('../middleware/rbac.js', () => ({ authorize: async () => (state.mayApprove ? null : { status: 403, body: {} }) }));
vi.mock('../services/people/inbox.js', () => ({
  waitingFor: async () => {
    if (state.peopleFails) throw new Error('down');
    return { waiting: 3, approvals: 2, tasks: 1, counts: {} };
  },
}));
const counter = (n: number) => ({ count: async (q: any) => (state.payrollWhere.push(q.where), n) });
vi.mock('../utils/payrollPrisma.js', () => ({ payrollPrisma: { payrollRun: counter(1), bankDetailChange: counter(0), salaryRevision: counter(2), finalSettlement: counter(0) } }));

const { prisma } = await import('../utils/prisma.js');
const { workspaceWaiting } = await import('../services/workspace/waiting.js');

const scope = { accountId: `acc-ws-${Date.now()}`, orgId: `org-ws-${Date.now()}` };
const req = { tenant: { ...scope, branchId: 'b' }, auth: { userId: 'me' } } as any;
afterAll(async () => {
  await prisma.approvalRequest.deleteMany({ where: scope });
  await prisma.approvalRule.deleteMany({ where: scope });
});

describe('what waits for me, across apps', () => {
  it('counts People, Books and Payroll items I may decide, not what I raised, each with the screen that owns it', async () => {
    const mine = await prisma.approvalRule.create({ data: { ...scope, docType: 'INVOICE', name: 'ws', minAmount: 0, approverRoleId: 'role-ws', createdByUserId: 'x' } });
    const other = await prisma.approvalRule.create({ data: { ...scope, docType: 'BILL', name: 'ws other', minAmount: 0, approverRoleId: 'role-else', createdByUserId: 'x' } });
    const add = (ruleId: string, by: string, docId: string, status = 'PENDING') =>
      prisma.approvalRequest.create({ data: { ...scope, branchId: 'b', ruleId, docType: 'INVOICE', docId, amount: 1, requestedByUserId: by, status } });
    await add(mine.id, 'raiser', 'd1');
    await add(mine.id, 'raiser', 'd2');
    await add(mine.id, 'me', 'd3'); /* raised by me: not mine to approve */
    await add(mine.id, 'raiser', 'd4', 'APPROVED'); /* decided */
    await add(other.id, 'raiser', 'd5'); /* another role's */

    const w = await workspaceWaiting(req);
    expect(w.unanswered).toEqual([]);
    const by = Object.fromEntries(w.sources.map((s) => [s.key, s]));
    expect(by['people.approvals']).toMatchObject({ count: 2, open: { app: 'people', screen: 'approvals' } });
    expect(by['people.tasks']).toMatchObject({ count: 1, label: 'task on your name', open: { screen: 'approvals', params: { tab: 'tasks' } } });
    expect(by['books.approvals']).toMatchObject({ count: 2, label: 'documents to approve', open: { app: 'accounting', screen: 'approvals' } });
    expect(by['payroll.runs']).toMatchObject({ count: 1, label: 'payroll to approve', open: { app: 'payroll', screen: 'runs' } });
    expect(by['payroll.revisions']).toMatchObject({ count: 2, open: { screen: 'revisions' } });
    /* Nothing waiting is no line. */
    expect(by['payroll.bank']).toBeUndefined();
    expect(w.total).toBe(2 + 1 + 2 + 1 + 2);
    /* Maker-checker: what I made is never counted for me. */
    expect(state.payrollWhere.every((q) => JSON.stringify(q).includes('"not":"me"'))).toBe(true);
  });

  it('asks only apps the account has, counts Payroll only with the right to approve, and leaves out an app that does not answer', async () => {
    state.entitled = new Set(['people', 'payroll']);
    state.mayApprove = false;
    state.peopleFails = true;
    try {
      const w = await workspaceWaiting(req);
      expect(w.sources).toEqual([]);
      expect(w.total).toBe(0);
      expect(w.unanswered).toEqual(['people']);
    } finally {
      state.entitled = new Set(['people', 'accounting', 'payroll']);
      state.mayApprove = true;
      state.peopleFails = false;
    }
  });
});
