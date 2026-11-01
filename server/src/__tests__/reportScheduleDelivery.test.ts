import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * A-46: a scheduled report e-mail that failed was recorded as sent.
 *
 * The mailer reports a failed send by marking its outbox row FAILED, not by
 * throwing; the schedule read nothing back and stamped itself sent, so the
 * report was never retried. A retry after a partial failure also sent the
 * report again to everybody, and the job ran for companies whose Attendance
 * had lapsed.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runDueSchedules } = await import('../services/attendance/reportSchedules.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `a46.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `A46 Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId || claims.sub };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}

/* 11:30 IST on 20 October: a daily schedule at 07:00 is due, slot 2026-10-20. */
const NOW = new Date('2026-10-20T06:00:00Z');
const SLOT = '2026-10-20';
const build = async () => ({ title: 'Daily attendance', period: '19 Oct 2026', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Asha' }] });

const schedule = (c: Ctx, recipients: string) =>
  peoplePrisma.reportSchedule.create({ data: { accountId: c.accountId, orgId: c.orgId, reportId: 'daily', cadence: 'DAILY', hour: 7, recipients, createdByUserId: c.userId || 'owner' } });

/** SMTP that refuses every connection: each send ends FAILED in the outbox. */
const breakMail = (c: Ctx) =>
  platformPrisma.emailSetting.upsert({
    where: { orgId: c.orgId },
    create: { accountId: c.accountId, orgId: c.orgId, provider: 'SMTP', host: '127.0.0.1', port: 1, secure: false, updatedByUserId: 'test' },
    update: { provider: 'SMTP', host: '127.0.0.1', port: 1 },
  });
const fixMail = (c: Ctx) => platformPrisma.emailSetting.deleteMany({ where: { orgId: c.orgId } });

const mails = (orgId: string, to: string) => platformPrisma.emailOutbox.findMany({ where: { orgId, templateKey: 'reports.scheduled', toEmail: to }, orderBy: { createdAt: 'asc' } });

let c: Ctx;
beforeAll(async () => {
  c = await makeOwner();
}, 60_000);

describe('A-46: a scheduled report e-mail', () => {
  it('that fails is not recorded as sent, and goes out on the next tick', async () => {
    const s = await schedule(c, 'ops@example.com');
    await breakMail(c);
    await runDueSchedules(build, NOW);
    const failed = await peoplePrisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect((await mails(c.orgId, 'ops@example.com')).map((m) => m.status)).toEqual(['FAILED']);
    expect(failed.lastSentAt).toBeNull();
    expect(failed.lastError).toBeTruthy();

    await fixMail(c);
    await runDueSchedules(build, new Date(NOW.getTime() + 15 * 60_000));
    expect((await mails(c.orgId, 'ops@example.com')).map((m) => m.status)).toEqual(['FAILED', 'SENT']);
    expect((await peoplePrisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } })).lastSentAt).not.toBeNull();
    await peoplePrisma.reportSchedule.delete({ where: { id: s.id } });
  });

  it('is sent once per slot to each recipient: a retry reaches only those who did not get it', async () => {
    const s = await schedule(c, 'a@example.com, b@example.com');
    /* A tick earlier in this slot reached a@ and then stopped. */
    await platformPrisma.emailOutbox.create({
      data: { accountId: c.accountId, orgId: c.orgId, templateKey: 'reports.scheduled', toEmail: 'a@example.com', subject: 'x', bodyText: 'x', status: 'SENT', sentAt: NOW, relatedType: 'ReportSchedule', relatedId: `${s.id}:${SLOT}` },
    });
    await runDueSchedules(build, NOW);
    expect(await mails(c.orgId, 'a@example.com')).toHaveLength(1);
    expect((await mails(c.orgId, 'b@example.com')).map((m) => m.status)).toEqual(['SENT']);
    await peoplePrisma.reportSchedule.delete({ where: { id: s.id } });
  });

  it('is not sent for a company whose Attendance subscription has lapsed', async () => {
    const other = await makeOwner();
    const s = await schedule(other, 'lapsed@example.com');
    await platformPrisma.subscription.updateMany({ where: { accountId: other.accountId }, data: { status: 'cancelled' } });
    await runDueSchedules(build, NOW);
    expect(await mails(other.orgId, 'lapsed@example.com')).toHaveLength(0);
    expect((await peoplePrisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } })).lastSentAt).toBeNull();
  });
});
