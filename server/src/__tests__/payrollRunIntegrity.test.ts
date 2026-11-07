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

/* ------------------------------------------------------------ review of #145 */

async function approvedWithPayment(c: Ctx) {
  const { periodId, employeeId } = await setUp(c);
  const runId = await calculated(c, periodId);
  await api.post(c, `/runs/${runId}/approve`).expect(200);
  const bank = await bankLedger(c);
  const pay = await api.post(c, '/payments', { runId, paymentDate: '2026-10-31', ledgerAccountId: bank.id }).expect(201);
  return { runId, employeeId, bank, paymentId: pay.body.payment.id as string, line: await lineOf(pay.body.payment.id) };
}

/** Run `between` after the route's first read of `model`, before it writes: deterministic, not a race of requests. */
function between(model: any, method: string, gap: () => Promise<unknown>) {
  const read = model[method].bind(model);
  return vi.spyOn(model, method).mockImplementationOnce(async (args: any) => {
    const row = await read(args);
    await gap();
    return row;
  });
}

describe('B2 cancelling a loan', () => {
  async function approvedLoan(c: Ctx, employeeId: string, periodId: string) {
    const recovery = await mk(c, { name: 'Loan recovery', code: `LOAN${rnd().toUpperCase()}`, type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 });
    const made = await api.post(c, '/loans', { employeeId, principal: 60_000, interestRate: 0, startDate: '2026-10-01', recoveryStartPeriodId: periodId, installmentCount: 6, recoveryComponentId: recovery }).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);
    return (await api.get(c, `/loans/${made.body.loan.id}`)).body.loan;
  }

  it('is refused to the person who owes it while somebody else could', async () => {
    const c = await makeOwner();
    const other = await member(c, 'ADMIN');
    const { employeeId, periodId } = await setUp(c);
    const loan = await approvedLoan(c, employeeId, periodId);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: other.userId } });
    const res = await api.post(other, `/loans/${loan.id}/cancel`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWN_RECORD');
    expect(await payrollPrisma.payrollLoanInstallment.count({ where: { loanId: loan.id } })).toBe(6);
    await api.post(c, `/loans/${loan.id}/cancel`).expect(200);
    expect(await payrollPrisma.payrollLoanInstallment.count({ where: { loanId: loan.id } })).toBe(0);
  });

  it('a payroll recovering an instalment after the check: nothing is deleted and the cancel is refused', async () => {
    const c = await makeOwner();
    const { employeeId, periodId } = await setUp(c);
    const loan = await approvedLoan(c, employeeId, periodId);
    const first = loan.installments[0].id;
    const spy = between(payrollPrisma.payrollLoan, 'findFirst', () => payrollPrisma.payrollLoanInstallment.updateMany({ where: { id: first }, data: { status: 'RECOVERED' } }));
    const res = await api.post(c, `/loans/${loan.id}/cancel`);
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOAN_CHANGED');
    expect(await payrollPrisma.payrollLoanInstallment.count({ where: { loanId: loan.id } })).toBe(6);
    expect((await payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: loan.id } })).status).not.toBe('CANCELLED');
  });

  it('a payroll that recovers after the cancel finds the instalment gone, and stops', async () => {
    const c = await makeOwner();
    const { employeeId, periodId } = await setUp(c);
    const loan = await approvedLoan(c, employeeId, periodId);
    await api.post(c, `/loans/${loan.id}/cancel`).expect(200);
    /* What run.ts does on a full recovery: a conditional update that must move every instalment it took. */
    const n = await payrollPrisma.payrollLoanInstallment.updateMany({ where: { orgId: c.orgId, id: { in: [loan.installments[0].id] }, status: 'PENDING' }, data: { status: 'RECOVERED' } });
    expect(n.count).toBe(0);
  });
});

describe('S1 the bank file', () => {
  it('is refused for a cancelled payment; a payslip cancelled then paid again is in one file only', async () => {
    const c = await makeOwner();
    const { runId, bank, paymentId, line } = await approvedWithPayment(c);
    await api.post(c, `/payments/${paymentId}/cancel`).expect(200);
    const second = await api.post(c, '/payments', { runId, paymentDate: '2026-11-01', ledgerAccountId: bank.id }).expect(201);

    const old = await api.get(c, `/payments/${paymentId}/advice`);
    expect(old.status).toBe(409);
    expect(old.body.code).toBe('PAYMENT_CANCELLED');
    const fresh = await api.get(c, `/payments/${second.body.payment.id}/advice`).expect(200);
    expect(fresh.body.rows).toHaveLength(1);
    expect(fresh.body.rows[0].amount).toBe(Number(line.amount));
  });

  it('leaves out a line already paid or rejected', async () => {
    const c = await makeOwner();
    const { paymentId, line } = await approvedWithPayment(c);
    await api.post(c, `/payments/${paymentId}/settle`, { results: [{ lineId: line.id, status: 'PAID' }] }).expect(200);
    expect((await api.get(c, `/payments/${paymentId}/advice`).expect(200)).body.rows).toHaveLength(0);
  });
});

describe('S2 recording what the bank did', () => {
  it('(a) the payment cancelled between the read and the write: refused, the line stays cancelled', async () => {
    const c = await makeOwner();
    const { paymentId, line } = await approvedWithPayment(c);
    const spy = between(payrollPrisma.payrollPayment, 'findFirst', async () => {
      await payrollPrisma.payrollPayment.update({ where: { id: paymentId }, data: { status: 'CANCELLED' } });
      await payrollPrisma.payrollPaymentLine.updateMany({ where: { paymentId }, data: { status: 'CANCELLED' } });
    });
    const res = await api.post(c, `/payments/${paymentId}/settle`, { results: [{ lineId: line.id, status: 'PAID' }] });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_CHANGED');
    expect((await payrollPrisma.payrollPaymentLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('CANCELLED');
    expect((await payrollPrisma.salarySlip.findUniqueOrThrow({ where: { id: line.slipId } })).paymentStatus).not.toBe('PAID');
  });

  it('(b) the payroll cancelled between the read and the write: nothing on it is marked paid', async () => {
    const c = await makeOwner();
    const { runId, paymentId, line } = await approvedWithPayment(c);
    const spy = between(payrollPrisma.payrollPayment, 'findFirst', () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'CANCELLED' } }));
    const res = await api.post(c, `/payments/${paymentId}/settle`, { results: [{ lineId: line.id, status: 'PAID' }] });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RUN_NOT_APPROVED');
    expect((await payrollPrisma.payrollPaymentLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('PENDING');
  });

  it('N3 a payslip that is gone is said in words, not a server error', async () => {
    const c = await makeOwner();
    const { paymentId, line } = await approvedWithPayment(c);
    await payrollPrisma.salarySlipLine.deleteMany({ where: { slipId: line.slipId } });
    await payrollPrisma.payrollCalculationTrace.deleteMany({ where: { slipId: line.slipId } });
    await payrollPrisma.salarySlip.delete({ where: { id: line.slipId } });
    const res = await api.post(c, `/payments/${paymentId}/settle`, { results: [{ lineId: line.id, status: 'PAID' }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLIP_GONE');
    expect((await payrollPrisma.payrollPaymentLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('PENDING');
  });
});

describe('S3 the one-live-line index', () => {
  it('a missing index and a payslip in two live payments are reported, and the index is built once that is cleared', async () => {
    const { PrismaClient } = await import('../generated/payroll/index.js');
    const { checkCompany } = await import('../services/integrity/checks.js');
    const health = await import('../services/payroll/liveLineIndex.js');
    const own = new URL(String(process.env.PAYROLL_DATABASE_URL));
    const adminUrl = new URL(String(process.env.PGADMIN_URL || process.env.PG_ADMIN_URL || process.env.DATABASE_URL));
    adminUrl.pathname = own.pathname;
    adminUrl.search = own.search;
    const owner = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    const build = `CREATE UNIQUE INDEX IF NOT EXISTS "${health.LIVE_LINE_INDEX}" ON "PayrollPaymentLine"("slipId") WHERE "status" IN ('PENDING', 'PAID')`;

    const c = await makeOwner();
    const { runId, line } = await approvedWithPayment(c);
    let extraLine = '';
    try {
      await owner.$executeRawUnsafe(`DROP INDEX IF EXISTS "${health.LIVE_LINE_INDEX}"`);
      expect(await health.liveLineIndexPresent()).toBe(false);
      const extra = await payrollPrisma.payrollPayment.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `PAY-X-${rnd()}`, runId, paymentDate: '2026-10-31', totalAmount: 0, createdByUserId: c.userId } });
      extraLine = (await payrollPrisma.payrollPaymentLine.create({ data: { accountId: c.accountId, orgId: c.orgId, paymentId: extra.id, slipId: line.slipId, employeeId: line.employeeId, amount: 1, status: 'PENDING' } })).id;

      const found = await checkCompany({ accountId: c.accountId, orgId: c.orgId });
      expect(found.filter((f) => f.link.includes('two live payments')).map((f) => f.sourceId)).toEqual([line.slipId]);
      const refused = await health.ensureLiveLineIndex();
      expect(refused.built).toBe(false);
      expect(refused.clashes.map((x) => x.orgId)).toContain(c.orgId);

      /* The owner cancels the extra batch; the next check builds the index. Built here as the table's owner,
         as clor_app is in production (it runs the migrations); in this suite it only uses the tables. */
      await payrollPrisma.payrollPaymentLine.update({ where: { id: extraLine }, data: { status: 'CANCELLED' } });
      const built = await health.ensureLiveLineIndex((sql) => owner.$executeRawUnsafe(sql));
      expect(built).toMatchObject({ indexPresent: true, built: true });
      expect(await health.liveLineIndexPresent()).toBe(true);
    } finally {
      if (extraLine) await payrollPrisma.payrollPaymentLine.update({ where: { id: extraLine }, data: { status: 'CANCELLED' } });
      await owner.$executeRawUnsafe(build);
      await owner.$disconnect();
    }
  });
});

describe('S4 your own tax and statutory settings', () => {
  it('are not switched by the person they are about while somebody else could; their name is', async () => {
    const c = await makeOwner();
    const other = await member(c, 'ADMIN');
    const { employeeId } = await setUp(c);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: other.userId } });
    const person = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const base = { name: person.name, code: person.code, dateOfJoining: person.dateOfJoining, status: 'ACTIVE' };
    const payroll = { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true, esiApplicable: true, ptApplicable: true, professionalTaxState: 'Karnataka', bankAccountName: 'Meera Shetty', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' };

    for (const change of [{ pfApplicable: false }, { esiApplicable: false }, { ptApplicable: false }, { taxRegime: 'OLD' }, { professionalTaxState: 'Goa' }, { payrollStatus: 'EXCLUDED' }]) {
      const res = await api.put(other, `/employees/${employeeId}`, { ...base, payroll: { ...payroll, ...change } });
      expect(res.status, JSON.stringify(change)).toBe(403);
      expect(res.body.code).toBe('OWN_RECORD');
    }
    const profile = await payrollPrisma.employeePayrollProfile.findFirstOrThrow({ where: { orgId: c.orgId, employeeId } });
    expect(profile).toMatchObject({ pfApplicable: true, esiApplicable: true, ptApplicable: true, taxRegime: 'NEW' });

    await api.put(other, `/employees/${employeeId}`, { ...base, name: 'Meera S Shetty', payroll }).expect(200);
    await api.put(c, `/employees/${employeeId}`, { ...base, payroll: { ...payroll, pfApplicable: false } }).expect(200);
  });
});

describe('N2 recording a statutory scheme does not apply', () => {
  it('needs a fresh authenticator code from someone who has one', async () => {
    const c = await makeOwner();
    const { periodId } = await setUp(c, { statutory: ['PF'] });
    const runId = await calculated(c, periodId);
    await platformPrisma.user.update({ where: { id: c.userId }, data: { totpEnabledAt: new Date() } });
    const body = { schemes: ['PF'], reason: '12 people, under the PF threshold of 20' };
    const asked = await api.post(c, `/runs/${runId}/statutory-waiver`, body);
    expect(asked.status).toBe(403);
    expect(asked.body.code).toBe('STEP_UP_REQUIRED');
    const { issueStepUp } = await import('../services/stepUp.js');
    const { token } = issueStepUp(c.userId, undefined);
    await request(app).post(`/api/orgs/${c.orgId}/payroll/runs/${runId}/statutory-waiver`).set({ ...at(c), 'x-step-up': token }).send(body).expect(200);
  });

  it('says an owner or administrator records it', async () => {
    const c = await makeOwner();
    const manager = await member(c, 'Payroll Manager');
    const { periodId } = await setUp(c, { statutory: ['PF'] });
    const runId = await calculated(c, periodId);
    const res = await api.post(manager, `/runs/${runId}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/an owner or administrator records why/);
  });
});

describe('N1 professional tax with no rate for the month', () => {
  it('says to add the month\'s rate for their state, not to switch it on', async () => {
    const { gapsAdvice } = await import('../services/payroll/statutoryGaps.js');
    const text = gapsAdvice([{ scheme: 'PT', name: 'Professional Tax', reason: 'NO_RULE', mayStandWithout: false, people: [{ employeeId: 'e', name: 'Meera' }] }]);
    expect(text).toMatch(/add a rate for this pay month to Professional Tax in Payroll › Compliance/);
    expect(text).toMatch(/no rate covers this month in the state these people work in/);
    expect(text).not.toMatch(/switch Professional Tax on/i);
  });
});

describe('Re-review of #145', () => {
  async function adminClient() {
    const { PrismaClient } = await import('../generated/payroll/index.js');
    const own = new URL(String(process.env.PAYROLL_DATABASE_URL));
    const adminUrl = new URL(String(process.env.PGADMIN_URL || process.env.PG_ADMIN_URL || process.env.DATABASE_URL));
    adminUrl.pathname = own.pathname;
    adminUrl.search = own.search;
    return new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  }

  it('S1 a rejected line marked paid again while its payslip is in a newer live payment is refused, with the index gone', async () => {
    const health = await import('../services/payroll/liveLineIndex.js');
    const owner = await adminClient();
    const c = await makeOwner();
    const { runId, bank, paymentId, line } = await approvedWithPayment(c);
    try {
      await owner.$executeRawUnsafe(`DROP INDEX IF EXISTS "${health.LIVE_LINE_INDEX}"`);
      await api.post(c, `/payments/${paymentId}/settle`, { results: [{ lineId: line.id, status: 'FAILED', failureReason: 'Wrong IFSC' }] }).expect(200);
      const second = await api.post(c, '/payments', { runId, paymentDate: '2026-11-02', ledgerAccountId: bank.id }).expect(201);
      for (const status of ['PAID', 'PENDING']) {
        const res = await api.post(c, `/payments/${paymentId}/settle`, { results: [{ lineId: line.id, status }] });
        expect(res.status, status).toBe(409);
        expect(res.body.code).toBe('SLIP_ALREADY_IN_PAYMENT');
      }
      expect(await payrollPrisma.payrollPaymentLine.count({ where: { slipId: line.slipId, status: { in: ['PENDING', 'PAID'] } } })).toBe(1);
      expect((await lineOf(paymentId)).status).toBe('FAILED');
      expect((await lineOf(second.body.payment.id)).status).toBe('PENDING');
    } finally {
      await owner.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "${health.LIVE_LINE_INDEX}" ON "PayrollPaymentLine"("slipId") WHERE "status" IN ('PENDING', 'PAID')`);
      await owner.$disconnect();
    }
  });

  it('N1 a save that leaves out the tax regime and payroll status keeps them, for somebody else and for yourself', async () => {
    const c = await makeOwner();
    const other = await member(c, 'ADMIN');
    const { employeeId } = await setUp(c);
    await payrollPrisma.employeePayrollProfile.updateMany({ where: { orgId: c.orgId, employeeId }, data: { taxRegime: 'OLD', payrollStatus: 'ON_HOLD', professionalTaxState: 'Karnataka' } });
    const person = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const base = { name: person.name, code: person.code, dateOfJoining: person.dateOfJoining, status: 'ACTIVE' };
    const payroll = { bankAccountName: 'Meera Shetty', bankName: 'HDFC Bank' };
    const kept = () => payrollPrisma.employeePayrollProfile.findFirstOrThrow({ where: { orgId: c.orgId, employeeId } });
    await api.put(c, `/employees/${employeeId}`, { ...base, payroll }).expect(200);
    expect(await kept()).toMatchObject({ taxRegime: 'OLD', payrollStatus: 'ON_HOLD', professionalTaxState: 'Karnataka' });
    /* Their own record, while somebody else could: nothing statutory sent, so nothing to refuse. */
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: other.userId } });
    await api.put(other, `/employees/${employeeId}`, { ...base, name: 'Meera S Shetty', payroll }).expect(200);
    expect(await kept()).toMatchObject({ taxRegime: 'OLD', payrollStatus: 'ON_HOLD', professionalTaxState: 'Karnataka' });
  });

  it('N2 a cancel between the approval\'s read and its write: the loan stays cancelled with no schedule', async () => {
    const c = await makeOwner();
    const { employeeId, periodId } = await setUp(c);
    const recovery = await mk(c, { name: 'Loan recovery', code: `LOAN${rnd().toUpperCase()}`, type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 });
    const body = { employeeId, principal: 60_000, interestRate: 0, startDate: '2026-10-01', recoveryStartPeriodId: periodId, installmentCount: 6, recoveryComponentId: recovery };
    const loanId = (await api.post(c, '/loans', body).expect(201)).body.loan.id as string;
    const { approveLoan } = await import('../services/payroll/loan.js');
    const who = { accountId: c.accountId, orgId: c.orgId, userId: c.userId };
    const spy = between(payrollPrisma.payrollLoan, 'findFirst', () => payrollPrisma.payrollLoan.updateMany({ where: { id: loanId }, data: { status: 'CANCELLED' } }));
    await expect(approveLoan({ ...who, loanId })).rejects.toMatchObject({ code: 'LOAN_CANCELLED' });
    spy.mockRestore();
    expect((await payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe('CANCELLED');
    expect(await payrollPrisma.payrollLoanInstallment.count({ where: { loanId } })).toBe(0);
    /* Two approvals at once: one approves, the other is told it changed; one schedule. */
    const second = (await api.post(c, '/loans', body).expect(201)).body.loan.id as string;
    const results = await Promise.allSettled([1, 2].map(() => approveLoan({ ...who, loanId: second })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await payrollPrisma.payrollLoanInstallment.count({ where: { loanId: second } })).toBe(6);
  });
});
