import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/** The audit log (filters, CSV) and Home's numbers. */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { opsKit, lastAudit } = await import('./opsTestKit.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { auditDetails, auditSummary } = await import('../routes/ops.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);

describe('the audit log and home', () => {
  it('filters by operator, action, customer and date, and exports what is shown as CSV', async () => {
    const fin = await staff('BILLING');
    const reader = await staff('READ_ONLY');
    const c = await company('aud');
    await request(app).post(`/api/ops/accounts/${c.accountId}/suspend`).set(fin.h).send({ reason: 'Unpaid, "twice"' }).expect(200);
    await request(app).post(`/api/ops/accounts/${c.accountId}/reinstate`).set(fin.h).send({ reason: 'Paid' }).expect(200);

    const byOp = (await request(app).get('/api/ops/audit').query({ operatorId: fin.userId }).set(reader.h).expect(200)).body.events;
    expect(byOp.map((e: any) => e.action)).toEqual(['ACCOUNT_REINSTATED', 'ACCOUNT_SUSPENDED']);
    expect(byOp[1]).toMatchObject({ label: 'Suspended a customer', summary: 'Unpaid, "twice"', accountName: expect.any(String) });
    const byAction = (await request(app).get('/api/ops/audit').query({ operatorId: fin.userId, action: 'ACCOUNT_SUSPENDED', accountId: c.accountId }).set(reader.h).expect(200)).body.events;
    expect(byAction).toHaveLength(1);
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    expect((await request(app).get('/api/ops/audit').query({ operatorId: fin.userId, from: today, to: today }).set(reader.h).expect(200)).body.events).toHaveLength(2);
    expect((await request(app).get('/api/ops/audit').query({ operatorId: fin.userId, to: '2020-01-01' }).set(reader.h).expect(200)).body.events).toHaveLength(0);
    await request(app).get('/api/ops/audit').query({ from: 'yesterday' }).set(reader.h).expect(400);

    const filters = (await request(app).get('/api/ops/audit/filters').set(reader.h).expect(200)).body;
    expect(filters.operators.map((o: any) => o.id)).toContain(fin.userId);
    expect(filters.actions).toEqual(expect.arrayContaining([{ action: 'ACCOUNT_SUSPENDED', label: 'Suspended a customer' }]));

    const csv = await request(app).get('/api/ops/audit/export').query({ operatorId: fin.userId }).set(reader.h).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^When \(UTC\),Staff member,/);
    expect(lines[2]).toContain('"Unpaid, ""twice"""');
    expect(await lastAudit(reader.userId, 'AUDIT_EXPORTED')).not.toBeNull();
  }, 90_000);

  it('counts today’s work for Home', async () => {
    const reader = await staff('READ_ONLY');
    const before = (await request(app).get('/api/ops/home').set(reader.h).expect(200)).body;
    await platformPrisma.emailOutbox.create({ data: { templateKey: 'auth.password_reset', toEmail: 'x@example.com', subject: 's', bodyText: 'b', status: 'FAILED' } });
    await platformPrisma.demoRequest.create({ data: { name: 'A', company: 'B', email: `d.${Date.now()}@example.com`, phone: '+919845012345', city: 'Pune', companySize: '1-10', users: 1, apps: [] } });
    const after = (await request(app).get('/api/ops/home').set(reader.h).expect(200)).body;
    expect(after.failedEmails).toBe(before.failedEmails + 1);
    expect(after.newDemos).toBe(before.newDemos + 1);
    expect(after.demosToday).toBe(before.demosToday + 1);
    expect(after).toHaveProperty('trialsEnding');
    expect(after).toHaveProperty('failedPayments');
  }, 60_000);

  it('lists quiet paying customers and trials nobody came back to, and yesterday in numbers', async () => {
    const reader = await staff('READ_ONLY');
    const DAY = 86_400_000;
    const quiet = await company('quiet');
    const busy = await company('busy');
    const stalled = await company('stalled');
    const before = (await request(app).get('/api/ops/home').set(reader.h).expect(200)).body;
    /* Two paying customers: one nobody has signed in to for a month, one used this morning. */
    for (const c of [quiet, busy]) {
      await setSubscription(c.accountId, { apps: [{ appCode: 'accounting' }], status: 'active' });
      await platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { status: 'active', billingInterval: 'year', periodAmount: 1200000 } });
    }
    await platformPrisma.user.updateMany({ where: { accountId: quiet.accountId }, data: { lastLoginAt: new Date(Date.now() - 30 * DAY) } });
    await platformPrisma.user.updateMany({ where: { accountId: busy.accountId }, data: { lastLoginAt: new Date() } });
    /* A trial opened ten days ago; its owner signed in that day and never again. */
    await setSubscription(stalled.accountId, { apps: [{ appCode: 'accounting' }], status: 'trialing', trialDays: 30 });
    const opened = new Date(Date.now() - 10 * DAY);
    await platformPrisma.subscription.update({ where: { accountId: stalled.accountId }, data: { createdAt: opened, trialEndsAt: new Date(Date.now() + 20 * DAY) } });
    await platformPrisma.user.updateMany({ where: { accountId: stalled.accountId }, data: { lastLoginAt: new Date(opened.getTime() + 3_600_000) } });
    /* A ticket nobody has touched for two days. */
    await platformPrisma.supportTicket.create({ data: { accountId: quiet.accountId, openedByUserId: quiet.userId, subject: 'Still waiting', updatedAt: new Date(Date.now() - 2 * DAY) } });

    const h = (await request(app).get('/api/ops/home').set(reader.h).expect(200)).body;
    expect(h.work.quiet.total).toBe(before.work.quiet.total + 1);
    const row = h.work.quiet.items.find((x: any) => x.accountId === quiet.accountId);
    /* A yearly plan shows what it comes to a month. */
    if (row) expect(row).toMatchObject({ monthly: 100000, customer: expect.stringMatching(/^Ops Co /) });
    expect(h.work.quiet.items.map((x: any) => x.accountId)).not.toContain(busy.accountId);
    expect(h.work.stalled.total).toBe(before.work.stalled.total + 1);
    expect(h.work.stalled.items.map((x: any) => x.accountId)).not.toContain(busy.accountId);
    expect(h.ticketsOverADay).toBe(before.ticketsOverADay + 1);
    expect(h.yesterday).toMatchObject({ signUps: expect.any(Number), demos: expect.any(Number), collected: expect.any(Number), invoicesPaid: expect.any(Number), lost: expect.any(Number) });
    for (const g of [h.work.quiet, h.work.stalled]) expect(g.items.length).toBeLessThanOrEqual(5);
  }, 120_000);

  it('lists the work itself for Home, most pressing first, to every staff role and to nobody else', async () => {
    const reader = await staff('READ_ONLY');
    const sales = await staff('SALES');
    const c = await company('work');
    const DAY = 86_400_000;
    const before = (await request(app).get('/api/ops/home').set(reader.h).expect(200)).body;
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting' }], status: 'trialing', trialDays: 14 });
    await platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { trialEndsAt: new Date(Date.now() + 3_600_000) } });
    const older = await platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'ISSUED', number: `T/${Date.now()}/1`, total: 590000, dueDate: new Date('2020-01-05') } });
    await platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'ISSUED', number: `T/${Date.now()}/2`, total: 118000, dueDate: new Date('2020-02-05') } });
    /* Not overdue: paid, or not due yet. */
    await platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'PAID', total: 100, dueDate: new Date('2020-01-01') } });
    await platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'ISSUED', total: 100, dueDate: new Date(Date.now() + 5 * DAY) } });
    const urgent = await platformPrisma.supportTicket.create({ data: { accountId: c.accountId, openedByUserId: c.userId, subject: 'Payroll will not run', priority: 'URGENT', assignedOperatorId: sales.userId, updatedAt: new Date('2020-01-01') } });
    const unassigned = await platformPrisma.supportTicket.create({ data: { accountId: c.accountId, openedByUserId: c.userId, subject: 'How do I add a branch', updatedAt: new Date('2019-01-01') } });
    /* Taken and not urgent, or waiting on the customer: nobody at CLOR needs to pick these up. */
    await platformPrisma.supportTicket.create({ data: { accountId: c.accountId, openedByUserId: c.userId, subject: 'Taken', assignedOperatorId: sales.userId } });
    await platformPrisma.supportTicket.create({ data: { accountId: c.accountId, openedByUserId: c.userId, subject: 'With the customer', status: 'WAITING', priority: 'URGENT' } });
    const asked = await platformPrisma.opsApproval.create({ data: { kind: 'DEAL', accountId: c.accountId, payload: {}, summary: 'Growth, yearly, 40% off', reason: 'Festival', requestedBy: sales.userId, expiresAt: new Date(Date.now() + 60_000) } });
    await platformPrisma.opsApproval.create({ data: { kind: 'DEAL', accountId: c.accountId, payload: {}, summary: 'Ran out', reason: 'Old', requestedBy: sales.userId, expiresAt: new Date(Date.now() - DAY) } });
    const failed = await platformPrisma.paymentEvent.create({ data: { gateway: 'test', eventId: `home-${Date.now()}`, type: 'payment.captured', accountId: c.accountId, payload: '{}', status: 'FAILED', detail: 'No subscription to pay for', amount: 118000 } });

    for (const who of [reader, sales]) {
      const h = (await request(app).get('/api/ops/home').set(who.h).expect(200)).body;
      /* The numbers the menu reads are still there. */
      expect(h).toMatchObject({ ticketsOpen: expect.any(Number), newDemos: expect.any(Number), alertsOpen: expect.any(Number) });
      expect(h.approvalsWaiting).toBe(before.approvalsWaiting + 1);
      expect(h.invoicesOverdue).toBe(before.invoicesOverdue + 2);
      expect(h.work.trials.total).toBe(h.trialsEnding);
      expect(h.work.trials.items[0]).toMatchObject({ accountId: c.accountId, customer: expect.stringMatching(/^Ops Co /) });
      expect(h.work.invoices.total).toBe(h.invoicesOverdue);
      expect(h.work.invoices.items.slice(0, 2).map((i: any) => i.id)).toEqual([older.id, expect.any(String)]);
      expect(h.work.invoices.items[0]).toMatchObject({ number: older.number, total: 590000, accountId: c.accountId, customer: expect.stringMatching(/^Ops Co /) });
      expect(h.work.tickets.total).toBe(before.work.tickets.total + 2);
      /* Urgent before unassigned, though the unassigned one has waited longer. */
      expect(h.work.tickets.items[0]).toMatchObject({ id: urgent.id, code: `T-${urgent.number}`, subject: 'Payroll will not run', priority: 'URGENT', assigned: true });
      expect(h.work.tickets.items[1]).toMatchObject({ id: unassigned.id, assigned: false });
      expect(h.work.tickets.items.map((t: any) => t.subject)).not.toContain('Taken');
      expect(h.work.tickets.items.map((t: any) => t.subject)).not.toContain('With the customer');
      expect(h.work.approvals.total).toBe(h.approvalsWaiting);
      expect(h.work.approvals.items[0]).toMatchObject({ id: asked.id, kindWord: 'Subscription deal', summary: 'Growth, yearly, 40% off', accountId: c.accountId, askedBy: 'Owner' });
      expect(h.work.approvals.items.map((a: any) => a.summary)).not.toContain('Ran out');
      expect(h.work.payments.total).toBe(before.work.payments.total + 1);
      expect(h.work.payments.items[0]).toMatchObject({ id: failed.id, what: 'Payment received', amount: 118000, detail: 'No subscription to pay for', accountId: c.accountId });
      for (const g of Object.values(h.work) as any[]) expect(g.items.length).toBeLessThanOrEqual(5);
    }
    /* A customer is not staff: no numbers and no lists. */
    expect((await request(app).get('/api/ops/home').set({ Authorization: `Bearer ${c.token}` }).expect(403)).body.code).toBe('OPERATOR_ONLY');
  }, 120_000);

  it('shows five of each kind and counts the rest', async () => {
    const reader = await staff('READ_ONLY');
    const c = await company('many');
    for (let i = 0; i < 7; i++) await platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'ISSUED', total: 100 + i, dueDate: new Date(2019, 0, 1 + i) } });
    const h = (await request(app).get('/api/ops/home').set(reader.h).expect(200)).body;
    expect(h.work.invoices.items).toHaveLength(5);
    expect(h.work.invoices.total).toBeGreaterThanOrEqual(7);
    expect(h.work.invoices.items.map((i: any) => i.total)).toEqual([100, 101, 102, 103, 104]);
  }, 60_000);
});

describe('audit words', () => {
  it('shows only the reason as the why, and the rest as plain words', () => {
    const detail = { to: 'workspace.dev@clor.test', auto: false, kind: 'REMINDER', step: 'manual', number: 'CLOR/26-27/0042', invoiceId: 'inv_1', reason: 'Chased the unpaid invoice' };
    expect(auditSummary(detail)).toBe('Chased the unpaid invoice');
    expect(auditSummary({ note: 'Asked by phone' })).toBe('Asked by phone');
    expect(auditSummary({ to: 'a@b.in' })).toBe('');

    const words = auditDetails(detail);
    expect(words).toContain('To workspace.dev@clor.test');
    expect(words).toContain('Kind reminder');
    expect(words).toContain('Step manual');
    expect(words).not.toMatch(/invoiceId|auto:|kind:|reason:/);
    expect(auditDetails(null)).toBe('');
  });
});
