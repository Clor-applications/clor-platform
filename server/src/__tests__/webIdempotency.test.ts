import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Money records are never made twice: a double-clicked save (same person,
 * same body, same route, within seconds) gets the first answer back, and a
 * client's Idempotency-Key is honoured for a day.
 */
const { isGuardedWrite } = await import('../middleware/idempotency.js');
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await platformPrisma.$disconnect();
});

describe('which writes are guarded', () => {
  it('covers invoices, payments and payroll payments, not reads or other routes', () => {
    expect(isGuardedWrite('POST', '/api/orgs/o1/invoices')).toBe(true);
    expect(isGuardedWrite('POST', '/api/orgs/o1/payments')).toBe(true);
    expect(isGuardedWrite('POST', '/api/orgs/o1/payments/p1/reverse')).toBe(true);
    expect(isGuardedWrite('POST', '/api/orgs/o1/payroll/payments/x/post')).toBe(true);
    expect(isGuardedWrite('GET', '/api/orgs/o1/invoices')).toBe(false);
    expect(isGuardedWrite('POST', '/api/orgs/o1/invoices/i1/ewaybill')).toBe(false);
    expect(isGuardedWrite('POST', '/api/orgs/o1/attendance/clock')).toBe(false);
  });
});

describe('a repeated write', () => {
  const rnd = () => Math.random().toString(36).slice(2, 8);
  it('replays the first answer instead of running again', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email: `idem.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Idem ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
    const h = { Authorization: `Bearer ${signup.body.token}`, 'x-org-id': setup.body.company.orgId, 'x-branch-id': setup.body.branch.id };
    const org = setup.body.company.orgId;
    /* Raising what is due: a write that succeeds with nothing due, so the second send can be told apart. */
    const url = `/api/orgs/${org}/recurring/run`;
    const key = `click-${rnd()}`;
    const first = await request(app).post(url).set(h).set('Idempotency-Key', key).send({});
    expect(first.status).toBeLessThan(400);
    const second = await request(app).post(url).set(h).set('Idempotency-Key', key).send({});
    expect(second.status).toBe(first.status);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    /* Without a key an identical request runs again (two identical receipts on purpose are two receipts). */
    const plain = await request(app).post(url).set(h).send({});
    expect(plain.headers['idempotency-replayed']).toBeUndefined();
    /* The same key for a different request is refused. */
    const clash = await request(app).post(url).set(h).set('Idempotency-Key', key).send({ other: true });
    expect(clash.status).toBe(422);
    /* A refusal is not kept: a corrected retry with the same key runs. */
    const bad = `bad-${rnd()}`;
    const refused = await request(app).post(`/api/orgs/${org}/pay-requests`).set(h).set('Idempotency-Key', bad).send({ invoiceId: 'nope' });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const again = await request(app).post(`/api/orgs/${org}/pay-requests`).set(h).set('Idempotency-Key', bad).send({ invoiceId: 'nope' });
    expect(again.headers['idempotency-replayed']).toBeUndefined();
  });
});
