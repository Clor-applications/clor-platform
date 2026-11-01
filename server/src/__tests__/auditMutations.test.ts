import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Changes made through the Payroll and Attendance APIs are in the audit log,
 * readable, with anything sensitive hidden; refused requests are not; and an
 * action that writes its own detailed entry is not logged twice.
 */

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `audit.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Audit Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  return c;
}
/* Entries are written as the response finishes; give them a moment. */
const entries = async (orgId: string, where: Record<string, unknown> = {}) => {
  await new Promise((r) => setTimeout(r, 150));
  return platformPrisma.auditLog.findMany({ where: { orgId, ...where }, orderBy: { createdAt: 'asc' } });
};

describe('the audit log', () => {
  it('records a corrected day in words people can read', async () => {
    const c = await makeOwner();
    const p = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi', code: 'A1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await request(app).put(`/api/orgs/${c.orgId}/attendance/records`).set(at(c)).send({ employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const [e] = await entries(c.orgId, { entity: 'ATTENDANCE_RECORD' });
    expect(e).toMatchObject({ action: 'UPDATE', message: 'Marked or corrected a day' });
    expect(JSON.parse(e.metadata!).body).toMatchObject({ employeeId: p.id, date: '2026-09-02' });
  });

  it('hides bank account numbers, PAN and passwords', async () => {
    const c = await makeOwner();
    await request(app)
      .post(`/api/orgs/${c.orgId}/payroll/employees`)
      .set(at(c))
      .send({ name: 'Meena', code: 'P1', dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', bankAccountNumber: '50100012345678', bankIfsc: 'HDFC0000123', pan: 'ABCDE1234F' } })
      .expect(201);
    const [e] = await entries(c.orgId, { entity: 'PAYROLL_EMPLOYEE' });
    expect(e.message).toBe('Changed an employee’s payroll details');
    expect(e.metadata).not.toContain('50100012345678');
    expect(e.metadata).not.toContain('ABCDE1234F');
    expect(e.metadata).toContain('HDFC0000123');
  });

  it('leaves out refused requests and does not log an action twice', async () => {
    const c = await makeOwner();
    await request(app).put(`/api/orgs/${c.orgId}/attendance/records`).set(at(c)).send({ employeeId: 'nobody', date: '2026-09-02' }).expect(404);
    await request(app).post(`/api/orgs/${c.orgId}/attendance/months/2026-09/close`).set(at(c)).expect(200);
    const all = await entries(c.orgId);
    expect(all.filter((e) => e.entity === 'ATTENDANCE_RECORD')).toHaveLength(0);
    expect(all.filter((e) => e.entity === 'ATTENDANCE_MONTH')).toHaveLength(1);
    /* The close writes its own line, with the snapshot it kept (closure audit, 27 Oct 2026), so the generic line is not written as well. */
    expect(all.find((e) => e.entity === 'ATTENDANCE_MONTH')).toMatchObject({ action: 'CLOSE', entityId: '2026-09' });
    expect(all.find((e) => e.entity === 'ATTENDANCE_MONTH')!.message).toMatch(/^Closed 2026-09 \(snapshot 1\)/);
  });
});
