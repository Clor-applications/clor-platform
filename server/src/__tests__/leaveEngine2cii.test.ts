import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave on the approval engine, phase 2c-ii (docs/people/workflow-engine/SPEC.md section 9): the switch in
 * Company choices, the re-review fixes of PR #102 (A: a step's people are only ever replaced for that step,
 * under the company's lock; B: an approver going away or coming back moves the leave they decide), the
 * type's auto-approval as the rule's AUTO_APPROVED step, reminders and the leave rule's hand-on from the
 * engine's dues job, the drawer's steps and "With Ravi (your manager)" in the employee app. The parity of
 * the leave rule (RULE) with its walker is in leaveEngineParity.test.ts (the RULE rows of its table).
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { todayIst, addDays } = await import('../utils/istDate.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const { reassignStep, runApprovalDues } = await import('../services/people/approvals/engine.js');
const { refreshLeaveSteps } = await import('../services/attendance/leaveEngine.js');
const { runLeaveEngineRefresh, runLeaveHandOns } = await import('../services/attendance/leaveJobs.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; roleId?: string };
/* Everyone signed in here, signed in again before each test: the file runs longer than a sign-in lasts when the Mac is busy. */
const signedIn: Array<{ ctx: Ctx; email: string }> = [];
beforeEach(async () => {
  for (const s of signedIn) s.ctx.token = (await request(app).post('/api/auth/login').send({ email: s.email, password: 'Passw0rd!23' }).expect(200)).body.token;
});
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `l2.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `L2 Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  c.userId = me.body.user.id;
  c.accountId = me.body.orgs.find((o: any) => o.orgId === c.orgId).accountId;
  signedIn.push({ ctx: c, email });
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  const ctx: Ctx = { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId };
  signedIn.push({ ctx, email });
  return ctx;
}
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const people = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});

const LEAVE_HR = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE', 'ATTENDANCE::Leave Requests::EDIT', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW', 'ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE', 'PEOPLE::Approvals::EDIT'];
const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];

let cursor = addDays(todayIst(), 20);
const nextDay = () => {
  cursor = addDays(cursor, 1);
  return cursor;
};

let hr: Ctx;
let kavya: Ctx;
let meena: Ctx;
let ravi: Ctx;
let tara: Ctx;
const E: Record<string, any> = {};
const T: Record<string, any> = {};
const inTenant = <X>(fn: () => Promise<X>) => runInTenant(hr.orgId, fn);
const engineOf = (id: string) => inTenant(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: hr.orgId, sourceKind: 'LEAVE', sourceId: id }, include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } } }));
const waitingOn = async (id: string) => ((await engineOf(id))?.steps.find((s) => s.status === 'WAITING')?.candidateUserIds as string[]) || [];
const leaveRow = (id: string) => inTenant(() => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));
const notices = async (id: string) => {
  await deliverOutbox(new Date(), 5000);
  return inTenant(() => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, OR: [{ dedupeKey: { contains: id } }, { subjectKey: `leave:${id}` }] }, orderBy: { createdAt: 'asc' } }));
};
const switchOn = () => inTenant(() => peoplePrisma.peopleSetting.upsert({ where: { orgId: hr.orgId }, create: { accountId: hr.accountId, orgId: hr.orgId, leaveOnEngine: true }, update: { leaveOnEngine: true } }));
const ask = async (who: Ctx, type: any, day = nextDay(), extra: Record<string, unknown> = {}) => {
  const r = await att(who).post('/me/leave', { leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Family visit', ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.request;
};

beforeAll(async () => {
  hr = await owner();
  kavya = await colleague(hr, 'Kavya', LEAVE_HR);
  meena = await colleague(hr, 'Meena', LEAVE_HR, true);
  ravi = await colleague(hr, 'Ravi', LEAVE_HR, true);
  tara = await colleague(hr, 'Tara', MY);
  const emp = async (body: Record<string, unknown>) => (await people(hr).post('/employees', { dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
  E.kavya = await emp({ name: 'Kavya Rao', code: 'K-1' });
  E.meena = await emp({ name: 'Meena Iyer', code: 'K-2' });
  E.ravi = await emp({ name: 'Ravi Kumar', code: 'K-3', reportingManagerId: E.meena.id });
  E.tara = await emp({ name: 'Tara Singh', code: 'K-4', reportingManagerId: E.ravi.id });
  await inTenant(async () => {
    for (const [k, c] of Object.entries({ kavya, meena, ravi, tara })) await peoplePrisma.employee.update({ where: { id: E[k].id }, data: { userId: c.userId } });
  });
  /* Every day a working day here, so a leave for today can be asked and approved whatever today is. */
  await att(hr).put('/leave/working-week', { weeklyOffDays: '' }).expect(200);
  for (const chain of ['HR', 'MANAGER', 'MANAGER_THEN_HR']) {
    const t = (await att(hr).post('/leave/types', { name: `Casual ${chain}`, annualDays: 300 }).expect(201)).body.type;
    await att(hr).put(`/leave/types/${t.id}`, { name: t.name, annualDays: 300, approval: chain }).expect(200);
    T[chain] = t;
  }
}, 180_000);

describe('the switch is a company choice', () => {
  it('off by default; HR cannot turn it on, the owner can, audited; then new leave goes on the engine', async () => {
    const before = (await people(hr).get('/company-choices').expect(200)).body.choices.find((c: any) => c.key === 'leave.onEngine');
    expect(before).toMatchObject({ value: false, default: false, canChange: true });
    const asKavya = (await people(kavya).get('/company-choices').expect(200)).body.choices.find((c: any) => c.key === 'leave.onEngine');
    expect(asKavya.canChange).toBe(false);
    expect((await people(kavya).put('/company-choices/leave.onEngine', { value: true })).status).toBe(403);
    const off = await ask(tara, T.MANAGER);
    expect(await engineOf(off.id)).toBeNull();
    await people(hr).put('/company-choices/leave.onEngine', { value: true }).expect(200);
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: hr.orgId, entity: 'COMPANY_SETTING', entityId: 'leave.onEngine' } });
    expect(audit?.message).toMatch(/Off → On/);
    const on = await ask(tara, T.MANAGER);
    expect((await engineOf(on.id))?.status).toBe('WAITING');
    for (const id of [off.id, on.id]) await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
  }, 60_000);
});

describe('A: a step is only given the people worked out for it', () => {
  beforeAll(() => switchOn());
  it('reassignStep for a step no longer waiting does nothing; a refresh racing the manager’s approval never gives HR’s step to the manager', async () => {
    const r = await ask(tara, T.MANAGER_THEN_HR);
    const step1 = (await engineOf(r.id))!.steps.find((s) => s.status === 'WAITING')!;
    expect((await att(ravi).post(`/leave/requests/${r.id}/approve`, {})).body.stage).toBe('HR');
    const stale = await inTenant(() => reassignStep({ accountId: hr.accountId, orgId: hr.orgId, userId: null, source: 'FORM', correlationId: 'test' }, step1.requestId, { stepId: step1.id, candidates: [ravi.userId], how: 'MANAGER', comment: null, standInFor: null }));
    expect(stale).toBe(false);
    expect(await waitingOn(r.id)).not.toContain(ravi.userId);
    for (let i = 0; i < 4; i += 1) {
      const x = await ask(tara, T.MANAGER_THEN_HR);
      await Promise.all([att(ravi).post(`/leave/requests/${x.id}/approve`, {}), inTenant(() => refreshLeaveSteps(hr.accountId, hr.orgId)), inTenant(() => refreshLeaveSteps(hr.accountId, hr.orgId))]);
      const e = await engineOf(x.id);
      expect(e?.currentStep).toBe(2);
      expect(await waitingOn(x.id)).not.toContain(ravi.userId);
      expect((e!.steps.find((s) => s.status === 'WAITING')!.candidateUserIds as string[]).sort()).toEqual([hr.userId, kavya.userId].sort());
      await att(hr).post(`/leave/requests/${x.id}/cancel`).expect(200);
    }
    await att(hr).post(`/leave/requests/${r.id}/cancel`).expect(200);
  }, 120_000);
});

describe('B: an approver going away, or coming back, moves the leave they decide', () => {
  beforeAll(() => switchOn());
  it('Ravi’s own leave for today approved: Tara’s waiting leave goes up to Meena, who is told; cancelled: back to Ravi', async () => {
    const r = await ask(tara, T.MANAGER_THEN_HR);
    expect(await waitingOn(r.id)).toEqual([ravi.userId]);
    const own = await ask(ravi, T.HR, todayIst());
    await att(kavya).post(`/leave/requests/${own.id}/approve`, {}).expect(200);
    /* Moved after the approval commits, each request in its own transaction. */
    await expect.poll(() => waitingOn(r.id), { timeout: 15_000 }).toEqual([meena.userId]);
    const up = await engineOf(r.id);
    expect(up?.steps.find((s) => s.status === 'WAITING')).toMatchObject({ resolvedHow: 'AWAY_HANDED_UP' });
    expect(await waitingOn(r.id)).toEqual([meena.userId]);
    expect((await notices(r.id)).some((n) => n.userId === meena.userId && n.kind === 'attendance.leave_asked')).toBe(true);
    /* Ravi, away, is no longer offered it, and cannot take it. */
    expect((await people(ravi).get('/inbox').expect(200)).body.items.map((i: any) => i.id)).not.toContain(r.id);
    await att(kavya).post(`/leave/requests/${own.id}/cancel`).expect(200);
    await expect.poll(() => waitingOn(r.id), { timeout: 15_000 }).toEqual([ravi.userId]);
    expect((await att(ravi).post(`/leave/requests/${r.id}/approve`, {})).body.stage).toBe('HR');
    await att(hr).post(`/leave/requests/${r.id}/cancel`).expect(200);
  }, 60_000);

  it('the hourly refresh catches an absence nothing announced (a leave written another way), and a stand-in whose dates began', async () => {
    const r = await ask(tara, T.MANAGER_THEN_HR);
    const away = await inTenant(() => peoplePrisma.leaveRequest.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: E.ravi.id, leaveTypeId: T.HR.id, fromDate: todayIst(), toDate: todayIst(), days: 1, reason: 'Away, written straight in', status: 'APPROVED', requestedByUserId: ravi.userId } }));
    expect(await waitingOn(r.id)).toEqual([ravi.userId]);
    await runLeaveEngineRefresh();
    expect(await waitingOn(r.id)).toEqual([meena.userId]);
    await inTenant(() => peoplePrisma.leaveRequest.delete({ where: { id: away.id } }));
    await runLeaveEngineRefresh();
    expect(await waitingOn(r.id)).toEqual([ravi.userId]);
    await att(hr).post(`/leave/requests/${r.id}/cancel`).expect(200);
  }, 60_000);
});

describe('review nits', () => {
  beforeAll(() => switchOn());
  it('a refresh keeps a handed-on step with whom it was handed to; one whose leave is no longer waiting closes quietly', async () => {
    await att(hr).put(`/leave/types/${T.MANAGER.id}`, { name: T.MANAGER.name, annualDays: 300, approval: 'MANAGER', handOnAfterDays: 1 }).expect(200);
    try {
      const r = await ask(tara, T.MANAGER);
      await inTenant(() => peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } }));
      await runLeaveHandOns(new Date());
      const handed = (await engineOf(r.id))!.steps.find((s) => s.status === 'WAITING')!;
      expect(handed.resolvedHow).toBe('HANDED_ON');
      const to = (handed.candidateUserIds as string[]).slice().sort();
      expect(to).toEqual(expect.arrayContaining([kavya.userId]));
      await inTenant(() => refreshLeaveSteps(hr.accountId, hr.orgId));
      const after = (await engineOf(r.id))!.steps.find((s) => s.status === 'WAITING')!;
      expect(after.resolvedHow).toBe('HANDED_ON');
      expect((after.candidateUserIds as string[]).slice().sort()).toEqual(to);
      /* The leave rejected another way (an older API): the refresh closes its request, and tells nobody again. */
      await inTenant(() => peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', reviewedByUserId: kavya.userId } }));
      const before = (await notices(r.id)).length;
      await inTenant(() => refreshLeaveSteps(hr.accountId, hr.orgId));
      expect((await engineOf(r.id))?.status).toBe('REJECTED');
      expect((await notices(r.id)).length).toBe(before);
    } finally {
      await att(hr).put(`/leave/types/${T.MANAGER.id}`, { name: T.MANAGER.name, annualDays: 300, approval: 'MANAGER', handOnAfterDays: null }).expect(200);
    }
  }, 60_000);

  it('approved at once but refused by the leave: no decision record or self-approval line is left behind', async () => {
    const c = await owner();
    const me = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(c.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId } });
      await peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, leaveOnEngine: true }, update: { leaveOnEngine: true } });
    });
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const day = addDays(todayIst(), 40);
    await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: me.id, date: day, status: 'PRESENT', checkIn: new Date(`${day}T04:00:00Z`), source: 'MANUAL', createdByUserId: c.userId } as any }));
    const asked = await request(app).post(`/api/orgs/${c.orgId}/attendance/me/leave`).set(at(c)).send({ leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Rest' }).expect(201);
    expect(asked.body.request.status).toBe('PENDING');
    await runInTenant(c.orgId, async () => {
      expect(await peoplePrisma.approvalRequest.count({ where: { orgId: c.orgId } })).toBe(0);
      expect(await peoplePrisma.decisionRecord.count({ where: { orgId: c.orgId } })).toBe(0);
    });
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'SELF_APPROVED' } })).toBe(0);
  }, 60_000);
});

describe('the type’s own auto-approval, on the engine', () => {
  beforeAll(() => switchOn());
  it('is in the presets’ rule, approves the person’s own short leave at once (written AUTO_APPROVED), and never one HR enters for them', async () => {
    const quick = (await att(hr).post('/leave/types', { name: `Quick ${rnd()}`, annualDays: 30 }).expect(201)).body.type;
    await att(hr).put(`/leave/types/${quick.id}`, { name: quick.name, annualDays: 30, approval: 'MANAGER', autoApproveUpToDays: 1 }).expect(200);
    const own = await ask(tara, quick);
    expect(own.status).toBe('APPROVED');
    const e = await engineOf(own.id);
    expect(e?.status).toBe('APPROVED');
    expect(e?.steps.map((s) => s.resolvedHow)).toEqual(['AUTO_APPROVED']);
    const row = await leaveRow(own.id);
    expect(row.autoApproved).toBe(true);
    expect(row.reviewedByUserId).toBe('system');
    const preset = await inTenant(() => peoplePrisma.approvalRule.findFirst({ where: { orgId: hr.orgId, requestType: 'LEAVE', variantKey: 'preset:MANAGER', active: true } }));
    expect(JSON.stringify(preset?.autoApprove)).toContain(quick.id);
    const day = nextDay();
    const entered = (await att(kavya).post('/leave/requests', { employeeId: E.tara.id, leaveTypeId: quick.id, fromDate: day, toDate: day, reason: 'Entered' }).expect(201)).body.request;
    expect(entered.status).toBe('PENDING');
    expect((await engineOf(entered.id))?.status).toBe('WAITING');
    for (const id of [own.id, entered.id]) await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
  }, 60_000);
});

describe('reminders and the leave rule’s hand-on, from the engine’s dues job', () => {
  beforeAll(() => switchOn());
  it('a step past due reminds its people once; the leave rule’s step hands on a day after the reminder', async () => {
    const r = await ask(tara, T.HR);
    const step = (await engineOf(r.id))!.steps.find((s) => s.status === 'WAITING')!;
    await inTenant(() => peoplePrisma.approvalStep.update({ where: { id: step.id }, data: { dueAt: new Date(Date.now() - 3_600_000) } }));
    await runApprovalDues(new Date());
    const reminded = await inTenant(() => peoplePrisma.approvalStep.findUniqueOrThrow({ where: { id: step.id } }));
    expect(reminded.remindedAt).not.toBeNull();
    const overdue = (await inTenant(() => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, subjectKey: `leave:${r.id}` } }))).filter((n) => n.title.startsWith('Overdue'));
    expect(overdue.map((n) => n.userId).sort()).toEqual([hr.userId, kavya.userId, meena.userId, ravi.userId].sort());
    await runApprovalDues(new Date());
    expect((await inTenant(() => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, subjectKey: `leave:${r.id}` } }))).filter((n) => n.title.startsWith('Overdue'))).toHaveLength(overdue.length);
    await att(hr).post(`/leave/requests/${r.id}/cancel`).expect(200);

    /* The leave rule: Kavya by name, handed on to HR when late. */
    await people(hr).post('/approval-rules', { requestType: 'LEAVE', name: 'Leave', steps: [{ approver: { kind: 'USER', id: kavya.userId }, dueDays: 1, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } }] }).expect(201);
    const ruled = (await att(hr).post('/leave/types', { name: `Ruled ${rnd()}`, annualDays: 30 }).expect(201)).body.type;
    await att(hr).put(`/leave/types/${ruled.id}`, { name: ruled.name, annualDays: 30, approval: 'RULE' }).expect(200);
    const x = await ask(tara, ruled);
    expect(await waitingOn(x.id)).toEqual([kavya.userId]);
    expect((await leaveRow(x.id)).ruleId).toBeNull();
    const s1 = (await engineOf(x.id))!.steps.find((s) => s.status === 'WAITING')!;
    await inTenant(() => peoplePrisma.approvalStep.update({ where: { id: s1.id }, data: { dueAt: new Date(Date.now() - 3 * 86_400_000), remindedAt: new Date(Date.now() - 2 * 86_400_000) } }));
    await runApprovalDues(new Date());
    const handed = (await engineOf(x.id))!.steps.find((s) => s.status === 'WAITING')!;
    expect(handed.resolvedHow).toBe('HANDED_ON');
    expect((handed.candidateUserIds as string[]).sort()).toEqual([hr.userId, kavya.userId].sort());
    expect(JSON.stringify((await leaveRow(x.id)).history)).toContain('handed on');
    expect((await att(hr).post(`/leave/requests/${x.id}/approve`, {})).status).toBe(200);
  }, 90_000);
});

describe('what people see', () => {
  beforeAll(() => switchOn());
  it('the drawer shows the steps in plain words; the employee app says who has it', async () => {
    const r = await ask(tara, T.MANAGER_THEN_HR);
    const d1 = (await att(kavya).get(`/leave/requests/${r.id}`).expect(200)).body.step;
    expect(d1).toMatchObject({ engine: true, current: 1, yours: false });
    expect(d1.timeline.map((t: any) => t.text)).toEqual(['Waiting for Ravi (manager)']);
    const company = (await att(hr).get('/portal-access').expect(200)).body.company.code;
    const code = (await att(hr).post('/portal-access/codes', { employeeIds: [E.tara.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company, employeeCode: 'K-4', activationCode: code, password: 'app pass 123' }).expect(200)).body.token;
    /* Under TEST_TODAY the clock moves but PostgreSQL's now() does not: the app session starts at the test's own "now". */
    await inTenant(() => peoplePrisma.portalSession.updateMany({ where: { orgId: hr.orgId }, data: { createdAt: new Date(), lastSeenAt: new Date() } }));
    const mine = async () => (await request(app).get(`/api/portal/leave?year=${r.fromDate.slice(0, 4)}`).set('Authorization', `Bearer ${token}`).expect(200)).body.requests.find((x: any) => x.id === r.id);
    expect((await mine()).withWhom).toBe('With Ravi (your manager)');
    await att(ravi).post(`/leave/requests/${r.id}/approve`, { note: 'Fine' }).expect(200);
    expect((await mine()).withWhom).toBe('With HR');
    const d2 = (await att(kavya).get(`/leave/requests/${r.id}`).expect(200)).body.step;
    expect(d2.yours).toBe(true);
    expect(d2.timeline.map((t: any) => t.text)).toEqual(['Ravi (manager) approved', expect.stringMatching(/ \(HR\)$/)]);
    await att(kavya).post(`/leave/requests/${r.id}/approve`, {}).expect(200);
    const d3 = (await att(kavya).get(`/leave/requests/${r.id}`).expect(200)).body.step;
    expect(d3.timeline.map((t: any) => t.text)).toEqual(['Ravi (manager) approved', 'Kavya (HR) approved']);
    expect((await mine()).withWhom).toBeNull();
  }, 60_000);
});

describe('review of PR #104', () => {
  beforeAll(() => switchOn());

  it('the public API takes no step of leave on the approval rules: a chain’s or the leave rule’s, 409, and the leave keeps waiting', async () => {
    const approver = (await att(hr).post('/integrations/keys', { name: `Key ${rnd()}`, scopes: ['leave:approve'] }).expect(201)).body.token;
    await people(hr).post('/approval-rules', { requestType: 'LEAVE', name: 'Leave', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }, { approver: { kind: 'USER', id: kavya.userId }, dueDays: 2 }] }).expect(201);
    const ruled = (await att(hr).post('/leave/types', { name: `Ruled ${rnd()}`, annualDays: 30 }).expect(201)).body.type;
    await att(hr).put(`/leave/types/${ruled.id}`, { name: ruled.name, annualDays: 30, approval: 'RULE' }).expect(200);
    for (const type of [T.MANAGER_THEN_HR, ruled]) {
      const r = await ask(tara, type);
      for (const what of ['approve', 'reject']) {
        const out = await request(app).post(`/v1/leave/requests/${r.id}/${what}`).set('Authorization', `Bearer ${approver}`).send({ note: 'From the API' });
        expect(out.status).toBe(409);
      }
      expect((await leaveRow(r.id)).status).toBe('PENDING');
      expect((await engineOf(r.id))?.status).toBe('WAITING');
      await att(hr).post(`/leave/requests/${r.id}/cancel`).expect(200);
    }
  }, 60_000);

  it('HR’s own leave for today approved moves nothing: only the leave someone decides as a manager is worked out again', async () => {
    const r = await ask(tara, T.HR);
    const step = (await engineOf(r.id))!.steps.find((x) => x.status === 'WAITING')!;
    /* Written stale on purpose: a refresh would put the real people back. */
    await inTenant(() => peoplePrisma.approvalStep.update({ where: { id: step.id }, data: { candidateUserIds: [kavya.userId] } }));
    const own = await ask(kavya, T.HR, todayIst());
    await att(hr).post(`/leave/requests/${own.id}/approve`, {}).expect(200);
    await new Promise((done) => setTimeout(done, 1500));
    expect(await waitingOn(r.id)).toEqual([kavya.userId]);
    for (const id of [own.id, r.id]) await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
  }, 60_000);

  it('the drawer: HR sees reject only while the manager decides, nothing on a leave rule step that is not theirs; the stand-in is marked, not the manager', async () => {
    const r = await ask(tara, T.MANAGER_THEN_HR);
    const asHr = (await att(kavya).get(`/leave/requests/${r.id}`).expect(200)).body.step;
    expect(asHr).toMatchObject({ yours: false, mayReject: true });
    expect((await att(ravi).get(`/leave/requests/${r.id}`).expect(200)).body.step).toMatchObject({ yours: true, mayReject: false });
    await att(ravi).post(`/leave/requests/${r.id}/approve`, {}).expect(200);
    const after = (await att(kavya).get(`/leave/requests/${r.id}`).expect(200)).body.step;
    expect(after.timeline[0].text).toBe('Ravi (manager) approved');
    await att(hr).post(`/leave/requests/${r.id}/cancel`).expect(200);
    /* A stand-in named, who decides: marked as standing in. */
    const standIn = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: E.ravi.id, standInEmployeeId: E.meena.id, fromDate: todayIst(), toDate: addDays(todayIst(), 1) }).expect(201)).body.standIn;
    try {
      const x = await ask(tara, T.MANAGER_THEN_HR);
      await att(meena).post(`/leave/requests/${x.id}/approve`, {}).expect(200);
      expect((await att(kavya).get(`/leave/requests/${x.id}`).expect(200)).body.step.timeline[0].text).toBe('Meena (standing in) approved');
      const y = await ask(tara, T.MANAGER_THEN_HR);
      await att(ravi).post(`/leave/requests/${y.id}/approve`, {}).expect(200);
      expect((await att(kavya).get(`/leave/requests/${y.id}`).expect(200)).body.step.timeline[0].text).toBe('Ravi (manager) approved');
      for (const id of [x.id, y.id]) await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
    } finally {
      await att(hr).del(`/leave/stand-ins/${standIn.id}`).expect(200);
    }
  }, 60_000);
});
