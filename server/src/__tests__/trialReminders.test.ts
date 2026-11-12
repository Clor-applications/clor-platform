import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * The customer hears before the trial ends, and once when it has (platform
 * audit, 11 Nov 2026: no trial-ending emails). One email per step per end date.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { dueStep, runTrialReminders } = await import('../billing/trialReminders.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const DAY = 86_400_000;
const as = <T>(fn: () => Promise<T>) => outsideTenant('test: trial reminders', fn);

async function trialAccount() {
  const email = `tr.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Trial owner' }).expect(200);
  return { accountId: (jwt.decode(res.body.token) as { accountId: string }).accountId, email };
}
const sentTo = (email: string) => as(() => platformPrisma.emailOutbox.findMany({ where: { toEmail: email, relatedType: 'TrialReminder' }, orderBy: { createdAt: 'asc' }, select: { templateKey: true, relatedId: true } }));

describe('trial reminders', () => {
  it('picks the most urgent step that applies', () => {
    const now = new Date('2026-11-12T06:00:00Z');
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    expect(dueStep(at(10), now)).toBeNull();
    expect(dueStep(at(6.5), now)).toBe('7');
    expect(dueStep(at(2.2), now)).toBe('3');
    expect(dueStep(at(0.4), now)).toBe('1');
    expect(dueStep(at(-1), now)).toBe('ended');
    expect(dueStep(at(-9), now)).toBeNull();
  });

  it('emails the owner once per step, never an earlier step after a later one, and once when it ends', async () => {
    const { accountId, email } = await trialAccount();
    const now = new Date();
    const setEnd = (days: number) => as(() => platformPrisma.subscription.update({ where: { accountId }, data: { trialEndsAt: new Date(now.getTime() + days * DAY) } }));

    await setEnd(2.5);
    expect((await runTrialReminders(now, [accountId])).sent).toBe(1);
    expect((await runTrialReminders(now, [accountId])).sent).toBe(0);
    let mails = await sentTo(email);
    expect(mails.map((m) => m.templateKey)).toEqual(['billing.trial_ending']);
    expect(mails[0].relatedId).toMatch(/:3$/);

    /* The same end date, a day later: the 1-day step goes; the 7-day one never does. */
    expect((await runTrialReminders(new Date(now.getTime() + 2 * DAY), [accountId])).sent).toBe(1);
    expect((await runTrialReminders(new Date(now.getTime() + 3 * DAY), [accountId])).sent).toBe(1);
    mails = await sentTo(email);
    expect(mails.map((m) => m.relatedId!.split(':').pop())).toEqual(['3', '1', 'ended']);
    expect(mails[2].templateKey).toBe('billing.trial_ended');
    expect((await runTrialReminders(new Date(now.getTime() + 4 * DAY), [accountId])).sent).toBe(0);
  });

  it('sends nothing to an account that is not on a trial', async () => {
    const { accountId, email } = await trialAccount();
    await as(() => platformPrisma.subscription.update({ where: { accountId }, data: { status: 'active', trialEndsAt: new Date(Date.now() + DAY) } }));
    expect((await runTrialReminders(new Date(), [accountId])).sent).toBe(0);
    expect(await sentTo(email)).toEqual([]);
  });
});
