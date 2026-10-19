import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/** The phone app's home screen: one answer with today, the month, the week, alerts, leave, holidays and team. */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { purgeExpiredRecords } = await import('../services/retention.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `home.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Home Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  if (Object.keys(features).length) await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** What a reader sends. */
const reader = (sn: string) => ({
  handshake: () => request(app).get(`/iclock/cdata?SN=${sn}&options=all&pushver=2.4.1&language=69`),
  heartbeat: (info?: string) => request(app).get(`/iclock/getrequest?SN=${sn}${info ? `&INFO=${encodeURIComponent(info)}` : ''}`),
  push: (lines: string[], table = 'ATTLOG') =>
    request(app).post(`/iclock/cdata?SN=${sn}&table=${table}&Stamp=9999`).set('Content-Type', 'text/plain').send(lines.join('\n')),
  result: (body: string) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('Content-Type', 'text/plain').send(body),
});
const serial = () => `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const addReader = async (c: Ctx, sn: string, direction = 'both') =>
  (await api(c).post('/devices', { serialNumber: sn, name: `Gate ${sn.slice(-4)}`, direction }).expect(201)).body;
const day = async (c: Ctx, employeeId: string, date: string) =>
  (await api(c).get(`/records?from=${date}&to=${date}&employeeId=${employeeId}`).expect(200)).body.records[0];


const tmpl = (s: string) => Buffer.from(`template-${s}-`.repeat(20)).toString('base64');
const dp = (c: Ctx) => ({
  get: () => api(c).get('/data-protection'),
  put: (b: unknown) => api(c).put('/data-protection', b),
});
const portalFor = async (c: Ctx, employeeId: string, code: string) => {
  const list = await api(c).get('/portal-access').expect(200);
  const company = list.body.company.code;
  const issued = await api(c).post('/portal-access/codes', { employeeIds: [employeeId] }).expect(200);
  const ok = await request(app).post('/api/portal/activate').send({ company, employeeCode: code, activationCode: issued.body.codes[0].activationCode, password: 'mine pass 1' }).expect(200);
  const token = ok.body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
};


describe('the app home screen', () => {
  it('answers with company, site, today, month, week, alerts, leave, holidays and team in one call', async () => {
    const c = await makeOwner();
    const site = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/areas`).set(at(c)).send({ name: 'Peenya Plant' }).expect(201)).body.item;
    const boss = await person(c, { name: 'Manager Mala', code: 'H1', areaId: site.id });
    const p = await person(c, { name: 'Ravi', code: 'H2', areaId: site.id, reportingManagerId: boss.id });
    const sn = serial();
    await addReader(c, sn);
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    await reader(sn).push([`H2\t${t} 09:05:00\t0\t1`]).expect(200);
    const me = await portalFor(c, p.id, 'H2');
    const h = (await me.get('/home').expect(200)).body;
    expect(h.company.name).toMatch(/Home Co/);
    expect(h.site).toBe('Peenya Plant');
    expect(h.today).toBe(t);
    expect(h.week).toHaveLength(7);
    expect(h.week[6].date).toBe(t);
    expect(h.month).toMatchObject({ month: t.slice(0, 7) });
    expect(Array.isArray(h.leave.balances)).toBe(true);
    expect(h.approvals.approver).toBe(false);
    expect(h.privacy.read).toBe(false);
    expect(h.punches.length).toBe(1);

    const mm = await portalFor(c, boss.id, 'H1');
    await me.post('/corrections', { date: t, checkIn: '09:00', reason: 'Reader was slow' }).expect(201);
    const bh = (await mm.get('/home').expect(200)).body;
    expect(bh.approvals).toMatchObject({ approver: true, team: 1, waiting: 1 });
  });
});
