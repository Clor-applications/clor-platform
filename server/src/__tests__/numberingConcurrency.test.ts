import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { allocateNumber, ensureDefaultSeries } from '../services/numbering.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { prisma } from '../utils/prisma.js';
import { runInTenant } from '../utils/tenantScope.js';

/**
 * Two documents saved at the same moment in one series get different numbers.
 *
 * allocateNumber used to read nextNumber and write it back as two statements;
 * two saves could read the same value, and the second then failed on the
 * unique (orgId, number). The bump is now one UPDATE … RETURNING under the
 * row lock.
 */
const app = buildApp();
const rnd = () => Math.random().toString(36).slice(2, 8);

let ctx: { accountId: string; orgId: string; userId: string };

beforeAll(async () => {
  const email = `numrace.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Race owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Race Co ${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true, accountId: true } });
  ctx = { accountId: user.accountId, orgId: setup.body.company.orgId, userId: user.id };
});

describe('number allocation', () => {
  it('gives ten simultaneous saves ten different numbers, in order', async () => {
    const opts = { ...ctx, docType: 'race-test', date: '2026-10-20' };
    await runInTenant(ctx.orgId, () => ensureDefaultSeries(opts));
    const values = await Promise.all(
      Array.from({ length: 10 }, () => runInTenant(ctx.orgId, () => prisma.$transaction((tx) => allocateNumber(tx, opts)))),
    );
    const got = values.map((v) => v.value).sort((a, b) => a - b);
    expect(new Set(got).size).toBe(10);
    expect(got[9] - got[0]).toBe(9);
  });

  it('starts a resetting series again in a new period', async () => {
    const opts = { ...ctx, docType: 'race-reset', date: '2026-03-31' };
    await runInTenant(ctx.orgId, () => ensureDefaultSeries(opts));
    const first = await runInTenant(ctx.orgId, () => prisma.$transaction((tx) => allocateNumber(tx, opts)));
    const second = await runInTenant(ctx.orgId, () => prisma.$transaction((tx) => allocateNumber(tx, opts)));
    const nextYear = await runInTenant(ctx.orgId, () => prisma.$transaction((tx) => allocateNumber(tx, { ...opts, date: '2026-04-01' })));
    expect(second.value).toBe(first.value + 1);
    expect(nextYear.value).toBe(1);
  });
});
