import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Trace (docs/people/02-PRD.md TRACE-03, 04, 05): a decision keeps
 * the policy versions and evidence it rested on after the policy changes;
 * a correction raised from the panel carries the change; the salary
 * question names what it cannot get and shows what interfaces give.
 */
const { buildApp } = await import('../app.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `trace.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Trace Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('trace', () => {
  it('a decision keeps the policy version and evidence it rested on, after the policy changes (TRACE-05); a correction from the panel carries the change (TRACE-03)', async () => {
    const head = await colleague(hr, 'Head', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE']);
    const senior = (await people(hr).post('/structure/job-positions', { name: 'Senior analyst' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Tara Nair', code: 'T-1', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const appraisal = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Appraisal 2026', kind: 'OTHER', classification: 'HR_ONLY', ...file('rating: exceeds') }).expect(201)).body.document;
    const policy = (await people(hr).post('/policies', { title: 'Promotion policy', category: 'CONDUCT' }).expect(201)).body.policy;
    await people(hr).post(`/policies/${policy.id}/versions`, { body: 'Two years in grade.', effectiveFrom: '2026-01-01' }).expect(201);
    await people(hr).post(`/policies/${policy.id}/versions/1/submit`, {}).expect(200);

    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'USER', id: head.userId }, dueDays: 3 }] }).expect(201);
    const sent = (await people(hr).put(`/employees/${e.id}`, { jobPositionId: senior.id, changeNote: 'Promotion', evidenceDocumentIds: [appraisal.id, 'not-hers'] }).expect(200)).body;
    await people(head).post(`/requests/${sent.request.id}/approve`, {}).expect(200);

    /* The policy moves on, and the appraisal is replaced by a second version. */
    await people(hr).post(`/policies/${policy.id}/versions`, { body: 'Three years in grade.', effectiveFrom: today() }).expect(201);
    await people(hr).post(`/policies/${policy.id}/versions/2/submit`, {}).expect(200);
    await people(hr).post(`/documents/${appraisal.id}/replace`, { title: 'Appraisal 2026 (corrected)', ...file('rating: meets') }).expect(201);

    const promo = (await people(hr).get(`/employees/${e.id}/journey`).expect(200)).body.entries.find((x: any) => x.kind === 'APPROVED');
    const why = (await people(hr).get(`/employees/${e.id}/why/${promo.key}`).expect(200)).body.why;
    expect(why.decision.policies).toEqual([expect.objectContaining({ title: 'Promotion policy', version: 1, effectiveFrom: '2026-01-01' })]);
    expect(why.evidence).toEqual([expect.objectContaining({ id: appraisal.id, title: 'Appraisal 2026', version: 1 })]);
    expect(why.unknown).not.toEqual(expect.arrayContaining([expect.stringMatching(/No decision record/)]));

    const raised = (await people(hr).post(`/employees/${e.id}/why/${promo.key}/raise`, { kind: 'CORRECTION', note: 'Effective date should be 1 November.' }).expect(201)).body.request;
    expect(raised.changeRef).toBe(promo.key);
    expect(raised.subject).toMatch(/^Correction: Designation: .* to Senior analyst/);
    expect(raised.description).toContain('Effective date should be 1 November.');
    await people(hr).post(`/employees/${e.id}/why/nope/raise`, { kind: 'QUESTION' }).expect(404);
  });

  it('the salary question says which evidence it cannot get, and shows what the read interfaces give (TRACE-04)', async () => {
    const { registerDaysInterface, registerPayslipInterface } = await import('../services/people/salaryQuestion.js');
    const e = (await people(hr).post('/employees', { name: 'Vikram Rao', code: 'T-2', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const none = (await people(hr).get(`/employees/${e.id}/salary-question?month=2026-09`).expect(200)).body;
    expect(none.payslip).toBeNull();
    expect(none.missing.map((m: any) => m.owner)).toEqual(['Payroll', 'Attendance']);
    registerPayslipInterface(async ({ month }) => ({ month, net: 41000, ruleSet: 'Karnataka PT', ruleVersion: '2026.2', lines: [{ code: 'BASIC', label: 'Basic', amount: 30000, kind: 'EARNING' }, { code: 'PT', label: 'Professional tax', amount: 200, kind: 'DEDUCTION', ruleVersion: '2026.2' }, { code: 'LOP', label: 'Loss of pay', amount: 1800, kind: 'DEDUCTION', basis: '2 days' }] }));
    registerDaysInterface(async ({ month }) => ({ month, payableDays: 28, lopDays: 2, absences: [{ date: '2026-09-11', reason: 'Absent, no leave applied' }] }));
    try {
      const got = (await people(hr).get(`/employees/${e.id}/salary-question?month=2026-09`).expect(200)).body;
      expect(got.missing).toEqual([]);
      expect(got.deductions.map((d: any) => d.code)).toEqual(['PT', 'LOP']);
      expect(got.payslip.ruleVersion).toBe('2026.2');
      expect(got.days.absences).toHaveLength(1);
      expect(got.correction).toMatchObject({ category: 'PAYROLL', queue: 'Payroll' });
    } finally {
      registerPayslipInterface(null);
      registerDaysInterface(null);
    }
  });
});
