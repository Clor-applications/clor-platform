import { it, expect, vi, afterAll } from 'vitest';

/* The approver's role is checked elsewhere (governance.test.ts); this is about the race alone. */
vi.mock('../services/access.js', () => ({ resolveRoleIds: async () => ['role-race'] }));

const { prisma } = await import('../utils/prisma.js');
const { decide } = await import('../services/approvals.js');

const scope = { accountId: `acc-race-${Date.now()}`, orgId: `org-race-${Date.now()}` };
afterAll(async () => {
  await prisma.approvalRequest.deleteMany({ where: scope });
  await prisma.approvalRule.deleteMany({ where: scope });
});

/*
 * A-12: decide() read "still pending" and then wrote the decision as two
 * steps. Called at the same moment by two approvers it let both through —
 * nine pairs in ten on the old code (evidence/A-12/race-probe-before.txt) —
 * and the route posted the invoice to the journal twice. The claim is now
 * conditional: exactly one decision lands.
 */
it('lets exactly one of two simultaneous decisions land', async () => {
  let doubles = 0;
  for (let i = 0; i < 10; i++) {
    const rule = await prisma.approvalRule.create({ data: { ...scope, docType: 'INVOICE', name: `race ${i}`, minAmount: 0, approverRoleId: 'role-race', createdByUserId: 'raiser' } });
    const req = await prisma.approvalRequest.create({ data: { ...scope, branchId: 'b', ruleId: rule.id, docType: 'INVOICE', docId: `doc-${i}`, amount: 1, requestedByUserId: 'raiser', status: 'PENDING' } });
    const call = (userId: string) => decide({ ...scope, branchId: 'b', userId, requestId: req.id, approve: true }).then(() => 'won', (e) => String(e.status));
    const out = await Promise.all([call('approver-1'), call('approver-2')]);
    if (out.filter((o) => o === 'won').length !== 1) doubles++;
    expect(out.sort()).toEqual(['409', 'won']);
  }
  expect(doubles).toBe(0);
});
