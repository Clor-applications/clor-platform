import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { monthlyRunRate, subscriptionWatch } from '../services/accountHealth.js';

/**
 * The Workspace Overview's account-wide figures: entities and GST
 * registrations, seats bought, the monthly run rate and whether what feeds
 * the suite from outside is flowing. Each is read from rows that exist, and a
 * figure nobody has set (a price) comes back as null, not as a zero.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const makeOwner = async (label: string): Promise<Ctx> => {
  const email = `ah.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${label} Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

const overview = async (c: Ctx) => (await request(app).get('/api/account/overview').set(auth(c)).expect(200)).body;

let owner: Ctx;
let accountId: string;
let userId: string;
let secondOrgId: string;

beforeAll(async () => {
  owner = await makeOwner('health');
  const second = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ companyName: `Second ${Date.now()}-${rnd()}`, state: 'Kerala' })
    .expect(200);
  secondOrgId = String(second.body.company.orgId);
  const first = await overview(owner);
  accountId = first.account.id;
  userId = first.users[0].id;
}, 60_000);

describe('monthly run rate', () => {
  const sub = (items: any[], billingInterval: string | null = 'month', status = 'active') => ({ status, billingInterval, currency: 'INR', items });

  it('sums per-seat, per-app and flat prices, and skips free ones', () => {
    const r = monthlyRunRate(
      sub([
        { appCode: 'accounting', priceModel: 'flat', unitAmount: 99900, seats: null },
        { appCode: 'payroll', priceModel: 'per_seat', unitAmount: 5000, seats: 3 },
        { appCode: 'people', priceModel: 'free', unitAmount: null, seats: null },
      ])
    );
    expect(r).toMatchObject({ monthly: 99900 + 15000, unpriced: [] });
  });

  it('spreads a yearly price over twelve months', () => {
    expect(monthlyRunRate(sub([{ appCode: 'accounting', priceModel: 'flat', unitAmount: 120000, seats: null }], 'year'))?.monthly).toBe(10000);
  });

  /* Pricing is CLOR's to set and may not be yet: an unpriced item makes the total unknown, not smaller. */
  it('is unknown while any app has no price, and names it', () => {
    const r = monthlyRunRate(
      sub([
        { appCode: 'accounting', priceModel: 'flat', unitAmount: 99900, seats: null },
        { appCode: 'payroll', priceModel: null, unitAmount: null, seats: null },
        { appCode: 'attendance', priceModel: 'per_seat', unitAmount: 2000, seats: null },
      ])
    );
    expect(r?.monthly).toBeNull();
    expect(r?.unpriced).toEqual(['payroll', 'attendance']);
  });

  it('is nothing for a cancelled subscription, and absent with no subscription', () => {
    expect(monthlyRunRate(sub([{ appCode: 'accounting', priceModel: 'flat', unitAmount: 500, seats: null }], 'month', 'cancelled'))?.monthly).toBe(0);
    expect(monthlyRunRate(null)).toBeNull();
  });

  it('has no monthly figure for a priced subscription with no billing interval', () => {
    expect(monthlyRunRate(sub([{ appCode: 'accounting', priceModel: 'flat', unitAmount: 500, seats: null }], null))?.monthly).toBeNull();
  });
});

describe('the overview’s account-wide figures', () => {
  it('counts companies, branches and GST registrations once each', async () => {
    let body = await overview(owner);
    expect(body.entities).toMatchObject({ companies: 2, branches: 2, taxProfiles: 0, companiesWithoutGstin: 2, costCentres: 0 });

    /* Two branches of one company under one GSTIN are one registration. */
    await platformPrisma.branch.updateMany({ where: { orgId: owner.orgId }, data: { gstin: '29ABCDE1234F1Z5' } });
    await platformPrisma.branch.create({ data: { accountId, orgId: owner.orgId, branchCode: `B${rnd()}`, branchName: 'Mysuru', addressLine1: 'Sayyaji Rao Road', state: 'Karnataka', country: 'India', createdByUserId: userId, gstin: '29abcde1234f1z5' } as any });
    body = await overview(owner);
    expect(body.entities).toMatchObject({ companies: 2, branches: 3, taxProfiles: 1, companiesWithoutGstin: 1 });
  });

  it('gives the run rate and seats from the subscription', async () => {
    const body = await overview(owner);
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId }, include: { items: true } });
    if (!sub) {
      expect(body.runRate).toBeNull();
      expect(body.seats).toBeNull();
    } else {
      expect(body.seats.map((s: any) => s.app).sort()).toEqual(sub.items.map((i) => i.appCode).sort());
      expect(body.runRate.currency).toBe('INR');
    }
  });

  it('has nothing to sync until something feeds the account, then reports its open alerts', async () => {
    /* Signing up sends a welcome e-mail; cleared so the account starts with nothing flowing in or out. */
    await platformPrisma.emailOutbox.deleteMany({ where: { accountId } });
    let body = await overview(owner);
    expect(body.dataHealth).toMatchObject({ status: 'none', issues: 0, sources: [] });

    const device = await peoplePrisma.attendanceDevice.create({
      data: { accountId, orgId: secondOrgId, serialNumber: `SN${rnd()}${rnd()}`, name: 'Gate', vendor: 'ADMS', createdByUserId: userId } as any,
    });
    body = await overview(owner);
    expect(body.dataHealth.status).toBe('ok');
    expect(body.dataHealth.sources).toEqual([{ key: 'readers', label: 'Attendance readers', total: 1, issues: 0 }]);

    await peoplePrisma.readerAlert.create({
      data: { accountId, orgId: secondOrgId, key: `offline:${device.id}`, kind: 'offline', deviceId: device.id, severity: 'high', title: 'Gate is offline', details: 'Nothing for an hour.' },
    });
    body = await overview(owner);
    expect(body.dataHealth.status).toBe('attention');
    expect(body.dataHealth.issues).toBe(1);
    expect(body.dataHealth.alerts[0]).toMatchObject({ title: 'Gate is offline', severity: 'high', orgId: secondOrgId });
  });

  it('counts e-mail that failed to go this week as a delivery problem', async () => {
    await platformPrisma.emailOutbox.create({ data: { accountId, orgId: owner.orgId, templateKey: 'test', toEmail: 'x@example.com', subject: 's', bodyText: 'b', status: 'FAILED', lastError: 'Mailbox full' } });
    const body = await overview(owner);
    expect(body.dataHealth.sources.find((s: any) => s.key === 'email')).toEqual({ key: 'email', label: 'E-mail delivery', total: 1, issues: 1 });
    expect(body.dataHealth.issues).toBe(2);
  });

  it("never counts another account's readers or registrations", async () => {
    const stranger = await makeOwner('stranger');
    const theirs = (await overview(stranger)).account.id;
    await peoplePrisma.attendanceDevice.create({ data: { accountId: theirs, orgId: stranger.orgId, serialNumber: `SN${rnd()}${rnd()}`, name: 'Theirs', vendor: 'ADMS', createdByUserId: 'stranger' } as any });
    await platformPrisma.branch.updateMany({ where: { orgId: stranger.orgId }, data: { gstin: '32ZZZZZ9999Z1Z9' } });
    const body = await overview(owner);
    expect(body.entities.taxProfiles).toBe(1);
    expect(body.dataHealth.sources.find((s: any) => s.key === 'readers').total).toBe(1);
  });
});

describe('subscription watch (Workspace plan, expiring subscription)', () => {
  const now = new Date('2026-11-11T06:00:00Z');
  const days = (n: number) => new Date(now.getTime() + n * 86400000);
  const sub = (o: Partial<{ status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean }>) => ({ status: 'active', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, ...o });

  it('warns when a trial ends within fourteen days, not before', () => {
    expect(subscriptionWatch(sub({ status: 'trialing', trialEndsAt: days(5) }), [], now)).toMatchObject({ warn: 'trial-ending', daysLeft: 5 });
    expect(subscriptionWatch(sub({ status: 'trialing', trialEndsAt: days(30) }), [], now)).toMatchObject({ warn: null, daysLeft: 30 });
  });

  it('warns when a plan is set to stop at the end of its period; an active one renews', () => {
    expect(subscriptionWatch(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: days(3) }), [], now)).toMatchObject({ warn: 'ending', daysLeft: 3, renewsAt: null });
    expect(subscriptionWatch(sub({ currentPeriodEnd: days(3) }), [], now)).toMatchObject({ warn: null, renewsAt: days(3) });
  });

  it('a lapsed plan is said as such', () => {
    expect(subscriptionWatch(sub({ status: 'past_due' }), [], now).warn).toBe('lapsed');
  });

  it('counts unpaid and overdue CLOR invoices and what is due', () => {
    const r = subscriptionWatch(sub({}), [
      { status: 'ISSUED', dueDate: days(-2), total: 118000 },
      { status: 'ISSUED', dueDate: days(10), total: 59000 },
    ], now);
    expect(r.invoices).toEqual({ unpaid: 2, overdue: 1, due: 177000 });
  });

  it('no subscription: no dates invented', () => {
    expect(subscriptionWatch(null, [], now)).toMatchObject({ status: null, warn: null, endsAt: null, daysLeft: null });
  });

  it('the overview carries it', async () => {
    const o = await overview(owner);
    expect(o.renewal).toHaveProperty('invoices');
    expect(o.renewal.invoices).toEqual({ unpaid: 0, overdue: 0, due: 0 });
  });
});
