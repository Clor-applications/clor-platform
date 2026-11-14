import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Ops portal, first batch (docs/workspace/OPS_PORTAL_GAPS.md): notes and tags
 * on a customer, status page posts, saved replies, insights and the switches
 * that pause clor.in's forms.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { forgetPublicStatus } = await import('../routes/status.js');
const { fillReply } = await import('../routes/opsSavedReplies.js');
const { lastMonths, monthlyPaise } = await import('../routes/opsInsights.js');
const { at, bearer, lastAudit, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: ops modules', fn);

describe('notes and tags on a customer', () => {
  it('staff write, pin and tag; only the writer or the owner changes a note; the customer never sees them', async () => {
    const sales = await staff('SALES');
    const support = await staff('SUPPORT');
    const viewer = await staff('READ_ONLY');
    const c = await company('notes');
    const base = `/api/ops/accounts/${c.accountId}`;

    const made = (await request(app).post(`${base}/notes`).set(sales.h).send({ body: 'Called the owner: e-invoice password was wrong.', pinned: true }).expect(201)).body.note;
    await request(app).post(`${base}/notes`).set(viewer.h).send({ body: 'Not allowed to write.' }).expect(403);
    await request(app).post(`${base}/notes`).set(support.h).send({ body: 'x' }).expect(400);
    await request(app).post(`${base}/notes`).set(support.h).send({ body: 'Asked about payroll on 13 Nov.' }).expect(201);

    const list = (await request(app).get(`${base}/notes`).set(viewer.h).expect(200)).body;
    expect(list.notes.map((n: any) => n.pinned)).toEqual([true, false]);
    expect(list.notes[0]).toMatchObject({ mine: false, mayChange: false });

    await request(app).patch(`${base}/notes/${made.id}`).set(support.h).send({ pinned: false }).expect(403);
    await request(app).patch(`${base}/notes/${made.id}`).set(sales.h).send({ pinned: false }).expect(200);
    expect(await lastAudit(sales.userId, 'CUSTOMER_NOTE_CHANGED')).toMatchObject({ targetAccountId: c.accountId });

    /* Tags: one spelling across customers, filterable on the list. */
    const tag = `Pilot ${rnd()}`;
    await request(app).post(`${base}/tags`).set(sales.h).send({ tag }).expect(201);
    const other = await company('notes2');
    expect((await request(app).post(`/api/ops/accounts/${other.accountId}/tags`).set(sales.h).send({ tag: tag.toUpperCase() }).expect(201)).body.tag).toBe(tag);
    await request(app).post(`${base}/tags`).set(sales.h).send({ tag: '<b>' }).expect(400);
    const filtered = (await request(app).get(`/api/ops/accounts?tag=${encodeURIComponent(tag)}`).set(viewer.h).expect(200)).body;
    expect(filtered.accounts.map((a: any) => a.id).sort()).toEqual([c.accountId, other.accountId].sort());
    expect(filtered.accounts[0].tags).toEqual([tag]);
    expect((await request(app).get('/api/ops/tags').set(viewer.h).expect(200)).body.tags).toContainEqual({ tag, customers: 2 });
    await request(app).delete(`${base}/tags/${encodeURIComponent(tag)}`).set(sales.h).expect(200);
    expect((await request(app).get(`${base}/notes`).set(viewer.h).expect(200)).body.tags).toEqual([]);

    /* The customer: no route reaches them, nothing in their security activity, and the tables refuse a company's request. */
    await request(app).get(`${base}/notes`).set(bearer(c)).expect(403);
    expect(await db(() => platformPrisma.authEvent.count({ where: { accountId: c.accountId, eventType: { startsWith: 'OPERATOR_CUSTOMER_' } } }))).toBe(0);
    const { runInTenant } = await import('../utils/tenantScope.js');
    expect(await runInTenant(c.orgId, () => platformPrisma.accountNote.count({ where: { accountId: c.accountId } })).catch(() => 0)).toBe(0);

    await request(app).delete(`${base}/notes/${made.id}`).set(sales.h).expect(200);
  }, 90_000);
});

describe('status page posts', () => {
  it('an incident marks its part on the public page until resolved; maintenance shows as coming', async () => {
    const sup = await staff('SUPPORT');
    const sales = await staff('SALES');
    const title = `E-invoices failing ${rnd()}`;
    await request(app).post('/api/ops/status-incidents').set(sales.h).send({ title, body: 'The government portal is not answering.', parts: ['accounting'] }).expect(403);
    const inc = (await request(app).post('/api/ops/status-incidents').set(sup.h).send({ title, body: 'The government portal is not answering.', parts: ['accounting'], impact: 'MAJOR' }).expect(201)).body.incident;
    expect(inc).toMatchObject({ state: 'INVESTIGATING', kind: 'INCIDENT' });
    expect(await lastAudit(sup.userId, 'STATUS_INCIDENT_POSTED')).toBeTruthy();

    forgetPublicStatus();
    let pub = (await request(app).get('/api/public/status').expect(200)).body;
    expect(pub.parts.find((p: any) => p.key === 'accounting')).toMatchObject({ impact: 'MAJOR' });
    expect(pub.parts.find((p: any) => p.key === 'payroll').impact).toBeUndefined();
    expect(pub.ok).toBe(false);
    expect(pub.incidents.map((i: any) => i.title)).toContain(title);

    await request(app).post(`/api/ops/status-incidents/${inc.id}/updates`).set(sup.h).send({ state: 'SCHEDULED', body: 'Wrong state.' }).expect(400);
    await request(app).post(`/api/ops/status-incidents/${inc.id}/updates`).set(sup.h).send({ state: 'IDENTIFIED', body: 'The portal team is on it.' }).expect(200);
    const done = (await request(app).post(`/api/ops/status-incidents/${inc.id}/updates`).set(sup.h).send({ state: 'RESOLVED', body: 'E-invoices go through again.' }).expect(200)).body.incident;
    expect(done.resolvedAt).toBeTruthy();
    expect(done.updates).toHaveLength(3);
    await request(app).delete(`/api/ops/status-incidents/${inc.id}`).set(sup.h).expect(409);

    forgetPublicStatus();
    pub = (await request(app).get('/api/public/status').expect(200)).body;
    expect(pub.parts.find((p: any) => p.key === 'accounting').impact).toBeUndefined();
    expect(pub.incidents.find((i: any) => i.title === title).resolvedAt).toBeTruthy();

    /* Planned maintenance: needs an end; coming, not a problem now. */
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await request(app).post('/api/ops/status-incidents').set(sup.h).send({ title: 'Payroll upgrade', kind: 'MAINTENANCE', body: 'Payroll is off for ten minutes.', parts: ['payroll'], startsAt: start }).expect(400);
    const m = (await request(app).post('/api/ops/status-incidents').set(sup.h).send({ title: `Payroll upgrade ${rnd()}`, kind: 'MAINTENANCE', body: 'Payroll is off for ten minutes.', parts: ['payroll'], startsAt: start, endsAt: new Date(Date.now() + 2 * 86_400_000 + 600_000).toISOString() }).expect(201)).body.incident;
    expect(m.state).toBe('SCHEDULED');
    forgetPublicStatus();
    pub = (await request(app).get('/api/public/status').expect(200)).body;
    expect(pub.incidents.find((i: any) => i.id === m.id).upcoming).toBe(true);
    expect(pub.parts.find((p: any) => p.key === 'payroll').impact).toBeUndefined();
    await request(app).delete(`/api/ops/status-incidents/${m.id}`).set(sup.h).expect(200);
  }, 90_000);
});

describe('saved replies', () => {
  it('fills the name and ticket, puts the ticket app first, and counts use', async () => {
    expect(fillReply('Hi {name}, about {ticket}:', { name: 'Asha Rao', ticket: 'T-1001' })).toBe('Hi Asha, about T-1001:');
    expect(fillReply('Hi {name}', { name: '' })).toBe('Hi there');

    const sup = await staff('SUPPORT');
    const viewer = await staff('READ_ONLY');
    const title = `Reset password ${rnd()}`;
    const r = (await request(app).post('/api/ops/saved-replies').set(sup.h).send({ title, body: 'Hi {name}, use Forgot password on the sign-in page.', app: 'workspace' }).expect(201)).body.reply;
    await request(app).post('/api/ops/saved-replies').set(sup.h).send({ title, body: 'A second one with the same title.' }).expect(409);
    await request(app).post('/api/ops/saved-replies').set(viewer.h).send({ title: 'Nope nope', body: 'Not allowed to write this.' }).expect(403);

    const c = await company('replies');
    const ticket = (await request(app).post('/api/support/tickets').set(at(c)).send({ subject: 'Cannot sign in', body: 'I forgot my password.', app: 'workspace' }).expect(201)).body.ticket;
    const listed = (await request(app).get(`/api/ops/saved-replies?ticket=${ticket.id}`).set(sup.h).expect(200)).body.replies;
    expect(listed[0].filled).toMatch(/^Hi \w+, use Forgot password/);

    await request(app).post(`/api/ops/tickets/${ticket.id}/reply`).set(sup.h).send({ body: listed[0].filled, savedReplyId: r.id }).expect(200);
    expect(await db(() => platformPrisma.supportSavedReply.findUnique({ where: { id: r.id }, select: { usedCount: true } }))).toEqual({ usedCount: 1 });
    await request(app).delete(`/api/ops/saved-replies/${r.id}`).set(sup.h).expect(200);
  }, 90_000);
});

describe('insights', () => {
  it('counts recurring revenue from priced subscriptions, a yearly price spread over twelve', async () => {
    expect(lastMonths(new Date('2026-11-14T00:00:00Z'), 3)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(monthlyPaise({ periodAmount: 120_000, billingInterval: 'year' })).toBe(10_000);
    expect(monthlyPaise({ periodAmount: 50_000, billingInterval: 'month' })).toBe(50_000);
    expect(monthlyPaise({ periodAmount: null, billingInterval: 'month' })).toBe(0);

    const viewer = await staff('READ_ONLY');
    const before = (await request(app).get('/api/ops/insights').set(viewer.h).expect(200)).body;
    const c = await company('insights');
    await db(async () => {
      await platformPrisma.subscription.deleteMany({ where: { accountId: c.accountId } });
      await platformPrisma.subscription.create({ data: { accountId: c.accountId, status: 'active', billingInterval: 'year', periodAmount: 1_200_000, planName: 'Growth', items: { create: [{ appCode: 'people' }, { appCode: 'payroll' }] } } as any });
    });
    const after = (await request(app).get('/api/ops/insights').set(viewer.h).expect(200)).body;
    expect(after.mrr - before.mrr).toBe(100_000);
    expect(after.paying - before.paying).toBe(1);
    expect(after.arr).toBe(after.mrr * 12);
    expect(after.months).toHaveLength(12);
    expect(after.months.at(-1).signups).toBeGreaterThan(0);
    await request(app).get('/api/ops/insights').set(bearer(c)).expect(403);
  }, 90_000);
});

describe('switches', () => {
  it('the owner pauses trials and demo requests; the forms answer with the message; opened again they work', async () => {
    const owner = await staff('SUPER_ADMIN');
    const sup = await staff('SUPPORT');
    await request(app).put('/api/ops/switches/signups').set(sup.h).send({ open: false }).expect(403);
    await request(app).put('/api/ops/switches/nothing').set(owner.h).send({ open: false }).expect(404);
    try {
      const sw = (await request(app).put('/api/ops/switches/signups').set(owner.h).send({ open: false, message: 'Back on Monday.' }).expect(200)).body.switches;
      expect(sw.find((s: any) => s.name === 'signups')).toMatchObject({ open: false, message: 'Back on Monday.' });
      expect(await lastAudit(owner.userId, 'SWITCH_PAUSED')).toBeTruthy();
      const refused = await request(app).post('/api/public/signup/start').send({ email: `p.${rnd()}@example.com` }).expect(503);
      expect(refused.body).toMatchObject({ code: 'PAUSED', error: 'Back on Monday.' });

      await request(app).put('/api/ops/switches/demoRequests').set(owner.h).send({ open: false }).expect(200);
      expect((await request(app).post('/api/public/demo-requests').send({}).expect(503)).body.error).toMatch(/not taking demo requests/);
    } finally {
      await request(app).put('/api/ops/switches/signups').set(owner.h).send({ open: true }).expect(200);
      await request(app).put('/api/ops/switches/demoRequests').set(owner.h).send({ open: true }).expect(200);
    }
    await request(app).post('/api/public/signup/start').send({ email: `p.${rnd()}@example.com` }).expect((r) => expect(r.status).not.toBe(503));
  }, 90_000);
});
