import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createHmac } from 'node:crypto';

/** API keys, the /v1 API for outside systems, and webhooks. */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { flushWebhooks } = await import('../services/attendance/webhooks.js');
const { blockedReason } = await import('../services/outbound.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `int.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Int owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Int Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const v1 = (key: string) => ({
  get: (p: string) => request(app).get(`/v1${p}`).set('Authorization', `Bearer ${key}`),
  post: (p: string, b: unknown) => request(app).post(`/v1${p}`).set('Authorization', `Bearer ${key}`).send(b as any),
});
const newKey = async (c: Ctx, scopes: string[], extra: Record<string, unknown> = {}) =>
  (await api(c).post('/integrations/keys', { name: `Key ${rnd()}`, scopes, ...extra }).expect(201)).body;

let c: Ctx;
beforeAll(async () => {
  c = await makeOwner();
}, 60_000);

describe('API keys', () => {
  it('are shown once, kept only as a hash, and do only what their scopes say', async () => {
    const { key, token } = await newKey(c, ['employees:read']);
    expect(token).toMatch(/^clor_[0-9a-f]{64}$/);
    const listed = JSON.stringify((await api(c).get('/integrations/keys').expect(200)).body);
    expect(listed).not.toContain(token);
    expect(listed).not.toContain('tokenHash');
    expect((await peoplePrisma.apiClient.findUnique({ where: { id: key.id } }))!.tokenHash).not.toBe(token);

    expect((await v1(token).get('/ping').expect(200)).body).toMatchObject({ ok: true, orgId: c.orgId, scopes: ['employees:read'] });
    await v1(token).get('/employees').expect(200);
    await v1(token).get('/attendance/days').expect(403);
    await request(app).get('/v1/ping').expect(401);
    await v1('clor_nope').get('/ping').expect(401);
  });

  it('stop working when revoked, and the old key stops when rotated', async () => {
    const { key, token } = await newKey(c, ['attendance:read']);
    const rotated = (await api(c).post(`/integrations/keys/${key.id}/rotate`).expect(200)).body.token;
    await v1(token).get('/ping').expect(401);
    await v1(rotated).get('/ping').expect(200);
    await api(c).post(`/integrations/keys/${key.id}/revoke`).expect(200);
    await v1(rotated).get('/ping').expect(401);
  });

  it('refuse calls from addresses outside their allowlist', async () => {
    const { token } = await newKey(c, ['attendance:read'], { allowedIps: '10.9.8.7' });
    expect((await v1(token).get('/ping').expect(403)).body.error).toMatch(/may not be used from/);
  });

  it('see only their own company', async () => {
    const other = await makeOwner();
    await person(other, { name: 'Other Co Person', code: 'X1' });
    const { token } = await newKey(c, ['employees:read']);
    const names = (await v1(token).get('/employees').expect(200)).body.employees.map((e: any) => e.name);
    expect(names).not.toContain('Other Co Person');
  });
});

describe('punches in, attendance out', () => {
  it('takes punches from anything that can POST JSON and works out the days', async () => {
    const p = await person(c, { name: 'Turnstile', code: '801' });
    const { token } = await newKey(c, ['punches:write', 'attendance:read']);
    const r = (await v1(token)
      .post('/attendance/punches', {
        punches: [
          { employee_code: '801', timestamp: '2026-09-21 09:15', direction: 'in', verify_mode: 'face' },
          { employee_code: '801', timestamp: '2026-09-21 18:05:00', direction: 'out' },
          { employee_code: '', timestamp: 'yesterday' },
        ],
      })
      .expect(200)).body;
    expect(r).toMatchObject({ received: 3, accepted: 2, added: 2, rejected: 1 });
    expect((await v1(token).post('/attendance/punches', { employee_code: '801', timestamp: '2026-09-21 09:15:00', direction: 'in' }).expect(200)).body).toMatchObject({ added: 0, duplicates: 1 });

    const days = (await v1(token).get('/attendance/days?from=2026-09-21&to=2026-09-21').expect(200)).body.days;
    expect(days.find((d: any) => d.employeeId === p.id)).toMatchObject({ employeeCode: '801', checkIn: '09:15', checkOut: '18:05', lateMinutes: 15, source: 'DEVICE' });
    const punches = (await v1(token).get('/attendance/punches?from=2026-09-21&to=2026-09-21').expect(200)).body.punches;
    expect(punches.map((x: any) => [x.time, x.direction])).toEqual([
      ['2026-09-21 09:15:00', 'IN'],
      ['2026-09-21 18:05:00', 'OUT'],
    ]);
    const summary = (await v1(token).get('/attendance/summary?month=2026-09').expect(200)).body.rows.find((x: any) => x.employeeId === p.id);
    expect(summary.halfDays).toBe(1); // 09:15–18:05 less the hour's break is 7:50, under a full day
    // Transactions show where they came from.
    const tx = (await api(c).get('/transactions?from=2026-09-21&to=2026-09-21').expect(200)).body.transactions;
    expect(tx[0].deviceName).toMatch(/^API: /);
    await v1(token).get('/attendance/days?from=2026-01-01&to=2026-12-31').expect(400);
  });
});

describe('webhooks', () => {
  it('refuse private and metadata addresses in production', () => {
    const prev = process.env.INTEGRATIONS_ALLOW_PRIVATE;
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'false';
    try {
      expect(blockedReason('169.254.169.254')).toMatch(/metadata/);
      expect(blockedReason('10.0.0.5')).toMatch(/private/);
      expect(blockedReason('127.0.0.1')).toMatch(/private/);
      expect(blockedReason('8.8.8.8')).toBeNull();
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE = prev;
    }
  });

  it('send signed punch and day events as they happen', async () => {
    const got: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    const receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        got.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', () => done()));
    const port = (receiver.address() as any).port;
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
    try {
      const c2 = await makeOwner();
      await person(c2, { name: 'Hooked', code: '901' });
      const { webhook, secret } = (await api(c2).post('/integrations/webhooks', { name: 'HRMS', url: `http://127.0.0.1:${port}/clor`, events: ['punch', 'day'] }).expect(201)).body;
      expect(secret).toMatch(/^whsec_/);
      expect(JSON.stringify((await api(c2).get('/integrations/webhooks').expect(200)).body)).not.toContain(secret);

      const { token } = await newKey(c2, ['punches:write']);
      await v1(token).post('/attendance/punches', { employee_code: '901', timestamp: '2026-09-22 09:00:00', direction: 'in' }).expect(200);
      await flushWebhooks();
      const events = got.map((g) => JSON.parse(g.body).event);
      expect(events).toEqual(expect.arrayContaining(['punch', 'day']));
      for (const g of got) {
        expect(g.headers['x-clor-signature']).toBe(`sha256=${createHmac('sha256', secret).update(g.body).digest('hex')}`);
      }
      const day = JSON.parse(got.find((g) => JSON.parse(g.body).event === 'day')!.body);
      expect(day.data).toMatchObject({ date: '2026-09-22', checkIn: '09:00' });

      expect((await api(c2).post(`/integrations/webhooks/${webhook.id}/test`).expect(200)).body).toMatchObject({ ok: true, status: 204 });
      expect((await api(c2).get('/integrations/webhooks').expect(200)).body.webhooks[0]).toMatchObject({ lastStatus: 204, lastError: null });

      await api(c2).post('/integrations/webhooks', { name: 'Bad', url: 'ftp://example.com/x', events: ['day'] }).expect(400);
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE = 'false';
      await new Promise((done) => receiver.close(done));
    }
  });
});
