import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Operator console, Ops P0: the search box on every page (GSTIN and phone
 * too), System health, one customer's connections, the request-ID lookup,
 * and the support actions added with them — unlock a locked-out user, take
 * a lost authenticator off (owner-level staff only), send failed mail again.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { workerLines } = await import('../services/ops/systemHealth.js');
const { at, opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: ops health', fn);

describe('the search box', () => {
  it('finds a customer by GSTIN, by phone and by a person’s email; read-only staff can search', async () => {
    const ro = await staff('READ_ONLY');
    const c = await company('srch');
    const gstin = `29AAB${Math.random().toString().slice(2, 6)}C1Z${Math.floor(Math.random() * 9)}`;
    const phone = `98${Math.random().toString().slice(2, 10)}`;
    await db(() => platformPrisma.branch.update({ where: { id: c.branchId }, data: { gstin, phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` } }));

    const byGstin = (await request(app).get('/api/ops/search').query({ q: gstin.toLowerCase() }).set(ro.h).expect(200)).body;
    expect(byGstin.customers.map((x: any) => x.id)).toContain(c.accountId);
    const byPhone = (await request(app).get('/api/ops/search').query({ q: `0${phone.slice(0, 3)}-${phone.slice(3)}` }).set(ro.h).expect(200)).body;
    expect(byPhone.customers.map((x: any) => x.id)).toContain(c.accountId);
    const byEmail = (await request(app).get('/api/ops/search').query({ q: c.email }).set(ro.h).expect(200)).body;
    expect(byEmail.people[0]).toMatchObject({ id: c.userId, accountId: c.accountId });
    /* The Customers list search finds the GSTIN too. */
    const list = (await request(app).get('/api/ops/accounts').query({ q: gstin }).set(ro.h).expect(200)).body;
    expect(list.accounts.map((a: any) => a.id)).toEqual([c.accountId]);
    /* Too short is just empty, not an error. */
    expect((await request(app).get('/api/ops/search').query({ q: 'a' }).set(ro.h).expect(200)).body.customers).toEqual([]);
  }, 60_000);

  it('is for CLOR staff only', async () => {
    const c = await company('cust');
    expect((await request(app).get('/api/ops/search').query({ q: 'abc' }).set(at(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    await request(app).get('/api/ops/health').set(at(c)).expect(403);
  });
});

describe('system health', () => {
  it('marks a worker late when it has gone quiet for twice its usual gap, failing when its last run failed', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    const min = 60_000;
    const run = (worker: string, agoMin: number, outcome = 'OK', error: string | null = null) => ({ worker, startedAt: new Date(now - agoMin * min), finishedAt: new Date(now - agoMin * min + 1000), outcome, error });
    const lines = workerLines(
      [
        run('mail', 5), run('mail', 15), run('mail', 25),
        run('nightly', 50 * 60), run('nightly', 74 * 60), run('nightly', 98 * 60),
        run('readers', 10, 'FAILED', 'connection refused'), run('readers', 20),
        run('once', 3000),
      ],
      now,
    );
    const by = Object.fromEntries(lines.map((l) => [l.worker, l]));
    expect(by.mail).toMatchObject({ state: 'ok', usualGapMinutes: 10 });
    expect(by.nightly).toMatchObject({ state: 'late', usualGapMinutes: 24 * 60 });
    expect(by.readers).toMatchObject({ state: 'failing', failedToday: 1, lastError: 'connection refused' });
    expect(by.once).toMatchObject({ state: 'ok', usualGapMinutes: null });
    expect(lines[0].worker).toBe('readers');
  });

  it('shows workers and the last day’s failures, and a customer’s connections', async () => {
    const ro = await staff('READ_ONLY');
    const c = await company('conn');
    await db(() => platformPrisma.emailOutbox.create({ data: { accountId: c.accountId, orgId: c.orgId, toEmail: c.email, templateKey: 'auth.password_reset', subject: 'x', bodyText: 'x', status: 'FAILED', attempts: 1, lastError: 'smtp down' } as any }));
    const h = (await request(app).get('/api/ops/health').set(ro.h).expect(200)).body;
    expect(['ok', 'attention', 'down']).toContain(h.overall);
    expect(h.signals.find((s: any) => s.key === 'emails-failed').count).toBeGreaterThan(0);
    expect(Array.isArray(h.workers)).toBe(true);
    const conn = (await request(app).get(`/api/ops/accounts/${c.accountId}/connections`).set(ro.h).expect(200)).body;
    expect(conn).toMatchObject({ items: [], emailsFailedThisWeek: 1, openReaderAlerts: 0 });
    await request(app).get('/api/ops/accounts/nope/connections').set(ro.h).expect(404);
  }, 60_000);

  it('turns a request ID into a Cloud Logging link, and refuses what is not one', async () => {
    const ro = await staff('READ_ONLY');
    const id = '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b';
    const r = (await request(app).get('/api/ops/request-lookup').query({ id }).set(ro.h).expect(200)).body;
    expect(r.logsUrl).toContain('console.cloud.google.com/logs/query');
    expect(decodeURIComponent(r.logsUrl)).toContain(`jsonPayload.requestId="${id}"`);
    await request(app).get('/api/ops/request-lookup').query({ id: 'x"; drop' }).set(ro.h).expect(400);
    expect((await request(app).get('/api/ops/search').query({ q: id }).set(ro.h).expect(200)).body.requestId).toBe(id);
  });
});

describe('support actions', () => {
  it('lets Support unlock a locked-out user, with a reason on the record; not when they are not locked', async () => {
    const sup = await staff('SUPPORT');
    const fin = await staff('BILLING');
    const c = await company('lock');
    const url = `/api/ops/accounts/${c.accountId}/users/${c.userId}/unlock`;
    await request(app).post(url).set(sup.h).send({ reason: 'Not locked yet' }).expect(409);
    await db(() => platformPrisma.user.update({ where: { id: c.userId }, data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } }));
    const users = (await request(app).get(`/api/ops/accounts/${c.accountId}/users`).set(sup.h).expect(200)).body.users;
    expect(users[0].lockedUntil).not.toBeNull();
    await request(app).post(url).set(fin.h).send({ reason: 'Asked' }).expect(403);
    await request(app).post(url).set(sup.h).send({}).expect(400);
    await request(app).post(url).set(sup.h).send({ reason: 'Owner rang, checked the email' }).expect(200);
    expect(await db(() => platformPrisma.user.findUnique({ where: { id: c.userId }, select: { lockedUntil: true, failedLoginCount: true } }))).toEqual({ lockedUntil: null, failedLoginCount: 0 });
    expect((await lastAudit(sup.userId, 'USER_UNLOCKED'))?.detail).toMatchObject({ wasLocked: true, reason: 'Owner rang, checked the email' });
  }, 60_000);

  it('lets only owner-level staff take a lost authenticator off; the person is signed out and told', async () => {
    const sup = await staff('SUPPORT');
    const boss = await staff('SUPER_ADMIN');
    const c = await company('totp');
    const url = `/api/ops/accounts/${c.accountId}/users/${c.userId}/reset-authenticator`;
    const why = { reason: 'Lost phone; called from the number on file' };
    await request(app).post(url).set(boss.h).send(why).expect(409);
    await db(() => platformPrisma.user.update({ where: { id: c.userId }, data: { totpSecretEnc: 'x', totpEnabledAt: new Date() } }));
    await request(app).post(url).set(sup.h).send(why).expect(403);
    await request(app).post(url).set(boss.h).send({ reason: 'lost' }).expect(400);
    const r = (await request(app).post(url).set(boss.h).send(why).expect(200)).body;
    expect(r.sessionsEnded).toBeGreaterThan(0);
    const u = await db(() => platformPrisma.user.findUnique({ where: { id: c.userId }, select: { totpSecretEnc: true, totpEnabledAt: true } }));
    expect(u).toEqual({ totpSecretEnc: null, totpEnabledAt: null });
    expect(await db(() => platformPrisma.emailOutbox.findFirst({ where: { toEmail: c.email, templateKey: 'auth.authenticator_removed' } }))).not.toBeNull();
    expect((await lastAudit(boss.userId, 'USER_AUTHENTICATOR_RESET'))?.detail).toMatchObject({ reason: why.reason });
    /* Not CLOR staff from here. */
    await request(app).post(`/api/ops/accounts/${sup.accountId}/users/${sup.userId}/reset-authenticator`).set(boss.h).send(why).expect(409);
  }, 60_000);

  it('sends a customer’s failed emails again, counting what went', async () => {
    const sup = await staff('SUPPORT');
    const c = await company('mail');
    await db(() => platformPrisma.emailOutbox.create({ data: { accountId: c.accountId, orgId: c.orgId, toEmail: c.email, templateKey: 'auth.password_reset', subject: 'x', bodyText: 'x', status: 'FAILED', attempts: 1, lastError: 'smtp down' } as any }));
    const r = (await request(app).post(`/api/ops/accounts/${c.accountId}/emails/retry`).set(sup.h).send({ reason: 'Their mail server was down' }).expect(200)).body;
    expect(r.tried).toBe(1);
    expect(r.sent + r.stillFailing).toBe(1);
    expect((await lastAudit(sup.userId, 'EMAILS_RETRIED'))?.detail).toMatchObject({ tried: 1 });
  }, 60_000);
});
