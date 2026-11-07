import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The automations registry (automations plan B1): any module defines recipes that show on its own
 * Automations screen; a recipe may let the company choose who hears and how; the daily job still claims
 * each (company, recipe, day) once, runs a recipe only while its module is on, and every change is audited.
 * People's seventeen recipes keep their keys, defaults and old path.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const A = await import('../services/people/engagement/automations.js');
const { runEndDateReminders } = await import('../services/people/documentReminders.js');
const { runDigests } = await import('../services/people/lifecycle/jobs.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `auto.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Auto Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id } as Ctx;
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  c.accountId = (await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } }))!.accountId;
  c.userId = signup.body.user?.id;
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id };
}
const api = (c: Ctx, m: 'get' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);
const put = (c: Ctx, automations: Record<string, unknown>, module = 'people') => api(c, 'put', `/automations?module=${module}`, { automations });
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tenAm = () => new Date(`${istToday()}T10:00:00+05:30`);
const person = async (c: Ctx, name: string) => (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name, code: `A-${rnd()}`, dateOfJoining: '2024-01-01' }).expect(201)).body.employee;

/* Another module's recipe, defined from this file as Payroll's would be from its own. */
/* The companies the payroll recipe ran for, each time it ran. */
const payrollRuns: string[] = [];
const payslip = A.defineRecipe({
  module: 'payroll', key: 'payslipReady', group: 'Pay day', sentence: 'Tell each employee when their payslip is ready', defaultOn: true,
  job: 'people.automations', when: 'Every morning', channels: ['bell', 'app', 'email'], chooseChannels: true,
  recipients: { default: ['OWNER'], options: ['OWNER', 'HR', 'PERSON'] },
  run: async ({ orgId, to, channels }) => {
    payrollRuns.push(orgId);
    return { count: 1, recipients: [`${(to || []).join('+')} by ${channels.join('+')}`] };
  },
});

describe('the registry', () => {
  it('keeps People’s seventeen recipes, in order, under their old keys', () => {
    expect(A.recipesOf('people').map((r) => r.id)).toEqual(['taskDigest', 'firstDayPlan', 'probationEnds', 'contractEnds', 'exitInterview', 'clearanceDue', 'finalPayDue', 'leaveDigest', 'leaveWaiting', 'missingPunch', 'absence', 'documentExpiry', 'policyAccept', 'birthdays', 'anniversaries', 'wishNudge', 'holidayHeadsUp']);
    expect(A.RECIPES).toHaveLength(17);
    expect(payslip.id).toBe('payroll.payslipReady');
    expect(A.recipesOf('payroll').map((r) => r.id)).toEqual(['payroll.payslipReady']);
  });

  it('refuses a second definition, a bad key, unknown channels and defaults outside the options', () => {
    const base = { module: 'payroll' as const, group: 'G', sentence: 'S', defaultOn: false, job: 'j', when: 'w', channels: ['bell' as const] };
    expect(() => A.defineRecipe({ ...base, key: 'payslipReady' })).toThrow(/twice/);
    expect(() => A.defineRecipe({ ...base, key: 'bad-key' })).toThrow(/letters/);
    expect(() => A.defineRecipe({ ...base, key: 'noChannel', channels: ['fax' as any] })).toThrow(/channels/);
    expect(() => A.defineRecipe({ ...base, key: 'badTo', recipients: { default: ['MANAGER'], options: ['HR'] } })).toThrow(/default recipients/);
    expect(() => A.registerRecipe('payroll.nothing', async () => ({ count: 0, recipients: [] }))).toThrow(/not defined/);
  });
});

describe('the Automations screen for any module', () => {
  let c: Ctx;
  let mgr: Ctx;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true, payroll: true });
    mgr = await withRole(c, 'Team Manager', 'Mina Lead');
  }, 60_000);

  it('the old People path and the new one answer the same; another module lists only its own', async () => {
    const old = (await api(c, 'get', '/people/automations').expect(200)).body;
    const now = (await api(c, 'get', '/automations?module=people').expect(200)).body;
    expect(now.automations.map((a: any) => [a.key, a.on, a.n])).toEqual(old.automations.map((a: any) => [a.key, a.on, a.n]));
    expect(old.canEdit).toBe(true);
    const digest = now.automations.find((a: any) => a.key === 'taskDigest');
    expect(digest).toMatchObject({ to: [{ value: 'HR', label: null }], channels: ['bell', 'email'], channelOptions: ['bell', 'email'], recipients: { options: ['HR', 'OWNER', 'PERSON'] } });
    expect(now.automations.find((a: any) => a.key === 'documentExpiry')).toMatchObject({ to: null, channelOptions: null });
    expect(now.users.map((u: any) => u.id)).toEqual(expect.arrayContaining([c.userId, mgr.userId]));
    const pay = (await api(c, 'get', '/automations?module=payroll').expect(200)).body;
    expect(pay.automations.map((a: any) => a.key)).toEqual(['payroll.payslipReady']);
    expect(pay.automations[0]).toMatchObject({ module: 'payroll', on: true, to: [{ value: 'OWNER' }], channels: ['bell', 'app', 'email'] });
    await api(c, 'get', '/automations?module=books').expect(404);
  });

  it('a reader who may not change them sees no names and no users; their change is refused', async () => {
    const r = (await api(mgr, 'get', '/automations?module=people').expect(200)).body;
    expect(r.canEdit).toBe(false);
    expect(r.users).toEqual([]);
    expect(r.automations.every((a: any) => a.lastRun === null)).toBe(true);
    await put(mgr, { birthdays: { on: true } }).expect(403);
    await api(mgr, 'get', '/automations/taskDigest/history').expect(403);
    await api(mgr, 'get', '/automations?module=payroll').expect(403);
  });

  it('recipients: saved, named, and refused when the recipe does not offer them', async () => {
    await put(c, { probationEnds: { to: ['OWNER', `PERSON:${mgr.userId}`] } }).expect(200);
    const row = (await api(c, 'get', '/automations').expect(200)).body.automations.find((a: any) => a.key === 'probationEnds');
    expect(row.to).toEqual([{ value: 'OWNER', label: null }, { value: `PERSON:${mgr.userId}`, label: 'Mina Lead' }]);
    /* A reader sees that a named person hears, not who: neither the name nor the user id. */
    const seen = (await api(mgr, 'get', '/automations').expect(200)).body;
    expect(seen.automations.find((a: any) => a.key === 'probationEnds').to).toEqual([{ value: 'OWNER', label: null }, { value: 'PERSON', label: null }]);
    expect(JSON.stringify(seen)).not.toContain(mgr.userId);
    expect(JSON.stringify(seen)).not.toContain('Mina Lead');
    expect((await put(c, { taskDigest: { to: ['MANAGER'] } }).expect(400)).body.error).toMatch(/cannot go to/);
    expect((await put(c, { probationEnds: { to: [] } }).expect(400)).body.error).toMatch(/at least one/);
    expect((await put(c, { probationEnds: { to: ['PERSON:nobody-here'] } }).expect(400)).body.error).toMatch(/not a user/);
    expect((await put(c, { documentExpiry: { to: ['HR'] } }).expect(400)).body.error).toMatch(/fixed/);
    expect((await put(c, { 'payroll.payslipReady': { on: false } }).expect(400)).body.error).toMatch(/no such/);
    /* Another company's user is not a choice here. */
    const other = await company();
    expect((await put(c, { probationEnds: { to: [`PERSON:${other.userId}`] } }).expect(400)).body.error).toMatch(/not a user/);
  }, 60_000);

  it('channels: one at least, only those the recipe sends by, only where it lets you choose', async () => {
    await put(c, { taskDigest: { channels: ['email'] } }).expect(200);
    expect((await api(c, 'get', '/automations').expect(200)).body.automations.find((a: any) => a.key === 'taskDigest').channels).toEqual(['email']);
    expect((await put(c, { taskDigest: { channels: [] } }).expect(400)).body.error).toMatch(/at least one/);
    expect((await put(c, { taskDigest: { channels: ['app'] } }).expect(400)).body.error).toMatch(/cannot be sent/);
    expect((await put(c, { probationEnds: { channels: ['bell'] } }).expect(400)).body.error).toMatch(/fixed/);
    await put(c, { 'payroll.payslipReady': { channels: ['app'] } }, 'payroll').expect(200);
    await put(c, { taskDigest: { channels: ['bell', 'email'] } }).expect(200);
  });

  it('every change is audited with who and how; a save that changes nothing is not', async () => {
    const since = new Date();
    await put(c, { contractEnds: { to: ['OWNER'], n: 45 } }).expect(200);
    await put(c, { contractEnds: { to: ['OWNER'] } }).expect(200);
    const rows = await platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'EngagementSettings', createdAt: { gte: since } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toMatch(/contractEnds on \(45\) to OWNER/);
    expect(JSON.parse(String(rows[0].metadata)).changed[0]).toMatchObject({ key: 'contractEnds', n: 45, to: ['OWNER'] });
  });
});

describe('the jobs honour the choice', () => {
  let c: Ctx;
  let mgr: Ctx;
  let hr: Ctx;
  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Ravi Lead');
    hr = await withRole(c, 'HR Manager', 'Hema HR');
  }, 60_000);
  const bells = (kind: string, userId: string) => runInTenant(c.orgId, () => platformPrisma.notification.count({ where: { orgId: c.orgId, userId, kind } }));

  it('probation ends: only the chosen people hear, the manager through the reporting line', async () => {
    const boss = await person(c, 'Boss Person');
    const p = await person(c, 'New Hire');
    await runInTenant(c.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: mgr.userId } });
      await peoplePrisma.employee.update({ where: { id: p.id }, data: { reportingManagerId: boss.id, probationEndDate: plus(istToday(), 10), confirmedOn: null } });
    });
    await put(c, { probationEnds: { to: ['MANAGER'] } }).expect(200);
    await runEndDateReminders();
    expect(await bells('people.probation_ending', mgr.userId)).toBe(1);
    expect(await bells('people.probation_ending', c.userId)).toBe(0);
    expect(await bells('people.probation_ending', hr.userId)).toBe(0);
    /* Back to HR (the default): HR and the owner hear, the manager is not told twice. */
    await put(c, { probationEnds: { to: ['HR'] } }).expect(200);
    await runEndDateReminders();
    expect(await bells('people.probation_ending', c.userId)).toBe(1);
    expect(await bells('people.probation_ending', hr.userId)).toBe(1);
    expect(await bells('people.probation_ending', mgr.userId)).toBe(1);
  }, 60_000);

  it('task digest: late tasks go to the chosen person; email only sends no bell', async () => {
    const e = await person(c, 'Digest Leaver');
    await runInTenant(c.orgId, () => peoplePrisma.checklistTask.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: e.id, kind: 'LEAVING', title: 'Collect laptop', owner: 'IT', dueDate: plus(istToday(), -5) } }));
    await put(c, { taskDigest: { to: [`PERSON:${mgr.userId}`], channels: ['email'] } }).expect(200);
    await runDigests(tenAm());
    const mgrUser = await platformPrisma.user.findUnique({ where: { id: mgr.userId }, select: { email: true } });
    expect(await platformPrisma.emailOutbox.count({ where: { orgId: c.orgId, templateKey: 'people.task_digest', toEmail: mgrUser!.email } })).toBe(1);
    const digests = () => runInTenant(c.orgId, () => platformPrisma.notification.count({ where: { orgId: c.orgId, dedupeKey: { startsWith: 'lifecycle-digest:' } } }));
    expect(await digests()).toBe(0);
    const run = await runInTenant(c.orgId, () => peoplePrisma.automationRun.findFirst({ where: { orgId: c.orgId, key: 'taskDigest', ranOn: istToday() } }));
    /* Owners of their own due tasks (the plans made for these people) hear too; the late one went to Ravi, not HR. */
    expect(run!.recipients).toContain('Ravi Lead');
    const history = (await api(c, 'get', '/automations/taskDigest/history').expect(200)).body.history;
    expect(history[0]).toMatchObject({ on: istToday(), count: run!.count });
    expect(history[0].recipients).toContain('Ravi Lead');
    /* The job wakes every 15 minutes: a task added later that day does not mail Ravi a second digest. */
    await runInTenant(c.orgId, () => peoplePrisma.checklistTask.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: e.id, kind: 'LEAVING', title: 'Return badge', owner: 'IT', dueDate: plus(istToday(), -4) } }));
    await runDigests(new Date(tenAm().getTime() + 3_600_000));
    expect(await platformPrisma.emailOutbox.count({ where: { orgId: c.orgId, templateKey: 'people.task_digest', toEmail: mgrUser!.email } })).toBe(1);
    await put(c, { taskDigest: { to: ['HR'], channels: ['bell', 'email'] } }).expect(200);
  }, 60_000);

  it('a choice that names nobody falls back to the default: a named user who left, a person with no manager', async () => {
    const gone = await withRole(c, 'Viewer', 'Gita Gone');
    await put(c, { probationEnds: { to: [`PERSON:${gone.userId}`] } }).expect(200);
    await platformPrisma.user.update({ where: { id: gone.userId }, data: { isActive: false } });
    const listed = (await api(c, 'get', '/automations').expect(200)).body.automations.find((a: any) => a.key === 'probationEnds');
    expect(listed.to).toEqual([{ value: `PERSON:${gone.userId}`, label: null, gone: true }]);
    expect(listed.fallback).toEqual(['HR']);
    const told = (name: string, userId: string) => runInTenant(c.orgId, () => platformPrisma.notification.count({ where: { orgId: c.orgId, userId, kind: 'people.probation_ending', title: { contains: name } } }));
    const p = await person(c, 'Fallback Hire');
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: p.id }, data: { probationEndDate: plus(istToday(), 9), confirmedOn: null } }));
    await runEndDateReminders();
    expect(await told('Fallback Hire', hr.userId)).toBe(1);
    expect(await told('Fallback Hire', gone.userId)).toBe(0);
    /* Their manager, for someone with none: HR hears instead. */
    await put(c, { probationEnds: { to: ['MANAGER'] } }).expect(200);
    const q = await person(c, 'No Manager Hire');
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: q.id }, data: { reportingManagerId: null, probationEndDate: plus(istToday(), 8), confirmedOn: null } }));
    await runEndDateReminders();
    expect(await told('No Manager Hire', hr.userId)).toBe(1);
    expect(await told('No Manager Hire', c.userId)).toBe(1);
    await put(c, { probationEnds: { to: ['HR'] } }).expect(200);
  }, 60_000);

  it('the daily job: once per company and day, with the choice, and only while the module is on', async () => {
    const pay = await company({ people: true, payroll: true });
    await put(pay, { 'payroll.payslipReady': { to: ['HR'], channels: ['app'] } }, 'payroll').expect(200);
    await A.runAutomations(tenAm());
    await A.runAutomations(new Date(tenAm().getTime() + 3_600_000));
    expect(payrollRuns.filter((o) => o === pay.orgId)).toHaveLength(1);
    const run = await runInTenant(pay.orgId, () => peoplePrisma.automationRun.findFirst({ where: { orgId: pay.orgId, key: 'payroll.payslipReady', ranOn: istToday() } }));
    expect(run).toMatchObject({ count: 1, recipients: ['HR by app'] });
    /* Payroll switched off: People's recipes still run, Payroll's do not. */
    const off = await company({ people: true, payroll: false });
    await put(off, { birthdays: { on: true } }).expect(200);
    await A.runAutomations(tenAm());
    expect(payrollRuns).not.toContain(off.orgId);
    expect(await runInTenant(off.orgId, () => peoplePrisma.automationRun.count({ where: { orgId: off.orgId, key: 'payroll.payslipReady' } }))).toBe(0);
    expect(await runInTenant(off.orgId, () => peoplePrisma.automationRun.count({ where: { orgId: off.orgId, key: 'birthdays' } }))).toBe(1);
  }, 90_000);
});
