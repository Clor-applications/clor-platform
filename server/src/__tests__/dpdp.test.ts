import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/**
 * DPDP, strictly: fingerprint and face copies opt-in and sealed, never for
 * anyone under 18 or who withdrew; phone location never for under 18s; the
 * employee privacy notice, read receipts, my-data download, consent
 * withdrawal; the breach register; retention of locations and originals.
 */

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
  const email = `dpdp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `DPDP Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
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

describe('fingerprints and faces under DPDP', () => {
  it('keeps no copy and copies nothing until the company switches copying on with a confirmation', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    await person(c, { name: 'Ravi', code: '104' });
    const finger = tmpl('104');
    await reader(a).push([`USER PIN=104\tName=Ravi\tPri=0`, `FP PIN=104\tFID=6\tSize=1200\tValid=1\tTMP=${finger}`], 'OPERLOG').expect(200);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId } })).toBe(0);
    expect(await peoplePrisma.deviceCommand.count({ where: { serialNumber: b, command: { contains: 'FINGERTMP' } } })).toBe(0);
    const devB = (await api(c).get('/devices').expect(200)).body.devices.find((d: any) => d.serialNumber === b);
    expect((await api(c).post(`/devices/${devB.id}/commands`, { action: 'FETCH_TEMPLATES' })).status).toBe(409);
    expect((await dp(c).get().expect(200)).body.settings.biometricCopy).toBe(false);

    expect((await dp(c).put({ biometricCopy: true }).expect(400)).body.error).toMatch(/Confirm/);
    await dp(c).put({ biometricCopy: true, attest: true }).expect(200);
    await reader(a).push([`FP PIN=104\tFID=6\tSize=1200\tValid=1\tTMP=${finger}`], 'OPERLOG').expect(200);
    const stored = await peoplePrisma.biometricTemplate.findMany({ where: { orgId: c.orgId } });
    expect(stored).toHaveLength(1);
    /* Sealed at rest; the reader gets the template itself. */
    expect(stored[0].data.startsWith('enc:')).toBe(true);
    expect(stored[0].data).not.toContain(finger.slice(0, 20));
    const copy = await peoplePrisma.deviceCommand.findFirst({ where: { serialNumber: b, command: { contains: 'FINGERTMP' } } });
    expect(copy!.command).toContain(`TMP=${finger}`);
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'DataProtection' }, orderBy: { createdAt: 'desc' } });
    expect(audit!.message).toMatch(/switched on/);

    /* Off again: every copy goes at once. */
    const off = (await dp(c).put({ biometricCopy: false }).expect(200)).body;
    expect(off.templatesDeleted).toBe(1);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId } })).toBe(0);
  });

  it('never keeps a copy for someone under 18, and never reads their location', async () => {
    const c = await makeOwner();
    await dp(c).put({ biometricCopy: true, attest: true }).expect(200);
    const a = serial();
    await addReader(c, a);
    const year = new Date().getFullYear();
    const kid = await person(c, { name: 'Young Worker', code: '501', dateOfBirth: `${year - 16}-01-15` });
    await reader(a).push([`FP PIN=501\tFID=1\tSize=1200\tValid=1\tTMP=${tmpl('501')}`], 'OPERLOG').expect(200);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId } })).toBe(0);
    const status = (await dp(c).get().expect(200)).body.status;
    expect(status.minors.map((m: any) => m.name)).toEqual(['Young Worker']);

    await api(c).post('/geofences', { name: 'Office', latitude: 12.9757, longitude: 77.6061, radiusMeters: 200 }).expect(201);
    await api(c).put('/portal-access', { employeeIds: [kid.id], mobilePunch: true }).expect(200);
    const me = await portalFor(c, kid.id, '501');
    const r = await me.post('/punch', { latitude: 12.9757, longitude: 77.6061, accuracy: 10 }).expect(403);
    expect(r.body.code).toBe('MINOR');
    expect((await me.get('/me').expect(200)).body.phone.allowed).toBe(false);
  });

  it('lets a person withdraw: their copies are deleted and none are kept again', async () => {
    const c = await makeOwner();
    await dp(c).put({ biometricCopy: true, attest: true }).expect(200);
    const a = serial();
    await addReader(c, a);
    const p = await person(c, { name: 'Meena', code: '601' });
    await reader(a).push([`FP PIN=601\tFID=1\tSize=1200\tValid=1\tTMP=${tmpl('601')}`], 'OPERLOG').expect(200);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(1);
    const me = await portalFor(c, p.id, '601');
    const w = (await me.post('/consent/withdraw', { what: 'BIOMETRIC' }).expect(200)).body;
    expect(w.message).toMatch(/deleted 1 stored copy/);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(0);
    await reader(a).push([`FP PIN=601\tFID=2\tSize=1200\tValid=1\tTMP=${tmpl('601b')}`], 'OPERLOG').expect(200);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(0);
    const reqs = (await me.get('/data-requests').expect(200)).body.requests;
    expect(reqs[0]).toMatchObject({ type: 'WITHDRAW', status: 'RESOLVED' });
    await me.post('/consent/withdraw', { what: 'PHONE' }).expect(200);
    expect((await peoplePrisma.employee.findUnique({ where: { id: p.id } }))!.mobilePunch).toBe(false);
  });
});

describe('the employee privacy notice and rights', () => {
  it('builds the notice from the company’s settings, asks for a new read when it changes, and records reads', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Kiran', code: '701', workEmail: 'kiran@example.com' });
    const me = await portalFor(c, p.id, '701');
    const first = (await me.get('/privacy-notice').expect(200)).body;
    expect(first.read).toBe(false);
    const text = JSON.stringify(first.notice.sections);
    expect(text).toMatch(/Data Fiduciary/);
    expect(text).toMatch(/CLOR keeps no copy/);
    expect(text).toMatch(/Data Protection Board of India/);
    expect(text).toMatch(/section 7\(i\)/);
    expect((await me.get('/me').expect(200)).body.privacy).toEqual({ version: first.notice.version, read: false });
    await me.post('/privacy-notice/read', { version: 'old' }).expect(409);
    await me.post('/privacy-notice/read', { version: first.notice.version }).expect(200);
    expect((await me.get('/me').expect(200)).body.privacy.read).toBe(true);

    await dp(c).put({ privacyContactName: 'Priya (HR)', privacyContactEmail: 'privacy@example.com', publishNotice: true }).expect(200);
    const second = (await me.get('/privacy-notice').expect(200)).body;
    expect(second.notice.version).not.toBe(first.notice.version);
    expect(second.read).toBe(false);
    expect(JSON.stringify(second.notice.sections)).toMatch(/privacy@example.com/);
    expect((await dp(c).get().expect(200)).body.status).toMatchObject({ noticeRead: 1, noticeReadCurrent: 0 });
  });

  it('gives a person everything held about them, without secrets or fingerprint data, and takes nominees and grievances', async () => {
    const c = await makeOwner();
    const a = serial();
    await addReader(c, a);
    const p = await person(c, { name: 'Lata', code: '801' });
    await reader(a).push(['801\t2026-09-01 09:00:00\t0\t1']).expect(200);
    const me = await portalFor(c, p.id, '801');
    const data = (await me.get('/my-data').expect(200)).body;
    expect(data.summary.sharedWith.join(' ')).toMatch(/CLOR \(Data Processor\)/);
    expect(data.punches).toHaveLength(1);
    expect(data.profile.portalPasswordHash).toBeUndefined();
    expect(data.profile.name).toBe('Lata');
    const n = (await me.post('/data-requests', { type: 'NOMINATE', details: 'My brother, Ravi, +91 90000 00000' }).expect(201)).body.request;
    expect(new Date(n.dueAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await me.post('/data-requests', { type: 'GRIEVANCE', details: 'My punch on 1 Sept was moved without telling me.' }).expect(201);
    expect((await dp(c).get().expect(200)).body.status.requestsWaiting).toBe(2);
  });
});

describe('breach register', () => {
  it('records a breach, tells the affected people, and tracks the Board’s 72 hours', async () => {
    const c = await makeOwner();
    await dp(c).put({ privacyContactEmail: 'dpo@example.com' }).expect(200);
    const a = await person(c, { name: 'Has Email', code: '901', personalEmail: 'one@example.com' });
    const b = await person(c, { name: 'No Email', code: '902' });
    /* The employee form saves the personal address in `email` (review R-09): that person is told too. */
    const d = await person(c, { name: 'Plain Email', code: '903', email: 'three@example.com' });
    const made = (await api(c).post('/data-protection/breaches', {
      title: 'Laptop with an attendance export lost', description: 'An HR laptop holding an attendance export was lost on a train.',
      discoveredAt: new Date(Date.now() - 80 * 3_600_000).toISOString(), categories: ['identity', 'attendance'], employeeIds: [a.id, b.id, d.id],
      consequences: 'Your name and punch times may be seen by someone else.', mitigation: 'The laptop is encrypted and has been locked remotely.', stepsForPeople: 'Nothing is needed; tell HR if you are contacted about it.',
    }).expect(201)).body.breach;
    expect(made).toMatchObject({ affected: 3, boardReportLate: true });
    await api(c).put(`/data-protection/breaches/${made.id}`, { status: 'CLOSED' }).expect(409);
    const sent = (await api(c).post(`/data-protection/breaches/${made.id}/notify`).expect(200)).body;
    expect(sent.sent).toBe(2);
    expect(sent.noEmail.map((x: any) => x.name)).toEqual(['No Email']);
    const mails = await platformPrisma.emailOutbox.findMany({ where: { orgId: c.orgId, templateKey: 'people.data_breach' } });
    expect(mails.map((m) => m.toEmail).sort()).toEqual(['one@example.com', 'three@example.com']);
    const mail = mails.find((m) => m.toEmail === 'one@example.com');
    void d;
    expect(mail!.bodyText).toMatch(/dpo@example.com/);
    await api(c).put(`/data-protection/breaches/${made.id}`, { boardIntimatedAt: new Date().toISOString(), boardReportAt: new Date().toISOString(), boardReference: 'DPB/2026/1' }).expect(200);
    const listed = (await api(c).get('/data-protection/breaches').expect(200)).body.breaches[0];
    expect(listed).toMatchObject({ boardReference: 'DPB/2026/1', boardReportLate: false });
    await api(c).put(`/data-protection/breaches/${made.id}`, { status: 'CLOSED' }).expect(200);
  });
});

describe('retention', () => {
  it('drops the position of old phone punches and old reader originals, keeping the punch', async () => {
    const c = await makeOwner();
    const sn = serial();
    const { device } = await addReader(c, sn);
    await person(c, { name: 'Old Punch', code: '990' });
    await reader(sn).push(['990\t2024-01-02 09:00:00\t0\t1']).expect(200);
    const punch = await peoplePrisma.devicePunch.findFirst({ where: { orgId: c.orgId, pin: '990' } });
    await peoplePrisma.devicePunch.update({ where: { id: punch!.id }, data: { latitude: 12.9, longitude: 77.6, accuracyM: 10 } });
    await peoplePrisma.readerEvent.updateMany({ where: { orgId: c.orgId, deviceId: device.id }, data: { receivedAt: new Date('2024-01-02T03:30:00Z') } });
    await purgeExpiredRecords();
    const after = await peoplePrisma.devicePunch.findUnique({ where: { id: punch!.id } });
    expect(after).toMatchObject({ latitude: null, longitude: null, accuracyM: null, localTime: '2024-01-02 09:00:00' });
    expect(await peoplePrisma.readerEvent.count({ where: { orgId: c.orgId, deviceId: device.id } })).toBe(0);
  });
});
