import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';

/*
 * A-16: the payment gateway's webhook said it was "mounted PUBLIC and BEFORE
 * auth" but sat behind routers that put requireAuth on everything under /api,
 * so a gateway's call got 401 and never arrived. It also parsed JSON first,
 * so a signature over the bytes the gateway sent could never be checked.
 */
const { buildApp } = await import('../app.js');
const { __setGateway } = await import('../billing/gateway.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
afterEach(() => __setGateway(null));

const SECRET = 'whsec_test_only';

/** A gateway that, like a real one, signs the exact bytes it sends. */
const signingGateway = (seen: { raw?: string }) =>
  ({
    name: 'test',
    external: true,
    verifyWebhook(rawBody: string | Buffer, headers: Record<string, unknown>) {
      const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
      seen.raw = raw;
      const expected = createHmac('sha256', SECRET).update(raw).digest('hex');
      if (headers['x-test-signature'] !== expected) return null;
      const body = JSON.parse(raw);
      return { gateway: 'test', eventId: body.id, type: body.type, accountId: null, raw: body };
    },
  }) as any;

describe('the billing webhook', () => {
  it('is reached without a session', async () => {
    const res = await request(app).post('/api/billing/webhook').send({ id: 'evt_x', type: 'ping' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ignored: true });
  });

  it('verifies the signature over the exact bytes the gateway sent', async () => {
    const seen: { raw?: string } = {};
    __setGateway(signingGateway(seen));
    /* Spacing and key order a JSON round-trip would not keep. */
    const body = `{"type":"subscription.updated",  "id":"evt_${Date.now()}"}`;
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    const res = await request(app).post('/api/billing/webhook').set('content-type', 'application/json').set('x-test-signature', sig).send(body);
    expect(seen.raw).toBe(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: true });
    const bad = await request(app).post('/api/billing/webhook').set('content-type', 'application/json').set('x-test-signature', 'forged').send(body);
    expect(bad.status).toBe(202);
    expect(await platformPrisma.paymentEvent.count({ where: { gateway: 'test', eventId: JSON.parse(body).id } })).toBe(1);
  });
});
