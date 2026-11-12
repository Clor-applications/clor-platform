import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A customer's timeline for CLOR staff (Ops plan P1): how the account began,
 * its companies and people, CLOR invoices and payments, tickets and alerts,
 * newest first, with what is coming up and paging back. Read-only staff may
 * look; customers may not.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { at, bearer, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: timeline', fn);
const DAY = 86_400_000;

describe('customer timeline', () => {
  it('tells the story newest first, with links, amounts and what is coming up', async () => {
    const c = await company('tl');
    const now = Date.now();
    const paid = await db(() =>
      platformPrisma.billingInvoice.create({ data: { number: `CLOR/TL/${rnd()}`, accountId: c.accountId, status: 'PAID', issueDate: new Date(now - 40 * DAY), dueDate: new Date(now - 30 * DAY), paidAt: new Date(now - 25 * DAY), paidAmount: 118000, total: 118000, booksStatus: 'OFF' } as any }),
    );
    const due = await db(() =>
      platformPrisma.billingInvoice.create({ data: { number: `CLOR/TL/${rnd()}`, accountId: c.accountId, status: 'ISSUED', issueDate: new Date(now - 2 * DAY), dueDate: new Date(now + 8 * DAY), total: 59000, booksStatus: 'OFF' } as any }),
    );
    await db(() => platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'DRAFT', total: 1000, booksStatus: 'OFF' } as any }));
    const t = (await request(app).post('/api/support/tickets').set(at(c)).send({ subject: 'Leave balance wrong', body: 'Balance shows minus two for Ravi.' }).expect(201)).body.ticket;
    await db(() => platformPrisma.subscription.upsert({ where: { accountId: c.accountId }, create: { accountId: c.accountId, status: 'trialing', trialEndsAt: new Date(now + 5 * DAY) } as any, update: { status: 'trialing', trialEndsAt: new Date(now + 5 * DAY) } }));

    const ro = await staff('READ_ONLY');
    const body = (await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).set(ro.h).expect(200)).body;
    const by = (id: string) => body.lines.find((l: any) => l.id === id);

    expect(by('start')).toMatchObject({ kind: 'account', what: 'Account created' });
    expect(body.lines.some((l: any) => l.kind === 'account' && /^Company added: /.test(l.what))).toBe(true);
    expect(body.lines.some((l: any) => l.kind === 'account' && / joined as owner$/.test(l.what))).toBe(true);
    expect(by(`inv-${paid.id}`)).toMatchObject({ kind: 'money', amount: 118000, link: { page: 'invoices', id: paid.id } });
    expect(by(`inv-paid-${paid.id}`)).toMatchObject({ tone: 'good', what: `Invoice ${paid.number} paid` });
    /* Paid five days late: the day it became overdue is part of the story. */
    expect(by(`inv-late-${paid.id}`)).toMatchObject({ tone: 'bad' });
    expect(by(`inv-late-${due.id}`)).toBeUndefined();
    expect(body.lines.some((l: any) => /Invoice\s*issued/.test(l.what) && l.amount === 1000)).toBe(false);
    expect(by(`tk-${t.id}`)).toMatchObject({ kind: 'support', what: `Asked for help: ${t.code} Leave balance wrong`, link: { page: 'tickets', id: t.id } });

    const times = body.lines.map((l: any) => new Date(l.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(body.upcoming.map((u: any) => u.what)).toEqual(['Trial ends', `Invoice ${due.number} due`]);
    expect(body.older).toBeNull();

    /* Requests now lists the customer's tickets. */
    const req = (await request(app).get(`/api/ops/accounts/${c.accountId}/requests`).set(ro.h).expect(200)).body;
    expect(req.support).toEqual([expect.objectContaining({ id: t.id, code: t.code, subject: 'Leave balance wrong', status: 'OPEN' })]);
  }, 60_000);

  it('pages back with `before`, never repeating a line, and has no "coming up" on older pages', async () => {
    const c = await company('tlp');
    const base = Date.now() - 400 * DAY;
    const ro = await staff('READ_ONLY');
    /* More sign-ins than one page holds. */
    await db(() =>
      platformPrisma.authEvent.createMany({ data: Array.from({ length: 150 }, (_, i) => ({ accountId: c.accountId, eventType: 'LOGIN_SUCCESS', email: c.email, createdAt: new Date(base + i * 60_000) })) as any }),
    );
    const first = (await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).set(ro.h).expect(200)).body;
    expect(first.older).toEqual(expect.any(String));
    const second = (await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).query({ before: first.older }).set(ro.h).expect(200)).body;
    expect(second.upcoming).toEqual([]);
    const ids = [...first.lines, ...second.lines].map((l: any) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.lines.every((l: any) => new Date(l.at) < new Date(first.older))).toBe(true);
    let all = ids.length;
    let older = second.older;
    while (older) {
      const next = (await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).query({ before: older }).set(ro.h).expect(200)).body;
      all += next.lines.length;
      older = next.older;
    }
    expect(all).toBeGreaterThanOrEqual(150);

    await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).query({ before: 'not a date' }).set(ro.h).expect(400);
  }, 60_000);

  it('is for CLOR staff only', async () => {
    const c = await company('tlx');
    await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).set(bearer(c)).expect(403);
  });
});
