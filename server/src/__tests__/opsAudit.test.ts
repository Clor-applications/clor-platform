import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/** The audit log (filters, CSV) and Home's numbers. */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { opsKit, lastAudit } = await import('./opsTestKit.js');

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
});
