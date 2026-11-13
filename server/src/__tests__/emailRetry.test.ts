import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sending mail again (services/emailRetry.ts): a failed message is retried
 * later each time and then left alone, a message left QUEUED by a stopped
 * instance is picked up, and no message is sent by two senders at once.
 *
 * The mail server is a stand-in that records what it was given and fails on
 * demand; everything else (the outbox, the claim, the job) is the real thing.
 */
const smtp = { sent: [] as string[], fail: false, delayMs: 0 };
vi.mock('nodemailer', () => {
  const createTransport = () => ({
    sendMail: async (m: { to: string }) => {
      if (smtp.delayMs) await new Promise((r) => setTimeout(r, smtp.delayMs));
      if (smtp.fail) throw new Error('421 mail server not available');
      smtp.sent.push(m.to);
      return { messageId: 'x' };
    },
    verify: async () => true,
  });
  return { default: { createTransport }, createTransport };
});
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_FROM = 'CLOR <no-reply@clor.test>';

const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { sendTemplate, deliver, MAX_ATTEMPTS, RETRY_AFTER_MINUTES, CLAIM_MS } = await import('../services/mailer.js');
const { runEmailRetries, QUEUED_AFTER_MS, QUEUED_TOO_OLD_MS } = await import('../services/emailRetry.js');


const db = <T>(fn: () => Promise<T>) => outsideTenant('test: email retries', fn);
const rnd = () => Math.random().toString(36).slice(2, 10);
const MIN = 60_000;
const templateKey = 'auth.password_reset';
const address = () => `retry.${rnd()}@example.com`;
const sentTo = (to: string) => smtp.sent.filter((x) => x === to).length;
const row = (id: string) => db(() => platformPrisma.emailOutbox.findUniqueOrThrow({ where: { id } }));
const send = (to: string) => db(() => sendTemplate({ templateKey, to, transactional: true, data: { userName: 'Asha', resetUrl: 'https://app.clor.test/reset?token=abc' } }));
/** A row written straight to the outbox, as an earlier release or a stopped instance left it. */
const leftBehind = (to: string, data: Record<string, unknown>) =>
  db(() => platformPrisma.emailOutbox.create({ data: { templateKey, toEmail: to, subject: 'Left behind', bodyText: 'Hello', ...data } as any }));

beforeAll(async () => {
  /* Other rows in the table are not this file's business: nothing else is due when a test starts. */
  await db(() => platformPrisma.emailOutbox.updateMany({ where: { status: { in: ['QUEUED', 'FAILED'] } }, data: { status: 'SUPPRESSED' } }));
});
beforeEach(() => {
  smtp.sent.length = 0;
  smtp.fail = false;
  smtp.delayMs = 0;
});

describe('a message the mail server refused', () => {
  it('is left FAILED with a next time, and the job sends it once that time has come', async () => {
    const to = address();
    smtp.fail = true;
    const first = await send(to);
    expect(first).toMatchObject({ status: 'FAILED', attempts: 1, claimedAt: null });
    const wait = first!.nextAttemptAt!.getTime() - Date.now();
    expect(wait).toBeGreaterThan(0.5 * MIN);
    expect(wait).toBeLessThanOrEqual(RETRY_AFTER_MINUTES[0] * MIN);

    smtp.fail = false;
    /* Too early: nothing is sent. */
    expect(await db(() => runEmailRetries(new Date()))).toMatchObject({ due: 0, sent: 0 });
    expect(sentTo(to)).toBe(0);

    const r = await db(() => runEmailRetries(new Date(Date.now() + 2 * MIN)));
    expect(r).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(sentTo(to)).toBe(1);
    const after = await row(first!.id);
    expect(after).toMatchObject({ status: 'SENT', attempts: 2, nextAttemptAt: null, claimedAt: null, lastError: null });
    /* The working link is taken out of the stored copy once it has gone. */
    expect(after.bodyText).not.toContain('token=abc');

    /* Sent is sent: the job never touches it again. */
    await db(() => runEmailRetries(new Date(Date.now() + 24 * 60 * MIN)));
    expect(sentTo(to)).toBe(1);
  });

  it('is tried later each time, and no more after the last try', async () => {
    const to = address();
    smtp.fail = true;
    const first = await send(to);
    let at = Date.now();
    const waits: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      const before = await row(first!.id);
      if (!before.nextAttemptAt) break;
      waits.push(Math.round((before.nextAttemptAt.getTime() - before.updatedAt.getTime()) / MIN));
      at = Math.max(at, before.nextAttemptAt.getTime()) + 1000;
      await db(() => runEmailRetries(new Date(at)));
    }
    expect(waits).toEqual(RETRY_AFTER_MINUTES);
    const parked = await row(first!.id);
    expect(parked).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, nextAttemptAt: null, claimedAt: null });
    expect(parked.lastError).toMatch(/mail server not available/);

    /* The mail server is back, but this message has used every try: only a person sends it now. */
    smtp.fail = false;
    expect(await db(() => runEmailRetries(new Date(at + 7 * 24 * 60 * MIN)))).toMatchObject({ due: 0 });
    expect(sentTo(to)).toBe(0);
    expect(await db(() => deliver(first!.id))).toMatchObject({ status: 'SENT', attempts: MAX_ATTEMPTS + 1 });
    expect(sentTo(to)).toBe(1);
  });

  it('is not re-sent if it failed before retries existed (no next time on the row)', async () => {
    const to = address();
    const old = await leftBehind(to, { status: 'FAILED', attempts: 1, lastError: 'old failure' });
    expect(await db(() => runEmailRetries(new Date(Date.now() + 60 * MIN)))).toMatchObject({ due: 0 });
    expect(sentTo(to)).toBe(0);
    expect(await row(old.id)).toMatchObject({ status: 'FAILED', attempts: 1 });
  });
});

describe('a message left QUEUED by an instance that stopped', () => {
  it('is sent once nobody has had it in hand for a few minutes; a fresh one is left to its own sender', async () => {
    const stale = address();
    const fresh = address();
    const inHand = address();
    const now = Date.now();
    const a = await leftBehind(stale, { createdAt: new Date(now - QUEUED_AFTER_MS - MIN), claimedAt: new Date(now - CLAIM_MS - MIN) });
    const b = await leftBehind(fresh, { createdAt: new Date(now - MIN), claimedAt: new Date(now - MIN) });
    /* Old enough, but a sender took it a moment ago (a person pressed Resend): not the job's to send. */
    const c = await leftBehind(inHand, { createdAt: new Date(now - QUEUED_AFTER_MS - MIN), claimedAt: new Date(now - 5_000) });

    expect(await db(() => runEmailRetries(new Date(now)))).toMatchObject({ due: 1, sent: 1 });
    expect([sentTo(stale), sentTo(fresh), sentTo(inHand)]).toEqual([1, 0, 0]);
    expect(await row(a.id)).toMatchObject({ status: 'SENT', attempts: 1, claimedAt: null });
    expect(await row(b.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
    expect(await row(c.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
    await db(() => platformPrisma.emailOutbox.updateMany({ where: { id: { in: [b.id, c.id] } }, data: { status: 'SUPPRESSED' } }));
  });

  it('is retried with the same backoff when the pick-up send fails', async () => {
    const to = address();
    const now = Date.now();
    const a = await leftBehind(to, { createdAt: new Date(now - QUEUED_AFTER_MS - MIN) });
    smtp.fail = true;
    expect(await db(() => runEmailRetries(new Date(now)))).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const failed = await row(a.id);
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1, claimedAt: null });
    expect(failed.nextAttemptAt).not.toBeNull();
    await db(() => platformPrisma.emailOutbox.update({ where: { id: a.id }, data: { status: 'SUPPRESSED' } }));
  });

  it('is marked FAILED, not sent, when it has waited more than a day', async () => {
    const to = address();
    const a = await leftBehind(to, { createdAt: new Date(Date.now() - QUEUED_TOO_OLD_MS - 60 * MIN) });
    const r = await db(() => runEmailRetries(new Date()));
    expect(r.expired).toBe(1);
    expect(sentTo(to)).toBe(0);
    const after = await row(a.id);
    expect(after).toMatchObject({ status: 'FAILED', nextAttemptAt: null });
    expect(after.lastError).toMatch(/within a day/);
  });
});

describe('two senders reaching for one message', () => {
  it('two runs of the job at the same moment send it once', async () => {
    const to = address();
    const now = Date.now();
    const a = await leftBehind(to, { status: 'FAILED', attempts: 1, nextAttemptAt: new Date(now - MIN), lastError: 'x' });
    smtp.delayMs = 150;
    const runs = await Promise.all([db(() => runEmailRetries(new Date(now))), db(() => runEmailRetries(new Date(now))), db(() => runEmailRetries(new Date(now)))]);
    expect(sentTo(to)).toBe(1);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(await row(a.id)).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('the job and a person pressing Resend send it once', async () => {
    const to = address();
    const a = await leftBehind(to, { status: 'FAILED', attempts: 2, nextAttemptAt: new Date(Date.now() - MIN), lastError: 'x' });
    smtp.delayMs = 150;
    await Promise.all([db(() => deliver(a.id)), db(() => deliver(a.id)), db(() => runEmailRetries(new Date()))]);
    expect(sentTo(to)).toBe(1);
    expect(await row(a.id)).toMatchObject({ status: 'SENT', attempts: 3 });
  });

  it('a message being sent for the first time is not taken by the job, however slow the send', async () => {
    const to = address();
    smtp.delayMs = 300;
    const sending = send(to);
    await new Promise((r) => setTimeout(r, 100));
    /* Even a job that thinks five minutes have passed since it was written: the row is in its sender's hands. */
    await db(() => runEmailRetries(new Date(Date.now() + QUEUED_AFTER_MS + MIN)));
    expect(await sending).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(sentTo(to)).toBe(1);
  });
});
