import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Row-level security on every People table this build adds (docs/people/02-PRD.md
 * FND-01): the policy fails closed (no company set, no bypass: nothing), and
 * one company never reads another's rows through the application client.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `rls.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `RLS Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
}

/* Every table this build added, with how to make one row in it. */
const TABLES: Array<{ table: string; model: string; make: (c: Ctx, employeeId: string) => Record<string, unknown> }> = [
  { table: 'EmploymentEpisode', model: 'employmentEpisode', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, seq: 9, startDate: '2026-01-01' }) },
  { table: 'ChangeLog', model: 'changeLog', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, entity: 'Employee', entityId: employeeId, employeeId, field: 'x', source: 'API', correlationId: `t-${rnd()}` }) },
  { table: 'OutboxEvent', model: 'outboxEvent', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, name: 'people.employee.updated.v1', employeeId, correlationId: `t-${rnd()}`, payload: {} }) },
  { table: 'LegalEntity', model: 'legalEntity', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `LE ${rnd()}` }) },
  { table: 'Establishment', model: 'establishment', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `Est ${rnd()}`, state: 'Karnataka' }) },
  { table: 'ScheduledChange', model: 'scheduledChange', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, field: 'departmentId', effectiveOn: '2099-01-01', correlationId: `t-${rnd()}` }) },
  { table: 'EmployeeIdentity', model: 'employeeIdentity', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, aadhaarLast4: '1111' }) },
  { table: 'AccessLog', model: 'accessLog', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, what: 'STATUTORY', entityId: employeeId, employeeId, userId: 'u' }) },
  /* Shift swaps and request types HR makes (FEATURE-UI-AUDIT gaps 24, 25). */
  { table: 'ShiftSwap', model: 'shiftSwap', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, requesterEmployeeId: employeeId, colleagueEmployeeId: employeeId, fromDate: '2099-01-01', toDate: '2099-01-01', days: [], requestedByUserId: 'u' }) },
  { table: 'RequestForm', model: 'requestForm', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `Form ${rnd()}`, fields: [] }) },
  { table: 'RequestFormFile', model: 'requestFormFile', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, formId: 'f', employeeId, fieldKey: 'k', fileName: 'a.png', mime: 'image/png', size: 1, data: Buffer.from('x') }) },
  { table: 'Referral', model: 'referral', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, openingId: `o-${rnd()}`, candidateId: `c-${rnd()}`, referrerEmployeeId: employeeId, phoneKey: '9800000000' }) },
  { table: 'ReferralLink', model: 'referralLink', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, openingId: `o-${rnd()}`, referrerEmployeeId: employeeId, tokenHash: `h-${rnd()}${rnd()}` }) },
  /* Expense claims, advances and salary advances (WORKFLOW-GAP-RESEARCH 4.1, 4.2). */
  { table: 'ExpenseCategory', model: 'expenseCategory', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `Cat ${rnd()}` }) },
  { table: 'ExpenseBill', model: 'expenseBill', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, name: 'bill.png', mime: 'image/png', sha256: rnd(), data: Buffer.from('x') }) },
  { table: 'ExpenseClaim', model: 'expenseClaim', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, number: `EXP-${rnd()}`, title: 'Trip' }) },
  { table: 'ExpenseLine', model: 'expenseLine', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, spentOn: '2026-10-01', categoryName: 'Travel', merchant: 'Cab', amount: 100, claim: { create: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `EXP-${rnd()}`, title: 'Trip' } } }) },
  { table: 'EmployeeAdvance', model: 'employeeAdvance', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, number: `ADV-${rnd()}`, purpose: 'Trip', amount: 1000 }) },
  { table: 'SalaryAdvanceAsk', model: 'salaryAdvanceAsk', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, amount: 1000, months: 2, reason: 'Rent' }) },
  /* Attendance rules (WORKFLOW-GAP-RESEARCH 4.4, 4.5, 4.6, B19). */
  { table: 'AttendancePenalty', model: 'attendancePenalty', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, month: `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`, status: 'WAIVED', decidedByUserId: 'u' }) },
  { table: 'AttendanceNudge', model: 'attendanceNudge', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, sentOn: `2099-01-${rnd()}`, kind: 'FIX' }) },
  { table: 'AbsenceCase', model: 'absenceCase', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, fromDate: '2099-01-01', lastAbsentDate: '2099-01-05', days: 5 }) },
  { table: 'AbsenceNotice', model: 'absenceNotice', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, caseId: `case-${rnd()}`, employeeId, seq: 1, reportBy: '2099-01-10', text: 'x', sentByUserId: 'u' }) },
  { table: 'NightWorkConsent', model: 'nightWorkConsent', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, status: 'GIVEN', onDate: '2099-01-01', recordedByUserId: 'u' }) },
  /* Leaving and engagement (WORKFLOW-GAP-RESEARCH 4.3, 4.7, 4.8, 4.9). */
  { table: 'ClearanceLine', model: 'clearanceLine', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, leavingDate: '2099-01-31', dept: 'CUSTOM', label: `Line ${rnd()}` }) },
  { table: 'ExitInterview', model: 'exitInterview', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, leavingDate: `2099-02-${rnd()}` }) },
  { table: 'EngagementSettings', model: 'engagementSettings', make: (c) => ({ accountId: c.accountId, orgId: c.orgId }) },
  { table: 'AutomationRun', model: 'automationRun', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, key: 'birthdays', ranOn: `2099-03-${rnd()}` }) },
  { table: 'CelebrationOptOut', model: 'celebrationOptOut', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, byUserId: 'u' }) },
  { table: 'GreetingPost', model: 'greetingPost', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, onDate: '2099-01-01', kind: 'HOLIDAY', key: `HOLIDAY:${rnd()}`, text: 'x' }) },
  /* People Home's kudos stream and one-question pulse (owner's suite spec, 5–6 Nov 2026). */
  { table: 'Kudos', model: 'kudos', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, toEmployeeId: employeeId, message: 'Thanks', fromUserId: 'u', fromName: 'U' }) },
  { table: 'PulseQuestion', model: 'pulseQuestion', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, text: 'How was your week?', createdByUserId: 'u' }) },
  { table: 'PulseAnswer', model: 'pulseAnswer', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, questionId: `q-${rnd()}`, userId: 'u', score: 4 }) },
  /* Workflow engine 2a (docs/people/workflow-engine/SPEC.md 6): no new table; the new columns (a rule variant, a request's source record, a step's slot) sit behind the existing policies. */
  { table: 'ApprovalRule', model: 'approvalRule', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: 'Pune', requestType: 'JOB_CHANGE', variantKey: `v-${rnd()}`, specVersion: 2, appliesWhen: [{ field: 'branchId', op: 'eq', value: 'x' }], priority: 1, steps: [] }) },
  { table: 'ApprovalRequest', model: 'approvalRequest', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, requestType: 'JOB_CHANGE', subjectEmployeeId: employeeId, requesterUserId: 'u', ruleId: 'r', ruleVersion: 1, title: 'x', payload: {}, sourceKind: 'LEAVE', sourceId: `l-${rnd()}`, ruleVariant: 'v', steps: { create: [{ accountId: c.accountId, orgId: c.orgId, order: 1, slot: 1, mode: 'ALL', candidateUserIds: [], dueAt: new Date(), resolvedHow: 'STAND_IN' }] } }) },
];

let a: Ctx;
let b: Ctx;
let employeeA: string;
beforeAll(async () => {
  a = await owner();
  b = await owner();
  employeeA = (await request(app).post(`/api/orgs/${a.orgId}/people/employees`).set(at(a)).send({ name: 'Only A', code: 'R-1' }).expect(201)).body.employee.id;
}, 90_000);

describe('row-level security on the new People tables', () => {
  for (const t of TABLES) {
    it(`${t.table}: the policy fails closed and company B reads nothing of company A's`, async () => {
      const [{ qual }] = await peoplePrisma.$queryRawUnsafe<Array<{ qual: string }>>(`SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy WHERE polname = 'tenant_isolation' AND polrelid = '"${t.table}"'::regclass`);
      expect(qual, t.table).toContain("current_setting('clor.bypass'::text, true) = 'on'::text");
      expect(qual, t.table).toContain("NULLIF(current_setting('clor.org_id'::text, true), ''::text)");
      expect(qual, t.table).not.toContain('IS NULL');
      const [{ forced }] = await peoplePrisma.$queryRawUnsafe<Array<{ forced: boolean }>>(`SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = '"${t.table}"'::regclass`);
      expect(forced, t.table).toBe(true);

      const row = await runInTenant(a.orgId, () => (peoplePrisma as any)[t.model].create({ data: t.make(a, employeeA) }));
      expect(await runInTenant(a.orgId, () => (peoplePrisma as any)[t.model].count({ where: { id: row.id } }))).toBe(1);
      expect(await runInTenant(b.orgId, () => (peoplePrisma as any)[t.model].count({ where: { id: row.id } }))).toBe(0);
      /* Company B cannot write into A's row either: the update finds nothing. */
      const touched = await runInTenant(b.orgId, () => (peoplePrisma as any)[t.model].updateMany({ where: { id: row.id }, data: { orgId: b.orgId } }));
      expect(touched.count).toBe(0);
    });
  }
});
