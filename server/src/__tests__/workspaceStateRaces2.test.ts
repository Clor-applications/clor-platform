import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * More races in the Workspace and ops state machines (docs/state-machines.md
 * W2, W5, W8, W11, W12, W14): extending a trial, the by-id updates of
 * credentials, outside access, demo requests and company archive, and a
 * payment provider's Test or Live mode. Each test lets the second of two
 * operations land in the window the first left open (holding a read while
 * the other write goes first), or runs both at once, and checks one outcome
 * stands.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant, outsideTenant } = await import('../utils/tenantScope.js');
const { setSubscription } = await import('../services/subscriptions.js');
const creds = await import('../services/credentials.js');
const { grantOutsideAccess, setOutsideAccessStatus, changeOutsideAccess } = await import('../services/outsideAccess.js');
const { archiveCompany, reactivateCompany, forgetArchived } = await import('../services/companyArchive.js');
const providers = await import('../billing/providers.js');
const { at, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: workspace races', fn);
const resetProviders = async () => {
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  providers.clearProviderCache();
};
beforeAll(resetProviders);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await resetProviders();
  await new Promise((done) => app.close(done));
});

const DAY = 86_400_000;
/** Of Promise.allSettled results: how many went through, and the codes of those refused. */
const tally = (rs: PromiseSettledResult<any>[]) => ({
  ok: rs.filter((r) => r.status === 'fulfilled').length,
  codes: rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason?.code),
});

describe('1. Extend trial', () => {
  it('moves the entitlement to the new trial end, in the same write', async () => {
    const ops = await staff('SALES');
    const c = await company('trial');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'FULL' }], status: 'trialing', trialDays: 3 });
    const r = await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(ops.h).send({ days: 10, reason: 'Needs more time' }).expect(200);
    const ent = await platformPrisma.accountEntitlement.findUniqueOrThrow({ where: { accountId: c.accountId } });
    expect(ent.validUntil?.toISOString()).toBe(r.body.trialEndsAt);
    expect(ent.status).toBe('TRIAL');
  }, 90_000);

  it('brings the extras back on a trial that had already ended', async () => {
    const ops = await staff('BILLING');
    const c = await company('trial');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'FULL' }], status: 'trialing', trialEndsAt: new Date(Date.now() - DAY) });
    expect((await platformPrisma.accountEntitlement.findUniqueOrThrow({ where: { accountId: c.accountId } })).status).toBe('PAST_DUE');
    await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(ops.h).send({ days: 7, reason: 'Missed the end' }).expect(200);
    const ent = await platformPrisma.accountEntitlement.findUniqueOrThrow({ where: { accountId: c.accountId } });
    expect(ent.status).toBe('TRIAL');
    expect(ent.validUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
  }, 90_000);

  it('two extends at once give the days once', async () => {
    const ops = await staff('BILLING');
    const c = await company('trial');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting' }], status: 'trialing', trialDays: 5 });
    const before = (await platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId } })).trialEndsAt!;
    /* The second operator's read is held until the first extend is written. */
    const real = platformPrisma.subscription.findUnique.bind(platformPrisma.subscription);
    vi.spyOn(platformPrisma.subscription, 'findUnique').mockImplementationOnce((async (args: any) => {
      const row = await real(args);
      await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(ops.h).send({ days: 7, reason: 'First operator' }).expect(200);
      return row;
    }) as any);
    const second = await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(ops.h).send({ days: 7, reason: 'Second operator' }).expect(409);
    expect(second.body.code).toBe('PLAN_CHANGED');
    const after = (await platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId } })).trialEndsAt!;
    expect(after.getTime()).toBe(before.getTime() + 7 * DAY);
  }, 90_000);

  it('does not overwrite a plan cancelled in between', async () => {
    const ops = await staff('BILLING');
    const c = await company('trial');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting' }], status: 'trialing', trialDays: 5 });
    const real = platformPrisma.subscription.findUnique.bind(platformPrisma.subscription);
    vi.spyOn(platformPrisma.subscription, 'findUnique').mockImplementationOnce((async (args: any) => {
      const row = await real(args);
      await platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { status: 'cancelled' } });
      return row;
    }) as any);
    expect((await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(ops.h).send({ days: 7, reason: 'Late' }).expect(409)).body.code).toBe('PLAN_CHANGED');
    expect((await platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId } })).status).toBe('cancelled');
  }, 90_000);
});

describe('2. Credentials', () => {
  const user = (c: { userId: string }) => ({ type: 'USER' as const, id: c.userId, ip: '10.0.0.1', userAgent: 'vitest' });
  const issue = async (c: { accountId: string; orgId: string; userId: string }, expiresAt: Date | null = null) => {
    const token = `clor_${rnd()}${rnd()}${rnd()}`;
    return creds.issueCredential({ kind: 'API_KEY', accountId: c.accountId, orgId: c.orgId, ownerId: `owner_${rnd()}`, token, tokenPrefix: token.slice(0, 12), expiresAt, createdByUserId: c.userId }, user(c));
  };
  const statusOf = (c: { orgId: string }, id: string) => runInTenant(c.orgId, () => platformPrisma.credential.findUniqueOrThrow({ where: { id } }));
  /** Hold the next credential read until `first` has run. */
  const holdRead = (first: () => Promise<unknown>) => {
    const real = platformPrisma.credential.findFirst.bind(platformPrisma.credential);
    vi.spyOn(platformPrisma.credential, 'findFirst').mockImplementationOnce((async (args: any) => {
      const row = await real(args);
      await first();
      return row;
    }) as any);
  };

  it('a resume racing a revoke does not bring the credential back', async () => {
    const c = await company('cred');
    const row = await issue(c);
    await creds.suspendCredential(row.id, c.orgId, user(c));
    holdRead(() => creds.revokeCredential(row.id, c.orgId, user(c), 'leaked'));
    await expect(creds.resumeCredential(row.id, c.orgId, user(c))).rejects.toMatchObject({ status: 409, code: 'CREDENTIAL_CHANGED' });
    expect((await statusOf(c, row.id)).status).toBe('REVOKED');
  }, 90_000);

  it('a suspend racing a revoke leaves it revoked', async () => {
    const c = await company('cred');
    const row = await issue(c);
    holdRead(() => creds.revokeCredential(row.id, c.orgId, user(c)));
    await expect(creds.suspendCredential(row.id, c.orgId, user(c))).rejects.toMatchObject({ code: 'CREDENTIAL_CHANGED' });
    expect((await statusOf(c, row.id)).status).toBe('REVOKED');
  }, 90_000);

  it('a revoke racing a suspend still revokes', async () => {
    const c = await company('cred');
    const row = await issue(c);
    holdRead(() => creds.suspendCredential(row.id, c.orgId, user(c)));
    await creds.revokeCredential(row.id, c.orgId, user(c));
    expect((await statusOf(c, row.id)).status).toBe('REVOKED');
  }, 90_000);

  it('an extend racing a revoke does not touch it, and two extends at once take one date', async () => {
    const c = await company('cred');
    const row = await issue(c, new Date(Date.now() + 30 * DAY));
    const a = new Date(Date.now() + 100 * DAY);
    const b = new Date(Date.now() + 200 * DAY);
    holdRead(() => creds.extendCredential(row.id, c.orgId, a, user(c)));
    await expect(creds.extendCredential(row.id, c.orgId, b, user(c))).rejects.toMatchObject({ code: 'CREDENTIAL_CHANGED' });
    expect((await statusOf(c, row.id)).expiresAt?.getTime()).toBe(a.getTime());

    holdRead(() => creds.revokeCredential(row.id, c.orgId, user(c)));
    await expect(creds.extendCredential(row.id, c.orgId, b, user(c))).rejects.toMatchObject({ code: 'CREDENTIAL_CHANGED' });
    const after = await statusOf(c, row.id);
    expect(after.status).toBe('REVOKED');
    expect(after.expiresAt?.getTime()).toBe(a.getTime());
  }, 90_000);

  it('a rotate racing a revoke issues no live successor', async () => {
    const c = await company('cred');
    const row = await issue(c);
    holdRead(() => creds.revokeCredential(row.id, c.orgId, user(c)));
    const next = `clor_${rnd()}${rnd()}${rnd()}`;
    await expect(creds.rotateCredential(row.id, c.orgId, { token: next, tokenPrefix: next.slice(0, 12) }, user(c))).rejects.toMatchObject({ code: 'CREDENTIAL_CHANGED' });
    expect(await runInTenant(c.orgId, () => platformPrisma.credential.count({ where: { rotatedFromId: row.id } }))).toBe(0);
  }, 90_000);

  it('resume and revoke at once end revoked', async () => {
    const c = await company('cred');
    for (let i = 0; i < 3; i++) {
      const row = await issue(c);
      await creds.suspendCredential(row.id, c.orgId, user(c));
      await Promise.allSettled([creds.resumeCredential(row.id, c.orgId, user(c)), creds.revokeCredential(row.id, c.orgId, user(c))]);
      expect((await statusOf(c, row.id)).status).toBe('REVOKED');
    }
  }, 90_000);
});

describe('3. Outside access', () => {
  async function engagement() {
    const firm = await company('client');
    const outsider = await company('ca');
    const row = await runInTenant(firm.orgId, () =>
      grantOutsideAccess({ accountId: firm.accountId, orgId: firm.orgId, userId: outsider.userId, homeAccountId: outsider.accountId, byUserId: firm.userId })
    );
    const as = <T>(fn: () => Promise<T>) => runInTenant(firm.orgId, fn);
    /** Hold a read of this access until `first` has run: the next one, or after `skip` others. */
    const hold = (first: () => Promise<unknown>, skip = 0) => {
      const real = platformPrisma.outsideAccess.findFirst.bind(platformPrisma.outsideAccess);
      let held = false;
      let seen = 0;
      vi.spyOn(platformPrisma.outsideAccess, 'findFirst').mockImplementation((async (args: any) => {
        const r = await real(args);
        if (!held && args?.where?.id === row.id && seen++ === skip) {
          held = true;
          await first();
        }
        return r;
      }) as any);
    };
    const now = () => as(() => platformPrisma.outsideAccess.findUniqueOrThrow({ where: { id: row.id } }));
    return { firm, row, as, hold, now };
  }

  it('a resume racing an end does not open it again', async () => {
    const { firm, row, as, hold, now } = await engagement();
    await as(() => setOutsideAccessStatus(firm.orgId, row.id, firm.userId, 'SUSPENDED'));
    hold(() => setOutsideAccessStatus(firm.orgId, row.id, firm.userId, 'REVOKED', 'Engagement over'));
    await expect(as(() => setOutsideAccessStatus(firm.orgId, row.id, firm.userId, 'ACTIVE'))).rejects.toMatchObject({ status: 409, code: 'ACCESS_CHANGED' });
    expect((await now()).status).toBe('REVOKED');
  }, 90_000);

  it('an edit racing an end does not touch ended access', async () => {
    const { firm, row, as, hold, now } = await engagement();
    hold(() => setOutsideAccessStatus(firm.orgId, row.id, firm.userId, 'REVOKED'));
    await expect(as(() => changeOutsideAccess(firm.orgId, row.id, firm.userId, { apps: ['payroll'] }))).rejects.toMatchObject({ code: 'ACCESS_CHANGED' });
    const after = await now();
    expect(after.status).toBe('REVOKED');
    expect(after.apps).toBeNull();
  }, 90_000);

  it('the route answers 409 in plain words', async () => {
    const { firm, row, as, hold } = await engagement();
    await as(() => setOutsideAccessStatus(firm.orgId, row.id, firm.userId, 'SUSPENDED'));
    /* The account log's middleware reads it first; the route's own read is the one held. */
    hold(() => setOutsideAccessStatus(firm.orgId, row.id, firm.userId, 'REVOKED'), 1);
    const r = await request(app).post(`/api/orgs/${firm.orgId}/outside-access/${row.id}/resume`).set(at(firm)).send({}).expect(409);
    expect(r.body).toEqual({ error: 'Someone changed this access a moment ago. Refresh to see it as it is now.', code: 'ACCESS_CHANGED' });
  }, 90_000);
});

describe('4. Demo requests', () => {
  const demo = () =>
    platformPrisma.demoRequest.create({ data: { name: 'Asha', company: `Demo Co ${rnd()}`, email: `demo.${rnd()}@example.com`, phone: '9876543210', city: 'Pune', companySize: '11-20', users: 5, apps: ['people'] } });

  it('a status change whose read predates the account being made is refused, and ACCOUNT_CREATED stays', async () => {
    const ops = await staff('SALES');
    const d = await demo();
    const real = platformPrisma.demoRequest.findUnique.bind(platformPrisma.demoRequest);
    vi.spyOn(platformPrisma.demoRequest, 'findUnique').mockImplementationOnce((async (args: any) => {
      const row = await real(args);
      await platformPrisma.demoRequest.update({ where: { id: d.id }, data: { status: 'ACCOUNT_CREATED' } });
      return row;
    }) as any);
    const r = await request(app).patch(`/api/ops/demo-requests/${d.id}`).set(ops.h).send({ status: 'CONTACTED', note: 'Called' }).expect(409);
    expect(r.body.code).toBe('REQUEST_CHANGED');
    expect(r.body.error).toMatch(/changed this request a moment ago/);
    expect((await platformPrisma.demoRequest.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('ACCOUNT_CREATED');
  }, 90_000);

  it('two colleagues at once: one change stands, the other is told to refresh', async () => {
    const ops = await staff('SALES');
    const d = await demo();
    const real = platformPrisma.demoRequest.findUnique.bind(platformPrisma.demoRequest);
    vi.spyOn(platformPrisma.demoRequest, 'findUnique').mockImplementationOnce((async (args: any) => {
      const row = await real(args);
      await request(app).patch(`/api/ops/demo-requests/${d.id}`).set(ops.h).send({ status: 'NOT_A_FIT', note: 'Too small' }).expect(200);
      return row;
    }) as any);
    await request(app).patch(`/api/ops/demo-requests/${d.id}`).set(ops.h).send({ status: 'DEMO_DONE' }).expect(409);
    expect((await platformPrisma.demoRequest.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('NOT_A_FIT');
    /* Read again, the change goes through. */
    await request(app).patch(`/api/ops/demo-requests/${d.id}`).set(ops.h).send({ status: 'DEMO_DONE' }).expect(200);
  }, 90_000);
});

describe('5. Company archive', () => {
  async function twoCompanies() {
    const o = await company('arch');
    const second = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${o.token}`).send({ companyName: `Second Co ${rnd()}`, state: 'Kerala' }).expect(200);
    return { o, a: o.orgId, b: second.body.company.orgId as string };
  }
  const archivedOf = (orgIds: string[]) => db(() => platformPrisma.org.count({ where: { id: { in: orgIds }, archivedAt: { not: null } } }));

  it('archiving the last two companies at once leaves one active', async () => {
    const { o, a, b } = await twoCompanies();
    const rs = await Promise.allSettled([
      archiveCompany({ accountId: o.accountId, orgId: a, actorUserId: o.userId, reason: 'NOT_NEEDED' }),
      archiveCompany({ accountId: o.accountId, orgId: b, actorUserId: o.userId, reason: 'NOT_NEEDED' }),
    ]);
    expect(tally(rs)).toEqual({ ok: 1, codes: ['LAST_ACTIVE_COMPANY'] });
    expect(await archivedOf([a, b])).toBe(1);
    forgetArchived();
  }, 90_000);

  it('the same company archived twice at once is archived once', async () => {
    const { o, b } = await twoCompanies();
    const go = () => archiveCompany({ accountId: o.accountId, orgId: b, actorUserId: o.userId, reason: 'DUPLICATE', note: rnd() });
    const rs = await Promise.allSettled([go(), go()]);
    expect(tally(rs)).toEqual({ ok: 1, codes: ['ALREADY_ARCHIVED'] });

    const back = await Promise.allSettled([reactivateCompany({ accountId: o.accountId, orgId: b, actorUserId: o.userId }), reactivateCompany({ accountId: o.accountId, orgId: b, actorUserId: o.userId })]);
    expect(tally(back)).toEqual({ ok: 1, codes: ['NOT_ARCHIVED'] });
    expect(await archivedOf([b])).toBe(0);
    forgetArchived();
  }, 90_000);
});

describe('6. Payment provider mode', () => {
  /** Razorpay on, test keys saved and passed in Test (the tests make no network calls). */
  const ready = async (over: Record<string, unknown> = {}) => {
    await db(() => providers.saveProvider('razorpay', { enabled: true, test: { id: 'rzp_test_AbCdEf123456', secrets: { keySecret: 'rzpKeySecret9876', webhookSecret: 'whsec_rzp_9f8e7d6c' } } }, 'tester'));
    await db(() => platformPrisma.paymentProvider.update({ where: { code: 'razorpay' }, data: { lastTestOk: true, lastTestMode: 'TEST', lastTestAt: new Date(), lastTestMessage: 'ok', ...over } }));
    providers.clearProviderCache();
  };
  const row = () => db(() => platformPrisma.paymentProvider.findUniqueOrThrow({ where: { code: 'razorpay' } }));

  it('an active provider cannot switch mode; the console is told why in plain words', async () => {
    await resetProviders();
    await ready({ active: true });
    await expect(db(() => providers.setMode('razorpay', 'LIVE', 'tester'))).rejects.toMatchObject({ status: 409, code: 'PROVIDER_ACTIVE' });
    const ops = await staff('BILLING');
    const r = await request(app).post('/api/ops/payments/providers/razorpay/mode').set(ops.h).send({ mode: 'LIVE', confirm: 'LIVE' }).expect(409);
    expect(r.body.code).toBe('PROVIDER_ACTIVE');
    expect(r.body.error).toBe('Customers pay through Razorpay now, so its mode cannot change. Make another provider active, or turn Razorpay off, then switch it.');
    expect(await row()).toMatchObject({ mode: 'TEST', active: true, lastTestOk: true });

    /* Turned off (which drops active), it can switch. */
    await request(app).put('/api/ops/payments/providers/razorpay').set(ops.h).send({ enabled: false }).expect(200);
    await request(app).post('/api/ops/payments/providers/razorpay/mode').set(ops.h).send({ mode: 'LIVE', confirm: 'LIVE' }).expect(200);
    expect(await row()).toMatchObject({ mode: 'LIVE', active: false, lastTestOk: null });
  }, 90_000);

  it('a switch landing while it is made active: it is not active on untested keys', async () => {
    await resetProviders();
    await ready();
    /* Activate reads the provider ready in Test; the switch to Live lands before it writes. */
    const real = platformPrisma.paymentProvider.findUnique.bind(platformPrisma.paymentProvider);
    vi.spyOn(platformPrisma.paymentProvider, 'findUnique').mockImplementationOnce((async (args: any) => {
      const r = await real(args);
      await providers.setMode('razorpay', 'LIVE', 'tester');
      return r;
    }) as any);
    await expect(db(() => providers.activate('razorpay', 'tester'))).rejects.toMatchObject({ status: 409, code: 'PROVIDER_CHANGED' });
    expect(await row()).toMatchObject({ mode: 'LIVE', active: false });
  }, 90_000);

  it('activate and a switch at once never leave it active in a mode nobody tested', async () => {
    for (let i = 0; i < 4; i++) {
      await resetProviders();
      await ready();
      await Promise.allSettled([db(() => providers.activate('razorpay', 'tester')), db(() => providers.setMode('razorpay', 'LIVE', 'tester'))]);
      const r = await row();
      if (r.active) expect(r).toMatchObject({ mode: 'TEST', lastTestOk: true, lastTestMode: 'TEST' });
      else expect(r.mode).toBe('LIVE');
    }
  }, 90_000);
});
