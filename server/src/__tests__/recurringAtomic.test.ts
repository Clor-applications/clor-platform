import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { runDueSchedules } from '../services/recurring.js';

/**
 * A-44: a recurring invoice could be lost for good.
 *
 * The period claim, the draft and the link between them were three separate
 * writes. A crash after the claim left a claim with no invoice; every later
 * run collided with it, took the period as raised and moved on. The job also
 * raised drafts for companies that had switched recurring invoices off, or
 * no longer had Accounting at all.
 *
 * The crash is real here: a trigger makes the database refuse the invoice
 * insert for one customer, after the claim was written — what a killed
 * instance or a failed insert does.
 */

const app = buildApp().listen(0);
const rnd = () => Math.random().toString(36).slice(2, 8);

/* The owner's connection to this run's database: the application role may not create triggers. */
const ownerUrl = () => {
  const url = new URL(String(process.env.PG_ADMIN_URL));
  url.pathname = new URL(String(process.env.DATABASE_URL)).pathname;
  url.search = '?schema=accounting';
  return url.toString();
};
const owner = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
const CRASH = 'Crash Test Ltd';

beforeAll(async () => {
  await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION accounting.a44_crash() RETURNS trigger AS $$
    BEGIN IF NEW."customerName" = '${CRASH}' THEN RAISE EXCEPTION 'simulated crash after the claim'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS a44_crash ON accounting."Invoice"`);
  await owner.$executeRawUnsafe(`CREATE TRIGGER a44_crash BEFORE INSERT ON accounting."Invoice" FOR EACH ROW EXECUTE FUNCTION accounting.a44_crash()`);
});
afterAll(async () => {
  await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS a44_crash ON accounting."Invoice"`);
  await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS accounting.a44_crash()`);
  await owner.$disconnect();
  await new Promise((done) => app.close(done));
});

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const makeOwner = async (label: string): Promise<Ctx> => {
  const email = `a44.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `A44 ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: (jwt.decode(signup.body.token) as any).accountId };
};

const schedule = async (c: Ctx, over: Record<string, unknown> = {}) =>
  (
    await request(app)
      .post(`/api/orgs/${c.orgId}/recurring`)
      .set(auth(c))
      .send({
        name: `Retainer ${rnd()}`,
        partyName: 'Acme Traders',
        frequency: 'MONTHLY',
        nextRunDate: '2026-01-01',
        dueDays: 15,
        template: { items: [{ description: 'Retainer', quantity: 1, rate: 10000, gstRate: 18, amount: 10000 }], subtotal: 10000, cgstTotal: 900, sgstTotal: 900, gstTotal: 1800, total: 11800 },
        ...over,
      })
      .expect(201)
  ).body.schedule as { id: string };

const drafts = async (orgId: string) => (await prisma.invoice.findMany({ where: { orgId, status: 'Draft' }, orderBy: { date: 'asc' } })).map((i) => i.date);
const claims = (scheduleId: string) => prisma.recurringScheduleRun.findMany({ where: { scheduleId }, orderBy: { periodDate: 'asc' } });

describe('A-44: a recurring period', () => {
  it('is raised on the next run after a crash between the claim and the invoice', async () => {
    const c = await makeOwner('crash');
    const s = await schedule(c, { partyName: CRASH });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await runDueSchedules({ orgId: c.orgId, today: '2026-01-15' }).catch(() => null);
    } finally {
      quiet.mockRestore();
    }
    expect(await drafts(c.orgId)).toEqual([]);

    /* Whatever made the insert fail is gone; the next run must bill January. */
    await prisma.recurringSchedule.update({ where: { id: s.id }, data: { partyName: 'Acme Traders' } });
    await runDueSchedules({ orgId: c.orgId, today: '2026-01-15' });
    expect(await drafts(c.orgId)).toEqual(['2026-01-01']);
    expect((await claims(s.id)).map((r) => Boolean(r.invoiceId))).toEqual([true]);
  });

  it('left half-raised by an earlier crash (a claim with no invoice) is repaired, not skipped', async () => {
    const c = await makeOwner('orphan');
    const s = await schedule(c);
    await prisma.recurringScheduleRun.create({ data: { accountId: c.accountId, orgId: c.orgId, scheduleId: s.id, periodDate: '2026-01-01' } });

    await runDueSchedules({ orgId: c.orgId, today: '2026-02-15' });
    expect(await drafts(c.orgId)).toEqual(['2026-01-01', '2026-02-01']);
    expect((await claims(s.id)).every((r) => r.invoiceId)).toBe(true);
    expect((await prisma.recurringSchedule.findUniqueOrThrow({ where: { id: s.id } })).nextRunDate).toBe('2026-03-01');
  });

  it('is never raised past the agreed number of invoices, however many runs race', async () => {
    const c = await makeOwner('race');
    await schedule(c, { maxOccurrences: 2 });
    await Promise.all(Array.from({ length: 5 }, () => runDueSchedules({ orgId: c.orgId, today: '2026-06-15' })));
    expect(await drafts(c.orgId)).toEqual(['2026-01-01', '2026-02-01']);
  });
});

describe('A-44: the job raises nothing', () => {
  it('for a company that has switched recurring invoices off', async () => {
    const c = await makeOwner('off');
    const s = await schedule(c);
    await platformPrisma.featureSetting.upsert({
      where: { orgId_key: { orgId: c.orgId, key: 'recurringInvoices' } },
      create: { accountId: c.accountId, orgId: c.orgId, key: 'recurringInvoices', enabled: false, updatedByUserId: 'test' },
      update: { enabled: false },
    });
    const r = await runDueSchedules({ today: '2026-02-15', orgId: c.orgId });
    expect(r.raised).toBe(0);
    expect(await drafts(c.orgId)).toEqual([]);
    /* Nothing is lost: the schedule still stands at its first period, for when it is switched back on. */
    expect((await prisma.recurringSchedule.findUniqueOrThrow({ where: { id: s.id } })).nextRunDate).toBe('2026-01-01');
  });

  it('for an account whose Accounting subscription has lapsed', async () => {
    const c = await makeOwner('lapsed');
    await schedule(c);
    await platformPrisma.subscription.updateMany({ where: { accountId: c.accountId }, data: { status: 'cancelled' } });
    const r = await runDueSchedules({ today: '2026-02-15', orgId: c.orgId });
    expect(r.raised).toBe(0);
    expect(await drafts(c.orgId)).toEqual([]);
  });
});
