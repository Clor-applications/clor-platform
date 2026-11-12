import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Email on the operator console: sender addresses, template wording that the
 * product then sends, and the log with Resend for a failed message.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { sendTemplate } = await import('../services/mailer.js');
const { opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await platformPrisma.emailTemplateOverride.deleteMany({ where: { key: 'people.joined' } });
  await new Promise((done) => app.close(done));
});
const { staff } = opsKit(app);

describe('email in the operator console', () => {
  it('lets the owner set a sender address, and anybody but read-only send a test from it', async () => {
    const owner = await staff('SUPER_ADMIN');
    const sales = await staff('SALES');
    const reader = await staff('READ_ONLY');
    const list = (await request(app).get('/api/ops/email/senders').set(reader.h).expect(200)).body;
    expect(list.senders.map((s: any) => s.purpose)).toEqual(['sales', 'support', 'billing', 'no-reply']);

    await request(app).put('/api/ops/email/senders/sales').set(sales.h).send({ name: 'CLOR Sales', email: 'sales@clor.in', reason: 'Set up' }).expect(403);
    expect((await request(app).put('/api/ops/email/senders/sales').set(owner.h).send({ name: 'CLOR Sales', email: 'not-an-address', reason: 'Set up' }).expect(400)).body.error).toBe('That is not an email address.');
    await request(app).put('/api/ops/email/senders/sales').set(owner.h).send({ name: 'CLOR Sales', email: 'Sales@clor.in', reason: 'Set up' }).expect(200);
    expect((await lastAudit(owner.userId, 'EMAIL_SENDER_CHANGED'))?.detail).toMatchObject({ purpose: 'sales', to: 'CLOR Sales <sales@clor.in>' });

    await request(app).post('/api/ops/email/senders/sales/test').set(reader.h).send({}).expect(403);
    const t = (await request(app).post('/api/ops/email/senders/sales/test').set(sales.h).send({}).expect(200)).body;
    expect(t).toMatchObject({ sent: true, status: 'SENT' });
    expect(t.message).toMatch(/^Sent to .*Check that inbox\.$/);
    expect(await lastAudit(sales.userId, 'EMAIL_SENDER_TESTED')).not.toBeNull();
  }, 90_000);

  it('saves new wording that the product then sends, refuses a placeholder it cannot fill, previews, and resets', async () => {
    const owner = await staff('SUPER_ADMIN');
    const sup = await staff('SUPPORT');
    const tpl = (await request(app).get('/api/ops/email/templates').set(sup.h).expect(200)).body.templates.find((t: any) => t.key === 'people.joined');
    expect(tpl).toMatchObject({ changed: false });
    expect(tpl.fields).toContain('appName');

    await request(app).put('/api/ops/email/templates/people.joined').set(sup.h).send({ subject: 'x', body: 'y', reason: 'Tone' }).expect(403);
    const bad = await request(app).put('/api/ops/email/templates/people.joined').set(owner.h).send({ subject: 'Hi {{nickname}}', body: 'Body', reason: 'Tone' }).expect(400);
    expect(bad.body.error).toMatch(/cannot fill \{\{nickname\}\}/);

    const pv = (await request(app).post('/api/ops/email/templates/people.joined/preview').set(sup.h).send({ subject: 'Welcome to {{appName}}', body: 'Hello from {{appName}}' }).expect(200)).body;
    expect(pv).toMatchObject({ subject: 'Welcome to CLOR', body: 'Hello from CLOR', unknown: [] });

    await request(app).put('/api/ops/email/templates/people.joined').set(owner.h).send({ subject: 'Somebody joined {{appName}}', body: 'Plain words from {{appName}}.', reason: 'Owner asked for plainer wording' }).expect(200);
    const row = await sendTemplate({ templateKey: 'people.joined', to: 'someone@example.com', transactional: true });
    expect(row).toMatchObject({ subject: 'Somebody joined CLOR', bodyText: 'Plain words from CLOR.' });
    expect((await request(app).get('/api/ops/email/templates').set(sup.h).expect(200)).body.templates.find((t: any) => t.key === 'people.joined')).toMatchObject({ changed: true, subject: 'Somebody joined {{appName}}' });

    const test = (await request(app).post('/api/ops/email/templates/people.joined/test').set(sup.h).send({ to: 'tester@example.com' }).expect(200)).body;
    expect(test.sent).toBe(true);

    await request(app).delete('/api/ops/email/templates/people.joined').set(owner.h).send({ reason: 'Back to default' }).expect(200);
    await request(app).delete('/api/ops/email/templates/people.joined').set(owner.h).send({ reason: 'Again' }).expect(409);
    expect(await lastAudit(owner.userId, 'EMAIL_TEMPLATE_RESET')).not.toBeNull();
  }, 90_000);

  it('logs every message with a plain failure reason, and resends a failed one', async () => {
    const sup = await staff('SUPPORT');
    const sales = await staff('SALES');
    const to = `bounce.${Date.now()}@example.com`;
    const failed = await platformPrisma.emailOutbox.create({ data: { templateKey: 'auth.password_reset', toEmail: to, subject: 'Reset your password', bodyText: 'x', status: 'FAILED', attempts: 1, lastError: 'Connection refused: connect ECONNREFUSED 127.0.0.1:587' } });
    const log = (await request(app).get('/api/ops/email/log').query({ q: to }).set(sales.h).expect(200)).body;
    expect(log.messages).toHaveLength(1);
    expect(log.messages[0]).toMatchObject({ to, status: 'FAILED', templateLabel: 'Password reset', reason: 'Could not reach the mail server. Engineering should check the mail settings.' });

    await request(app).post(`/api/ops/email/log/${failed.id}/resend`).set(sales.h).send({ reason: 'Customer asked' }).expect(403);
    await request(app).post(`/api/ops/email/log/${failed.id}/resend`).set(sup.h).send({}).expect(400);
    const again = (await request(app).post(`/api/ops/email/log/${failed.id}/resend`).set(sup.h).send({ reason: 'Customer asked' }).expect(200)).body;
    expect(again.sent).toBe(true);
    await request(app).post(`/api/ops/email/log/${failed.id}/resend`).set(sup.h).send({ reason: 'Twice' }).expect(409);
    expect((await lastAudit(sup.userId, 'EMAIL_RESENT'))?.detail).toMatchObject({ to, reason: 'Customer asked', status: 'SENT' });
  }, 90_000);
});
