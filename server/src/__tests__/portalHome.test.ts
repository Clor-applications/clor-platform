import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/** The phone app's home screen: one answer with today, the month, the week, alerts, leave, holidays and team. */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { purgeExpiredRecords } = await import('../services/retention.js');

const app = buildApp().listen(0, '127.0.0.1');
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
    put: (p: string, b: unknown = {}) => request(app).put(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
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

  it('lets an employee list, change and withdraw their own requests, and ask for phone punching', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Lakshmi', code: 'R1' });
    const me = await portalFor(c, p.id, 'R1');
    const t = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
    const made = (await me.post('/corrections', { date: t, checkIn: '09:00', reason: 'Client visit', reasonCode: 'ON_DUTY' }).expect(201)).body.request;
    const list = (await me.get('/requests').expect(200)).body;
    expect(list.reasons).toContain('ON_DUTY');
    expect(list.requests[0]).toMatchObject({ kind: 'correction', reasonCode: 'ON_DUTY', checkIn: '09:00', canChange: true });
    await me.put(`/corrections/${made.id}`, { checkIn: '08:30', checkOut: '17:45', reason: 'Client visit at Peenya', reasonCode: 'ON_DUTY' }).expect(200);
    expect((await me.get('/requests').expect(200)).body.requests[0]).toMatchObject({ checkIn: '08:30', checkOut: '17:45', reason: 'Client visit at Peenya' });
    await me.put(`/corrections/${made.id}`, { checkIn: '8.30', reason: 'x' }).expect(400);
    await me.post(`/corrections/${made.id}/cancel`).expect(200);
    expect((await me.get('/requests').expect(200)).body.requests[0]).toMatchObject({ status: 'CANCELLED', canChange: false });
    await me.post(`/corrections/${made.id}/cancel`).expect(409);
    expect((await me.post('/phone-punch/ask', { note: 'I visit client sites' }).expect(200)).body.message).toMatch(/Sent to HR/);
  });

  it('field punching: anywhere, with the address, waiting for the manager, and a selfie when required', async () => {
    const c = await makeOwner();
    const boss = await person(c, { name: 'Field Boss', code: 'F0' });
    const p = await person(c, { name: 'Field Ravi', code: 'F1', reportingManagerId: boss.id });
    await api(c).put('/portal-access', { employeeIds: [p.id], mobilePunch: true }).expect(200);
    const me = await portalFor(c, p.id, 'F1');
    /* Site mode, no site set up: refused. */
    expect((await me.post('/punch', { latitude: 12.97, longitude: 77.59, accuracy: 10 }).expect(409)).body.code).toBe('NO_SITE');
    await api(c).put('/portal-access', { employeeIds: [p.id], phonePunchMode: 'FIELD', selfieRequired: true }).expect(200);
    expect((await me.get('/home').expect(200)).body.phone).toMatchObject({ allowed: true, mode: 'FIELD', selfieRequired: true });
    expect((await me.post('/punch', { latitude: 12.97, longitude: 77.59, accuracy: 10 }).expect(400)).body.code).toBe('SELFIE_REQUIRED');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64');
    const r = (await me.post('/punch', { latitude: 12.97, longitude: 77.59, accuracy: 10, photo: `data:image/jpeg;base64,${jpeg}` }).expect(201)).body;
    expect(r).toMatchObject({ kind: 'IN', outside: true, review: 'PENDING' });
    const home = (await me.get('/home').expect(200)).body;
    expect(home.punches[0]).toMatchObject({ outside: true, review: 'PENDING' });
    expect(home.record).toBeNull();
    /* The manager sees it and approves; the day now counts it. */
    const mm = await portalFor(c, boss.id, 'F0');
    const ap = (await mm.get('/approvals').expect(200)).body;
    expect(ap.punches).toHaveLength(1);
    await mm.post(`/approvals/punch/${ap.punches[0].id}`, { decision: 'approve' }).expect(200);
    expect((await me.get('/home').expect(200)).body.record).toMatchObject({ checkInTime: expect.any(String) });
    await mm.post(`/approvals/punch/${ap.punches[0].id}`, { decision: 'approve' }).expect(409);
    /* HR's list shows it as a field punch; the notice now mentions field punching. */
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const list = (await api(c).get(`/phone-punches?from=${t}&to=${t}`).expect(200)).body;
    expect(list.summary).toMatchObject({ field: 1, waiting: 0 });
    expect(JSON.stringify((await me.get('/privacy-notice').expect(200)).body.notice)).toMatch(/Field punching/);
  });

  it('half-day leave: 0.5 from the balance, and the punches decide the other half', async () => {
    const c = await makeOwner();
    const boss = await person(c, { name: 'Half Boss', code: 'HB' });
    const p = await person(c, { name: 'Half Hema', code: 'HH', reportingManagerId: boss.id });
    const type = (await api(c).post('/leave/types', { name: 'Casual', isPaid: true, annualDays: 12 }).expect(201)).body.type;
    const me = await portalFor(c, p.id, 'HH');
    /* A past weekday, so its punches can be sent. */
    let d = new Date(Date.now() + 330 * 60_000 - 86_400_000);
    while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86_400_000);
    const day = d.toISOString().slice(0, 10);
    await me.post('/leave', { leaveTypeId: type.id, fromDate: day, toDate: plusOne(day), reason: 'Doctor', halfDay: 'FIRST' }).expect(400);
    const req = (await me.post('/leave', { leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Doctor in the morning', halfDay: 'FIRST' }).expect(201)).body.request;
    expect(req.days).toBe(0.5);
    const mm = await portalFor(c, boss.id, 'HB');
    await mm.post(`/approvals/leave/${req.id}`, { decision: 'approve' }).expect(200);
    /* No punches yet: a half day (the other half is not worked). */
    const sn = serial();
    await addReader(c, sn);
    const rec0 = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: p.id, date: day } } });
    expect(rec0!.status).toBe('HALF_DAY');
    /* Worked the afternoon: present, and no lateness for arriving after the morning off. */
    await reader(sn).push([`HH\t${day} 13:30:00\t0\t1`, `HH\t${day} 18:05:00\t1\t1`]).expect(200);
    const rec = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: p.id, date: day } } });
    expect(rec).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
    const bal = (await me.get('/leave').expect(200)).body.types.find((t: any) => t.id === type.id);
    expect(bal.used).toBe(0.5);
    expect((await me.get('/leave').expect(200)).body.requests[0].halfDay).toBe('FIRST');
  });

  it('forgot password tells HR without saying whether the person exists; updates list decisions', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Forgetful', code: 'FG' });
    const me = await portalFor(c, p.id, 'FG');
    const list = await api(c).get('/portal-access').expect(200);
    const company = list.body.company.code;
    const a = (await request(app).post('/api/portal/forgot').send({ company, employeeCode: 'FG' }).expect(200)).body.message;
    const b = (await request(app).post('/api/portal/forgot').send({ company, employeeCode: 'NOBODY' }).expect(200)).body.message;
    expect(a).toBe(b);
    const u = (await me.get('/updates').expect(200)).body;
    expect(u).toMatchObject({ decided: [], waitingForMe: 0 });
  });
});

const plusOne = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
