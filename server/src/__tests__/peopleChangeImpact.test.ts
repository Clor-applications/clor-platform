import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The transfer preview says only what is true (Workforce research addendum,
 * 26 Oct 2026; docs/people/design-v1/WORKFORCE-LAYOUT.md): nothing is "told"
 * to an app; a line about an app the company does not use is left out;
 * Professional Tax, which Payroll takes from the payroll profile and not from
 * the work site, is an action the owner can take in the same step, applied
 * now when the move applies now and left as a task when it waits.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { runInTenant, outsideTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `ci.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Impact Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, ...features } }).expect(200);
  const me = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body;
  ctx.userId = me.user.id;
  ctx.accountId = me.user.accountId || (await runInTenant(ctx.orgId, () => peoplePrisma.employee.findFirst({ where: { orgId: ctx.orgId }, select: { accountId: true } })))?.accountId || '';
  return ctx;
}
const api = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

async function setUp(c: Ctx, ptState: string | null) {
  const blr = (await api(c).post('/structure/establishments', { name: `Bengaluru office ${rnd()}`, kind: 'OFFICE', state: 'Karnataka' }).expect(201)).body.item;
  const pune = (await api(c).post('/structure/establishments', { name: `Pune shop ${rnd()}`, kind: 'SHOP', state: 'Maharashtra' }).expect(201)).body.item;
  const e = (await api(c).post('/employees', { name: 'Ravi Kumar', code: `R-${rnd()}`, dateOfJoining: '2025-01-01', establishmentId: blr.id }).expect(201)).body.employee;
  if (ptState !== undefined) {
    await outsideTenant('test: a payroll profile with Professional Tax', () =>
      payrollPrisma.employeePayrollProfile.create({ data: { accountId: e.accountId, orgId: c.orgId, employeeId: e.id, ptApplicable: true, professionalTaxState: ptState, createdByUserId: c.userId } }));
  }
  return { blr, pune, e };
}
const ptOf = async (orgId: string, employeeId: string) => (await outsideTenant('test: read the profile', () => payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId }, select: { professionalTaxState: true } })))?.professionalTaxState;

let withPayroll: Ctx;
let peopleOnly: Ctx;
beforeAll(async () => {
  withPayroll = await owner({ payroll: true, attendance: true });
  peopleOnly = await owner({ payroll: false, attendance: false });
}, 120_000);

describe('the transfer preview tells the truth', () => {
  it('never says an app was told; with no Payroll or Attendance it says nothing about them', async () => {
    const { pune, e } = await setUp(peopleOnly, 'Karnataka');
    const impact = (await api(peopleOnly).get(`/employees/${e.id}/change-impact?establishmentId=${pune.id}`).expect(200)).body.impact;
    expect(impact.map((i: any) => i.key)).toEqual(['se', 'leave']);
    expect(JSON.stringify(impact)).not.toMatch(/told|Payroll|Attendance/);
  });

  it('with Payroll on, Professional Tax that will not follow the move is an action with its fix', async () => {
    const { pune, e } = await setUp(withPayroll, 'Karnataka');
    const impact = (await api(withPayroll).get(`/employees/${e.id}/change-impact?establishmentId=${pune.id}`).expect(200)).body.impact;
    const pt = impact.find((i: any) => i.key === 'pt');
    expect(pt).toMatchObject({ target: 'ACTION', title: 'Professional Tax stays Karnataka in Payroll', fix: { kind: 'ptState', state: 'Maharashtra' } });
    expect(impact.every((i: any) => ['AUTO', 'ACTION', 'TASK', 'INFO'].includes(i.target))).toBe(true);
  });

  it('asked to, a transfer that applies now sets the PT state and logs it; one dated ahead leaves a task instead', async () => {
    const now = await setUp(withPayroll, 'Karnataka');
    const r = (await api(withPayroll).put(`/employees/${now.e.id}`, { establishmentId: now.pune.id, alsoPtState: true }).expect(200)).body;
    expect(r.ptState).toMatchObject({ applied: true, state: 'Maharashtra' });
    expect(await ptOf(withPayroll.orgId, now.e.id)).toBe('Maharashtra');

    const later = await setUp(withPayroll, 'Karnataka');
    const r2 = (await api(withPayroll).put(`/employees/${later.e.id}`, { establishmentId: later.pune.id, alsoPtState: true, effectiveFrom: '2099-01-01' }).expect(200)).body;
    expect(r2.ptState).toMatchObject({ applied: false, task: true, state: 'Maharashtra', due: '2099-01-01' });
    expect(await ptOf(withPayroll.orgId, later.e.id)).toBe('Karnataka');
    const tasks = await runInTenant(withPayroll.orgId, () => peoplePrisma.checklistTask.findMany({ where: { orgId: withPayroll.orgId, employeeId: later.e.id, doneAt: null }, select: { title: true } }));
    expect(tasks.map((t) => t.title)).toContain('Set Professional Tax state to Maharashtra in Payroll');

    /* Not asked: nothing in Payroll moves. */
    const quiet = await setUp(withPayroll, 'Karnataka');
    expect((await api(withPayroll).put(`/employees/${quiet.e.id}`, { establishmentId: quiet.pune.id }).expect(200)).body.ptState).toBeNull();
    expect(await ptOf(withPayroll.orgId, quiet.e.id)).toBe('Karnataka');
  });

  it('a manager change follows the company approval setting, and flags a manager who cannot sign in', async () => {
    const { e } = await setUp(withPayroll, null);
    const boss = (await api(withPayroll).post('/employees', { name: 'Meena Shah', code: `M-${rnd()}` }).expect(201)).body.employee;
    const impact = (await api(withPayroll).get(`/employees/${e.id}/change-impact?reportingManagerId=${boss.id}`).expect(200)).body.impact;
    expect(impact.find((i: any) => i.key === 'approvals')).toMatchObject({ target: 'INFO', title: 'Leave and corrections stay with HR' });
    expect(impact.find((i: any) => i.key === 'manager-no-login')).toMatchObject({ target: 'ACTION', title: 'Meena Shah cannot sign in yet' });
  });
});

describe('ready for payday, on the record', () => {
  it("lists only this person's problems, with Payroll's only when Payroll is in use", async () => {
    const { e } = await setUp(withPayroll, 'Karnataka');
    const other = (await api(withPayroll).post('/employees', { name: 'No Date', code: `N-${rnd()}` }).expect(201)).body.employee;
    const mine = (await api(withPayroll).get(`/employees/${e.id}/readiness`).expect(200)).body;
    expect(mine.apps).toMatchObject({ payroll: true, attendance: true });
    const ids = mine.checks.map((c: any) => c.id);
    /* A payroll profile with no PAN, no bank and no salary: each blocks payday. */
    expect(ids).toEqual(expect.arrayContaining(['pan', 'bank', 'no-salary']));
    expect(ids).not.toContain('no-joining-date');
    expect(mine.checks.find((c: any) => c.id === 'pan').severity).toBe('BLOCKS_PAYROLL');
    /* The other person's missing joining date is theirs, not this person's. */
    const theirs = (await api(withPayroll).get(`/employees/${other.id}/readiness`).expect(200)).body.checks.map((c: any) => c.id);
    expect(theirs).toContain('no-joining-date');

    const plain = await setUp(peopleOnly, null);
    const p = (await api(peopleOnly).get(`/employees/${plain.e.id}/readiness`).expect(200)).body;
    expect(p.apps.payroll).toBe(false);
    expect(p.checks.filter((c: any) => c.area === 'Payroll')).toEqual([]);
  });
});

