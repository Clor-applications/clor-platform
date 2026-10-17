import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Where somebody is paid. The first bank details apply at once; a change to
 * details on file waits for approval by somebody else (or by the same person
 * after 24 hours), and pay keeps going to the account on file until then.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { approveBankChange } = await import('../services/payroll/bankChanges.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const pay = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `bank.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Bank Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

const base = { name: 'Ravi Kumar', status: 'ACTIVE', dateOfJoining: '2026-01-01' };
const bank = (number: string, ifsc = 'HDFC0000123') => ({ payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', bankAccountName: 'Ravi Kumar', bankAccountNumber: number, bankIfsc: ifsc, bankName: 'HDFC Bank' });
const profileOf = (orgId: string, employeeId: string) => payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId } });

describe('bank details', () => {
  it('applies the first ones at once and keeps them in the history', async () => {
    const c = await makeOwner();
    const made = await pay.post(c, '/employees', { ...base, code: `E${rnd()}`, payroll: bank('50100012345678') }).expect(201);
    const id = made.body.employee.id;
    expect((await profileOf(c.orgId, id))!.bankAccountNumber).toBe('50100012345678');
    const history = (await pay.get(c, `/bank-changes?status=ALL&employeeId=${id}`).expect(200)).body.changes;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'APPROVED', newAccount: '••••5678', oldAccount: null });
  });

  it('holds a change to details on file until somebody else approves it', async () => {
    const c = await makeOwner();
    const id = (await pay.post(c, '/employees', { ...base, code: `E${rnd()}`, payroll: bank('50100012345678') }).expect(201)).body.employee.id;

    const saved = await pay.put(c, `/employees/${id}`, { ...base, code: `E${rnd()}`, payroll: bank('99990000111122', 'ICIC0000999') }).expect(200);
    expect(saved.body.bankChangePending).toBe(true);
    // Pay still goes to the account on file — IFSC included.
    const still = await profileOf(c.orgId, id);
    expect(still).toMatchObject({ bankAccountNumber: '50100012345678', bankIfsc: 'HDFC0000123' });

    const [pending] = (await pay.get(c, '/bank-changes').expect(200)).body.changes;
    expect(pending).toMatchObject({ status: 'PENDING', oldAccount: '••••5678', newAccount: '••••1122', mine: true });

    // Whoever entered it cannot approve it straight away.
    const own = await pay.post(c, `/bank-changes/${pending.id}/approve`).expect(409);
    expect(own.body.code).toBe('SELF_APPROVAL_TOO_SOON');

    // Somebody else can.
    await approveBankChange(c.orgId, pending.id, 'another-approver');
    expect(await profileOf(c.orgId, id)).toMatchObject({ bankAccountNumber: '99990000111122', bankIfsc: 'ICIC0000999' });
  });

  it('lets the same person approve after a day, and a rejected change never applies', async () => {
    const c = await makeOwner();
    const id = (await pay.post(c, '/employees', { ...base, code: `E${rnd()}`, payroll: bank('50100012345678') }).expect(201)).body.employee.id;

    await pay.put(c, `/employees/${id}`, { ...base, code: `E${rnd()}`, payroll: bank('11112222333344') }).expect(200);
    let [pending] = (await pay.get(c, '/bank-changes').expect(200)).body.changes;
    await pay.post(c, `/bank-changes/${pending.id}/reject`, { note: 'Not asked for by Ravi' }).expect(200);
    expect((await profileOf(c.orgId, id))!.bankAccountNumber).toBe('50100012345678');

    await pay.put(c, `/employees/${id}`, { ...base, code: `E${rnd()}`, payroll: bank('55556666777788') }).expect(200);
    [pending] = (await pay.get(c, '/bank-changes').expect(200)).body.changes;
    await payrollPrisma.bankDetailChange.update({ where: { id: pending.id }, data: { requestedAt: new Date(Date.now() - 25 * 3_600_000) } });
    await pay.post(c, `/bank-changes/${pending.id}/approve`).expect(200);
    expect((await profileOf(c.orgId, id))!.bankAccountNumber).toBe('55556666777788');
    // Decided changes cannot be decided again.
    await pay.post(c, `/bank-changes/${pending.id}/approve`).expect(409);
  });
});
