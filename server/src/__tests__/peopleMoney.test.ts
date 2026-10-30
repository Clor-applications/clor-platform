import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Expense claims with advances, and salary advances (WORKFLOW-GAP-RESEARCH
 * 30 Oct 2026, 4.1 and 4.2): bills from the employee app with their photos,
 * duplicates caught, the manager approving in the one inbox (allowing less on
 * a bill, with a reason), advances set against claims, paying with salary (a
 * draft Payroll earning) or paid now (listed for Books), the half-of-pay cap
 * on a salary advance, and the Payroll loan it becomes. Who may do what,
 * company isolation, and the races: double submit, double pay, one advance
 * used by two claims at once.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function owner(): Promise<Ctx> {
  const email = `money.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Money Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`).expect(200)).body.user.id;
  return c;
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
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
});
async function portalOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await api(c).get('/attendance/portal-access').expect(200)).body.company.code;
  const issued = (await api(c).post('/attendance/portal-access/codes', { employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal/people/money${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal/people/money${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
    del: (p: string) => request(app).delete(`/api/portal/people/money${p}`).set('Authorization', `Bearer ${token}`),
  };
}

/* A tiny real PNG, and another that differs by one byte (a different bill). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const bill = (salt = 0) => `data:image/png;base64,${Buffer.concat([PNG, Buffer.from([salt])]).toString('base64')}`;

const MANAGER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

let hr: Ctx;
let manager: Ctx;
let other: Ctx;
let asha: any;
let ravi: any;
let me: Awaited<ReturnType<typeof portalOf>>;
let travel: string;
let food: string;
let courier: string;

beforeAll(async () => {
  hr = await owner();
  manager = await colleague(hr, 'Kiran', MANAGER);
  other = await colleague(hr, 'Priya', MANAGER);
  const boss = (await api(hr).post('/people/employees', { name: 'Kiran Rao', code: 'M-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
  await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: manager.userId } }));
  asha = (await api(hr).post('/people/employees', { name: 'Asha Nair', code: 'E-1', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
  ravi = (await api(hr).post('/people/employees', { name: 'Ravi Das', code: 'E-2', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
  me = await portalOf(hr, asha);

  /* Payroll: a reimbursement earning, a salary-advance deduction, this month open, and Asha on ₹6,00,000 a year. */
  const pay = (p: string, b: unknown) => api(hr).post(`/payroll${p}`, b).expect(201);
  const basic = (await pay('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 })).body.component;
  await pay('/components', { name: 'Reimbursement', code: 'REIMB', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 90 });
  await pay('/components', { name: 'Salary advance', code: 'SALADV', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 });
  const structure = (await pay('/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2024-01-01', status: 'ACTIVE', components: [{ componentId: basic.id, displayOrder: 1 }] })).body.structure;
  const t = today();
  const start = `${t.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)).toISOString().slice(0, 10);
  await pay('/periods', { name: `This month ${rnd()}`, startDate: start, endDate: end, paymentDate: end });
  await pay('/assignments', { employeeId: asha.id, structureId: structure.id, effectiveFrom: '2024-01-01', annualCtc: 600_000 });

  const cats = (await me.get('/').expect(200)).body.categories;
  travel = cats.find((c: any) => c.name === 'Travel').id;
  food = cats.find((c: any) => c.name === 'Food and meals').id;
  courier = cats.find((c: any) => c.name === 'Courier and postage').id;
}, 180_000);

const approve = (c: Ctx, requestId: string) => api(c).post(`/people/requests/${requestId}/approve`, {});
const requestOf = async (kind: 'claims' | 'advances', id: string) => {
  const body = (await me.get('/').expect(200)).body;
  const row = (kind === 'claims' ? body.claims : body.advances).find((r: any) => r.id === id);
  return row.approvalRequestId as string;
};

describe('bills from the employee app', () => {
  it('adds bills with their photos into a draft; the same photo, a fake file and a lookalike bill are caught', async () => {
    const first = await me.post('/lines', { spentOn: daysAgo(2), categoryId: travel, amount: 450, merchant: 'Uber', bill: bill(1), billName: 'uber.png' }).expect(201);
    expect(first.body.claimId).toBeTruthy();
    /* The same photo again: refused, whatever the amount. */
    const again = await me.post('/lines', { spentOn: daysAgo(1), categoryId: travel, amount: 99, merchant: 'Ola', bill: bill(1) }).expect(409);
    expect(again.body.code).toBe('DUPLICATE_BILL');
    /* A page of HTML calling itself a PNG. */
    const fake = await me.post('/lines', { spentOn: daysAgo(1), categoryId: travel, amount: 50, merchant: 'Auto', bill: `data:image/png;base64,${Buffer.from('<html><script>x</script></html>').toString('base64')}` }).expect(400);
    expect(fake.body.error).toMatch(/not a photo or PDF/);
    /* Same amount, day and shop: asked whether it is a different bill; said yes, it goes in and the approver sees it flagged. */
    const twin = await me.post('/lines', { spentOn: daysAgo(2), categoryId: travel, amount: 450, merchant: 'uber' }).expect(409);
    expect(twin.body.code).toBe('POSSIBLE_DUPLICATE');
    const kept = await me.post('/lines', { spentOn: daysAgo(2), categoryId: travel, amount: 450, merchant: 'uber', notDuplicate: true }).expect(201);
    let draft = (await me.get('/').expect(200)).body.draft;
    expect(draft.lines.find((l: any) => l.id === kept.body.lineId).possibleDuplicate).toBe(true);
    await me.del(`/lines/${kept.body.lineId}`).expect(200);
    /* Food on a bill in the company's name: GSTIN and tax kept; food shows credit usually blocked. */
    await me.post('/lines', { spentOn: daysAgo(1), categoryId: food, amount: 1200, merchant: 'Hotel Saravana', companyGstin: true, supplierGstin: '29ABCDE1234F1Z5', taxAmount: 60, bill: bill(2) }).expect(201);
    await me.post('/lines', { spentOn: daysAgo(1), categoryId: food, amount: 100, merchant: 'Tea', supplierGstin: 'not-a-gstin' }).expect(400);
    await me.post('/lines', { spentOn: '2999-01-01', categoryId: food, amount: 100, merchant: 'Tea' }).expect(400);
    draft = (await me.get('/').expect(200)).body.draft;
    expect(draft.claimed).toBe(1650);
    expect(draft.lines).toHaveLength(2);
    const foodLine = draft.lines.find((l: any) => l.category === 'Food and meals');
    expect(foodLine).toMatchObject({ companyGstin: true, supplierGstin: '29ABCDE1234F1Z5', taxAmount: 60, creditBlocked: true });
    /* My bill opens for me; not for a colleague in the app. */
    const mine = await me.get(`/bills/${foodLine.billId}`).expect(200);
    expect(mine.headers['content-type']).toMatch(/image\/png/);
    const raviApp = await portalOf(hr, ravi);
    await raviApp.get(`/bills/${foodLine.billId}`).expect(404);
    await raviApp.del(`/lines/${foodLine.id}`).expect(404);
  });
});

describe('an advance, a claim against it, the manager in the inbox, and paying with salary', () => {
  let advanceId: string;
  let claimId: string;

  it('the advance is asked, approved by the manager and paid by HR', async () => {
    const a = (await me.post('/advances', { purpose: 'Client visit to Mysuru', amount: 1000 }).expect(201)).body.advance;
    advanceId = a.id;
    const reqId = await requestOf('advances', a.id);
    /* Waiting on the manager: it is in their one inbox. */
    const inbox = (await api(manager).get('/people/inbox').expect(200)).body.items;
    expect(inbox.find((i: any) => i.id === reqId)).toMatchObject({ kind: 'APPROVAL', subKind: 'EMPLOYEE_ADVANCE' });
    await approve(manager, reqId).expect(200);
    /* A manager cannot pay; HR can, once. */
    await api(manager).post(`/people/money/advances/${a.id}/pay`, { method: 'CASH' }).expect(403);
    await api(hr).post(`/people/money/advances/${a.id}/pay`, { method: 'UPI', reference: 'UPI-77' }).expect(200);
    await api(hr).post(`/people/money/advances/${a.id}/pay`, { method: 'UPI' }).expect(409);
    const mine = (await me.get('/').expect(200)).body.advances.find((x: any) => x.id === a.id);
    expect(mine).toMatchObject({ status: 'PAID', open: 1000 });
  });

  it('the claim goes to the manager, who allows less on the food bill with a reason; the advance is used first', async () => {
    const draft = (await me.get('/').expect(200)).body.draft;
    claimId = draft.id;
    /* A double tap sends one claim. */
    const [x, y] = await Promise.all([
      me.post(`/claims/${claimId}/submit`, { title: 'Mysuru visit', advanceId }),
      me.post(`/claims/${claimId}/submit`, { title: 'Mysuru visit', advanceId }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const reqId = await requestOf('claims', claimId);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.approvalRequest.count({ where: { orgId: hr.orgId, requestType: 'EXPENSE_CLAIM' } }))).toBe(1);

    /* The manager opens it from the inbox: the bills, the advance. Someone it does not wait on sees nothing. */
    const detail = (await api(manager).get(`/people/money/requests/${reqId}`).expect(200)).body;
    expect(detail).toMatchObject({ kind: 'EXPENSE_CLAIM', waitingOnMe: true });
    expect(detail.record.lines).toHaveLength(2);
    expect(detail.advance).toMatchObject({ open: 1000 });
    await api(other).get(`/people/money/requests/${reqId}`).expect(404);
    const foodLine = detail.record.lines.find((l: any) => l.category === 'Food and meals');
    await api(manager).get(`/people/money/bills/${foodLine.billId}`).expect(200);
    await api(other).get(`/people/money/bills/${foodLine.billId}`).expect(404);

    /* Less without a reason is refused; with one it stands. Only the one it waits on may. */
    await api(manager).post(`/people/money/claims/${claimId}/sanction`, { lines: [{ id: foodLine.id, approvedAmount: 1000 }] }).expect(400);
    await api(other).post(`/people/money/claims/${claimId}/sanction`, { lines: [{ id: foodLine.id, approvedAmount: 1, reason: 'x' }] }).expect(403);
    await api(manager).post(`/people/money/claims/${claimId}/sanction`, { lines: [{ id: foodLine.id, approvedAmount: 1000, reason: 'Meals up to ₹1,000 a day' }] }).expect(200);
    await approve(manager, reqId).expect(200);

    const mine = (await me.get('/').expect(200)).body;
    const claim = mine.claims.find((c: any) => c.id === claimId);
    expect(claim).toMatchObject({ status: 'APPROVED', claimed: 1650, approved: 1450, advanceSettled: 1000, toPay: 450 });
    expect(claim.lines.find((l: any) => l.id === foodLine.id)).toMatchObject({ approvedAmount: 1000, cutReason: 'Meals up to ₹1,000 a day' });
    expect(mine.advances.find((a: any) => a.id === advanceId)).toMatchObject({ status: 'CLOSED', settled: 1000 });
  });

  it('HR pays it with salary: one draft reimbursement in Payroll, however many clicks', async () => {
    const [p, q] = await Promise.all([
      api(hr).post(`/people/money/claims/${claimId}/pay`, { mode: 'SALARY' }),
      api(hr).post(`/people/money/claims/${claimId}/pay`, { mode: 'SALARY' }),
    ]);
    expect([p.status, q.status].sort()).toEqual([200, 409]);
    const adj = await runInTenant(hr.orgId, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: hr.orgId, employeeId: asha.id } }));
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ id: `expense-claim:${claimId}`, type: 'EARNING', status: 'DRAFT' });
    expect(Number(adj[0].amount)).toBe(450);
    const claim = (await api(hr).get(`/people/money/claims/${claimId}`).expect(200)).body.claim;
    expect(claim).toMatchObject({ status: 'PAID', payMode: 'SALARY' });
    expect(claim.payrollPeriodName).toMatch(/This month/);
  });
});

describe('a second claim paid now, and the Books list', () => {
  it('is approved, paid by UPI, listed for Books with its GST, and marked entered', async () => {
    await me.post('/lines', { spentOn: daysAgo(3), categoryId: courier, amount: 300, merchant: 'Blue Dart', companyGstin: true, supplierGstin: '27AAACB1234C1Z2', taxAmount: 45.76, bill: bill(3) }).expect(201);
    const draft = (await me.get('/').expect(200)).body.draft;
    await me.post(`/claims/${draft.id}/submit`, { title: 'Courier to client' }).expect(200);
    await approve(manager, await requestOf('claims', draft.id)).expect(200);
    /* A manager has no right to pay; a date ahead is refused. */
    await api(manager).post(`/people/money/claims/${draft.id}/pay`, { mode: 'NOW', method: 'UPI' }).expect(403);
    await api(hr).post(`/people/money/claims/${draft.id}/pay`, { mode: 'NOW', method: 'UPI', paidOn: '2999-01-01' }).expect(400);
    await api(hr).post(`/people/money/claims/${draft.id}/pay`, { mode: 'NOW', method: 'UPI', reference: 'UTR123' }).expect(200);
    const books = (await api(hr).get('/people/money/claims?status=BOOKS').expect(200)).body.claims;
    expect(books.map((c: any) => c.id)).toContain(draft.id);
    const csv = (await api(hr).get('/people/money/export.csv?kind=books').expect(200)).text;
    expect(csv).toContain('Blue Dart');
    expect(csv).toContain('27AAACB1234C1Z2');
    expect(csv).toContain('45.76');
    await api(hr).post('/people/money/books-recorded', { claimIds: [draft.id] }).expect(200);
    expect((await api(hr).get('/people/money/claims?status=BOOKS').expect(200)).body.claims.map((c: any) => c.id)).not.toContain(draft.id);
    /* Reports: by person, category and month. */
    const r = (await api(hr).get('/people/money/report').expect(200)).body;
    expect(r.byPerson.find((p: any) => p.key === asha.id).amount).toBe(1750);
    expect(r.byCategory.map((c: any) => c.key)).toEqual(expect.arrayContaining(['Travel', 'Food and meals', 'Courier and postage']));
    await api(manager).get('/people/money/report').expect(403);
  });
});

describe('one advance, two claims approved at once', () => {
  it('never uses the same rupee twice; what is left comes back from salary within half the pay', async () => {
    const a = (await me.post('/advances', { purpose: 'Site purchase', amount: 500 }).expect(201)).body.advance;
    await approve(manager, await requestOf('advances', a.id)).expect(200);
    await api(hr).post(`/people/money/advances/${a.id}/pay`, { method: 'CASH' }).expect(200);
    const ids: string[] = [];
    for (const [i, shop] of ['Hardware shop', 'Paint shop'].entries()) {
      await me.post('/lines', { spentOn: daysAgo(1), categoryId: travel, amount: 400, merchant: shop, bill: bill(10 + i) }).expect(201);
      const d = (await me.get('/').expect(200)).body.draft;
      await me.post(`/claims/${d.id}/submit`, { title: shop, advanceId: a.id }).expect(200);
      ids.push(d.id);
    }
    const reqs = await Promise.all(ids.map((id) => requestOf('claims', id)));
    const out = await Promise.all(reqs.map((r) => approve(manager, r)));
    expect(out.map((o) => o.status)).toEqual([200, 200]);
    const claims = (await me.get('/').expect(200)).body.claims.filter((c: any) => ids.includes(c.id));
    expect(claims.reduce((t: number, c: any) => t + c.advanceSettled, 0)).toBe(500);
    const adv = (await me.get('/').expect(200)).body.advances.find((x: any) => x.id === a.id);
    expect(adv).toMatchObject({ status: 'CLOSED', settled: 500 });
    /* Closed: nothing to give back or take. */
    await api(hr).post(`/people/money/advances/${a.id}/returned`, {}).expect(409);
  });

  it('an unused advance is taken from salary as a draft deduction, or given back', async () => {
    const a = (await me.post('/advances', { purpose: 'Trip that was cancelled', amount: 2000 }).expect(201)).body.advance;
    await approve(manager, await requestOf('advances', a.id)).expect(200);
    await api(hr).post(`/people/money/advances/${a.id}/pay`, { method: 'BANK' }).expect(200);
    await api(hr).post(`/people/money/advances/${a.id}/returned`, { amount: 500 }).expect(200);
    await api(hr).post(`/people/money/advances/${a.id}/returned`, { amount: 5000 }).expect(400);
    const r = (await api(hr).post(`/people/money/advances/${a.id}/recover`, {}).expect(200)).body;
    expect(r).toMatchObject({ recovered: 1500, left: 0 });
    const ded = await runInTenant(hr.orgId, () => payrollPrisma.payrollAdjustment.findFirst({ where: { orgId: hr.orgId, employeeId: asha.id, type: 'DEDUCTION' } }));
    expect(Number(ded!.amount)).toBe(1500);
    await api(hr).post(`/people/money/advances/${a.id}/recover`, {}).expect(409);
  });
});

describe('salary advance from the employee app', () => {
  it('shows the cap in plain words, refuses over it, and becomes a Payroll loan once approved', async () => {
    const start = (await me.get('/').expect(200)).body.salaryAdvance;
    expect(start.available).toBe(true);
    /* ₹50,000 a month: up to half of it can come off. */
    expect(start.cap).toMatchObject({ known: true, monthlyRoom: 25000 });
    expect(start.cap.explain).toMatch(/half your wages/);
    const over = (await me.post('/salary-advance/preview', { amount: 30000, months: 1 }).expect(200)).body;
    expect(over).toMatchObject({ fits: false, mostYouCanAsk: 25000 });
    expect((await me.post('/salary-advance', { amount: 30000, months: 1, reason: 'Rent deposit' }).expect(400)).body.code).toBe('OVER_CAP');
    await me.post('/salary-advance', { amount: 40000, months: 25, reason: 'Rent deposit' }).expect(400);
    const [x, y] = await Promise.all([
      me.post('/salary-advance', { amount: 40000, months: 4, reason: 'Rent deposit' }),
      me.post('/salary-advance', { amount: 40000, months: 4, reason: 'Rent deposit' }),
    ]);
    expect([x.status, y.status]).toContain(201);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.salaryAdvanceAsk.count({ where: { orgId: hr.orgId, employeeId: asha.id } }))).toBe(1);
    /* A different one while it waits: wait or withdraw first. */
    expect((await me.post('/salary-advance', { amount: 5000, months: 1, reason: 'Medical' }).expect(409)).body.code).toBe('ASK_WAITING');

    const ask = (await me.get('/').expect(200)).body.salaryAdvance.asks[0];
    expect(ask).toMatchObject({ amount: 40000, months: 4, emi: 10000, status: 'WAITING' });
    /* HR decides by default; not the manager. */
    const inbox = (await api(manager).get('/people/inbox').expect(200)).body.items;
    expect(inbox.find((i: any) => i.id === ask.approvalRequestId)).toBeUndefined();
    const detail = (await api(hr).get(`/people/money/requests/${ask.approvalRequestId}`).expect(200)).body;
    expect(detail.cap).toMatchObject({ fits: true, monthlyRoom: 25000 });
    expect(detail.perquisite).toBeNull();
    await approve(hr, ask.approvalRequestId).expect(200);

    const loans = await runInTenant(hr.orgId, () => payrollPrisma.payrollLoan.findMany({ where: { orgId: hr.orgId, employeeId: asha.id }, include: { installments: true } }));
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ type: 'SALARY_ADVANCE', status: 'ACTIVE', installmentCount: 4 });
    expect(Number(loans[0].principal)).toBe(40000);
    expect(loans[0].installments).toHaveLength(4);
    const after = (await me.get('/').expect(200)).body.salaryAdvance;
    expect(after.asks[0]).toMatchObject({ status: 'APPROVED', loan: { status: 'ACTIVE', outstanding: 40000 } });
    expect(after.loans[0]).toMatchObject({ kind: 'Salary advance', outstanding: 40000 });
    /* Now ₹10,000 a month already goes to it: the room is smaller. */
    expect(after.cap.monthlyRoom).toBe(15000);
  });

  it('warns about the perquisite above ₹2,00,000 interest free, without working it out', async () => {
    const ask = (await me.post('/salary-advance', { amount: 180000, months: 24, reason: 'House repair' }).expect(201)).body.ask;
    const reqId = (await me.get('/').expect(200)).body.salaryAdvance.asks.find((a: any) => a.id === ask.id).approvalRequestId;
    const detail = (await api(hr).get(`/people/money/requests/${reqId}`).expect(200)).body;
    expect(detail.perquisite).toMatch(/taxable perquisite/);
    /* Withdrawn from the app: closed, and nothing reaches Payroll. */
    await me.post(`/salary-advance/${ask.id}/withdraw`).expect(200);
    expect((await me.get('/').expect(200)).body.salaryAdvance.asks.find((a: any) => a.id === ask.id).status).toBe('WITHDRAWN');
  });
});

describe('who may, and company isolation', () => {
  it('another company reads and pays nothing; a request typed by hand pays nobody', async () => {
    const b = await owner();
    const claims = (await api(hr).get('/people/money/claims').expect(200)).body.claims;
    const id = claims[0].id;
    await api(b).get(`/people/money/claims/${id}`).expect(404);
    await api(b).post(`/people/money/claims/${id}/pay`, { mode: 'NOW', method: 'CASH' }).expect(404);
    expect((await api(b).get('/people/money/claims').expect(200)).body.claims).toHaveLength(0);
    /* The org in the path must be the caller's own. */
    await request(app).get(`/api/orgs/${hr.orgId}/people/money/claims`).set(at(b)).expect(403);
    /* An EXPENSE_CLAIM typed through the generic route has no claim behind it: it cannot be approved. */
    const forged = (await api(manager).post('/people/requests', { requestType: 'EXPENSE_CLAIM', subjectEmployeeId: ravi.id, title: 'Pay me', payload: { amount: 1, claimId: id } }).expect(201)).body.request;
    if (forged.status === 'WAITING') {
      const r = await approve(hr, forged.id);
      expect(r.status).toBe(409);
    }
    expect((await api(hr).get(`/people/money/claims/${id}`).expect(200)).body.claim.status).not.toBe('SUBMITTED');
  });
});
