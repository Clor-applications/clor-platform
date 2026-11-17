import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * An account that bought by the head is held to the number it bought (audit,
 * 17 Nov 2026: buy 20, add 500).
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { boughtSeats, employeeLimitReason, userLimitReason } = await import('../services/entitlements.js');
const { at, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);
type Ctx = Awaited<ReturnType<typeof company>>;
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: bought seats', fn);
const buy = (c: Ctx, planUnit: string | null, quantity: number | null) => db(() => platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { planUnit, quantity } }));
const add = (c: Ctx, name: string, over: Record<string, unknown> = {}) =>
  request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name, code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', ...over });

describe('an account that bought by the employee', () => {
  it('adds as many as it bought and no more; someone who left frees a place', async () => {
    const c = await company('seat');
    expect(await boughtSeats(c.accountId)).toBeNull();
    expect(await employeeLimitReason(c.accountId)).toBeNull();

    await buy(c, 'EMPLOYEE', 2);
    expect(await boughtSeats(c.accountId)).toEqual({ unit: 'EMPLOYEE', quantity: 2 });
    const first = await add(c, 'Asha').expect(201);
    await add(c, 'Ravi').expect(201);
    const refused = await add(c, 'Meena').expect(409);
    expect(refused.body.code).toBe('SEATS_FULL');
    expect(refused.body.error).toMatch(/paid for 2 employees, and it has 2/);
    expect(await db(() => peoplePrisma.employee.count({ where: { accountId: c.accountId } }))).toBe(2);

    /* Payroll's own door is held to the same number. */
    const viaPayroll = await request(app).post(`/api/orgs/${c.orgId}/payroll/employees`).set(at(c)).send({ name: 'Kiran', code: `P${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE' });
    expect(viaPayroll.status).toBe(409);
    expect(viaPayroll.body.code).toBe('SEATS_FULL');

    await db(() => peoplePrisma.employee.update({ where: { id: first.body.employee.id }, data: { status: 'LEFT' } }));
    await add(c, 'Meena').expect(201);

    /* More bought, more may be added. */
    await buy(c, 'EMPLOYEE', 5);
    await add(c, 'Kiran').expect(201);
  }, 180_000);

  it('a plan sold flat, or by the company, holds nobody to a head count', async () => {
    const c = await company('flat');
    await buy(c, 'COMPANY', 1);
    expect(await boughtSeats(c.accountId)).toBeNull();
    await add(c, 'One').expect(201);
    await add(c, 'Two').expect(201);
  }, 120_000);
});

describe('an account that bought by the user', () => {
  it('is told when its users are all taken, and a number CLOR set wins', async () => {
    const c = await company('useat');
    expect(await userLimitReason(c.accountId)).toBeNull();
    await buy(c, 'USER', 1);
    expect(await userLimitReason(c.accountId)).toMatch(/paid for 1 user, and it has 1/);
    await buy(c, 'USER', 3);
    expect(await userLimitReason(c.accountId)).toBeNull();
  }, 120_000);
});

describe('an account active with no end date', () => {
  it('is listed for CLOR staff under its own filter, and leaves it once a period is set', async () => {
    const c = await company('noend');
    await db(() => platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { status: 'active', trialEndsAt: null, currentPeriodEnd: null } }));
    const ro = await staff('READ_ONLY');
    const list = async () => (await request(app).get('/api/ops/accounts').query({ status: 'no-end', q: c.email }).set(ro.h).expect(200)).body.accounts as Array<{ id: string; noEnd: boolean }>;
    expect((await list()).map((a) => a.id)).toEqual([c.accountId]);
    expect((await list())[0].noEnd).toBe(true);
    await db(() => platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } }));
    expect(await list()).toEqual([]);
  }, 120_000);
});
