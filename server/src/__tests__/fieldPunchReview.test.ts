import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A field punch (made outside every work site) is decided like every other
 * attendance request: by the manager or whoever stands in for them today,
 * never by the person themselves; once, however many decide at the same time;
 * and with a line in the audit log.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `fp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `FP Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[]) {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const user = await request(app).post('/api/users').set(at(boss)).send({ email: `fpc.${Date.now()}.${rnd()}@example.com`, fullName: 'Deputy', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
/* A past working day: a Tuesday, a week ago or so. */
const pastTuesday = (() => {
  const d = new Date(Date.now() - 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
let minute = 0;
async function fieldPunch(c: Ctx, employeeId: string) {
  const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } }));
  const mm = String(minute++ % 60).padStart(2, '0');
  const when = new Date(`${pastTuesday}T04:${mm}:00Z`);
  return runInTenant(c.orgId, () => peoplePrisma.devicePunch.create({ data: { accountId: e.accountId, orgId: c.orgId, deviceId: 'phone', serialNumber: 'PHONE', pin: employeeId, at: when, localTime: `${pastTuesday}T09:${mm}:00`, state: 'IN', employeeId, shiftDate: pastTuesday, outsideSite: true, reviewStatus: 'PENDING' } }));
}
const auditOf = (c: Ctx, id: string) => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'DevicePunch', entityId: id } });

describe('field punch review', () => {
  let c: Ctx;
  let boss: any;
  let asha: any;
  let ravi: any;
  let portal: (employeeId: string, code: string) => Promise<any>;
  beforeAll(async () => {
    c = await company();
    boss = await person(c, { name: 'Boss', code: 'B1' });
    asha = await person(c, { name: 'Asha', code: 'P1', reportingManagerId: boss.id });
    ravi = await person(c, { name: 'Ravi', code: 'P2', reportingManagerId: boss.id });
    const access = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
    portal = async (employeeId: string, code: string) => {
      const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
      const token = (await request(app).post('/api/portal/activate').send({ company: access, employeeCode: code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
      return {
        get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
        post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
      };
    };
  }, 90_000);

  it('a stand-in decides the team’s field punches, never their own, once, and the audit log says who', async () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    await att(c, 'post', '/leave/stand-ins', { managerEmployeeId: boss.id, standInEmployeeId: asha.id, fromDate: today, toDate: today }).expect(201);
    const his = await fieldPunch(c, ravi.id);
    const mine = await fieldPunch(c, asha.id);
    const me = await portal(asha.id, 'P1');
    const queue = (await me.get('/approvals').expect(200)).body.punches.map((p: any) => p.id);
    expect(queue).toContain(his.id);
    expect(queue).not.toContain(mine.id);
    await me.post(`/approvals/punch/${mine.id}`, { decision: 'approve' }).expect(403);
    /* Two at once: one wins, the other is told. */
    const both = await Promise.all([me.post(`/approvals/punch/${his.id}`, { decision: 'approve' }), me.post(`/approvals/punch/${his.id}`, { decision: 'approve' })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const lines = await auditOf(c, his.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ action: 'FIELD_PUNCH_APPROVE', createdByUserId: `portal:${asha.id}` });
  }, 60_000);

  it('HR alone may decide their own field punch, audited as such; once somebody else can, they may not', async () => {
    const hr = await company();
    const self = await person(hr, { name: 'Owner Self', code: 'O1' });
    const uid = (await platformPrisma.userOrgMembership.findFirst({ where: { orgId: hr.orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } }))!.userId;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: self.id }, data: { userId: uid } }));
    const first = await fieldPunch(hr, self.id);
    await att(hr, 'post', `/phone-punches/${first.id}/review`, { approve: true }).expect(200);
    expect((await auditOf(hr, first.id)).map((l) => l.action)).toEqual(['SELF_APPROVED']);
    /* And it is under People & Attendance in the audit trail, not Accounting. */
    const trail = (await request(app).get(`/api/orgs/${hr.orgId}/audit?app=attendance&limit=200`).set(at(hr)).expect(200)).body.entries;
    expect(trail.some((e: any) => e.entity === 'DevicePunch' && e.action === 'SELF_APPROVED')).toBe(true);
    await colleague(hr, ['ATTENDANCE::Attendance Devices::VIEW', 'ATTENDANCE::Attendance Devices::EDIT']);
    const next = await fieldPunch(hr, self.id);
    expect((await att(hr, 'post', `/phone-punches/${next.id}/review`, { approve: true }).expect(403)).body.code).toBe('OWN_RECORD');
    expect((await runInTenant(hr.orgId, () => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id: next.id } }))).reviewStatus).toBe('PENDING');
  }, 60_000);
});
