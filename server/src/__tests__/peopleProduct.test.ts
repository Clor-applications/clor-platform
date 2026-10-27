import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * PRODUCT-VIEW R1 (27 Oct 2026): a new company's People Home shows a setup
 * list that ticks itself; simple mode is on for a new small company and the
 * menus read it as `peopleDetailed`; the Monday summary reaches owners and HR
 * once a week, by bell and by e-mail; and the activation events are recorded
 * on our own server.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { isoWeekOf, sendWeeklySummary, weeklySummaryFor, summaryText, runWeeklySummaries } = await import('../services/people/weeklySummary.js');
const { track } = await import('../services/productEvents.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `prod.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Prod Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`).expect(200)).body.user.id;
  return c;
}
const people = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, name: string, code: string, extra: Record<string, unknown> = {}) =>
  (await people(c).post('/employees', { name, code, dateOfJoining: '2026-01-05', ...extra }).expect(201)).body.employee;
const features = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
/* Events are written without the caller waiting; give them a moment. */
const settle = () => new Promise((r) => setTimeout(r, 300));
const events = (c: Ctx, name: string) => runInTenant(c.orgId, () => platformPrisma.productEvent.findMany({ where: { orgId: c.orgId, name }, orderBy: { createdAt: 'asc' } }));
const props = (e: { props: string | null }) => (e.props ? JSON.parse(e.props) : {});

describe('People Home setup list', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true, payroll: false });
  }, 60_000);

  it('starts with every step to do, linked to its screen', async () => {
    const r = (await people(c).get('/setup').expect(200)).body;
    expect(r.setup.show).toBe(true);
    expect(r.setup).toMatchObject({ done: 0, total: 4 });
    expect(r.setup.steps.map((s: any) => [s.key, s.screen, s.done, s.optional])).toEqual([
      ['people', 'employeeNew', false, false],
      ['week', 'workingWeek', false, false],
      ['leave', 'leaveTypes', false, false],
      ['app', 'selfService', false, false],
      ['payroll', 'modules', false, true],
    ]);
    expect(r.setup.steps[0].alt).toEqual({ label: 'Import', screen: 'employeeImport' });
  });

  it('ticks each step as its records appear, and records the step once', async () => {
    await person(c, 'Asha Rao', 'S1');
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0', offSaturdays: '2,4' }).expect(200);
    let r = (await people(c).get('/setup').expect(200)).body;
    expect(r.setup.steps.find((s: any) => s.key === 'people').done).toBe(true);
    /* The week needs holidays too; the step now opens Holidays. */
    expect(r.setup.steps.find((s: any) => s.key === 'week')).toMatchObject({ done: false, screen: 'holidays' });
    await att(c, 'post', '/holidays', { date: `${isoWeekOf(new Date()).key.slice(0, 4)}-12-25`, name: 'Christmas' }).expect(201);
    await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201);
    r = (await people(c).get('/setup').expect(200)).body;
    expect(r.setup).toMatchObject({ done: 3, total: 4, show: true });
    await people(c).get('/setup').expect(200);
    await settle();
    const steps = (await events(c, 'setup_step_done')).map((e) => props(e).step).sort();
    expect(steps).toEqual(['leave', 'people', 'week']);
  });

  it('goes away when the last step is skipped, and comes back when unskipped', async () => {
    let r = (await people(c).post('/setup', { action: 'skip', step: 'app' }).expect(200)).body;
    expect(r.setup.steps.find((s: any) => s.key === 'app').skipped).toBe(true);
    expect(r.setup.show).toBe(false);
    r = (await people(c).post('/setup', { action: 'unskip', step: 'app' }).expect(200)).body;
    expect(r.setup.show).toBe(true);
    r = (await people(c).post('/setup', { action: 'hide' }).expect(200)).body;
    expect(r.setup.show).toBe(false);
    await people(c).post('/setup', { action: 'skip', step: 'nonsense' }).expect(400);
    await people(c).post('/setup', { action: 'explode' }).expect(400);
  });

  it('records the first employee added as first, the next one not', async () => {
    await person(c, 'Bala K', 'S2');
    await settle();
    const added = await events(c, 'employee_added');
    expect(added.map((e) => props(e).first)).toEqual([true, false]);
    expect(props(added[0]).source).toBe('form');
  });
});

describe('Simple mode', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await company();
  }, 60_000);

  it('is on for a new company, and the menus read it as peopleDetailed off', async () => {
    const f = await features(c);
    expect(f).toMatchObject({ peopleSimpleMode: true, peopleDetailed: false });
    /* Not a module: Hiring and the rest keep their own defaults. */
    expect(f.peopleHiring).toBe(true);
    await settle();
    expect((await events(c, 'simple_mode_toggled')).map((e) => props(e))).toEqual([{ on: true, trigger: 'company_created' }]);
  });

  it('switches off and on from Settings, and says so', async () => {
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { peopleSimpleMode: false } }).expect(200);
    expect(await features(c)).toMatchObject({ peopleSimpleMode: false, peopleDetailed: true });
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { peopleSimpleMode: true }, trigger: 'outgrown' }).expect(200);
    expect(await features(c)).toMatchObject({ peopleSimpleMode: true, peopleDetailed: false });
    await settle();
    expect((await events(c, 'simple_mode_toggled')).slice(1).map((e) => props(e))).toEqual([{ on: false, trigger: 'settings' }, { on: true, trigger: 'outgrown' }]);
  });

  it('is never a switch of its own on the menus: peopleDetailed sent back is ignored, simple mode decides it', async () => {
    /* A screen that saves what it read sends the derived key too; that must not fail, nor turn simple mode off. */
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { peopleDetailed: true } }).expect(200);
    const f = (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
    expect(f).toMatchObject({ peopleSimpleMode: true, peopleDetailed: false });
  });

  it('suggests the full menus once, when the company outgrows it', async () => {
    let r = (await people(c).get('/setup').expect(200)).body;
    expect(r.simpleMode).toEqual({ on: true, suggest: false, reasons: [] });
    for (let i = 0; i < 11; i += 1) await person(c, `Worker ${i}`, `W${i}`);
    r = (await people(c).get('/setup').expect(200)).body;
    expect(r.simpleMode.suggest).toBe(true);
    expect(r.simpleMode.reasons).toContain('11 people work here');
    r = (await people(c).post('/setup', { action: 'simpleAdviceSeen' }).expect(200)).body;
    expect(r.simpleMode).toEqual({ on: true, suggest: false, reasons: [] });
    /* Still on: a suggestion, never a switch. */
    expect((await features(c)).peopleSimpleMode).toBe(true);
  }, 60_000);

  it('is not on for a company that was there before it (no stored switch)', async () => {
    const d = await company();
    await runInTenant(d.orgId, () => platformPrisma.featureSetting.deleteMany({ where: { orgId: d.orgId, key: 'peopleSimpleMode' } }));
    expect(await features(d)).toMatchObject({ peopleSimpleMode: false, peopleDetailed: true });
  });
});

describe('Monday summary', () => {
  let c: Ctx;
  /* Monday 2 Nov 2026, 09:00 in India. */
  const monday = new Date('2026-11-02T03:30:00Z');
  beforeAll(async () => {
    c = await company();
    const casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const care = (await att(c, 'post', '/leave/types', { name: 'Medical care', annualDays: 6 }).expect(201)).body.type;
    await runInTenant(c.orgId, () => peoplePrisma.leaveType.update({ where: { id: care.id }, data: { isPrivate: true } }));
    const asha = await person(c, 'Asha Rao', 'M1');
    const bala = await person(c, 'Bala K', 'M2');
    await person(c, 'Chitra N', 'M3', { dateOfJoining: '2026-11-04' });
    const away = (await att(c, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-11-03', toDate: '2026-11-04', reason: 'Family' }).expect(201)).body.request;
    await att(c, 'post', `/leave/requests/${away.id}/approve`).expect(200);
    const priv = (await att(c, 'post', '/leave/requests', { employeeId: bala.id, leaveTypeId: care.id, fromDate: '2026-11-06', toDate: '2026-11-06', reason: 'Appointment' }).expect(201)).body.request;
    await att(c, 'post', `/leave/requests/${priv.id}/approve`).expect(200);
    await att(c, 'post', '/leave/requests', { employeeId: bala.id, leaveTypeId: casual.id, fromDate: '2026-11-20', toDate: '2026-11-20', reason: 'Errand' }).expect(201);
  }, 90_000);

  it('names the ISO week Monday to Sunday', () => {
    expect(isoWeekOf(monday)).toMatchObject({ key: '2026-W45', from: '2026-11-02', to: '2026-11-08', weekday: 1 });
    /* Sunday night in India is still the same week. */
    expect(isoWeekOf(new Date('2026-11-08T17:00:00Z')).key).toBe('2026-W45');
    expect(isoWeekOf(new Date('2026-11-08T19:00:00Z')).key).toBe('2026-W46');
  });

  it('says who is away, what waits, and who joins, keeping a private type private', async () => {
    const s = await runInTenant(c.orgId, () => weeklySummaryFor('', c.orgId, monday));
    expect(s.away).toEqual([
      { name: 'Asha Rao', from: '2026-11-03', to: '2026-11-04', leave: 'Casual' },
      { name: 'Bala K', from: '2026-11-06', to: '2026-11-06', leave: 'Leave' },
    ]);
    expect(s.waiting).toEqual([{ kind: 'leave', label: 'leave', count: 1 }]);
    expect(s.oldest?.label).toBe('leave request');
    expect(s.joining).toEqual([{ name: 'Chitra N', on: '2026-11-04' }]);
    const text = summaryText(s);
    expect(text.title).toBe('2 people away this week · 1 waiting for you');
    expect(text.body).toContain('Asha Rao: Casual, 3 Nov–4 Nov');
    expect(text.body).not.toContain('Medical care');
    expect(text.body).toContain('Joining: Chitra N (4 Nov)');
  });

  it('reaches the owner by bell and e-mail once a week, and the next week again', async () => {
    const account = (await runInTenant(c.orgId, () => platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } })))!.accountId;
    expect(await sendWeeklySummary(account, c.orgId, monday)).toBe(1);
    expect(await sendWeeklySummary(account, c.orgId, new Date('2026-11-04T05:00:00Z'))).toBe(0);
    const bell = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: 'people.weekly_summary' } }));
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ userId: c.userId, title: '2 people away this week · 1 waiting for you' });
    expect(JSON.parse(bell[0].linkJson!)).toMatchObject({ app: 'people', screen: 'overview', dedupe: 'weekly:2026-W45' });
    const mail = await runInTenant(c.orgId, () => platformPrisma.emailOutbox.findMany({ where: { orgId: c.orgId, templateKey: 'people.weekly_summary' } }));
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toContain('2 people away this week');
    expect(mail[0].bodyText).toContain('Waiting for a decision:');
    expect(await sendWeeklySummary(account, c.orgId, new Date('2026-11-09T04:00:00Z'))).toBe(1);
    await settle();
    expect((await events(c, 'digest_sent')).map((e) => props(e).week)).toEqual(['2026-W45', '2026-W46']);
  }, 60_000);

  it('respects a mute on the bell and a company switch on the e-mail', async () => {
    const account = (await runInTenant(c.orgId, () => platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } })))!.accountId;
    await request(app).post(`/api/orgs/${c.orgId}/notifications/inbox/mutes`).set(at(c)).send({ kind: 'people.weekly_summary', muted: true }).expect(200);
    await runInTenant(c.orgId, () => platformPrisma.notificationSetting.create({ data: { accountId: account, orgId: c.orgId, eventKey: 'people.weekly_summary', enabled: false, updatedByUserId: c.userId } as any }));
    await sendWeeklySummary(account, c.orgId, new Date('2026-11-16T04:00:00Z'));
    const bell = await runInTenant(c.orgId, () => platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.weekly_summary', linkJson: { contains: '2026-W47' } } }));
    expect(bell).toBe(0);
    const mail = await runInTenant(c.orgId, () => platformPrisma.emailOutbox.findFirst({ where: { orgId: c.orgId, relatedId: `${c.orgId}:2026-W47` } }));
    expect(mail?.status).toBe('SUPPRESSED');
    /* And the week is still sent once: a suppressed e-mail counts. */
    expect(await sendWeeklySummary(account, c.orgId, new Date('2026-11-17T04:00:00Z'))).toBe(0);
  }, 60_000);

  it('runs on Monday to Wednesday only, and a company with nothing to say gets nothing', async () => {
    expect(await runWeeklySummaries(new Date('2026-11-05T04:00:00Z'))).toBe(0);
    const quiet = await company();
    const account = (await runInTenant(quiet.orgId, () => platformPrisma.org.findUnique({ where: { id: quiet.orgId }, select: { accountId: true } })))!.accountId;
    expect(await sendWeeklySummary(account, quiet.orgId, monday)).toBe(0);
  }, 60_000);

  it('counts the summary opened from the bell and from the e-mail link', async () => {
    const n = await runInTenant(c.orgId, () => platformPrisma.notification.findFirst({ where: { orgId: c.orgId, kind: 'people.weekly_summary', readAt: null } }));
    await request(app).post(`/api/orgs/${c.orgId}/notifications/inbox/read`).set(at(c)).send({ ids: [n!.id] }).expect(200);
    await people(c).post('/summary-opened').expect(200);
    await settle();
    expect((await events(c, 'digest_opened')).map((e) => props(e).channel).sort()).toEqual(['bell', 'email']);
  });
});

describe('Product events', () => {
  it('records leave decided, first approval marked, and never throws', async () => {
    const c = await company();
    const casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const asha = await person(c, 'Asha Rao', 'E1');
    for (const day of ['2026-12-01', '2026-12-02']) {
      const r = (await att(c, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: day, toDate: day, reason: 'Errand' }).expect(201)).body.request;
      await att(c, 'post', `/leave/requests/${r.id}/approve`).expect(200);
      await settle();
    }
    const decided = await events(c, 'leave_decided');
    expect(decided.map((e) => [props(e).decision, props(e).first])).toEqual([['approved', true], ['approved', false]]);
    expect(decided[0].userRole).toBeTruthy();
    expect(await track('', null, 'digest_sent')).toBe(false);
  }, 60_000);

  it('cannot be edited or deleted', async () => {
    const c = await company();
    await track(c.orgId, c.userId, 'setup_step_done', { step: 'people' });
    const [e] = await events(c, 'setup_step_done');
    await expect(runInTenant(c.orgId, () => platformPrisma.productEvent.update({ where: { id: e.id }, data: { name: 'digest_sent' } }))).rejects.toThrow(/append_only/);
    await expect(runInTenant(c.orgId, () => platformPrisma.productEvent.delete({ where: { id: e.id } }))).rejects.toThrow(/append_only/);
  });
});
