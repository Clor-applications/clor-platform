import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createHmac } from 'node:crypto';

/*
 * A-34, what Batch 5 left (Batch 11):
 * - tokens that ride in a URL path were written into logs and error reports
 *   as they came; only the invoice share link was taken out;
 * - a webhook's signature covered the body but not the time it was sent, so a
 *   captured delivery could be replayed for ever; and its secret could not be
 *   changed without deleting the webhook.
 */
const { safeUrl } = await import('../utils/safeUrl.js');
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `cl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'CL owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CL Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}
const hooks = (c: Ctx) => ({
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/webhooks${p}`).set(at(c)).send(b as any),
});

describe('a token in a URL path never reaches a log', () => {
  const token = 'clorp_AbCdEfGhIjKlMnOpQrStUv_12';
  it.each([
    ['payment page', `/pay/${token}`, '/pay/[token]'],
    ['payment claim', `/pay/${token}/claim`, '/pay/[token]/claim'],
    ['generic ingest', `/ingest/${token}`, '/ingest/[token]'],
    ['Matrix reader', `/matrix/${token}/cosec/api.svc/v2/event`, '/matrix/[token]/cosec/api.svc/v2/event'],
    ['Hikvision push', `/hikvision/${token}`, '/hikvision/[token]'],
    ['invoice share link', `/api/public/invoice/${token}`, '/api/public/invoice/[token]'],
  ])('%s', (_name, url, logged) => {
    expect(safeUrl(url)).toBe(logged);
    expect(safeUrl(`${url}?x=1`)).toBe(`${logged}?x=1`);
  });

  it('leaves ordinary addresses alone', () => {
    expect(safeUrl('/api/orgs/o1/invoices')).toBe('/api/orgs/o1/invoices');
    expect(safeUrl('/api/orgs/o1/attendance/payroll-export')).toBe('/api/orgs/o1/attendance/payroll-export');
    expect(safeUrl('/iclock/cdata?SN=ABC123')).toBe('/iclock/cdata?SN=ABC123');
  });
});

describe('webhook signatures cover the time, and the secret can be changed', () => {
  const got: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(204).end();
    });
  });
  let url = '';
  let c: Ctx;
  let prev: string | undefined;
  beforeAll(async () => {
    await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', () => done()));
    url = `http://127.0.0.1:${(receiver.address() as any).port}/clor`;
    prev = process.env.INTEGRATIONS_ALLOW_PRIVATE;
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
    c = await company();
  }, 60_000);
  afterAll(async () => {
    process.env.INTEGRATIONS_ALLOW_PRIVATE = prev;
    await new Promise((done) => receiver.close(done));
  });

  /** The v1 values in X-Clor-Signature-256, after checking its time is the one sent. */
  const v1s = (g: { headers: http.IncomingHttpHeaders }) => {
    const header = String(g.headers['x-clor-signature-256'] || '');
    const parts = header.split(',').map((p) => p.split('='));
    const t = parts.find(([k]) => k === 't')?.[1];
    expect(t).toBe(g.headers['x-clor-timestamp']);
    return { t: t!, v1: parts.filter(([k]) => k === 'v1').map(([, v]) => v) };
  };
  const sign = (secret: string, t: string, body: string) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

  it('signs the time with the body, and keeps the old header for receivers that check it', async () => {
    const made = (await hooks(c).post('', { name: 'HRMS', url, events: ['day'] }).expect(201)).body;
    got.length = 0;
    await hooks(c).post(`/${made.webhook.id}/test`).expect(200);
    const g = got[0];
    const { t, v1 } = v1s(g);
    expect(v1).toEqual([sign(made.secret, t, g.body)]);
    expect(Math.abs(Number(t) - Date.now() / 1000)).toBeLessThan(60);
    expect(g.headers['x-clor-signature']).toBe(`sha256=${createHmac('sha256', made.secret).update(g.body).digest('hex')}`);
  });

  it('a new secret is shown once; both are signed with for a day, then only the new', async () => {
    const made = (await hooks(c).post('', { name: 'Payroll', url, events: ['day'] }).expect(201)).body;
    const rotated = await hooks(c).post(`/${made.webhook.id}/rotate-secret`).expect(200);
    expect(rotated.body.secret).toMatch(/^whsec_/);
    expect(rotated.body.secret).not.toBe(made.secret);
    expect(new Date(rotated.body.previousSecretUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(JSON.stringify((await request(app).get(`/api/orgs/${c.orgId}/attendance/integrations/webhooks`).set(at(c)).expect(200)).body)).not.toContain(rotated.body.secret);
    await new Promise((r) => setTimeout(r, 150));
    const trail = JSON.stringify((await request(app).get(`/api/orgs/${c.orgId}/audit?limit=50`).set(at(c)).expect(200)).body);
    expect(trail).toContain('Changed a webhook’s signing secret');
    expect(trail).not.toContain(rotated.body.secret);
    expect(trail).not.toContain(made.secret);

    got.length = 0;
    await hooks(c).post(`/${made.webhook.id}/test`).expect(200);
    let g = got[0];
    let s = v1s(g);
    expect(s.v1).toEqual([sign(rotated.body.secret, s.t, g.body), sign(made.secret, s.t, g.body)]);
    expect(g.headers['x-clor-signature']).toBe(`sha256=${createHmac('sha256', rotated.body.secret).update(g.body).digest('hex')}`);

    await outsideTenant('test: the day has passed', () => peoplePrisma.webhook.update({ where: { id: made.webhook.id }, data: { previousSecretUntil: new Date(Date.now() - 1000) } }));
    got.length = 0;
    await hooks(c).post(`/${made.webhook.id}/test`).expect(200);
    g = got[0];
    s = v1s(g);
    expect(s.v1).toEqual([sign(rotated.body.secret, s.t, g.body)]);
  });

  it('another company cannot change it', async () => {
    const made = (await hooks(c).post('', { name: 'Mine', url, events: ['day'] }).expect(201)).body;
    const d = await company();
    await hooks(d).post(`/${made.webhook.id}/rotate-secret`).expect(404);
  }, 60_000);
});
