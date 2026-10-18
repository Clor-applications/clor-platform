import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createVerify, generateKeyPairSync } from 'node:crypto';

/** HR tools: a connection per tool, punches out through an outbox, people in. Fake greytHR and Keka on localhost. */
process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { enqueuePunches, flushOutbox, pullEmployees } = await import('../services/hr/sync.js');
const { greythrSwipeLines } = await import('../services/hr/adapters.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `hr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `HR Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** A stand-in for a vendor: records what it was sent, answers as told. */
function fakeServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => handler(req, body, res));
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => new Promise((r) => server.close(() => r())) })));
}

let c: Ctx;
beforeAll(async () => {
  c = await makeOwner();
}, 60_000);

describe('HR tools', () => {
  it('lists the adapters with their fields and what they can do', async () => {
    const r = await api(c).get('/integrations/hr/adapters').expect(200);
    const ids = r.body.adapters.map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['GREYTHR', 'KEKA']));
    const keka = r.body.adapters.find((a: any) => a.id === 'KEKA');
    expect(keka.capabilities).toEqual(['pushPunches', 'pullEmployees']);
    expect(keka.fields.find((f: any) => f.key === 'clientSecret').secret).toBe(true);
  });

  it('greytHR: punches go out as signed swipes, once each, with retries on a bad day', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const got: string[] = [];
    let fail = false;
    const fake = await fakeServer((req, body, res) => {
      const params = new URLSearchParams(body);
      const swipes = params.get('swipes') || '';
      const ok = createVerify('RSA-SHA1').update(swipes).end().verify(publicKey, params.get('sign') || '', 'base64');
      if (!ok || req.headers['x-requested-with'] !== 'XMLHttpRequest') { res.statusCode = 400; return res.end('bad sign'); }
      if (fail) { res.statusCode = 503; return res.end('down'); }
      if (swipes) got.push(swipes);
      res.statusCode = 200; res.end('ok');
    });
    try {
      /* The fake speaks plain http on localhost; a full URL in the address is taken as given. */
      const made = await api(c).post('/integrations/hr', { adapter: 'GREYTHR', name: 'greytHR test', enabled: true, fields: { domain: fake.url, apiId: 'ID1', privateKey: pem } }).expect(201);
      const id = made.body.connection.id;
      expect(made.body.connection.secretsSet).toEqual(['privateKey']);
      expect(JSON.stringify(made.body)).not.toContain('BEGIN PRIVATE KEY');
      expect((await api(c).post(`/integrations/hr/${id}/test`).expect(200)).body.ok).toBe(true);

      const p = await person(c, { name: 'Swiper', code: 'SW1' });
      const punches = [{ employeeId: p.id, code: 'SW1', readerId: 'MAIN', time: '2026-10-17 09:01:00', direction: 'IN', verifyMode: 1 }, { employeeId: p.id, code: 'SW1', readerId: 'MAIN', time: '2026-10-17 18:02:00', direction: 'OUT', verifyMode: 15 }];
      expect(await enqueuePunches(c.orgId, punches)).toBe(2);
      expect(await enqueuePunches(c.orgId, punches)).toBe(0); // same punches again: nothing new
      expect(greythrSwipeLines(punches as any)).toBe('2026-10-17T09:01:00,SW1,MAIN,1\n2026-10-17T18:02:00,SW1,MAIN,0');
      fail = true;
      expect(await flushOutbox()).toBe(0);
      const rows = await peoplePrisma.hrOutbox.findMany({ where: { connectionId: id } });
      expect(rows.every((r) => r.status === 'PENDING' && r.attempts === 1 && r.nextAttemptAt && r.nextAttemptAt > new Date())).toBe(true);
      fail = false;
      expect(await flushOutbox(new Date(Date.now() + 2 * 60_000))).toBe(2);
      expect(got).toHaveLength(1);
      expect(got[0].split('\n')).toHaveLength(2);
      const after = await peoplePrisma.hrOutbox.findMany({ where: { connectionId: id } });
      expect(after.every((r) => r.status === 'OK')).toBe(true);
      const listed = (await api(c).get('/integrations/hr').expect(200)).body.connections.find((x: any) => x.id === id);
      expect(listed.outbox).toEqual({ OK: 2 });
      expect(listed.lastSummary).toMatch(/Sent 2 punches/);
      const log = (await api(c).get(`/integrations/hr/${id}/log`).expect(200)).body;
      expect(log.log.some((l: any) => !l.ok)).toBe(true);
      expect(log.log.some((l: any) => l.ok)).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it('Keka: reads people and adds the ones CLOR lacks, when told to', async () => {
    const fake = await fakeServer((req, body, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/connect/token') return res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      if (req.url?.startsWith('/api/v1/hris/employees')) return res.end(JSON.stringify({ data: [{ id: 'k1', employeeNumber: 'KK1', displayName: 'Kiran Keka', email: 'kiran@example.com', department: { name: 'Ops' }, employmentStatus: 0 }, { id: 'k2', employeeNumber: 'KK2', displayName: 'Left Person', employmentStatus: 1 }], totalPages: 1 }));
      res.statusCode = 404; res.end('{}');
    });
    try {
      const made = await api(c).post('/integrations/hr', { adapter: 'KEKA', enabled: true, pullEmployees: true, createEmployees: true, fields: { tenant: 'acme', server: 'cin01', clientId: 'cid', clientSecret: 's', apiKey: 'k', attendanceApiKey: 'ak', deviceId: 'CLOR', apiBase: fake.url } }).expect(201);
      const id = made.body.connection.id;
      expect((await api(c).post(`/integrations/hr/${id}/test`).expect(200)).body.ok).toBe(true);
      await person(c, { name: 'Already Here', code: 'KK1' });
      const r = (await api(c).post(`/integrations/hr/${id}/pull`).expect(200)).body;
      expect(r).toMatchObject({ pulled: 2, matched: 1, created: 0 }); // KK2 has left; not added
      const conn = (await peoplePrisma.hrConnection.findUnique({ where: { id } }))!;
      const again = await pullEmployees({ ...conn, createEmployees: true });
      expect(again.created).toBe(0);
      /* A fresh company without KK1: the active person is added, the one who left is not. */
      const d = await makeOwner();
      const made2 = await api(d).post('/integrations/hr', { adapter: 'KEKA', enabled: true, pullEmployees: true, createEmployees: true, fields: { tenant: 'acme', server: 'cin01', clientId: 'cid', clientSecret: 's', apiKey: 'k', attendanceApiKey: 'ak', deviceId: 'CLOR', apiBase: fake.url } }).expect(201);
      expect((await api(d).post(`/integrations/hr/${made2.body.connection.id}/pull`).expect(200)).body).toMatchObject({ pulled: 2, matched: 0, created: 1 });
      expect(await peoplePrisma.employee.findFirst({ where: { orgId: d.orgId, code: 'KK1' } })).toMatchObject({ name: 'Kiran Keka', workEmail: 'kiran@example.com' });
      /* Missing required fields are named. */
      expect((await api(c).post('/integrations/hr', { adapter: 'KEKA', fields: { tenant: 'x' } }).expect(400)).body.error).toMatch(/Missing: /);
      await api(c).post('/integrations/hr', { adapter: 'NOPE', fields: {} }).expect(400);
    } finally {
      await fake.close();
    }
  });
});
