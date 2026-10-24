import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

/**
 * A-47: the purge that deletes a closed company.
 *
 * It ran all four databases in one go with no record of how far it got. A
 * deploy's SIGTERM (eight seconds) could cut it off between databases, it
 * started new destructive work while the instance was stopping, and a failure
 * was swallowed into a log line: the closure record still said SCHEDULED and
 * nothing said a company was half deleted.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { Prisma: AccountingPrisma } = await import('@prisma/client');
const { purgeClosedCompanies, noticeDays } = await import('../services/companyClosure.js');
const jobLease = await import('../services/jobLease.js');
const { codeAt, stepNow } = await import('../services/totp.js');

const app = buildApp().listen(0);
const ownerUrl = () => {
  const url = new URL(String(process.env.PG_ADMIN_URL));
  url.pathname = new URL(String(process.env.DATABASE_URL)).pathname;
  url.search = '?schema=accounting';
  return url.toString();
};
const owner = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
afterAll(async () => {
  await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS accounting.a47_refuse() CASCADE`);
  await owner.$disconnect();
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; name: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

/** A company with people and books, closed, its notice ended. */
async function closedCompany(): Promise<Ctx> {
  const email = `a47.${Date.now()}.${rnd()}@example.com`;
  /* A prefix of its own per company: a purged company's code number is issued again while its account keeps the
     code (a separate, pre-existing bug in displayCodes.ts), so two companies sharing letters here could collide. */
  const letters = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const name = `${letters} Purge Co`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: name, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, name };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Some One', dateOfJoining: '2025-01-01' }).expect(201);
  await request(app).get(`/api/orgs/${c.orgId}/export?scope=all`).set(at(c)).expect(200);
  /* A-21: closing needs a fresh authenticator code. */
  const sec = (p: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(body as any);
  const { secret } = (await sec('/two-factor/setup').expect(200)).body;
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  const stepUp = (await sec('/step-up', { code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  await request(app).post(`/api/orgs/${c.orgId}/closure`).set({ ...at(c), 'x-step-up': stepUp }).send({ confirmName: name }).expect(201);
  return c;
}
const afterNotice = () => new Date(Date.now() + (noticeDays() + 1) * 86_400_000);
const people = (orgId: string) => peoplePrisma.employee.count({ where: { orgId } });

/** An accounting table this company has rows in, and how many. */
async function accountingTable(orgId: string) {
  for (const m of (AccountingPrisma.dmmf as any).datamodel.models) {
    if (!m.fields.some((f: any) => f.name === 'orgId')) continue;
    const d = (prisma as any)[m.name.charAt(0).toLowerCase() + m.name.slice(1)];
    const n = d?.count ? await d.count({ where: { orgId } }) : 0;
    if (n) return { model: m.name, count: () => d.count({ where: { orgId } }) as Promise<number> };
  }
  throw new Error('company has no accounting rows');
}
const closureOf = (orgId: string) => platformPrisma.orgClosure.findUniqueOrThrow({ where: { orgId } });
const quietly = async <T>(fn: () => Promise<T>) => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
};

describe('A-47: the closure purge', () => {
  it('does not begin once the instance has been told to stop', async () => {
    const c = await closedCompany();
    await jobLease.stopJobs();
    try {
      await quietly(() => purgeClosedCompanies(afterNotice(), { only: [c.orgId] }));
    } finally {
      jobLease._resetForTests();
    }
    expect(await people(c.orgId)).toBe(1);
    expect((await closureOf(c.orgId)).status).toBe('SCHEDULED');
    /* Finished on the next run. */
    await purgeClosedCompanies(afterNotice(), { only: [c.orgId] });
    expect((await closureOf(c.orgId)).status).toBe('DELETED');
  });

  it('stopped part-way (SIGTERM) starts no further store, keeps a checkpoint and resumes from it', async () => {
    const c = await closedCompany();
    const books = await accountingTable(c.orgId);
    /* The stop arrives while the first store (People) is being deleted. */
    const real = peoplePrisma.employee.deleteMany.bind(peoplePrisma.employee);
    const spy = vi.spyOn(peoplePrisma.employee, 'deleteMany').mockImplementation(async (args: any) => {
      await jobLease.stopJobs();
      return real(args);
    });
    try {
      await quietly(() => purgeClosedCompanies(afterNotice(), { only: [c.orgId] }));
    } finally {
      spy.mockRestore();
      jobLease._resetForTests();
    }
    expect(await people(c.orgId)).toBe(0);
    expect(await books.count()).toBeGreaterThan(0);
    const cut = await closureOf(c.orgId);
    expect(cut.status).toBe('SCHEDULED');
    expect(JSON.parse(cut.purgeProgress || '{}').done).toEqual(['people']);
    expect(cut.purgeError).toMatch(/resumes/);

    await purgeClosedCompanies(afterNotice(), { only: [c.orgId] });
    const after = await closureOf(c.orgId);
    expect(after.status).toBe('DELETED');
    expect(await books.count()).toBe(0);
    /* The record still counts what the first, cut-off run deleted. */
    expect(JSON.parse(after.deletedCounts || '{}')['people.Employee']).toBe(1);
  });

  it('records a failure on the closure and alerts, then resumes after the stores it finished', async () => {
    const c = await closedCompany();
    const books = await accountingTable(c.orgId);
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION accounting.a47_refuse() RETURNS trigger AS $$
      BEGIN IF OLD."orgId" = '${c.orgId}' THEN RAISE EXCEPTION 'a47: delete refused'; END IF; RETURN OLD; END $$ LANGUAGE plpgsql`);
    await owner.$executeRawUnsafe(`CREATE TRIGGER a47_refuse BEFORE DELETE ON accounting."${books.model}" FOR EACH ROW EXECUTE FUNCTION accounting.a47_refuse()`);
    const alerts: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void alerts.push(a.map(String).join(' ')));
    try {
      await purgeClosedCompanies(afterNotice(), { only: [c.orgId] });
    } finally {
      spy.mockRestore();
      await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS a47_refuse ON accounting."${books.model}"`);
    }
    const failed = await closureOf(c.orgId);
    expect(failed.status).toBe('SCHEDULED');
    expect(failed.purgeError).toMatch(new RegExp(books.model));
    expect(failed.purgeAttempts).toBe(1);
    expect(JSON.parse(failed.purgeProgress || '{}').done).toEqual(['people', 'payroll']);
    expect(alerts.some((l) => l.includes('ALERT') && l.includes(c.orgId))).toBe(true);

    await purgeClosedCompanies(afterNotice(), { only: [c.orgId] });
    const after = await closureOf(c.orgId);
    expect(after.status).toBe('DELETED');
    expect(after.purgeError).toBeNull();
    expect(JSON.parse(after.deletedCounts || '{}')['people.Employee']).toBe(1);
  });
});
