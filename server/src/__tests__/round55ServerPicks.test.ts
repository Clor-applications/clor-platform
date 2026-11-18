import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Round 55 server picks (server batch 2E, 18 Nov 2026):
 *
 *   search by PAN or UAN     a whole identifier finds its person, for a reader who may see statutory details
 *   Remind me tomorrow       a notice leaves the bell until 9 AM tomorrow, then comes back unread at the top
 *   week ahead               a manager's Home: their team away and birthdays in the next seven days
 *   subject lines            approval emails start with the action
 *   Stop these emails        a signed link at the foot of optional mail stops that kind for that address
 *   handover note            Ops home shows the newest note for the next shift
 *   saved reply help link    "Read more: <link>" under the reply
 *   renewals                 Ops home lists paid plans renewing in 30 days with the amount and last activity
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { outsideTenant, runInTenant } = await import('../utils/tenantScope.js');
const { identifierQuery } = await import('../services/payroll/statutoryRead.js');
const { tomorrowNineIst } = await import('../routes/notifications.js');
const { approvalSubject } = await import('../services/people/approvals/engine.js');
const { sendTemplate } = await import('../services/mailer.js');
const { emailStopLink } = await import('../services/emailStop.js');
const { fillReply } = await import('../routes/opsSavedReplies.js');
const { teamWeekOf } = await import('../services/people/home.js');
const { lastAudit, opsKit, rnd } = await import('./opsTestKit.js');
const { addDays, todayIst } = await import('../utils/istDate.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: round 55', fn);
type Ctx = Awaited<ReturnType<typeof company>>;
const at = (c: Pick<Ctx, 'token' | 'orgId' | 'branchId'>) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function peopleOn(c: Ctx) {
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true } }).expect(200);
}
async function withRole(boss: Ctx, label: string) {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body.roles;
  const role = roles.find((r: any) => r.name === label);
  expect(role, label).toBeTruthy();
  const email = `${label.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: label, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  const claims = jwt.decode(login.body.token) as { userId: string };
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: claims.userId, email };
}
const addEmployee = async (c: Ctx, body: Record<string, unknown>) => (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ code: `R55-${rnd()}`, ...body }).expect(201)).body.employee;

describe('search by PAN or UAN', () => {
  it('reads only whole identifiers', () => {
    expect(identifierQuery('abcde1234f')).toEqual({ field: 'pan', value: 'ABCDE1234F' });
    expect(identifierQuery('1001 2345 6789')).toEqual({ field: 'uan', value: '100123456789' });
    expect(identifierQuery('ABCDE')).toBeNull();
    expect(identifierQuery('12345')).toBeNull();
  });

  it('finds the person by a whole PAN or UAN for the owner, never for a reader without statutory details, and never by part of one', async () => {
    const boss = await company('r55search');
    await peopleOn(boss);
    const emp = await addEmployee(boss, { name: 'Selvi Raman', phone: '+91 98450 11111' });
    await addEmployee(boss, { name: 'Other Person' });
    const pan = `QWERT${String(Math.floor(1000 + Math.random() * 8999))}Y`;
    const uan = `10${String(Date.now()).slice(-10)}`;
    await runInTenant(boss.orgId, () => payrollPrisma.employeePayrollProfile.create({ data: { accountId: boss.accountId, orgId: boss.orgId, employeeId: emp.id, pan, uan, createdByUserId: boss.userId } }));
    const find = (c: any, q: string) => request(app).get(`/api/orgs/${c.orgId}/people/employees?q=${encodeURIComponent(q)}`).set(at(c)).expect(200).then((r) => r.body.employees.map((e: any) => e.name));

    expect(await find(boss, pan.toLowerCase())).toEqual(['Selvi Raman']);
    expect(await find(boss, uan)).toEqual(['Selvi Raman']);
    expect(await find(boss, '98450')).toEqual(['Selvi Raman']);
    expect(await find(boss, pan.slice(0, 6))).toEqual([]);
    const itAdmin = await withRole(boss, 'IT Administrator');
    expect(await find(itAdmin, pan)).toEqual([]);
    expect(await find(itAdmin, 'Selvi')).toEqual(['Selvi Raman']);
  }, 90_000);
});

describe('Remind me tomorrow', () => {
  it('9 AM India time on the next India day', () => {
    /* 23:00 IST on 18 Nov is already the 18th in India: back at 09:00 IST on the 19th. */
    expect(tomorrowNineIst(new Date('2026-11-18T17:30:00Z')).toISOString()).toBe('2026-11-19T03:30:00.000Z');
    /* 01:00 IST on the 19th: the next India day is the 20th. */
    expect(tomorrowNineIst(new Date('2026-11-18T19:30:00Z')).toISOString()).toBe('2026-11-20T03:30:00.000Z');
  });

  it('takes the notice out of the list and the badge until then; only your own', async () => {
    const c = await company('r55snooze');
    const other = await company('r55snooze2');
    const n = await runInTenant(c.orgId, () => platformPrisma.notification.create({ data: { accountId: c.accountId, orgId: c.orgId, userId: c.userId, kind: 'people.approval', title: `Waiting for you: leave ${rnd()}` } }));
    const inbox = () => request(app).get(`/api/orgs/${c.orgId}/notifications/inbox`).set(at(c)).expect(200).then((r) => r.body);
    const before = await inbox();
    expect(before.notifications.map((x: any) => x.id)).toContain(n.id);
    await request(app).post(`/api/orgs/${other.orgId}/notifications/inbox/snooze`).set(at(other)).send({ id: n.id }).expect(404);
    const r = (await request(app).post(`/api/orgs/${c.orgId}/notifications/inbox/snooze`).set(at(c)).send({ id: n.id }).expect(200)).body;
    expect(new Date(r.snoozedUntil).getTime()).toBeGreaterThan(Date.now());
    const after = await inbox();
    expect(after.notifications.map((x: any) => x.id)).not.toContain(n.id);
    expect(after.unread).toBe(before.unread - 1);
    /* Mark all read leaves it alone: it comes back unread. */
    await request(app).post(`/api/orgs/${c.orgId}/notifications/inbox/read`).set(at(c)).send({ all: true }).expect(200);
    /* Its time comes. */
    await runInTenant(c.orgId, () => platformPrisma.notification.update({ where: { id: n.id }, data: { snoozedUntil: new Date(Date.now() - 1000), createdAt: new Date() } }));
    const back = await inbox();
    expect(back.notifications[0]).toMatchObject({ id: n.id, readAt: null });
  }, 60_000);
});

describe("a manager's week ahead", () => {
  it('lists their own team away and birthdays this week; nothing for someone with no reports', async () => {
    const boss = await company('r55week');
    await peopleOn(boss);
    const mgrUser = await withRole(boss, 'HR User');
    const mgr = await addEmployee(boss, { name: 'Manager Mani' });
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: mgr.id }, data: { userId: mgrUser.userId } }));
    const today = todayIst();
    const inTwo = addDays(today, 2);
    const a = await addEmployee(boss, { name: 'Away Anu', reportingManagerId: mgr.id });
    const b = await addEmployee(boss, { name: 'Birthday Bala', reportingManagerId: mgr.id, dateOfBirth: `1990-${inTwo.slice(5)}` });
    const q = await addEmployee(boss, { name: 'Quiet Qadir', reportingManagerId: mgr.id, dateOfBirth: `1991-${inTwo.slice(5)}` });
    await addEmployee(boss, { name: 'Not Mine', dateOfBirth: `1992-${inTwo.slice(5)}` });
    await runInTenant(boss.orgId, async () => {
      const type = await peoplePrisma.leaveType.create({ data: { accountId: boss.accountId, orgId: boss.orgId, name: `Casual ${rnd()}`, createdByUserId: boss.userId } });
      await peoplePrisma.leaveRequest.create({ data: { accountId: boss.accountId, orgId: boss.orgId, employeeId: a.id, leaveTypeId: type.id, fromDate: addDays(today, 1), toDate: addDays(today, 3), days: 3, reason: 'Wedding', status: 'APPROVED', requestedByUserId: boss.userId } });
      await peoplePrisma.celebrationOptOut.create({ data: { accountId: boss.accountId, orgId: boss.orgId, employeeId: q.id, byUserId: boss.userId } });
    });

    const week = await runInTenant(boss.orgId, () => teamWeekOf(boss.accountId, boss.orgId, mgrUser.userId, today));
    expect(week).toMatchObject({ from: today, to: addDays(today, 6), team: 3 });
    expect(week!.away).toEqual([{ id: a.id, name: 'Away Anu', from: addDays(today, 1), to: addDays(today, 3), days: 3 }]);
    expect(week!.birthdays).toEqual([{ id: b.id, name: 'Birthday Bala', on: inTwo }]);
    expect(JSON.stringify(week)).not.toContain('1990');

    /* On Home, for the manager; the owner manages nobody here. */
    const home = (await request(app).get(`/api/orgs/${boss.orgId}/people/home`).set(at(mgrUser)).expect(200)).body;
    expect(home.teamWeek.away[0].name).toBe('Away Anu');
    expect((await request(app).get(`/api/orgs/${boss.orgId}/people/home`).set(at(boss)).expect(200)).body.teamWeek).toBeNull();
  }, 90_000);
});

describe('approval email subjects', () => {
  it('start with the action', () => {
    expect(approvalSubject('Waiting for you', "Selvi's leave · 2 days", new Date('2026-11-20T10:00:00Z'))).toBe("Approve: Selvi's leave · 2 days · due 20 Nov");
    expect(approvalSubject('Overdue', 'Job change for Anu', new Date('2026-11-20T10:00:00Z'))).toBe('Overdue, approve: Job change for Anu');
    expect(approvalSubject('Handed on to you', 'Probation for Bala')).toBe('Approve (handed on to you): Probation for Bala');
  });
});

describe('Stop these emails', () => {
  it('optional mail carries a signed link; opening it changes nothing; Stop stops that kind for that address only; Start again undoes it', async () => {
    const c = await company('r55stop');
    const to = `stop.${Date.now()}.${rnd()}@example.com`;
    const send = (key = 'people.approval_waiting') =>
      sendTemplate({ templateKey: key, to, accountId: c.accountId, orgId: c.orgId, data: { userName: 'A', subjectLine: 'Approve: x', headline: 'Waiting for you', title: 'x', orgName: 'Co', dueLine: '', appUrl: 'http://x', noteLine: '' } }) as Promise<any>;
    const first = await send();
    const row = await db(() => platformPrisma.emailOutbox.findUniqueOrThrow({ where: { id: first.id } }));
    expect(row.subject).toBe('Approve: x');
    const m = /Stop these emails: (\S+)/.exec(row.bodyText || '');
    expect(m).toBeTruthy();
    const path = new URL(m![1]).pathname;

    /* A transactional mail has no link. */
    const t: any = await sendTemplate({ templateKey: 'explore.pass', to, transactional: true, data: { name: 'x', apps: 'CLOR', exploreUrl: 'http://x/explore', days: '14' } });
    expect((await db(() => platformPrisma.emailOutbox.findUniqueOrThrow({ where: { id: t.id } }))).bodyText).not.toContain('Stop these emails');

    const page = await request(app).get(path).expect(200);
    expect(page.text).toContain('Stop these emails?');
    expect(page.text).toContain('People: a request waits for your decision');
    expect(await db(() => platformPrisma.emailOptOut.count({ where: { email: to } }))).toBe(0);
    await request(app).get('/api/public/email/stop/not-a-token').expect(400);
    await request(app).post(path).type('form').send({ action: 'stop' }).expect(200);
    expect(((await send()) as any).status).toBe('SUPPRESSED');
    /* Another kind still goes. */
    expect(((await send('people.approval_decided')) as any).status).not.toBe('SUPPRESSED');
    /* A link for one address does not stop another's: the token names the address. */
    const otherPath = new URL(emailStopLink(`else.${rnd()}@example.com`, 'people.approval_waiting')).pathname;
    expect(otherPath).not.toBe(path);

    const undone = await request(app).post(path).type('form').send({ action: 'start' }).expect(200);
    expect(undone.text).toContain('Started again');
    expect(((await send()) as any).status).not.toBe('SUPPRESSED');
  }, 60_000);
});

describe('Ops: handover note, help links, renewals', () => {
  it('the newest handover note shows on Home; Read-only cannot write one', async () => {
    const sup = await staff('SUPPORT');
    const sales = await staff('SALES');
    const viewer = await staff('READ_ONLY');
    await request(app).post('/api/ops/handover').set(viewer.h).send({ body: 'Not allowed.' }).expect(403);
    await request(app).post('/api/ops/handover').set(sup.h).send({ body: 'x' }).expect(400);
    const body = `Kaveri Foods waits for a callback about GST ${rnd()}.`;
    await request(app).post('/api/ops/handover').set(sales.h).send({ body: 'Earlier note.' }).expect(201);
    await request(app).post('/api/ops/handover').set(sup.h).send({ body }).expect(201);
    expect(await lastAudit(sup.userId, 'HANDOVER_WRITTEN')).toBeTruthy();
    const seen = (await request(app).get('/api/ops/handover').set(viewer.h).expect(200)).body.note;
    expect(seen).toMatchObject({ body, mine: false });
    expect((await request(app).get('/api/ops/handover').set(sup.h).expect(200)).body.note.mine).toBe(true);
    /* Never a customer's to read. */
    const cust = await company('r55cust');
    await request(app).get('/api/ops/handover').set({ Authorization: `Bearer ${cust.token}` }).expect(403);
  }, 90_000);

  it('a saved reply can point to a help page, added under it as "Read more"', async () => {
    expect(fillReply('Hi {name}', { name: 'Asha Rao' }, 'https://clor.in/help/gst')).toBe('Hi Asha\n\nRead more: https://clor.in/help/gst');
    const sup = await staff('SUPPORT');
    await request(app).post('/api/ops/saved-replies').set(sup.h).send({ title: `Help ${rnd()}`, body: 'Hi {name}, see the guide.', helpUrl: 'http://clor.in/help' }).expect(400);
    const made = (await request(app).post('/api/ops/saved-replies').set(sup.h).send({ title: `Help ${rnd()}`, body: 'Hi {name}, see the guide.', helpUrl: 'https://clor.in/help/gst' }).expect(201)).body.reply;
    expect(made.helpUrl).toBe('https://clor.in/help/gst');
    const cleared = (await request(app).patch(`/api/ops/saved-replies/${made.id}`).set(sup.h).send({ helpUrl: '' }).expect(200)).body.reply;
    expect(cleared.helpUrl).toBeNull();
    await request(app).delete(`/api/ops/saved-replies/${made.id}`).set(sup.h).expect(200);
  }, 60_000);

  it('Home lists plans renewing in the next 30 days with the amount and last activity', async () => {
    const viewer = await staff('READ_ONLY');
    const c = await company('r55renew');
    const renewsAt = new Date(Date.now() + 10 * 86_400_000);
    await db(() =>
      platformPrisma.subscription.upsert({
        where: { accountId: c.accountId },
        create: { accountId: c.accountId, status: 'active', billingInterval: 'month', currentPeriodEnd: renewsAt, periodAmount: 99_900, listAmount: 129_900 },
        update: { status: 'active', billingInterval: 'month', currentPeriodEnd: renewsAt, cancelAtPeriodEnd: false, trialEndsAt: null, periodAmount: 99_900, listAmount: 129_900, offerEndsAt: null },
      }),
    );
    const home = (await request(app).get('/api/ops/home').set(viewer.h).expect(200)).body;
    expect(home.renewalsDue).toBeGreaterThanOrEqual(1);
    /* Home shows the five soonest; ours may sit behind others in a shared database, so read the list as the count says. */
    const mine = home.work.renewals.items.find((r: any) => r.accountId === c.accountId);
    if (mine) expect(mine).toMatchObject({ amount: 99_900, interval: 'month' });
    else expect(home.work.renewals.total).toBeGreaterThan(home.work.renewals.items.length);
    /* Stopping renewal takes it off. */
    await db(() => platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { cancelAtPeriodEnd: true } }));
    const after = (await request(app).get('/api/ops/home').set(viewer.h).expect(200)).body;
    expect(after.work.renewals.items.find((r: any) => r.accountId === c.accountId)).toBeUndefined();
  }, 60_000);
});
