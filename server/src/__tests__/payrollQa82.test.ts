import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * QA of PR #82 at 856428e3 (employee and boundaries tester), each written to
 * fail first: a two-person company stuck on a leaver's settlement, HR editing
 * her own full and final, a hold button that only says "Permission denied",
 * and a payslip with "Fine ₹0.00" and an unexplained fine.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  get: (c: Ctx, p: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)),
  post: (c: Ctx, p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
  put: (c: Ctx, p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
};
const peopleApi = (c: Ctx, m: 'get' | 'put' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const own = <T,>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);

async function makeOwner(): Promise<Ctx> {
  const email = `review82.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Review Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  const c = { token: signup.body.token, orgId, branchId: setup.body.branch.id, accountId: org!.accountId, userId: signup.body.user.id };
  await request(app).put(`/api/orgs/${orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}

async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id };
}

async function leaver(c: Ctx) {
  const person = await api.post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2025-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', dateOfJoining: '2025-03-01', dateOfLeaving: '2026-10-14', status: 'LEFT' }).expect(200);
  return employeeId;
}

/** A deduction to hang recoveries on (People finds it by its code), a reimbursement earning, and an open month. */
async function recoveryRails(c: Ctx) {
  const comp = await api.post(c, '/components', { name: 'Advance recovery', code: 'ADVREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 85 }).expect(201);
  const reimb = await api.post(c, '/components', { name: 'Reimbursement', code: 'REIMB', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, isTaxable: false, displayOrder: 60 }).expect(201);
  const p = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
  return { componentId: comp.body.component.id as string, reimbId: reimb.body.component.id as string, periodId: p.body.period.id as string };
}

const advance = (c: Ctx, employeeId: string, over: Record<string, unknown> = {}) =>
  own(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `ADV-${rnd()}`, purpose: 'Site visit', amount: 5000, status: 'PAID', paidOn: '2026-09-01', ...over } as any }));

const adjustment = (c: Ctx, o: { id: string; employeeId: string; componentId: string; periodId: string; amount: number; status: string; type?: string; carriedByRunId?: string }) =>
  own(c, () => payrollPrisma.payrollAdjustment.create({ data: { id: o.id, accountId: c.accountId, orgId: c.orgId, employeeId: o.employeeId, componentId: o.componentId, periodId: o.periodId, type: o.type || 'DEDUCTION', amount: o.amount, reason: 'test', reference: o.id, status: o.status, approvedAt: o.status === 'APPROVED' ? new Date() : null, carriedByRunId: o.carriedByRunId ?? null, createdByUserId: 'test' } }));

const { payCap } = await import('../services/people/money/payrollBridge.js');
const { readableLines } = await import('../services/payroll/slipLines.js');
const OTHERS = 'another HR or payroll approver, or the owner';

/** Kavya: HR, who may work out and approve settlements, and who is herself leaving. */
async function hrLeaver(c: Ctx) {
  const kavya = await colleague(c, ['PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::EDIT', 'PAYROLL::Payroll Runs::APPROVE', 'PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT']);
  const employeeId = await leaver(c);
  await own(c, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: kavya.userId } }));
  return { kavya, employeeId };
}

describe('QA F1: two people, one of them leaving', () => {
  it('the owner approves the settlement he worked out for the only other approver, and it is audited as such', async () => {
    const c = await makeOwner();
    const { kavya, employeeId } = await hrLeaver(c);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    /* She may never approve her own. */
    const hers = await api.post(kavya, `/settlements/${s.id}/approve`).expect(403);
    expect(hers.body.code).toBe('OWN_RECORD');
    expect(hers.body.error).toContain(OTHERS);
    /* So she does not count as somebody else who could: he approves it. */
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await new Promise((x) => setTimeout(x, 150));
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'PAYROLL_SETTLEMENT', entityId: s.id, action: 'SELF_APPROVED' } });
    expect(audit?.message).toContain('the only other approver is the person it is about');
  }, 120_000);

  it('with a third approver in the company, the preparer is still refused', async () => {
    const c = await makeOwner();
    const { employeeId } = await hrLeaver(c);
    await colleague(c, ['PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::APPROVE']);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const r = await api.post(c, `/settlements/${s.id}/approve`).expect(403);
    expect(r.body.code).toBe('MAKER_CHECKER');
    expect(r.body.error).toContain(OTHERS);
  }, 120_000);
});

describe('QA F2: nobody works out their own full and final', () => {
  it('refuses her own: start, edit, work out again and cancel', async () => {
    const c = await makeOwner();
    const { kavya, employeeId } = await hrLeaver(c);
    const start = await api.post(kavya, '/settlements', { employeeId }).expect(403);
    expect(start.body.code).toBe('OWN_RECORD');
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const lines = [...s.lines, { code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 50_000, explanation: '' }];
    expect((await api.put(kavya, `/settlements/${s.id}`, { lines }).expect(403)).body.code).toBe('OWN_RECORD');
    expect((await api.post(kavya, `/settlements/${s.id}/recalculate`).expect(403)).body.code).toBe('OWN_RECORD');
    expect((await api.post(kavya, `/settlements/${s.id}/cancel`).expect(403)).body.code).toBe('OWN_RECORD');
    const row = await own(c, () => payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } }));
    expect(row.status).toBe('DRAFT');
    expect(row.linesJson).not.toContain('50000');
    /* The list tells the screen whose record is whose. */
    expect((await api.get(kavya, '/settlements').expect(200)).body.you.selfEmployeeId).toBe(employeeId);
  }, 120_000);
});

describe('QA F3: lifting a hold without People edit', () => {
  it('is refused in plain words, and the list says so before anyone presses', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    await own(c, () => peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, fromDate: '2026-10-01', lastAbsentDate: '2026-10-14', days: 14, status: 'ABSCONDED', holdReason: 'Absconded', heldAt: new Date(), heldByUserId: 'hr' } }));
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const pallavi = await colleague(c, ['PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::EDIT', 'PAYROLL::Payroll Runs::APPROVE']);
    expect((await api.get(pallavi, '/settlements').expect(200)).body.you).toMatchObject({ liftHold: false, liftHoldWhy: expect.stringContaining('People edit') });
    expect((await api.get(c, '/settlements').expect(200)).body.you).toMatchObject({ liftHold: true, liftHoldWhy: null });
    const r = await api.post(pallavi, `/settlements/${s.id}/release-hold`, { reason: 'Came in to settle' }).expect(403);
    expect(r.body.error).toContain('People edit');
    expect(r.body.error).not.toBe('Permission denied');
  }, 120_000);
});

describe('QA F4: a payslip reads plainly', () => {
  it('leaves out lines of nothing and says why each entered deduction was taken', async () => {
    const c = await makeOwner();
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const fine = await api.post(c, '/components', { name: 'Fine', code: 'FINE', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 70 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: fine.body.component.id, displayOrder: 70 }] }).expect(201);
    const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
    const person = await api.post(c, '/employees', { name: 'Arjun Das', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 264_000 }).expect(201);
    const adj = await api.post(c, '/adjustments', { employeeId: person.body.employee.id, componentId: fine.body.component.id, periodId, type: 'DEDUCTION', amount: 500, reason: 'Broken display unit' }).expect(201);
    await api.post(c, `/adjustments/${adj.body.adjustment.id}/approve`).expect(200);
    const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    const slipId = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
    const slip = (await api.get(c, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.deductions.map((l: any) => [l.name, l.amount])).toEqual([['Fine: Broken display unit', 500]]);
  }, 180_000);

  it('two entered lines of one component keep their own reasons', () => {
    const lines = [
      { componentId: 'f', componentName: 'Fine', amount: 0, displayOrder: 70, type: 'DEDUCTION' },
      { componentId: 'f', componentName: 'Fine', amount: 500, displayOrder: 900, type: 'DEDUCTION' },
      { componentId: 'f', componentName: 'Fine', amount: 200, displayOrder: 900, type: 'DEDUCTION' },
    ];
    const snap = JSON.stringify([{ componentId: 'f', amount: 200, reason: 'Late return of keys' }, { componentId: 'f', amount: 500, reason: 'Broken display unit' }]);
    expect(readableLines(lines, snap).map((l) => l.componentName)).toEqual(['Fine: Broken display unit', 'Fine: Late return of keys']);
  });

  it('the advance headroom counts a fine on a payslip whose month is not over yet', async () => {
    const c = await makeOwner();
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const fine = await api.post(c, '/components', { name: 'Fine', code: 'FINE', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 70 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2025-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: fine.body.component.id, displayOrder: 70 }] }).expect(201);
    /* This month is open; the payslip is for a month two ahead, run early and locked (as QA's December run). */
    const now = new Date(Date.now() + 330 * 60_000);
    const ym = (add: number) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + add, 1)); return [d.getUTCFullYear(), d.getUTCMonth()]; };
    const span = (add: number) => { const [y, m] = ym(add); const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10); return { startDate: `${y}-${String(m + 1).padStart(2, '0')}-01`, endDate: end, paymentDate: end }; };
    await api.post(c, '/periods', { name: `This month ${rnd()}`, ...span(0) }).expect(201);
    const later = (await api.post(c, '/periods', { name: `Later ${rnd()}`, ...span(2) }).expect(201)).body.period.id;
    const person = await api.post(c, '/employees', { name: 'Arjun Das', code: `E${rnd()}`, dateOfJoining: '2025-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    const employeeId = person.body.employee.id;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2025-01-01', annualCtc: 264_000 }).expect(201);
    const adj = await api.post(c, '/adjustments', { employeeId, componentId: fine.body.component.id, periodId: later, type: 'DEDUCTION', amount: 500, reason: 'Broken display unit' }).expect(201);
    await api.post(c, `/adjustments/${adj.body.adjustment.id}/approve`).expect(200);
    const runId = (await api.post(c, '/runs', { periodId: later }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'LOCKED' } }));
    const cap = await own(c, () => payCap(c.orgId, employeeId));
    expect(cap).toMatchObject({ wages: 22_000, room: 10_500 });
  }, 180_000);
});

/* ---------------------------------------------------------------------------
 * QA of PR #82 at 856428e3, owner and HR tester.
 * ------------------------------------------------------------------------ */
const { periodToPayIn } = await import('../services/people/money/payrollBridge.js');
const adv = (c: Ctx, id: string) => own(c, () => peoplePrisma.employeeAdvance.findUniqueOrThrow({ where: { id } }));
const adjOf = (c: Ctx, id: string) => own(c, () => payrollPrisma.payrollAdjustment.findUniqueOrThrow({ where: { id } }));
const peopleAdvance = async (c: Ctx, id: string) => (await peopleApi(c, 'get', '/money/advances').expect(200)).body.advances.find((a: any) => a.id === id);

/** Basic only, one person, a period: what most of these need. */
async function onePerson(c: Ctx, o: { annualCtc?: number; periodId?: string } = {}) {
  const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const fine = await api.post(c, '/components', { name: 'Fine', code: 'FINE', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 70 }).expect(201);
  const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2025-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: fine.body.component.id, displayOrder: 70 }] }).expect(201);
  const periodId = o.periodId || (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
  const person = await api.post(c, '/employees', { name: 'Imran Khan', code: `E${rnd()}`, dateOfJoining: '2025-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true, ptApplicable: true } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2025-01-01', annualCtc: o.annualCtc ?? 264_000 }).expect(201);
  return { employeeId, periodId, fineId: fine.body.component.id as string };
}
const monthSpan = (add: number) => {
  const now = new Date(Date.now() + 330 * 60_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + add, 1));
  const y = d.getUTCFullYear(); const m = d.getUTCMonth();
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { startDate: `${y}-${String(m + 1).padStart(2, '0')}-01`, endDate: end, paymentDate: end };
};

describe('owner/HR QA F1: a recovery Payroll edited down', () => {
  it('leaves the rest open, lists it on the full and final as its own line, and closes the advance only at what was taken', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const a = await advance(c, employeeId, { recoveringAmount: 5000 });
    const key = `advance-recover:${a.id}:${rails.periodId}`;
    await adjustment(c, { id: key, employeeId, ...rails, amount: 5000, status: 'APPROVED' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));
    /* Payroll takes only ₹3,000 of it this month. */
    await api.put(c, `/adjustments/${key}`, { employeeId, componentId: rails.componentId, periodId: rails.periodId, amount: 3000, reason: 'Only 3,000 this month' }).expect(200);
    await api.post(c, `/adjustments/${key}/approve`).expect(200);
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovered: 0, recovering: 3000, open: 2000 });

    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const traced = s.lines.filter((l: any) => l.source && (l.source.id === a.id || l.source.id === key)).map((l: any) => [l.source.type, l.amount]).sort();
    expect(traced).toEqual([['ADVANCE', 2000], ['CARRY', 3000]]);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'CLOSED', recovered: 5000, recovering: 0, open: 0 });
  }, 180_000);
});

describe('owner/HR QA F2: correcting a carried row', () => {
  it('waits while the payroll that carried it is open, then takes a correction with a reason', async () => {
    const c = await makeOwner();
    const r = await onePerson(c);
    const runId = (await api.post(c, '/runs', { periodId: r.periodId }).expect(201)).body.run.id;
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATED' } }));
    const id = `carry-${rnd()}`;
    await adjustment(c, { id, employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 5000, status: 'APPROVED', carriedByRunId: runId });
    const body = { employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 1000, reason: 'test' };
    expect((await api.put(c, `/adjustments/${id}`, body).expect(409)).body.code).toBe('CARRIED');
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED' } }));
    expect((await api.put(c, `/adjustments/${id}`, body).expect(400)).body.code).toBe('REASON_NEEDED');
    expect((await api.put(c, `/adjustments/${id}`, { ...body, employeeId: 'someone-else', correctionReason: 'Agreed with the owner, 2 Nov' }).expect(400)).body.code).toBe('CARRIED_FIXED');
    await api.put(c, `/adjustments/${id}`, { ...body, correctionReason: 'Agreed with the owner, 2 Nov' }).expect(200);
    const row = await adjOf(c, id);
    expect([Number(row.amount), row.status]).toEqual([1000, 'DRAFT']);
    expect(row.reason).toContain('Agreed with the owner, 2 Nov');
    /* The list tells the screen which carried rows may be corrected. */
    const listed = (await api.get(c, '/adjustments').expect(200)).body.adjustments.find((x: any) => x.id === id);
    expect(listed.carried).toEqual({ final: true });
  }, 120_000);
});

describe('owner/HR QA F4: figures that changed since the calculation', () => {
  it('are flagged on the run, and it is not sent for review until calculated again', async () => {
    const c = await makeOwner();
    const r = await onePerson(c);
    const runId = (await api.post(c, '/runs', { periodId: r.periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    expect((await api.get(c, `/runs/${runId}`).expect(200)).body.run.stale).toBeNull();
    await new Promise((x) => setTimeout(x, 20));
    await adjustment(c, { id: `fine-${rnd()}`, employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 500, status: 'APPROVED' });
    expect((await api.get(c, `/runs/${runId}`).expect(200)).body.run.stale).toMatch(/adjustment/i);
    expect((await api.post(c, `/runs/${runId}/submit-review`, {}).expect(409)).body.code).toBe('RUN_STALE');
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    expect((await api.get(c, `/runs/${runId}`).expect(200)).body.run.stale).toBeNull();
    await api.post(c, `/runs/${runId}/submit-review`, {}).expect(200);
  }, 180_000);
});

describe('owner/HR QA F5: recoveries in a month already paid', () => {
  it('People sends recoveries to the first month whose payroll is still open', async () => {
    const c = await makeOwner();
    const thisMonth = (await api.post(c, '/periods', { name: `This ${rnd()}`, ...monthSpan(0) }).expect(201)).body.period.id;
    const next = (await api.post(c, '/periods', { name: `Next ${rnd()}`, ...monthSpan(1) }).expect(201)).body.period.id;
    const runId = (await api.post(c, '/runs', { periodId: thisMonth }).expect(201)).body.run.id;
    expect((await own(c, () => periodToPayIn(c.orgId)))?.id).toBe(thisMonth);
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED' } }));
    expect((await own(c, () => periodToPayIn(c.orgId)))?.id).toBe(next);
  }, 120_000);

  it('closing a month warns of an instalment nobody took, and closes when told to', async () => {
    const c = await makeOwner();
    const r = await onePerson(c);
    await own(c, async () => {
      const loan = await payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId: r.employeeId, type: 'SALARY_ADVANCE', principal: 5000, startDate: '2026-06-01', outstandingBalance: 5000, status: 'ACTIVE', createdByUserId: 'test' } as any });
      await payrollPrisma.payrollLoanInstallment.create({ data: { accountId: c.accountId, orgId: c.orgId, loanId: loan.id, periodId: r.periodId, sequence: 1, dueAmount: 5000, principalAmount: 5000, interestAmount: 0, status: 'PENDING' } });
    });
    const warned = await api.post(c, `/periods/${r.periodId}/lock`, { locked: true }).expect(409);
    expect(warned.body.code).toBe('UNTAKEN_RECOVERIES');
    expect(warned.body.untaken).toEqual([expect.objectContaining({ employeeName: 'Imran Khan', amount: 5000 })]);
    await api.post(c, `/periods/${r.periodId}/lock`, { locked: true, acknowledge: true }).expect(200);
  }, 120_000);
});

describe('owner/HR QA F9: PF and PT per person', () => {
  it('saving the details without the switches keeps them; sending them changes them', async () => {
    const c = await makeOwner();
    const r = await onePerson(c);
    const profile = () => own(c, () => payrollPrisma.employeePayrollProfile.findFirstOrThrow({ where: { orgId: c.orgId, employeeId: r.employeeId } }));
    expect((await profile()).pfApplicable).toBe(true);
    await api.put(c, `/employees/${r.employeeId}`, { name: 'Imran Khan', dateOfJoining: '2025-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(200);
    expect(await profile()).toMatchObject({ pfApplicable: true, ptApplicable: true });
    await api.put(c, `/employees/${r.employeeId}`, { name: 'Imran Khan', dateOfJoining: '2025-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: false } }).expect(200);
    expect(await profile()).toMatchObject({ pfApplicable: false, ptApplicable: true });
  }, 120_000);
});

describe('reviewer nit: the advance headroom uses the company share', () => {
  it('30% of wages, not half', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 30, countsStatutory: true, countsPenalties: true }).expect(200);
    const r = await onePerson(c);
    const cap = await own(c, () => payCap(c.orgId, r.employeeId));
    expect(cap).toMatchObject({ wages: 22_000, room: 6600 });
  }, 120_000);
});

/* ---------------------------------------------------------------------------
 * Re-review of PR #82 at 5a7645e6.
 * ------------------------------------------------------------------------ */
describe('re-review 5a7645e6: a recovery split by a payroll, then corrected', () => {
  it('stays exact at each step: split, corrected, approved, the full and final paid', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const runId = (await api.post(c, '/runs', { periodId: rails.periodId }).expect(201)).body.run.id;
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED' } }));
    /* ₹8,000 sent; the payroll took ₹5,000 and carried ₹3,000; People counted that (made before this change: no starting figure). */
    const a = await advance(c, employeeId, { amount: 8000, recoveredAmount: 5000, recoveringAmount: 3000 });
    const root = `advance-recover:${a.id}:${rails.periodId}`;
    const carry = `carry-${rnd()}`;
    await own(c, async () => {
      await payrollPrisma.payrollAdjustment.create({ data: { id: root, accountId: c.accountId, orgId: c.orgId, employeeId, componentId: rails.componentId, periodId: rails.periodId, type: 'DEDUCTION', amount: 5000, reason: 'Advance recovery', reference: root, status: 'CONSUMED', consumedByRunId: runId, approvedAt: new Date(), createdByUserId: 'test' } });
      await payrollPrisma.payrollAdjustment.create({ data: { id: carry, accountId: c.accountId, orgId: c.orgId, employeeId, componentId: rails.componentId, periodId: rails.periodId, type: 'DEDUCTION', amount: 3000, reason: 'Carried from October: Advance recovery', reference: root, status: 'APPROVED', approvedAt: new Date(), carriedFromId: root, carriedByRunId: runId, createdByUserId: 'test' } });
      await peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: root } });
    });
    const at = async () => { const x = await peopleAdvance(c, a.id); return [x.status, x.recovered, x.recovering, x.open]; };
    expect(await at()).toEqual(['PAID', 5000, 3000, 0]);

    /* Corrected to ₹1,000 by a PUT that leaves out the reference, as a hand-written API call would. */
    await api.put(c, `/adjustments/${carry}`, { employeeId, componentId: rails.componentId, periodId: rails.periodId, amount: 1000, correctionReason: 'Agreed with the owner, 2 Nov' }).expect(200);
    expect((await adjOf(c, carry)).reference).toBe(root);
    expect(await at()).toEqual(['PAID', 5000, 1000, 2000]);
    expect(await at()).toEqual(['PAID', 5000, 1000, 2000]);

    await api.post(c, `/adjustments/${carry}/approve`).expect(200);
    expect(await at()).toEqual(['PAID', 5000, 1000, 2000]);
    expect(await at()).toEqual(['PAID', 5000, 1000, 2000]);

    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const traced = s.lines.filter((l: any) => l.source && (l.source.id === a.id || l.source.id === carry)).map((l: any) => [l.source.type, l.amount]).sort();
    expect(traced).toEqual([['ADVANCE', 2000], ['CARRY', 1000]]);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect(await at()).toEqual(['CLOSED', 8000, 0, 0]);
    /* Retrying the close changes nothing. */
    await api.post(c, `/settlements/${s.id}/close-sources`).expect(200);
    expect(await at()).toEqual(['CLOSED', 8000, 0, 0]);
  }, 240_000);

  it('a recovery People sends now records what the advance had recovered before it', async () => {
    const c = await makeOwner();
    const r = await onePerson(c, { annualCtc: 240_000, periodId: (await api.post(c, '/periods', { name: `Now ${rnd()}`, ...monthSpan(0) }).expect(201)).body.period.id });
    await api.post(c, '/components', { name: 'Advance recovery', code: 'ADVREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 85 }).expect(201);
    const a = await advance(c, r.employeeId, { amount: 6000, recoveredAmount: 1000 });
    await peopleApi(c, 'post', `/money/advances/${a.id}/recover`).expect(200);
    const link = (await adv(c, a.id)).payrollAdjustmentId!;
    const row = await adjOf(c, link);
    expect(Number((row as any).recoveryBase)).toBe(1000);
    expect(row.reference).toBe(link);
  }, 120_000);

  it('a PUT that leaves out the reference keeps it on a recovery People sent', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const key = `advance-recover:x${rnd()}:${rails.periodId}`;
    await own(c, () => payrollPrisma.payrollAdjustment.create({ data: { id: key, accountId: c.accountId, orgId: c.orgId, employeeId, componentId: rails.componentId, periodId: rails.periodId, type: 'DEDUCTION', amount: 5000, reason: 'Advance recovery', reference: key, status: 'APPROVED', createdByUserId: 'test' } }));
    await api.put(c, `/adjustments/${key}`, { employeeId, componentId: rails.componentId, periodId: rails.periodId, amount: 3000, reason: 'Less this month' }).expect(200);
    expect((await adjOf(c, key)).reference).toBe(key);
  }, 120_000);
});

describe('re-review 5a7645e6: what makes a calculation stale', () => {
  it('a loan approved since, a component changed since; not a draft adjustment', async () => {
    const c = await makeOwner();
    const r = await onePerson(c);
    const runId = (await api.post(c, '/runs', { periodId: r.periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    const stale = async () => (await api.get(c, `/runs/${runId}`).expect(200)).body.run.stale;
    await new Promise((x) => setTimeout(x, 20));
    await adjustment(c, { id: `draft-${rnd()}`, employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 100, status: 'DRAFT' });
    expect(await stale()).toBeNull();
    await own(c, () => payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId: r.employeeId, type: 'LOAN', principal: 3000, startDate: '2026-06-01', outstandingBalance: 3000, status: 'ACTIVE', createdByUserId: 'test' } as any }));
    expect(await stale()).toMatch(/loans/);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    expect(await stale()).toBeNull();
    await new Promise((x) => setTimeout(x, 20));
    await own(c, () => payrollPrisma.salaryComponent.updateMany({ where: { orgId: c.orgId, id: r.fineId }, data: { name: 'Fine (damage)' } }));
    expect(await stale()).toMatch(/salary structure/);
  }, 180_000);
});

describe('re-review 5a7645e6: the month to pay in, by pay group', () => {
  it('a month another pay group has finished is still open for this one', async () => {
    const c = await makeOwner();
    const thisMonth = (await api.post(c, '/periods', { name: `This ${rnd()}`, ...monthSpan(0) }).expect(201)).body.period.id;
    const next = (await api.post(c, '/periods', { name: `Next ${rnd()}`, ...monthSpan(1) }).expect(201)).body.period.id;
    const groupA = (await api.post(c, '/pay-groups', { name: `Weavers ${rnd()}`, frequency: 'MONTHLY' }).expect(201)).body.payGroup.id;
    const groupB = (await api.post(c, '/pay-groups', { name: `Office ${rnd()}`, frequency: 'MONTHLY' }).expect(201)).body.payGroup.id;
    const person = async (payGroupId: string) => (await api.post(c, '/employees', { name: `P ${rnd()}`, code: `E${rnd()}`, dateOfJoining: '2025-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', payGroupId } }).expect(201)).body.employee.id as string;
    const inA = await person(groupA);
    const inB = await person(groupB);
    const runA = (await api.post(c, '/runs', { periodId: thisMonth, payGroupId: groupA }).expect(201)).body.run.id;
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: runA }, data: { status: 'APPROVED' } }));
    expect((await own(c, () => periodToPayIn(c.orgId, undefined, inA)))?.id).toBe(next);
    expect((await own(c, () => periodToPayIn(c.orgId, undefined, inB)))?.id).toBe(thisMonth);
  }, 120_000);
});
