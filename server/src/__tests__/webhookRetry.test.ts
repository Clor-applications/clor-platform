import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import jwt from 'jsonwebtoken';

/**
 * A-45: webhook deliveries that were never retried, or sent twice.
 *
 * A delivery row started with no next-attempt time and got one only when its
 * first attempt was recorded. An attempt that died before that left the row
 * PENDING and due never. The retry job sent everything due without claiming
 * it, so two instances sent the same delivery twice; and it kept sending for
 * a company whose Attendance had lapsed.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { deliver, retryDueDeliveries } = await import('../services/attendance/webhooks.js');

const app = buildApp().listen(0);
const prevPrivate = process.env.INTEGRATIONS_ALLOW_PRIVATE;
afterAll(async () => {
  process.env.INTEGRATIONS_ALLOW_PRIVATE = prevPrivate;
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `a45.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `A45 Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: (jwt.decode(signup.body.token) as any).accountId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}

/** A receiving end that can be told to fail, counting what arrived. */
function receiver() {
  const got: string[] = [];
  let failNext = 0;
  let slowMs = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      got.push(String(req.headers['x-clor-delivery']));
      if (failNext > 0) {
        failNext -= 1;
        res.writeHead(500).end('nope');
      } else setTimeout(() => res.writeHead(200).end('ok'), slowMs);
    });
  });
  return {
    got,
    fail: (n: number) => (failNext = n),
    slow: (ms: number) => (slowMs = ms),
    start: () => new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}/hook`))),
    stop: () => new Promise((ok) => server.close(ok)),
  };
}

const rx = receiver();
let c: Ctx;
let hook: any;
const later = (min: number) => new Date(Date.now() + min * 60_000);

beforeAll(async () => {
  process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
  const url = await rx.start();
  c = await makeOwner();
  const made = (await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/webhooks`).set(at(c)).send({ name: 'HRMS', url, events: ['employee.created'] }).expect(201)).body.webhook;
  hook = await peoplePrisma.webhook.findUniqueOrThrow({ where: { id: made.id } });
}, 60_000);
afterAll(() => rx.stop());

describe('A-45: a webhook delivery', () => {
  it('whose first attempt was never recorded (the instance stopped) is retried, not lost', async () => {
    /* The instance stops before the attempt's outcome is written. Receivers de-duplicate on X-Clor-Delivery. */
    const stop = vi.spyOn(peoplePrisma.webhookDelivery, 'update').mockRejectedValueOnce(new Error('instance stopped'));
    try {
      await expect(deliver(hook, 'employee.created', c.orgId, { n: 1 })).rejects.toThrow('instance stopped');
    } finally {
      stop.mockRestore();
    }
    const row = await peoplePrisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id }, orderBy: { createdAt: 'desc' } });
    expect(row.status).toBe('PENDING');
    expect(row.nextAttemptAt).not.toBeNull();

    const before = rx.got.length;
    expect(await retryDueDeliveries(later(5))).toBe(1);
    expect(rx.got.length).toBe(before + 1);
    expect((await peoplePrisma.webhookDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('OK');
  });

  it('left with no next-attempt time by older code is picked up once it is older than a claim', async () => {
    const old = await peoplePrisma.webhookDelivery.create({
      data: { accountId: c.accountId, orgId: c.orgId, webhookId: hook.id, event: 'employee.created', body: '{}', createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await peoplePrisma.webhookDelivery.update({ where: { id: old.id }, data: { nextAttemptAt: null } });
    expect(await retryDueDeliveries(new Date())).toBe(1);
    expect((await peoplePrisma.webhookDelivery.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('OK');
  });

  it('is sent once when two instances retry at the same moment', async () => {
    rx.fail(1);
    await deliver(hook, 'employee.created', c.orgId, { n: 2 });
    const row = await peoplePrisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id }, orderBy: { createdAt: 'desc' } });
    expect(row.status).toBe('PENDING');
    const sentBefore = rx.got.filter((id) => id === row.id).length;
    /* The receiver takes a moment to answer: the second instance's tick lands while the first is still sending. */
    rx.slow(400);
    try {
      const t = later(3);
      const first = retryDueDeliveries(t);
      await new Promise((r) => setTimeout(r, 150));
      const [a, b] = await Promise.all([first, retryDueDeliveries(t)]);
      expect(a + b).toBe(1);
    } finally {
      rx.slow(0);
    }
    expect(rx.got.filter((id) => id === row.id).length).toBe(sentBefore + 1);
  });

  it('is not retried while the company no longer has Attendance, and waits instead of failing', async () => {
    rx.fail(1);
    await deliver(hook, 'employee.created', c.orgId, { n: 3 });
    const row = await peoplePrisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id }, orderBy: { createdAt: 'desc' } });
    await platformPrisma.subscription.updateMany({ where: { accountId: c.accountId }, data: { status: 'cancelled' } });
    const before = rx.got.length;
    expect(await retryDueDeliveries(later(3))).toBe(0);
    expect(rx.got.length).toBe(before);
    const after = await peoplePrisma.webhookDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(row.attempts);
  });
});
