import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Payroll run integrity (audit 7 Nov 2026, #3–#8, #20).
 *
 *  #3  a payroll whose payslips carry a statutory line nothing worked out (scheme off, or no rate) is not approved;
 *      the owner alone may record that PF, ESI or LWF does not apply; never TDS or PT.
 *  #4  an approved payroll with money on its way is not cancelled; every status move is compare-and-set.
 *  #5  one live payment per payslip, held by the database.
 *  #6  nobody sets their own salary; #7 nobody waives their own loan instalment, and a waive is conditional.
 *  #8  the Viewer role reads no Payroll.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `ri.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Run owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `RI Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId }, select: { accountId: true } });
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** Another person in the company, on one of the stock roles (ADMIN, or a preset label such as "Payroll Manager", "Viewer"). */
async function member(c: Ctx, role: 'ADMIN' | string): Promise<Ctx> {
  const { ensureDefaultRoles } = await import('../services/defaultRoles.js');
  await ensureDefaultRoles(c.accountId, c.orgId, c.userId);
  const email = `ri2.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(c)).send({ email, fullName: `Member ${rnd()}`, password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const r = await platformPrisma.role.findFirstOrThrow({ where: role === 'ADMIN' ? { orgId: c.orgId, roleType: 'ADMIN' } : { orgId: c.orgId, name: role }, select: { id: true } });
  await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(at(c)).send({ roleId: r.id }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { ...c, token: login.body.token, userId: made.body.user.id };
}

const mk = async (c: Ctx, payload: Record<string, unknown>) => (await api.post(c, '/components', payload).expect(201)).body.component.id as string;

/** A structure with Basic and the given statutory lines, one person on it, and a period. Schemes are seeded (off) unless `on`. */
async function setUp(c: Ctx, opts: { statutory?: Array<'PF' | 'ESI' | 'TDS' | 'PT' | 'LWF'>; on?: string[]; state?: string; bank?: boolean } = {}) {
  await api.post(c, '/statutory/seed').expect(200);
  if (opts.on?.length) {
    const { body } = await api.get(c, '/statutory').expect(200);
    for (const s of body.schemes.filter((x: any) => opts.on!.includes(x.code))) await api.put(c, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  }
  const { ensureLedgerSetup } = await import('../services/ledger.js');
  await ensureLedgerSetup(c.accountId, c.orgId, 'test');
  const expense = await prisma.ledgerAccount.findFirst({ where: { accountId: c.accountId, orgId: c.orgId, isActive: true, controlKind: 'EXPENSES' }, select: { id: true } });
  const comps = [{ componentId: await mk(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, includeInEsiWage: true, expenseLedgerId: expense?.id || null, displayOrder: 1 }), displayOrder: 1 }];
  for (const [i, scheme] of (opts.statutory || []).entries()) {
    comps.push({ componentId: await mk(c, { name: `Employee ${scheme}`, code: `E_${scheme}`, type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: scheme, includeInGross: false, isTaxable: false, displayOrder: 10 + i }), displayOrder: 10 + i });
  }
  const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: comps }).expect(201);
  const period = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
  const person = await api.post(c, '/employees', {
    name: 'Meera Shetty', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
    payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true, esiApplicable: true, ptApplicable: true, professionalTaxState: opts.state || 'Karnataka', ...(opts.bank === false ? {} : { bankAccountName: 'Meera Shetty', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' }) },
  }).expect(201);
  await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }).expect(201);
  return { periodId: period.body.period.id as string, employeeId: person.body.employee.id as string, structureId: structure.body.structure.id as string };
}

async function calculated(c: Ctx, periodId: string) {
  const run = await api.post(c, '/runs', { periodId }).expect(201);
  const id = run.body.run.id as string;
  await api.post(c, `/runs/${id}/validate`).expect(200);
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  await api.post(c, `/runs/${id}/submit-review`).expect(200);
  return id;
}

const lineOf = (paymentId: string) => payrollPrisma.payrollPaymentLine.findFirstOrThrow({ where: { paymentId } });

async function bankLedger(c: Ctx) {
  const row = await prisma.ledgerAccount.findFirst({ where: { accountId: c.accountId, orgId: c.orgId, isActive: true, OR: [{ controlKind: 'BANK' }, { controlKind: 'CASH' }] }, select: { id: true } });
  if (row) return row;
  return prisma.ledgerAccount.create({ data: { accountId: c.accountId, orgId: c.orgId, code: `BANK${rnd().toUpperCase()}`, name: 'Salary Bank', accountType: 'ASSET', controlKind: 'BANK', isActive: true, createdByUserId: 'test' }, select: { id: true } });
}

describe('#3 approving with a statutory scheme switched off', () => {
  it('is refused, naming the scheme and who it shows as nil for', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PF', 'ESI', 'PT', 'TDS'] });
    const runId = await calculated(c, periodId);

    const detail = await api.get(c, `/runs/${runId}`).expect(200);
    expect(detail.body.statutoryGaps.map((g: any) => [g.scheme, g.reason, g.mayStandWithout])).toEqual([
      ['ESI', 'OFF', true], ['PF', 'OFF', true], ['PT', 'OFF', false], ['TDS', 'OFF', false],
    ]);
    expect(detail.body.statutoryGaps[0].people[0].name).toBe('Meera Shetty');

    const res = await api.post(c, `/runs/${runId}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STATUTORY_NOT_SET_UP');
    expect(res.body.error).toMatch(/Provident Fund is switched off \(1 person\)/);
    /* TDS and PT are in it, so nobody may waive the lot. */
    expect(res.body.canWaive).toBe(false);
    expect((await payrollPrisma.payrollRun.findUnique({ where: { id: runId } }))!.status).toBe('REVIEW');
  });

  it('is approved once the schemes are switched on and it is calculated again', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PF', 'TDS'], on: ['PF', 'TDS'] });
    const runId = await calculated(c, periodId);
    expect((await api.get(c, `/runs/${runId}`)).body.statutoryGaps).toEqual([]);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
  });

  it('lets the owner record that PF does not apply (under 20 people), for this calculation only', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PF', 'TDS'], on: ['TDS'] });
    const runId = await calculated(c, periodId);

    const short = await api.post(c, `/runs/${runId}/statutory-waiver`, { schemes: ['PF'], reason: 'no' });
    expect(short.status).toBe(400);
    const tds = await api.post(c, `/runs/${runId}/statutory-waiver`, { schemes: ['TDS'], reason: 'We think it does not apply' });
    expect(tds.status).toBe(409);
    expect(tds.body.code).toBe('NOT_A_GAP');

    const ok = await api.post(c, `/runs/${runId}/statutory-waiver`, { schemes: ['pf'], reason: '12 people, under the PF threshold of 20' }).expect(200);
    expect(ok.body.run.statutoryWaiver.schemes).toEqual(['PF']);
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, entityId: runId, action: 'STATUTORY_WAIVED' } })).toBe(1);

    /* Calculated again: the figures it was about are gone, and it asks again. */
    await payrollPrisma.payrollRun.update({ where: { id: runId }, data: { calculatedAt: new Date(Date.now() + 1000) } });
    const again = await api.post(c, `/runs/${runId}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('STATUTORY_NOT_SET_UP');
    expect(again.body.canWaive).toBe(true);
  });

  it('approves after the owner records it', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PF', 'ESI'] });
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/statutory-waiver`, { schemes: ['PF', 'ESI'], reason: '7 people: under 10 for ESI and 20 for PF' }).expect(200);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
  });

  it('never waives income tax or professional tax', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PT', 'TDS'] });
    const runId = await calculated(c, periodId);
    for (const scheme of ['PT', 'TDS']) {
      const res = await api.post(c, `/runs/${runId}/statutory-waiver`, { schemes: [scheme], reason: 'It does not apply to us' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NOT_WAIVABLE');
    }
  });

  it('only the owner records it: a Payroll Manager may approve but not waive', async () => {
    const c = await makeOwner();
    const manager = await member(c, 'Payroll Manager');
    const { periodId } = await setUp(c, { statutory: ['PF'] });
    const runId = await calculated(c, periodId);
    const res = await api.post(manager, `/runs/${runId}/statutory-waiver`, { schemes: ['PF'], reason: '12 people, under the PF threshold' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_ONLY');
    expect((await api.get(manager, `/runs/${runId}`)).body.canWaiveStatutory).toBe(false);
  });

  it('another company cannot record it', async () => {
    const c = await makeOwner();
    const other = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PF'] });
    const runId = await calculated(c, periodId);
    const res = await api.post(other, `/runs/${runId}/statutory-waiver`, { schemes: ['PF'], reason: '12 people, under the PF threshold' });
    expect(res.status).toBe(404);
  });

  it('is not a gap where the state levies no professional tax', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PT', 'TDS'], on: ['PT', 'TDS'], state: 'Delhi' });
    const runId = await calculated(c, periodId);
    expect((await api.get(c, `/runs/${runId}`)).body.statutoryGaps).toEqual([]);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
  });
});

describe('#4 cancelling a payroll that is being paid', () => {
  it('is refused while a payment holds its payslips, and allowed once the payment is called off', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const pay = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);

    const refused = await api.post(c, `/runs/${runId}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RUN_HAS_PAYMENTS');
    expect(await payrollPrisma.salarySlip.count({ where: { orgId: c.orgId, runId } })).toBe(1);

    await api.post(c, `/payments/${pay.body.payment.id}/cancel`).expect(200);
    const line = await payrollPrisma.payrollPaymentLine.findFirst({ where: { paymentId: pay.body.payment.id } });
    expect(line!.status).toBe('CANCELLED');
    await api.post(c, `/runs/${runId}/cancel`).expect(200);
  });

  it('is refused once a line is paid', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const pay = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);
    const lineId = (await lineOf(pay.body.payment.id)).id;
    await api.post(c, `/payments/${pay.body.payment.id}/settle`, { results: [{ lineId, status: 'PAID' }] }).expect(200);
    const refused = await api.post(c, `/runs/${runId}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RUN_HAS_PAYMENTS');
  });

  it('counts a line the bank rejected as no payment', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const pay = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);
    await api.post(c, `/payments/${pay.body.payment.id}/settle`, { results: [{ lineId: (await lineOf(pay.body.payment.id)).id, status: 'FAILED', failureReason: 'Closed account' }] }).expect(200);
    await api.post(c, `/runs/${runId}/cancel`).expect(200);
  });

  it('two cancels at once: one cancels, the other is told it changed', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    const [a, b] = await Promise.all([api.post(c, `/runs/${runId}/cancel`), api.post(c, `/runs/${runId}/cancel`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await payrollPrisma.payrollRun.findUnique({ where: { id: runId } }))!.status).toBe('CANCELLED');
  });

  it('a payment and a cancel at once never leave a payment on a cancelled payroll', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const [pay, cancel] = await Promise.all([
      api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }),
      api.post(c, `/runs/${runId}/cancel`),
    ]);
    const run = await payrollPrisma.payrollRun.findUnique({ where: { id: runId } });
    const live = await payrollPrisma.payrollPaymentLine.count({ where: { orgId: c.orgId, status: { in: ['PENDING', 'PAID'] }, payment: { runId, status: { not: 'CANCELLED' } } } });
    if (run!.status === 'CANCELLED') {
      expect(live).toBe(0);
      expect(pay.status).toBe(409);
    } else {
      expect(cancel.status).toBe(409);
      expect(live).toBe(1);
    }
  });

  it('a paid run that is already posted is not moved back to PAID', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    await api.post(c, `/runs/${runId}/post`).expect(201);
    const bank = await bankLedger(c);
    const pay = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);
    await api.post(c, `/payments/${pay.body.payment.id}/settle`, { results: [{ lineId: (await lineOf(pay.body.payment.id)).id, status: 'PAID' }] }).expect(200);
    await api.post(c, `/payments/${pay.body.payment.id}/post`).expect(200);
    expect((await payrollPrisma.payrollRun.findUnique({ where: { id: runId } }))!.status).toBe('POSTED');
  });
});

describe('#5 one live payment per payslip', () => {
  it('two batches made at the same moment: one is made, the other refused', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const body = { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id };
    const results = await Promise.all([api.post(c, '/payments', body), api.post(c, '/payments', body), api.post(c, '/payments', body)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(['SLIP_ALREADY_IN_PAYMENT', 'NOTHING_TO_PAY']).toContain(r.body.code);
    }
    expect(await payrollPrisma.payrollPaymentLine.count({ where: { orgId: c.orgId, payment: { runId } } })).toBe(1);
  });

  it('the database refuses a second live line for one payslip, whatever the route did', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const pay = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);
    const line = await lineOf(pay.body.payment.id);
    const second = await payrollPrisma.payrollPayment.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `PAY-X-${rnd()}`, runId, paymentDate: '2026-10-31', totalAmount: 0, createdByUserId: c.userId } });
    await expect(
      payrollPrisma.payrollPaymentLine.create({ data: { accountId: c.accountId, orgId: c.orgId, paymentId: second.id, slipId: line.slipId, employeeId: line.employeeId, amount: 1, status: 'PENDING' } })
    ).rejects.toMatchObject({ code: 'P2002' });
    /* A rejected or called-off line holds nothing. */
    await payrollPrisma.payrollPaymentLine.create({ data: { accountId: c.accountId, orgId: c.orgId, paymentId: second.id, slipId: line.slipId, employeeId: line.employeeId, amount: 1, status: 'FAILED' } });
  });

  it('a rejected line marked paid again, once its payslip is in another batch, is refused in words', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c);
    const runId = await calculated(c, periodId);
    await api.post(c, `/runs/${runId}/approve`).expect(200);
    const bank = await bankLedger(c);
    const first = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);
    const lineId = (await lineOf(first.body.payment.id)).id;
    await api.post(c, `/payments/${first.body.payment.id}/settle`, { results: [{ lineId, status: 'FAILED', failureReason: 'Wrong IFSC' }] }).expect(200);
    await api.post(c, '/payments', { runId, paymentDate: '2026-11-02', ledgerAccountId: bank.id }).expect(201);
    const res = await api.post(c, `/payments/${first.body.payment.id}/settle`, { results: [{ lineId, status: 'PAID' }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLIP_ALREADY_IN_PAYMENT');
  });
});

describe('#6 your own salary', () => {
  it('is refused while somebody else could set it, on create, edit and delete', async () => {
    const c = await makeOwner();
    const other = await member(c, 'ADMIN');
    const { employeeId, structureId } = await setUp(c);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: other.userId } });

    const create = await api.post(other, '/assignments', { employeeId, structureId, effectiveFrom: '2026-11-01', annualCtc: 9_000_000 });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('OWN_RECORD');

    const current = await payrollPrisma.salaryAssignment.findFirstOrThrow({ where: { orgId: c.orgId, employeeId } });
    const edit = await api.put(other, `/assignments/${current.id}`, { employeeId, structureId, effectiveFrom: '2026-01-01', annualCtc: 9_000_000 });
    expect(edit.status).toBe(403);
    const del = await api.del(other, `/assignments/${current.id}`);
    expect(del.status).toBe(403);
    expect(Number((await payrollPrisma.salaryAssignment.findUniqueOrThrow({ where: { id: current.id } })).annualCtc)).toBe(600_000);

    /* The other administrator sets it. */
    await api.post(c, '/assignments', { employeeId, structureId, effectiveFrom: '2026-11-01', annualCtc: 720_000 }).expect(201);
  });

  it('an owner alone in the company sets their own, and it is audited', async () => {
    const c = await makeOwner();
    const { employeeId, structureId } = await setUp(c);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: c.userId } });
    await api.post(c, '/assignments', { employeeId, structureId, effectiveFrom: '2026-11-01', annualCtc: 720_000 }).expect(201);
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'OWN_RECORD_ALONE' } })).toBe(1);
  });

  it('an owner alone under STRICT is told to give somebody the right', async () => {
    const c = await makeOwner();
    const current = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...current, makerChecker: 'STRICT' }).expect(200);
    const { employeeId, structureId } = await setUp(c);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: c.userId } });
    const res = await api.post(c, '/assignments', { employeeId, structureId, effectiveFrom: '2026-11-01', annualCtc: 720_000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Give somebody the right/);
  });
});

describe('#7 your own loan instalment', () => {
  async function runningLoan(c: Ctx, employeeId: string, periodId: string) {
    const recovery = await mk(c, { name: 'Loan recovery', code: `LOAN${rnd().toUpperCase()}`, type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 });
    const made = await api.post(c, '/loans', { employeeId, principal: 60_000, interestRate: 0, startDate: '2026-10-01', recoveryStartPeriodId: periodId, installmentCount: 6, recoveryComponentId: recovery }).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);
    return (await api.get(c, `/loans/${made.body.loan.id}`)).body.loan;
  }

  it('is not waived by the person who owes it', async () => {
    const c = await makeOwner();
    const other = await member(c, 'ADMIN');
    const { employeeId, periodId } = await setUp(c);
    const loan = await runningLoan(c, employeeId, periodId);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: other.userId } });
    const res = await api.post(other, `/loans/${loan.id}/installments/${loan.installments[0].id}`, { action: 'WAIVE' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWN_RECORD');
    await api.post(c, `/loans/${loan.id}/installments/${loan.installments[0].id}`, { action: 'WAIVE' }).expect(200);
  });

  it('a waive does not overwrite an instalment a payroll took after it was read', async () => {
    const c = await makeOwner();
    const { employeeId, periodId } = await setUp(c);
    const loan = await runningLoan(c, employeeId, periodId);
    const id = loan.installments[0].id;
    /* Hold the route between its read and its write: a payroll recovers the
       instalment in that gap. Done deterministically rather than by racing requests. */
    const model = payrollPrisma.payrollLoanInstallment as any;
    const read = model.findFirst.bind(model);
    const spy = vi.spyOn(model, 'findFirst').mockImplementationOnce(async (args: any) => {
      const row = await read(args);
      await payrollPrisma.payrollLoanInstallment.updateMany({ where: { id }, data: { status: 'RECOVERED' } });
      return row;
    });
    const res = await api.post(c, `/loans/${loan.id}/installments/${id}`, { action: 'WAIVE' });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSTALMENT_CHANGED');
    const after = await payrollPrisma.payrollLoanInstallment.findFirst({ where: { id } });
    expect(after!.status).toBe('RECOVERED');
  });
});

describe('#8 the Viewer role', () => {
  it('reads no Payroll', async () => {
    const c = await makeOwner();
    const viewer = await member(c, 'Viewer');
    const res = await api.get(viewer, '/runs');
    expect(res.status).toBe(403);
    const { expandPreset } = await import('../constants/permissionCatalog.js');
    expect(expandPreset('VIEWER').some((r) => r.module === 'PAYROLL')).toBe(false);
    expect(expandPreset('VIEWER').some((r) => r.module === 'PEOPLE')).toBe(true);
  });
});
