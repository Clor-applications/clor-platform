import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

/*
 * A-35: every tenant_isolation policy let a row through when no company was
 * set, so a query that forgot to say which company it was for saw them all.
 * Row-level security was a backstop only for queries that were already right.
 *
 * The suite connects as the application role (globalSetup), which owns
 * nothing and bypasses nothing, so these are the real policies at work.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { beginRequestScope, outsideTenant, runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
const rnd = () => Math.random().toString(36).slice(2, 8);

/** A query as a request makes it before naming its company. */
const inRequest = <T>(fn: () => Promise<T>) => new Promise<T>((done, fail) => beginRequestScope(null, null, () => fn().then(done, fail)));

let a: { orgId: string };
let b: { orgId: string };

async function companyWithInvoice(label: string) {
  const email = `rls.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const s = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `RLS ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const at = { Authorization: `Bearer ${signup.body.token}`, 'x-org-id': s.body.company.orgId, 'x-branch-id': s.body.branch.id };
  await request(app).post(`/api/orgs/${s.body.company.orgId}/invoices`).set(at).send({ date: '2026-09-09', customerName: 'Acme', subtotal: 100, gstTotal: 18, total: 118, items: [{ description: 'x', quantity: 1, rate: 100, gstRate: 18 }] }).expect(201);
  return { orgId: s.body.company.orgId as string };
}

beforeAll(async () => {
  a = await companyWithInvoice('a');
  b = await companyWithInvoice('b');
}, 60_000);
afterAll(() => new Promise((done) => app.close(done)));

describe('the policies themselves', () => {
  it('have no "no company set means everything" clause left, in any of the four databases', async () => {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_policies
      WHERE policyname = 'tenant_isolation' AND (qual LIKE '%IS NULL%' OR qual NOT LIKE '%clor.bypass%')`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it('show a connection that names no company and no bypass nothing at all', async () => {
    const raw = new PrismaClient();
    try {
      expect(await raw.invoice.count({ where: { orgId: { in: [a.orgId, b.orgId] } } })).toBe(0);
    } finally {
      await raw.$disconnect();
    }
  });
});

describe('what each kind of code sees', () => {
  const both = { orgId: { in: [] as string[] } };
  beforeAll(() => {
    both.orgId.in = [a.orgId, b.orgId];
  });

  it('a request that has not named its company: nothing', async () => {
    expect(await inRequest(() => prisma.invoice.count({ where: both }))).toBe(0);
  });

  it('a request working for a company: that company only', async () => {
    expect(await inRequest(() => runInTenant(a.orgId, () => prisma.invoice.count({ where: both })))).toBe(1);
  });

  it('a request reading across companies on purpose: both', async () => {
    expect(await inRequest(() => outsideTenant('test: across companies', () => prisma.invoice.count({ where: both })))).toBe(2);
  });

  it('background work outside any request: both (maintenance)', async () => {
    expect(await prisma.invoice.count({ where: both })).toBe(2);
  });

  it('the operator valve, TENANT_STRICT=off: a request without a company falls back to both', async () => {
    process.env.TENANT_STRICT = 'off';
    try {
      expect(await inRequest(() => prisma.invoice.count({ where: both }))).toBe(2);
    } finally {
      delete process.env.TENANT_STRICT;
    }
  });
});
