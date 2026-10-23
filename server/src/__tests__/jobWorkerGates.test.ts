import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * A-48: background jobs with no owner, no subscription check and no history.
 *
 *  - The retention job deleted every company's punch selfies after 30 days,
 *    overriding each company's own photoRetentionDays (the photo purge, which
 *    honours it, is now their one owner).
 *  - It deleted the biometric templates of every company that merely had no
 *    attendance settings row, in one cross-tenant delete.
 *  - HR sync, the books digest and contractor-licence reminders ran for
 *    companies whose subscription had lapsed; document reminders asked only
 *    whether People was switched on.
 *  - Nothing recorded that a job ran, so a scheduler that had stopped was
 *    invisible.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { purgeExpiredRecords } = await import('../services/retention.js');
const { purgePunchPhotos } = await import('../services/attendance/punchPhotos.js');
const { runBooksDigest } = await import('../services/booksDigest.js');
const { pullAllDue } = await import('../services/hr/sync.js');
const { runDocumentReminders, runContractorLicenceReminders } = await import('../services/people/documentReminders.js');
const jobLease = await import('../services/jobLease.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `a48.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `A48 Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const orgId = setup.body.company.orgId;
  const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { accountId: true, createdByUserId: true } });
  const c = { token: signup.body.token, orgId, branchId: setup.body.branch.id, accountId: org.accountId, userId: org.createdByUserId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const lapse = (c: Ctx) => platformPrisma.subscription.updateMany({ where: { accountId: c.accountId }, data: { status: 'cancelled' } });
const employee = async (c: Ctx) => (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Emp ${rnd()}`, code: `E${rnd()}`, dateOfJoining: '2026-01-01' }).expect(201)).body.employee as { id: string };
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const notices = (orgId: string, kind: string) => platformPrisma.notification.count({ where: { orgId, kind } });

let live: Ctx;
let lapsed: Ctx;
const staff = new Map<string, { id: string }>();
beforeAll(async () => {
  live = await makeOwner();
  lapsed = await makeOwner();
  /* Their employees exist from before the lapse; afterwards the staff routes refuse new ones. */
  staff.set(live.orgId, await employee(live));
  staff.set(lapsed.orgId, await employee(lapsed));
  await lapse(lapsed);
}, 90_000);

describe('A-48: retention has one owner per kind of data', () => {
  it("keeps a punch selfie for the company's own period, not a global 30 days", async () => {
    const e = await employee(live);
    await request(app).put(`/api/orgs/${live.orgId}/attendance/rules`).set(at(live)).send({ defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0, photoRetentionDays: 120, readerUsersBecomeEmployees: false }).expect(200);
    const photo = await peoplePrisma.punchPhoto.create({ data: { accountId: live.accountId, orgId: live.orgId, employeeId: e.id, mime: 'image/jpeg', data: Buffer.from('x'), createdAt: daysAgo(40) } });
    await purgeExpiredRecords();
    await purgePunchPhotos();
    expect(await peoplePrisma.punchPhoto.count({ where: { id: photo.id } })).toBe(1);
    /* Past the company's own period, the photo purge removes it. */
    await peoplePrisma.punchPhoto.update({ where: { id: photo.id }, data: { createdAt: daysAgo(121) } });
    await purgePunchPhotos();
    expect(await peoplePrisma.punchPhoto.count({ where: { id: photo.id } })).toBe(0);
  });

  it('deletes biometric copies only where the company has switched copying off, never for a company with no settings on record', async () => {
    const off = await makeOwner();
    const none = await makeOwner();
    await peoplePrisma.attendanceSettings.upsert({ where: { orgId: off.orgId }, create: { accountId: off.accountId, orgId: off.orgId, updatedByUserId: off.userId, biometricCopy: false }, update: { biometricCopy: false } });
    await peoplePrisma.attendanceSettings.deleteMany({ where: { orgId: none.orgId } });
    const template = (c: Ctx) => peoplePrisma.biometricTemplate.create({ data: { accountId: c.accountId, orgId: c.orgId, pin: '1', type: 1, data: 'enc:x', sourceDeviceId: 'dev' } });
    await template(off);
    await template(none);
    /* After the notice period for copies has ended. */
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-01T00:00:00Z') });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await purgeExpiredRecords();
    } finally {
      quiet.mockRestore();
      vi.useRealTimers();
    }
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: off.orgId } })).toBe(0);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: none.orgId } })).toBe(1);
  });
});

describe('A-48: jobs work only for companies whose app is live', () => {
  it('the books digest', async () => {
    const overdue = (c: Ctx) =>
      prisma.invoice.create({ data: { accountId: c.accountId, orgId: c.orgId, branchId: c.branchId, number: `INV-${rnd()}`, date: '2026-01-01', dueDate: '2026-01-15', customerName: 'Acme', subtotal: 100, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, gstTotal: 0, total: 100, paidAmount: 0, status: 'Sent', itemsJson: '[]', createdByUserId: c.userId } });
    await overdue(live);
    await overdue(lapsed);
    await runBooksDigest();
    expect(await notices(live.orgId, 'books.overdue')).toBeGreaterThan(0);
    expect(await notices(lapsed.orgId, 'books.overdue')).toBe(0);
  });

  it('contractor-licence reminders', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    for (const c of [live, lapsed]) await peoplePrisma.contractor.create({ data: { accountId: c.accountId, orgId: c.orgId, name: `Contractor ${rnd()}`, licenceValidTo: soon, createdByUserId: c.userId } });
    await runContractorLicenceReminders();
    expect(await notices(live.orgId, 'people.contractor_licence')).toBeGreaterThan(0);
    expect(await notices(lapsed.orgId, 'people.contractor_licence')).toBe(0);
  });

  it('document-expiry reminders', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const docs = [];
    for (const c of [live, lapsed]) {
      const e = staff.get(c.orgId)!;
      docs.push(await peoplePrisma.employeeDocument.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: e.id, kind: 'ID', title: 'Passport', mime: 'application/pdf', size: 1, data: Buffer.from('x'), expiresOn: soon, uploadedByUserId: c.userId } }));
    }
    await runDocumentReminders();
    const [mine, theirs] = await Promise.all(docs.map((d) => peoplePrisma.employeeDocument.findUniqueOrThrow({ where: { id: d.id } })));
    expect(mine.expiryNotifiedAt).not.toBeNull();
    expect(theirs.expiryNotifiedAt).toBeNull();
  });

  it('HR sync: employees are not pulled for a company without People', async () => {
    const conn = await peoplePrisma.hrConnection.create({ data: { accountId: lapsed.accountId, orgId: lapsed.orgId, adapter: 'GREYTHR', name: 'greytHR', enabled: true, pushPunches: false, pullEmployees: true, createdByUserId: lapsed.userId } });
    await pullAllDue();
    expect(await peoplePrisma.hrSyncLog.count({ where: { connectionId: conn.id } })).toBe(0);
    await peoplePrisma.hrConnection.delete({ where: { id: conn.id } });
  });
});

describe('A-48: every job run is on record', () => {
  it('records a run, what it did and how it ended, so a stopped scheduler shows', async () => {
    const worker = `test.run.${rnd()}`;
    await jobLease.exclusive(worker, 60_000, async () => ({ deleted: 3, kept: 1 }));
    await expect(jobLease.exclusive(`${worker}.bad`, 60_000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const runs = await platformPrisma.jobRun.findMany({ where: { worker: { startsWith: worker } }, orderBy: { startedAt: 'asc' } });
    expect(runs.map((r) => [r.worker, r.outcome])).toEqual([[worker, 'OK'], [`${worker}.bad`, 'FAILED']]);
    expect(JSON.parse(runs[0].counts || '{}')).toEqual({ deleted: 3, kept: 1 });
    expect(runs[0].finishedAt).not.toBeNull();
    expect(runs[1].error).toBe('boom');
    expect((await jobLease.lastJobRuns()).find((r) => r.worker === worker)?.outcome).toBe('OK');
  });
});
