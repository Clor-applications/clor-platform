import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';

/**
 * Evidence from readers: the original of every line kept (ReaderEvent), signed
 * pushes, and a reader checked against the certification tests.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `evid.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Evidence Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
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



describe('reader evidence', () => {
  it('keeps the original of each new or unreadable line, never the repeats, and shows them per reader', async () => {
    const c = await makeOwner();
    const sn = serial();
    const { device } = await addReader(c, sn);
    await person(c, { name: 'Asha', code: '41' });
    await reader(sn).push(['41\t2026-09-01 09:00:00\t0\t1', 'garbage line']).expect(200);
    await reader(sn).push(['41\t2026-09-01 09:00:00\t0\t1']).expect(200);
    const events = await peoplePrisma.readerEvent.findMany({ where: { orgId: c.orgId, deviceId: device.id }, orderBy: { outcome: 'asc' } });
    expect(events.map((e) => [e.outcome, e.original, e.parser])).toEqual([
      ['NEW', '41\t2026-09-01 09:00:00\t0\t1', 'adms@1'],
      ['REJECTED', 'garbage line', 'adms@1'],
    ]);
    expect(events[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
    const listed = (await api(c).get(`/devices/${device.id}/events`).expect(200)).body;
    expect(listed.counts).toEqual({ NEW: 1, REJECTED: 1 });
    expect(listed.events[0].accountId).toBeUndefined();

    const cert = (await api(c).get(`/devices/${device.id}/certification`).expect(200)).body;
    expect(cert).toMatchObject({ support: 'COMPATIBLE', label: 'Compatible' });
    const status = Object.fromEntries(cert.tests.map((t: any) => [t.id, t.status]));
    expect(status).toMatchObject({ 'T-03': 'PASS', 'T-05': 'PASS', 'T-14': 'PASS', 'T-10': 'NA' });
    expect(cert.tests).toHaveLength(14);
    const compat = (await api(c).get('/reader-compatibility').expect(200)).body;
    expect(compat.catalogue.find((x: any) => /Mantra/.test(x.name)).support).toBe('UNSUPPORTED');
  });

  it('refuses unsigned or stale pushes once a push reader signs, and accepts signed ones', async () => {
    const c = await makeOwner();
    const made = (await api(c).post('/devices', { vendor: 'HTTP_PUSH', name: 'Turnstile', direction: 'both' }).expect(201)).body;
    const token = made.pushToken;
    await api(c).put(`/devices/${made.device.id}`, { name: 'Turnstile', direction: 'both', mapping: { employeeCode: 'code', timestamp: 'time' } }).expect(200);
    const { secret } = (await api(c).post(`/devices/${made.device.id}/signing`).expect(200)).body;
    expect(secret).toMatch(/^clors_/);
    expect((await api(c).get('/devices').expect(200)).body.devices.find((d: any) => d.id === made.device.id)).toMatchObject({ signed: true, support: { support: 'INTEGRATION_AVAILABLE' } });
    const body = JSON.stringify({ code: '88', time: '2026-09-01 09:00:00' });
    const sign = (ts: number, b = body) => `sha256=${createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const post = (headers: Record<string, string>, b = body) => request(app).post(`/ingest/${token}`).set('Content-Type', 'application/json').set(headers).send(b);

    expect((await post({}).expect(401)).body.error).toMatch(/Timestamp/);
    expect((await post({ 'X-Clor-Timestamp': String(now), 'X-Clor-Signature': sign(now, '{"code":"99","time":"2026-09-01 09:00:00"}') }).expect(401)).body.error).toMatch(/does not match/);
    expect((await post({ 'X-Clor-Timestamp': String(now - 3600), 'X-Clor-Signature': sign(now - 3600) }).expect(401)).body.error).toMatch(/five minutes/);
    expect((await post({ 'X-Clor-Timestamp': String(now), 'X-Clor-Signature': sign(now) }).expect(200)).body).toMatchObject({ added: 1 });

    await api(c).post(`/devices/${made.device.id}/signing`, { on: false }).expect(200);
    await post({}, JSON.stringify({ code: '88', time: '2026-09-01 18:00:00' })).expect(200);
    /* Signing is only for readers that push to their own URL. */
    const sn = serial();
    const adms = (await addReader(c, sn)).device;
    await api(c).post(`/devices/${adms.id}/signing`).expect(400);
  });
});
