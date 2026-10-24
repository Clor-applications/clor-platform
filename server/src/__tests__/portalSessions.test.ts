import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-33 (Batch 5, U5): portal tokens lived 30 days, could not be ended for one
 * device, and a SUSPENDED employee kept using theirs.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { deviceLabel } = await import('../services/portalSessions.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const DAY = 864e5;

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `ps.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'PS owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: (jwt.decode(signup.body.token) as any).accountId };
}

/** An employee with the portal activated; returns how to sign in as them. */
async function employee(c: Ctx) {
  const code = `P${rnd().toUpperCase()}`;
  const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  const list = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
  const company = list.body.company.code;
  const activationCode = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [emp.id] }).expect(200)).body.codes[0].activationCode;
  const activated = await request(app).post('/api/portal/activate').set('User-Agent', 'okhttp/4.12.0').send({ company, employeeCode: code, activationCode, password: 'mine pass 1' }).expect(200);
  const login = (ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36') =>
    request(app).post('/api/portal/login').set('User-Agent', ua).send({ company, employeeCode: code, password: 'mine pass 1' });
  return { id: emp.id as string, code, company, first: activated.body.token as string, login };
}
const me = (token: string) => request(app).get('/api/portal/me').set('Authorization', `Bearer ${token}`);
const sid = (token: string) => (jwt.decode(token) as any).sid as string;

/** A token as the portal signed them before sessions existed: no session id. */
function legacyToken(e: { id: string }, c: Ctx, pv: number, iatSeconds = Math.floor(Date.now() / 1000)) {
  return jwt.sign({ typ: 'portal', employeeId: e.id, accountId: c.accountId, orgId: c.orgId, pv, iat: iatSeconds }, process.env.JWT_SECRET || 'dev-secret', {
    expiresIn: '30d',
    issuer: process.env.JWT_ISSUER || 'accounting',
    audience: 'clor-portal',
  });
}
/* The person as they were before sessions existed: no "sessions ended" stamp yet. Returns their password stamp for the token. */
const pvOf = async (id: string) =>
  (await outsideTenant('test', () => peoplePrisma.employee.update({ where: { id }, data: { portalSessionsRevokedAt: null } }))).portalPasswordSetAt!.getTime();

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('a sign-in is a session on one device', () => {
  it('each sign-in names its own session, and the devices list them', async () => {
    const e = await employee(c);
    const second = (await e.login().expect(200)).body.token;
    expect(sid(e.first)).toBeTruthy();
    expect(sid(second)).not.toBe(sid(e.first));
    await me(second).expect(200);
    const list = (await request(app).get('/api/portal/sessions').set('Authorization', `Bearer ${second}`).expect(200)).body.sessions;
    expect(list.map((s: any) => s.deviceLabel).sort()).toEqual(['CLOR app', 'Chrome on Windows']);
    expect(list.find((s: any) => s.current).deviceLabel).toBe('Chrome on Windows');
  });

  it('signing out ends this device only', async () => {
    const e = await employee(c);
    const other = (await e.login().expect(200)).body.token;
    await request(app).post('/api/portal/signout').set('Authorization', `Bearer ${other}`).expect(200);
    expect((await me(other)).body.code).toBe('PORTAL_SIGNIN');
    await me(e.first).expect(200);
  });

  it('a device can be signed out from another, and all others at once', async () => {
    const e = await employee(c);
    const b = (await e.login().expect(200)).body.token;
    const cc = (await e.login().expect(200)).body.token;
    await request(app).delete(`/api/portal/sessions/${sid(b)}`).set('Authorization', `Bearer ${e.first}`).expect(200);
    expect((await me(b)).status).toBe(401);
    await request(app).post('/api/portal/sessions/end-others').set('Authorization', `Bearer ${e.first}`).expect(200);
    expect((await me(cc)).status).toBe(401);
    await me(e.first).expect(200);
  });

  it('ends after 30 days unused, and after 180 days however much it is used', async () => {
    const e = await employee(c);
    const t = (await e.login().expect(200)).body.token;
    await outsideTenant('test: unused for a month', () => peoplePrisma.portalSession.update({ where: { id: sid(t) }, data: { lastSeenAt: new Date(Date.now() - 31 * DAY) } }));
    expect((await me(t)).status).toBe(401);
    const u = (await e.login().expect(200)).body.token;
    await outsideTenant('test: used daily for half a year', () => peoplePrisma.portalSession.update({ where: { id: sid(u) }, data: { createdAt: new Date(Date.now() - 181 * DAY), lastSeenAt: new Date() } }));
    expect((await me(u)).status).toBe(401);
  });

  it('the eleventh device ends the one unused longest', async () => {
    const e = await employee(c);
    await outsideTenant('test', () => peoplePrisma.portalSession.updateMany({ where: { employeeId: e.id }, data: { lastSeenAt: new Date(Date.now() - DAY) } }));
    for (let i = 0; i < 10; i += 1) await e.login().expect(200);
    expect((await me(e.first)).status).toBe(401);
    expect(await outsideTenant('test', () => peoplePrisma.portalSession.count({ where: { employeeId: e.id, revokedAt: null } }))).toBe(10);
  }, 60_000);
});

describe('HR and the person’s status', () => {
  it('suspended: every device is signed out — older tokens too — and sign-in says why (AE6)', async () => {
    const e = await employee(c);
    const old = legacyToken(e, c, await pvOf(e.id), Math.floor(Date.now() / 1000) - 60);
    await me(old).expect(200);
    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${e.id}`).set(at(c)).send({ status: 'SUSPENDED' }).expect(200);
    for (const t of [e.first, old]) {
      const r = await me(t);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('PORTAL_SIGNIN');
    }
    const r = await e.login();
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/paused/);
    /* Back at work: they sign in again; the old devices stay ended. */
    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${e.id}`).set(at(c)).send({ status: 'ACTIVE' }).expect(200);
    expect((await me(e.first)).status).toBe(401);
    await me((await e.login().expect(200)).body.token).expect(200);
  });

  it('on notice: they keep the app', async () => {
    const e = await employee(c);
    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${e.id}`).set(at(c)).send({ status: 'ON_NOTICE' }).expect(200);
    await me(e.first).expect(200);
  });

  it('a status set through the API, or the payroll employee form, ends sessions too', async () => {
    const e = await employee(c);
    const key = (await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/keys`).set(at(c)).send({ name: 'HRMS', scopes: ['employees:write'] }).expect(201)).body.token;
    const r = await request(app).patch(`/v1/employees/${e.code}`).set('Authorization', `Bearer ${key}`).send({ status: 'SUSPENDED' });
    expect(r.status).toBeLessThan(300);
    const sessions = await outsideTenant('test', () => peoplePrisma.portalSession.findMany({ where: { employeeId: e.id } }));
    expect(sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it('HR signs someone out everywhere; they can sign straight back in', async () => {
    const e = await employee(c);
    const old = legacyToken(e, c, await pvOf(e.id), Math.floor(Date.now() / 1000) - 60);
    const r = await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/${e.id}/sign-out-everywhere`).set(at(c)).expect(200);
    expect(r.body.ended).toBe(1);
    expect((await me(e.first)).status).toBe(401);
    expect((await me(old)).status).toBe(401);
    await me((await e.login().expect(200)).body.token).expect(200);
  });

  it('a new password keeps this device and ends the others, older tokens included', async () => {
    const e = await employee(c);
    const other = (await e.login().expect(200)).body.token;
    const old = legacyToken(e, c, await pvOf(e.id), Math.floor(Date.now() / 1000) - 60);
    const r = await request(app).post('/api/portal/password').set('Authorization', `Bearer ${e.first}`).send({ current: 'mine pass 1', next: 'mine pass 2' }).expect(200);
    expect(sid(r.body.token)).toBe(sid(e.first));
    await me(r.body.token).expect(200);
    expect((await me(other)).status).toBe(401);
    expect((await me(old)).status).toBe(401);
  });
});

describe('tokens from before sessions', () => {
  it('keep working until the cut-off, which an unset setting cannot remove', async () => {
    const e = await employee(c);
    const old = legacyToken(e, c, await pvOf(e.id));
    await me(old).expect(200);
    const before = process.env.PORTAL_LEGACY_JWT_UNTIL;
    try {
      process.env.PORTAL_LEGACY_JWT_UNTIL = new Date(Date.now() - 1000).toISOString();
      expect((await me(old)).status).toBe(401);
      process.env.PORTAL_LEGACY_JWT_UNTIL = '2099-01-01T00:00:00Z';
      await me(old).expect(200);
    } finally {
      if (before === undefined) delete process.env.PORTAL_LEGACY_JWT_UNTIL;
      else process.env.PORTAL_LEGACY_JWT_UNTIL = before;
    }
  });
});

describe('device names', () => {
  it('are what a person recognises', () => {
    expect(deviceLabel('okhttp/4.12.0')).toBe('CLOR app');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
  });
});
