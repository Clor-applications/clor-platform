import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Races in the Workspace and ops state machines (billing, invitations,
 * company closure, two-factor, ops approvals). Each test makes the second of
 * two operations land in the window the first one left open, by holding a
 * read and letting the other write go first, then checks the record says
 * what really happened.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { markInvoicePaid } = await import('../billing/invoices.js');
const { applyGatewayEvent, paidUntil } = await import('../billing/events.js');
const { setSubscription, getSubscription, inGoodStanding } = await import('../services/subscriptions.js');
const { resendInvitation, acceptInvitation } = await import('../services/accountInvitations.js');
const { cancelClosure, purgeClosedCompanies, noticeDays } = await import('../services/companyClosure.js');
const { askApproval } = await import('../services/ops/approvals.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
const accounts: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  const where = { accountId: { in: accounts } };
  await platformPrisma.billingInvoice.deleteMany({ where });
  await platformPrisma.paymentEvent.deleteMany({ where });
  await platformPrisma.opsApproval.deleteMany({ where });
  await platformPrisma.accountInvitation.deleteMany({ where });
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;
const PASSWORD = 'Passw0rd!23';

/** A bare customer account, with a subscription if given. */
async function account(sub?: { status: string; currentPeriodEnd?: Date | null; trialEndsAt?: Date | null }) {
  const a = await platformPrisma.account.create({ data: { name: `Race Co ${rnd()}` } });
  accounts.push(a.id);
  if (sub) await platformPrisma.subscription.create({ data: { accountId: a.id, ...sub } });
  return a.id;
}
const issued = (accountId: string, extra: Record<string, unknown> = {}) =>
  platformPrisma.billingInvoice.create({ data: { accountId, status: 'ISSUED', number: `RACE-${rnd()}${rnd()}`, subtotal: 100000, total: 100000, months: 1, issueDate: new Date(), ...extra } });
const subOf = (accountId: string) => platformPrisma.subscription.findUniqueOrThrow({ where: { accountId } });

type Ctx = { token: string; orgId: string; branchId: string; email: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `races.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Race Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const { userId } = jwt.decode(signup.body.token) as { userId: string };
  const orgId = setup.body.company.orgId as string;
  const { accountId } = await platformPrisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { accountId: true } });
  accounts.push(accountId!);
  return { token: signup.body.token, orgId, branchId: setup.body.branch.id, email, userId, accountId: accountId! };
}
/** Closure scheduled directly (the route's export and step-up rules are tested in companyClosure.test.ts). */
const scheduled = (c: Ctx) =>
  platformPrisma.orgClosure.create({ data: { accountId: c.accountId, orgId: c.orgId, orgName: 'Race Co', status: 'SCHEDULED', requestedByUserId: c.userId, requestedAt: new Date(), deleteAfter: new Date(Date.now() + noticeDays() * DAY) } });
const afterNotice = () => new Date(Date.now() + (noticeDays() + 1) * DAY);

describe('1. Mark paid on CLOR’s invoice', () => {
  it('racing the customer paying the same invoice online, moves the subscription on once', async () => {
    const end = new Date(Date.now() + 10 * DAY);
    const acc = await account({ status: 'active', currentPeriodEnd: end });
    const linkId = `plink_${rnd()}`;
    const inv = await issued(acc, { payLinkId: linkId, payLinkGateway: 'razorpay' });
    const reference = `UTR${rnd()}${rnd()}`.toUpperCase();
    /* Staff open the invoice; the online payment lands before their Mark paid is written. */
    const real = platformPrisma.billingInvoice.findUnique.bind(platformPrisma.billingInvoice);
    vi.spyOn(platformPrisma.billingInvoice, 'findUnique').mockImplementationOnce((async (args: any) => {
      const row = await real(args);
      await applyGatewayEvent({ gateway: 'razorpay', eventId: `payment_link.paid:${linkId}`, type: 'payment_link.paid', accountId: acc, invoice: { invoiceId: inv.id, linkId, amountPaid: 100000 }, raw: {} });
      return row;
    }) as any);
    await expect(markInvoicePaid(inv.id, { reference, paidOn: new Date() }, 'race-staff')).rejects.toThrow(/changed a moment ago/);
    vi.restoreAllMocks();
    expect((await subOf(acc)).currentPeriodEnd).toEqual(paidUntil(end, 1, null));
    expect((await platformPrisma.billingInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paymentReference).toBe(linkId);
    /* The staff payment is not left in the log as applied. */
    expect(await platformPrisma.paymentEvent.count({ where: { gateway: 'manual', eventId: `manual:${reference}` } })).toBe(0);
  });

  it('does not reopen a subscription that was cancelled', async () => {
    const acc = await account({ status: 'cancelled', currentPeriodEnd: new Date(Date.now() - DAY) });
    const inv = await issued(acc);
    const r = await markInvoicePaid(inv.id, { reference: `UTR${rnd()}${rnd()}`, paidOn: new Date() }, 'race-staff');
    expect(r.invoice.status).toBe('PAID');
    expect(r.paidUntil).toBeNull();
    expect((await subOf(acc)).status).toBe('cancelled');
  });
});

describe('2. Gateway subscription events', () => {
  it('a late "active" does not bring back a subscription that was cancelled', async () => {
    const acc = await account({ status: 'cancelled', currentPeriodEnd: new Date() });
    const r = await applyGatewayEvent({ gateway: 'razorpay', eventId: `subscription.activated:${rnd()}`, type: 'subscription.activated', accountId: acc, subscription: { status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * DAY) }, raw: {} });
    expect(r.status).toBe('RECORDED');
    expect((await subOf(acc)).status).toBe('cancelled');
  });

  it('an event older than one already applied changes nothing', async () => {
    const acc = await account({ status: 'active' });
    const ev = (status: string, minutesAgo: number) =>
      applyGatewayEvent({ gateway: 'razorpay', eventId: `subscription.${status}:${rnd()}`, type: `subscription.${status}`, accountId: acc, subscription: { status: status as any }, occurredAt: new Date(Date.now() - minutesAgo * 60_000), raw: {} });
    expect((await ev('paused', 1)).status).toBe('APPLIED');
    expect((await ev('active', 2)).status).toBe('RECORDED');
    expect((await subOf(acc)).status).toBe('paused');
  });
});

describe('3. A plan granted by hand', () => {
  it('on an account whose paid period has ended, is in good standing', async () => {
    const acc = await account({ status: 'active', currentPeriodEnd: new Date(Date.now() - 5 * DAY) });
    await setSubscription(acc, { apps: [{ appCode: 'people', priceModel: 'free' }], status: 'active' });
    const sub = await getSubscription(acc);
    expect(sub!.currentPeriodEnd).toBeNull();
    expect(inGoodStanding(sub!)).toBe(true);
  });
});

describe('4. Invitations', () => {
  const invite = async (accountId: string, grants: unknown[] = []) => {
    const token = randomBytes(32).toString('base64url');
    const row = await platformPrisma.accountInvitation.create({
      data: { accountId, email: `invitee.${Date.now()}.${rnd()}@example.com`, grants: JSON.stringify(grants), tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * DAY), invitedByUserId: 'race-inviter' },
    });
    return { row, token };
  };

  it('a resend racing a revoke does not make the invitation live again', async () => {
    const acc = await account();
    const { row } = await invite(acc);
    const real = platformPrisma.accountInvitation.findFirst.bind(platformPrisma.accountInvitation);
    vi.spyOn(platformPrisma.accountInvitation, 'findFirst').mockImplementationOnce((async (args: any) => {
      const r = await real(args);
      await platformPrisma.accountInvitation.updateMany({ where: { id: row.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      return r;
    }) as any);
    await expect(resendInvitation({ auth: { userId: 'race-operator' } } as any, row.id, { accountId: acc })).rejects.toMatchObject({ code: 'NOT_PENDING' });
    expect((await platformPrisma.accountInvitation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('REVOKED');
  });

  it('accepting is all or nothing: a failure part way leaves it open to try again', async () => {
    const acc = await account();
    /* A company that does not exist: the grant fails after the claim. */
    const { row, token } = await invite(acc, [{ orgId: `no-such-org-${rnd()}`, branchIds: [], roleIds: [] }]);
    await expect(acceptInvitation({ token, fullName: 'New Person', password: 'Correct-Horse-Battery-9' })).rejects.toThrow();
    expect((await platformPrisma.accountInvitation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
    expect(await platformPrisma.user.count({ where: { email: row.email } })).toBe(0);
  });
});

describe('5. Company closure', () => {
  it('a cancel that arrives while the purge is deleting is refused, not reported done', async () => {
    const c = await company();
    await scheduled(c);
    let cancelled: unknown = 'not tried';
    const real = peoplePrisma.employee.deleteMany.bind(peoplePrisma.employee);
    vi.spyOn(peoplePrisma.employee, 'deleteMany').mockImplementation((async (args: any) => {
      if (cancelled === 'not tried') cancelled = await cancelClosure({ accountId: c.accountId, orgId: c.orgId, userId: c.userId }).catch((e) => e);
      return real(args);
    }) as any);
    await purgeClosedCompanies(afterNotice(), { only: [c.orgId] });
    vi.restoreAllMocks();
    expect(cancelled).toMatchObject({ code: 'TOO_LATE' });
    expect((await platformPrisma.orgClosure.findUniqueOrThrow({ where: { orgId: c.orgId } })).status).toBe('DELETED');
  });

  it('a closure cancelled after the purge run picked it up is not deleted', async () => {
    const c = await company();
    await scheduled(c);
    const realUpdate = platformPrisma.orgClosure.update.bind(platformPrisma.orgClosure);
    const realUpdateMany = platformPrisma.orgClosure.updateMany.bind(platformPrisma.orgClosure);
    let fired = false;
    /* The cancel lands just before the purge's first write for this company. */
    const cancelFirst = async (args: any) => {
      if (!fired && args?.data?.purgeAttempts) {
        fired = true;
        await realUpdateMany({ where: { orgId: c.orgId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: c.userId } });
      }
    };
    vi.spyOn(platformPrisma.orgClosure, 'update').mockImplementation((async (args: any) => (await cancelFirst(args), realUpdate(args))) as any);
    vi.spyOn(platformPrisma.orgClosure, 'updateMany').mockImplementation((async (args: any) => (await cancelFirst(args), realUpdateMany(args))) as any);
    const done = await purgeClosedCompanies(afterNotice(), { only: [c.orgId] });
    vi.restoreAllMocks();
    expect(fired).toBe(true);
    expect(done).toEqual([]);
    expect((await platformPrisma.orgClosure.findUniqueOrThrow({ where: { orgId: c.orgId } })).status).toBe('CANCELLED');
    expect(await platformPrisma.org.count({ where: { id: c.orgId } })).toBe(1);
  });
});

describe('6. Two-factor recovery codes', () => {
  it('one code signs in once, even when two sign-ins read it before either spends it', async () => {
    const c = await company();
    const sec = (p: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(body as any);
    const { secret } = (await sec('/two-factor/setup', { password: PASSWORD }).expect(200)).body;
    await clearOfStepEdge();
    const on = await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
    const code = (on.body.recoveryCodes as string[])[0];
    const login = () => request(app).post('/api/auth/login').send({ email: c.email, password: PASSWORD }).expect(200);
    const [a, b] = [await login(), await login()];
    /* What the second sign-in read, before the first spent the code. */
    const stale = await platformPrisma.user.findUniqueOrThrow({
      where: { id: c.userId },
      select: { id: true, accountId: true, email: true, fullName: true, isActive: true, lockedUntil: true, totpEnabledAt: true, totpSecretEnc: true, totpLastStep: true, totpRecoveryJson: true, emailVerifiedAt: true },
    });
    await request(app).post('/api/auth/login/two-factor').send({ challenge: a.body.challenge, code }).expect(200);
    const real = platformPrisma.user.findUnique.bind(platformPrisma.user);
    let served = false;
    vi.spyOn(platformPrisma.user, 'findUnique').mockImplementation((async (args: any) => {
      if (!served && args?.select?.totpRecoveryJson && args?.select?.totpSecretEnc) {
        served = true;
        return stale;
      }
      return real(args);
    }) as any);
    const second = await request(app).post('/api/auth/login/two-factor').send({ challenge: b.body.challenge, code });
    vi.restoreAllMocks();
    expect(served).toBe(true);
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('BAD_CODE');
  });
});

describe('7. Ops approvals', () => {
  it('two operators asking at once open one waiting request per customer', async () => {
    const c = await company();
    const acc = await account();
    const req = { auth: { userId: c.userId }, headers: {}, ip: '127.0.0.1', socket: {} } as any;
    const ask = () => askApproval(req, { kind: 'DEAL', accountId: acc, customerName: 'Race Co', payload: {}, summary: 'A deal', discountPercent: 50, reason: 'Race test' });
    const [x, y] = await Promise.all([ask(), ask()]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(await platformPrisma.opsApproval.count({ where: { accountId: acc, status: 'PENDING' } })).toBe(1);
  });
});
