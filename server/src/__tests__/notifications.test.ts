import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * The bell every app shares: who is told (by permission, directly or
 * through a role profile, administrators always), the inbox and read state
 * per person, and the producers — a reader alert, a person the directory
 * added, someone joining or leaving, a document about to expire.
 */

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { usersWithPermission, notifyPermission, notifyPermissionOnce, pruneNotifications } = await import('../services/notifications.js');
const { runReaderChecks } = await import('../services/attendance/readerHealth.js');
const { runDocumentReminders } = await import('../services/people/documentReminders.js');
const { runBooksDigest, booksDigestFor } = await import('../services/booksDigest.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await platformPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `bell.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Bell Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ctx.token}`).expect(200);
  ctx.userId = me.body.user.id;
  ctx.accountId = me.body.user.accountId;
  return ctx;
}
const inbox = (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/notifications/inbox`).set(at(c));

describe('who is told', () => {
  it('finds the people holding a permission, and administrators always', async () => {
    const c = await makeOwner();
    expect(await usersWithPermission(c.accountId, c.orgId, 'PEOPLE::Employees::EDIT')).toEqual([c.userId]);
    expect(await usersWithPermission(c.accountId, c.orgId, 'NOPE::Nothing::VIEW')).toEqual([c.userId]);
    /* A viewer added with only VIEW on employees is not told about edits. */
    const role = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(at(c)).send({ name: 'Viewer', roleType: 'CUSTOM', permissions: ['PEOPLE::Employees::VIEW'] }).expect(201);
    const u = await request(app).post('/api/users').set(at(c)).send({ email: `v.${rnd()}@example.com`, fullName: 'View Only', password: 'Viewer!2026pass', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
    const viewerId = u.body.user?.id || u.body.id;
    await request(app).post(`/api/orgs/${c.orgId}/users/${viewerId}/roles`).set(at(c)).send({ roleId: role.body.role?.id || role.body.id }).expect(201);
    expect((await usersWithPermission(c.accountId, c.orgId, 'PEOPLE::Employees::EDIT')).sort()).toEqual([c.userId]);
    expect((await usersWithPermission(c.accountId, c.orgId, 'PEOPLE::Employees::VIEW')).sort()).toEqual([c.userId, viewerId].sort());
  });
});

describe('the inbox', () => {
  it('lists a person’s own notifications, counts unread, marks read, and keeps companies apart', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    expect((await inbox(a).expect(200)).body).toEqual({ unread: 0, notifications: [] });
    expect(await notifyPermission(a.accountId, a.orgId, 'SETTINGS::Users::EDIT', { kind: 'test.hello', title: 'Hello', body: 'World', link: { app: 'accounting', screen: 'settingsUsers' } })).toBe(1);
    /* Not twice for the same open thing; again once it is read. */
    expect(await notifyPermissionOnce(a.accountId, a.orgId, 'SETTINGS::Users::EDIT', { kind: 'reader.alert', title: 'Gate down', dedupeKey: 'offline:dev1' })).toBe(1);
    expect(await notifyPermissionOnce(a.accountId, a.orgId, 'SETTINGS::Users::EDIT', { kind: 'reader.alert', title: 'Gate still down', dedupeKey: 'offline:dev1' })).toBe(0);
    const list = await inbox(a).expect(200);
    expect(list.body.unread).toBe(2);
    expect(list.body.notifications.map((n: any) => n.title)).toEqual(['Gate down', 'Hello']);
    expect(list.body.notifications[1].link).toEqual({ app: 'accounting', screen: 'settingsUsers' });
    expect((await inbox(b).expect(200)).body.unread).toBe(0);
    /* The one who did it is not told. */
    expect(await notifyPermission(a.accountId, a.orgId, 'SETTINGS::Users::EDIT', { kind: 'test.self', title: 'Mine' }, { except: a.userId })).toBe(0);
    const id = list.body.notifications[1].id;
    expect((await request(app).post(`/api/orgs/${a.orgId}/notifications/inbox/read`).set(at(a)).send({ ids: [id] }).expect(200)).body).toEqual({ marked: 1, unread: 1 });
    expect(await notifyPermissionOnce(a.accountId, a.orgId, 'SETTINGS::Users::EDIT', { kind: 'reader.alert', title: 'Gate down again', dedupeKey: 'offline:dev1' })).toBe(0);
    expect((await request(app).post(`/api/orgs/${a.orgId}/notifications/inbox/read`).set(at(a)).send({ all: true }).expect(200)).body).toEqual({ marked: 1, unread: 0 });
    expect(await notifyPermissionOnce(a.accountId, a.orgId, 'SETTINGS::Users::EDIT', { kind: 'reader.alert', title: 'Gate down again', dedupeKey: 'offline:dev1' })).toBe(1);
    /* B cannot read A's inbox through A's organisation id. */
    await request(app).get(`/api/orgs/${a.orgId}/notifications/inbox`).set(at(b)).expect(403);
  });
});

describe('a person’s own choices', () => {
  it('muting a kind stops it reaching them, for that company only; old rows are pruned', async () => {
    const c = await makeOwner();
    const mutes = (b: unknown) => request(app).post(`/api/orgs/${c.orgId}/notifications/inbox/mutes`).set(at(c)).send(b as any);
    expect((await mutes({ kind: 'reader.alert', muted: true }).expect(200)).body.mutes).toEqual(['reader.alert']);
    await mutes({ kind: 'Bad Kind!', muted: true }).expect(400);
    expect(await notifyPermission(c.accountId, c.orgId, 'SETTINGS::Users::EDIT', { kind: 'reader.alert', title: 'Muted one' })).toBe(0);
    expect(await notifyPermission(c.accountId, c.orgId, 'SETTINGS::Users::EDIT', { kind: 'scim.user', title: 'Still here' })).toBe(1);
    expect((await request(app).get(`/api/orgs/${c.orgId}/notifications/inbox/mutes`).set(at(c)).expect(200)).body.mutes).toEqual(['reader.alert']);
    expect((await mutes({ kind: 'reader.alert', muted: false }).expect(200)).body.mutes).toEqual([]);
    expect(await notifyPermission(c.accountId, c.orgId, 'SETTINGS::Users::EDIT', { kind: 'reader.alert', title: 'Back' })).toBe(1);
    /* Pruning: read rows older than 90 days and unread older than 180 go; the rest stay. */
    const rows = await platformPrisma.notification.findMany({ where: { orgId: c.orgId } });
    const day = 86_400_000;
    await platformPrisma.notification.update({ where: { id: rows[0].id }, data: { readAt: new Date(), createdAt: new Date(Date.now() - 91 * day) } });
    await platformPrisma.notification.update({ where: { id: rows[1].id }, data: { createdAt: new Date(Date.now() - 120 * day) } });
    expect(await pruneNotifications()).toBeGreaterThanOrEqual(1);
    const left = await platformPrisma.notification.findMany({ where: { orgId: c.orgId } });
    expect(left.map((r) => r.id)).not.toContain(rows[0].id);
    expect(left.map((r) => r.id)).toContain(rows[1].id);
  });
});

describe('what produces them', () => {
  it('a quiet reader, a person added by the directory, someone joining and leaving, a document about to expire', async () => {
    const c = await makeOwner();
    /* Reader gone quiet. */
    const reader = (await request(app).post(`/api/orgs/${c.orgId}/attendance/devices`).set(at(c)).send({ serialNumber: `BELL${rnd().toUpperCase()}`, name: 'Bell gate', direction: 'both' }).expect(201)).body.device;
    await peoplePrisma.attendanceDevice.update({ where: { id: reader.id }, data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    await runReaderChecks();
    await runReaderChecks();
    let items = (await inbox(c).expect(200)).body.notifications;
    expect(items.filter((n: any) => n.kind === 'reader.alert')).toHaveLength(1);
    expect(items[0].link).toMatchObject({ app: 'attendance', screen: 'readerHealth' });

    /* The directory adds a person. */
    const scim = (await request(app).post(`/api/orgs/${c.orgId}/security/scim`).set(at(c)).expect(201)).body.token;
    await request(app).post('/scim/v2/Users').set('Authorization', `Bearer ${scim}`).send({ userName: `dir.${rnd()}@example.com`, name: { givenName: 'Dir', familyName: 'Person' } }).expect(201);
    items = (await inbox(c).expect(200)).body.notifications;
    expect(items.find((n: any) => n.kind === 'scim.user')?.title).toMatch(/Dir Person .* was added by directory sync/);

    /* Joined and left: told the people who manage employees other than the one who did it — here the owner did it, so nobody; the mail still records the event for extra recipients. */
    const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'New Joiner', code: 'NJ1', dateOfJoining: '2026-10-01' }).expect(201)).body.employee;
    await new Promise((r) => setTimeout(r, 200));
    expect((await inbox(c).expect(200)).body.notifications.find((n: any) => n.kind === 'people.joined')).toBeUndefined();
    /* A document expiring within 30 days: announced once, to HR, with an e-mail. */
    const soon = new Date(Date.now() + 10 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const doc = await peoplePrisma.employeeDocument.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, kind: 'OTHER', title: 'Work visa', mime: 'application/pdf', size: 1, data: Buffer.from('x'), expiresOn: soon, uploadedByUserId: c.userId } });
    expect(await runDocumentReminders()).toBeGreaterThanOrEqual(1);
    expect(await runDocumentReminders()).toBe(0);
    const n = (await inbox(c).expect(200)).body.notifications.find((x: any) => x.kind === 'people.document_expiring');
    expect(n?.title).toMatch(/New Joiner’s Work visa expires in (9|10) days/);
    expect(n?.link).toEqual({ app: 'people', screen: 'employees', params: { id: emp.id } });
    expect((await peoplePrisma.employeeDocument.findUnique({ where: { id: doc.id } }))?.expiryNotifiedAt).toBeTruthy();
    expect(await platformPrisma.emailOutbox.count({ where: { orgId: c.orgId, templateKey: 'people.document_expiring' } })).toBe(1);
  });
});

describe('the books, in the shared bell', () => {
  it('overdue invoices and payables due this week become one reminder each, once while unread', async () => {
    const c = await makeOwner();
    const inv = (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send({ date: '2026-09-01', dueDate: '2026-09-15', customerName: 'Late Payer', subtotal: 1000, gstTotal: 0, total: 1000, items: [{ description: 'Work', quantity: 1, rate: 1000, gstRate: 0 }] }).expect(201)).body.invoice;
    const { prisma } = await import('../utils/prisma.js');
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid', dueDate: '2026-09-15' } });
    const d = await booksDigestFor(c.orgId, new Date('2026-10-18T04:00:00Z'));
    expect(d.overdue).toEqual({ count: 1, amount: 1000 });
    await runBooksDigest(new Date('2026-10-18T04:00:00Z'));
    await runBooksDigest(new Date('2026-10-19T04:00:00Z'));
    const rows = (await inbox(c).expect(200)).body.notifications.filter((n: any) => n.kind === 'books.overdue');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '1 invoice overdue', body: '₹1,000.00 past due date', link: { app: 'accounting', screen: 'invoices' } });
  });
});

