import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.7, 4.8, 4.9):
 *  - no-dues sign-off on a leaving: lines per department, assets from the register, money found by
 *    accounts, signed by the owner or HR (once), the final-pay clock and the absconding hold;
 *  - exit interviews: filled in the app once, hidden from the manager, entered by HR, retained;
 *  - birthdays, anniversaries, the wish nudge and the holiday heads-up, with the opt-out;
 *  - ready-made automations: switches, numbers, what is managed elsewhere, the old jobs gated, runs once.
 * Each with the allowed path, the refusal, another company, another role and the races that matter.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runCompany, startEngagement } = await import('../services/people/engagement/index.js');
const { leaveEmployee } = await import('../services/people/lifecycle/leaving.js');
const { eraseExpiredAnswers } = await import('../services/people/engagement/exitInterview.js');
const { mailOnce, listAutomations, inSendingHours, mayRunNow } = await import('../services/people/engagement/automations.js');
const { sendTemplate } = await import('../services/mailer.js');
const { dayThisYear, sameTeam } = await import('../services/people/engagement/greetings.js');
const { runEndDateReminders } = await import('../services/people/documentReminders.js');
const { registeredJobs } = await import('../services/jobRegistry.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId?: string; userId?: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `leave.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Leave Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } });
  c.accountId = org!.accountId;
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
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, accountId: boss.accountId, userId: user.body.user.id, email };
}
const ppl = (c: Ctx, m: 'get' | 'post' | 'put' | 'patch' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
const inTenant = <T>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function portalOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
  const issued = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
    put: (p: string, b: unknown = {}) => request(app).put(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
}

describe('the pieces themselves', () => {
  it('29 February falls on 28 February in a year without one; the year of birth is never part of the day', () => {
    expect(dayThisYear('1992-02-29', 2027)).toBe('2027-02-28');
    expect(dayThisYear('1992-02-29', 2028)).toBe('2028-02-29');
    expect(dayThisYear('1985-11-03', 2026)).toBe('2026-11-03');
  });

  it('a small company hears about everyone; a bigger one only the department and the reporting line', () => {
    const a = { id: 'a', departmentId: 'd1', reportingManagerId: 'm' };
    expect(sameTeam(a, { id: 'b', departmentId: 'd2', reportingManagerId: 'x' }, 12)).toBe(true);
    expect(sameTeam(a, { id: 'b', departmentId: 'd2', reportingManagerId: 'x' }, 40)).toBe(false);
    expect(sameTeam(a, { id: 'b', departmentId: 'd1', reportingManagerId: 'x' }, 40)).toBe(true);
    expect(sameTeam(a, { id: 'm', departmentId: null, reportingManagerId: null }, 40)).toBe(true);
    expect(sameTeam(a, { id: 'c', departmentId: null, reportingManagerId: 'm' }, 40)).toBe(true);
  });

  it('the jobs are registered, so the wake call runs them', () => {
    const stop = startEngagement();
    expect(registeredJobs()).toEqual(expect.arrayContaining(['startPeopleAutomations', 'startExitAnswerErase']));
    stop();
  });
});

describe('no-dues sign-off and the final-pay clock (4.3)', () => {
  let c: Ctx;
  let other: Ctx;
  let mgr: Ctx;
  let leaver: any;
  let lead: any;
  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Mina Lead');
    lead = await person(c, { name: 'Mina Lead', code: `L-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    leaver = await person(c, { name: 'Ravi Kumar', code: `R-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: leaver.id }, data: { reportingManagerId: lead.id } }));
    await ppl(c, 'post', '/workspace/assets', { title: 'Laptop', status: 'ASSIGNED', employeeId: leaver.id, details: { assetTag: 'LT-07' } }).expect(201);
    await inTenant(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: leaver.id, number: `ADV-${rnd()}`, purpose: 'Site visit', amount: 5000, status: 'PAID', settledAmount: 1000 } }));
    await ppl(c, 'post', `/employees/${leaver.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
  }, 180_000);

  it('a leaving gets one line per department: the handover, what they hold, ID and keys, and the money accounts found', async () => {
    const r = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    expect(r.clearance.lines.map((l: any) => l.dept)).toEqual(['MANAGER', 'IT', 'ADMIN', 'FINANCE']);
    const it = r.clearance.lines.find((l: any) => l.dept === 'IT');
    expect(it.items).toEqual([expect.objectContaining({ title: 'Laptop', tag: 'LT-07', returned: false })]);
    const fin = r.clearance.lines.find((l: any) => l.dept === 'FINANCE');
    expect(fin).toMatchObject({ direction: 'OWES', amount: 4000 });
    expect(fin.note).toMatch(/Advance .*₹4,000/);
    expect(r.clearance.lines.find((l: any) => l.dept === 'MANAGER').ownerUserId).toBe(mgr.userId);
    expect(r.finalPay).toMatchObject({ lastDay: plus(istToday(), 10), started: false, paid: false, held: null });
    expect(r.finalPay.dueDate > r.finalPay.lastDay).toBe(true);
    expect(r.finalPay.rule).toMatch(/s\.17\(2\)/);
    expect(r.canEdit).toBe(true);
    /* Read again: still one set. */
    expect((await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body.clearance.lines).toHaveLength(4);
  });

  it('two first reads at once make one set of lines', async () => {
    const twin = await person(c, { name: 'Twin Read', code: `T-${rnd()}` });
    await ppl(c, 'post', `/employees/${twin.id}/resign`, { lastDay: plus(istToday(), 12), leavingType: 'RESIGNED' }).expect(200);
    await Promise.all([ppl(c, 'get', `/leaving/${twin.id}`), ppl(c, 'get', `/leaving/${twin.id}`), ppl(c, 'get', `/leaving/${twin.id}`)]);
    expect(await inTenant(c, () => peoplePrisma.clearanceLine.count({ where: { orgId: c.orgId, employeeId: twin.id } }))).toBe(4);
  });

  it('the manager signs their own line, not IT’s; signing twice is refused', async () => {
    const r = (await ppl(mgr, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    expect(r.canEdit).toBe(false);
    const mine = r.clearance.lines.find((l: any) => l.dept === 'MANAGER');
    const its = r.clearance.lines.find((l: any) => l.dept === 'IT');
    expect(mine.canSign).toBe(true);
    expect(its.canSign).toBe(false);
    /* A manager does not see accounts' findings. */
    expect(r.clearance.found).toBeNull();
    await ppl(mgr, 'patch', `/clearance-lines/${its.id}`, { sign: true }).expect(403);
    const signed = (await ppl(mgr, 'patch', `/clearance-lines/${mine.id}`, { sign: true, note: 'Handed to Asha' }).expect(200)).body.line;
    expect(signed).toMatchObject({ status: 'CLEAR', signedByUserId: mgr.userId, note: 'Handed to Asha' });
    expect((await ppl(mgr, 'patch', `/clearance-lines/${mine.id}`, { sign: true }).expect(409)).body.code).toBe('SIGNED');
    /* Only HR opens it again. */
    await ppl(mgr, 'patch', `/clearance-lines/${mine.id}`, { sign: false }).expect(403);
    await ppl(mgr, 'patch', `/clearance-lines/${its.id}`, { ownerUserId: mgr.userId }).expect(403);
  });

  it('two sign-offs at once: one signs, the other is told', async () => {
    const r = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    const admin = r.clearance.lines.find((l: any) => l.dept === 'ADMIN');
    const out = await Promise.all([ppl(c, 'patch', `/clearance-lines/${admin.id}`, { sign: true }), ppl(c, 'patch', `/clearance-lines/${admin.id}`, { sign: true })]);
    expect(out.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  it('IT ticks the laptop back: the register says Returned too; a stale change is refused', async () => {
    const r = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    const it = r.clearance.lines.find((l: any) => l.dept === 'IT');
    await ppl(c, 'patch', `/clearance-lines/${it.id}`, { items: it.items.map((i: any) => ({ ...i, returned: true })), seenAt: it.updatedAt }).expect(200);
    const asset = await inTenant(c, () => peoplePrisma.peopleRecord.findFirst({ where: { orgId: c.orgId, kind: 'assets', employeeId: leaver.id } }));
    expect(asset!.status).toBe('RETURNED');
    /* The plan's own "Return Laptop" step is the same fact, ticked with it. */
    const step = await inTenant(c, () => peoplePrisma.checklistTask.findFirst({ where: { orgId: c.orgId, employeeId: leaver.id, kind: 'LEAVING', title: { startsWith: 'Return Laptop' } } }));
    if (step) expect(step.doneAt).not.toBeNull();
    expect((await ppl(c, 'patch', `/clearance-lines/${it.id}`, { note: 'old view', seenAt: it.updatedAt }).expect(409)).body.code).toBe('STALE');
  });

  it('money: owed needs an amount; who owes whom is saved with it', async () => {
    const r = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    const fin = r.clearance.lines.find((l: any) => l.dept === 'FINANCE');
    await ppl(c, 'patch', `/clearance-lines/${fin.id}`, { direction: 'OWED', amount: 0 }).expect(400);
    await ppl(c, 'patch', `/clearance-lines/${fin.id}`, { direction: 'OWED', amount: -5 }).expect(400);
    const ok = (await ppl(c, 'patch', `/clearance-lines/${fin.id}`, { direction: 'OWED', amount: 1250.5 }).expect(200)).body.line;
    expect(ok).toMatchObject({ direction: 'OWED' });
    expect(Number(ok.amount)).toBe(1250.5);
    const again = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    expect(again.clearance.totals).toMatchObject({ owed: 1250.5 });
  });

  it('HR adds and removes a line of the company’s own; a manager may not; a duplicate name is refused', async () => {
    await ppl(mgr, 'post', `/leaving/${leaver.id}/clearance-lines`, { label: 'Library books' }).expect(403);
    const line = (await ppl(c, 'post', `/leaving/${leaver.id}/clearance-lines`, { label: 'Library books' }).expect(201)).body.line;
    expect((await ppl(c, 'post', `/leaving/${leaver.id}/clearance-lines`, { label: 'Library books' }).expect(409)).body.code).toBe('DUPLICATE');
    await ppl(mgr, 'delete', `/clearance-lines/${line.id}`).expect(403);
    await ppl(c, 'delete', `/clearance-lines/${line.id}`).expect(200);
    const r = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    await ppl(c, 'delete', `/clearance-lines/${r.clearance.lines[0].id}`).expect(409);
  });

  it('another company sees nothing and changes nothing', async () => {
    await ppl(other, 'get', `/leaving/${leaver.id}`).expect(404);
    const r = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body;
    await ppl(other, 'patch', `/clearance-lines/${r.clearance.lines[3].id}`, { sign: true }).expect(404);
    expect((await ppl(other, 'get', '/final-pay').expect(200)).body.rows).toEqual([]);
  });

  it('from the last day, Home shows final pay due; a hold shows as held; paid drops off', async () => {
    const gone = await person(c, { name: 'Gone Yesterday', code: `G-${rnd()}` });
    await ppl(c, 'post', `/employees/${gone.id}/resign`, { lastDay: plus(istToday(), -1), leavingType: 'RESIGNED' }).expect(200);
    let rows = (await ppl(c, 'get', '/final-pay').expect(200)).body.rows;
    const mine = rows.find((r: any) => r.employeeId === gone.id);
    expect(mine).toMatchObject({ name: 'Gone Yesterday', lastDay: plus(istToday(), -1), started: true, paid: false, held: null, settlement: null });
    /* The leaver ten days out is not on Home yet. */
    expect(rows.some((r: any) => r.employeeId === leaver.id)).toBe(false);
    await inTenant(c, () => peoplePrisma.absenceCase.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: gone.id, fromDate: plus(istToday(), -9), lastAbsentDate: plus(istToday(), -2), days: 6, status: 'ABSCONDED', holdReason: 'No contact since notice 2', heldAt: new Date(), heldByUserId: 'u' } }));
    rows = (await ppl(c, 'get', '/final-pay').expect(200)).body.rows;
    expect(rows.find((r: any) => r.employeeId === gone.id).held).toMatchObject({ reason: 'No contact since notice 2' });
    /* Payroll's settlement, once paid, takes it off Home; its due date is the one shown before that. */
    const s = await inTenant(c, () => payrollPrisma.finalSettlement.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: gone.id, leavingDate: plus(istToday(), -1), dueDate: plus(istToday(), 1), createdByUserId: 'u' } }));
    rows = (await ppl(c, 'get', '/final-pay').expect(200)).body.rows;
    expect(rows.find((r: any) => r.employeeId === gone.id)).toMatchObject({ dueDate: plus(istToday(), 1), settlement: { id: s.id, status: 'DRAFT' } });
    await inTenant(c, () => payrollPrisma.finalSettlement.update({ where: { id: s.id }, data: { status: 'PAID', paidAt: new Date() } }));
    rows = (await ppl(c, 'get', '/final-pay').expect(200)).body.rows;
    expect(rows.some((r: any) => r.employeeId === gone.id)).toBe(false);
  });
});

describe('exit interviews (4.9)', () => {
  let c: Ctx;
  let other: Ctx;
  let mgr: Ctx;
  let leaver: any;
  let lead: any;
  let app1: Awaited<ReturnType<typeof portalOf>>;
  const answers = { reason: 'GROWTH', comeBack: 'MAYBE', keptYou: 'A clear path to team lead', liked: 'The people', toOwner: 'Thank you' };
  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Kiran Lead');
    lead = await person(c, { name: 'Kiran Lead', code: `K-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    leaver = await person(c, { name: 'Asha Rao', code: `A-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: leaver.id }, data: { reportingManagerId: lead.id } }));
    await ppl(c, 'post', `/employees/${leaver.id}/resign`, { lastDay: plus(istToday(), 14), leavingType: 'RESIGNED' }).expect(200);
    app1 = await portalOf(c, leaver);
  }, 180_000);

  it('someone not leaving has no interview', async () => {
    const stayer = await person(c, { name: 'Stays Here', code: `S-${rnd()}` });
    const p = await portalOf(c, stayer);
    expect((await p.get('/people/engage/exit-interview').expect(200)).body.interview).toBeNull();
    await p.post('/people/engage/exit-interview', { answers }).expect(404);
  });

  it('the leaver sees five questions and why they are asked; a choice must be answered', async () => {
    const i = (await app1.get('/people/engage/exit-interview').expect(200)).body.interview;
    expect(i.questions).toHaveLength(5);
    expect(i.questions[0]).toMatchObject({ key: 'reason', kind: 'REASON' });
    expect(i.purpose).toMatch(/kept for 24 months/);
    expect(i.status).toBe('OPEN');
    expect(i.dueBy).toBe(plus(istToday(), 12));
    expect(i.lastDay).toBe(plus(istToday(), 14));
    expect((await app1.post('/people/engage/exit-interview', { answers: { ...answers, reason: '' } }).expect(400)).body.error).toMatch(/main reason/);
    await app1.post('/people/engage/exit-interview', { answers: { ...answers, reason: 'NOT_A_CODE' } }).expect(400);
  });

  it('sent once from the phone: two taps at once keep one; the plan step ticks itself; HR is told', async () => {
    await inTenant(c, () => peoplePrisma.checklistTask.updateMany({ where: { orgId: c.orgId, employeeId: leaver.id }, data: {} }));
    const out = await Promise.all([app1.post('/people/engage/exit-interview', { answers, hideFromManager: true }), app1.post('/people/engage/exit-interview', { answers, hideFromManager: true })]);
    expect(out.map((r) => r.status).sort()).toEqual([200, 409]);
    const i = (await app1.get('/people/engage/exit-interview').expect(200)).body.interview;
    expect(i).toMatchObject({ status: 'SUBMITTED', reason: 'GROWTH', hideFromManager: true, enteredBy: 'EMPLOYEE' });
    const task = await inTenant(c, () => peoplePrisma.checklistTask.findFirst({ where: { orgId: c.orgId, employeeId: leaver.id, kind: 'LEAVING', title: 'Exit interview' } }));
    if (task) expect(task.doneAt).not.toBeNull();
    const bell = await inTenant(c, () => platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.exit_interview' } }));
    expect(bell).toBeGreaterThan(0);
  });

  it('hidden from the manager: they see that it was sent, not the answers; HR reads everything', async () => {
    const m = (await ppl(mgr, 'get', `/leaving/${leaver.id}`).expect(200)).body.interview;
    expect(m).toMatchObject({ status: 'SUBMITTED', hiddenFromYou: true, answers: null, canDecide: false });
    const h = (await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200)).body.interview;
    expect(h.answers).toMatchObject({ reason: 'GROWTH', keptYou: 'A clear path to team lead' });
    expect(h.canDecide).toBe(true);
  });

  it('HR enters one from a conversation; a manager may not; nor another company', async () => {
    const second = await person(c, { name: 'Dev Shah', code: `D-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: second.id }, data: { reportingManagerId: lead.id } }));
    await ppl(c, 'post', `/employees/${second.id}/resign`, { lastDay: plus(istToday(), -3), leavingType: 'RESIGNED' }).expect(200);
    await ppl(mgr, 'post', `/leaving/${second.id}/exit-interview`, { answers }).expect(403);
    await ppl(other, 'post', `/leaving/${second.id}/exit-interview`, { answers }).expect(404);
    const i = (await ppl(c, 'post', `/leaving/${second.id}/exit-interview`, { answers: { ...answers, reason: 'PAY' } }).expect(200)).body.interview;
    expect(i).toMatchObject({ status: 'SUBMITTED', enteredBy: 'HR', reason: 'PAY' });
    /* Not hidden: the manager reads it. */
    expect((await ppl(mgr, 'get', `/leaving/${second.id}`).expect(200)).body.interview.answers.reason).toBe('PAY');
    /* Already left: "retained" is refused, nothing is half-done. */
    expect((await ppl(c, 'post', `/leaving/${second.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(409)).body.code).toBe('LEFT');
    const after = (await ppl(c, 'get', `/leaving/${second.id}`).expect(200)).body.interview;
    expect(after.outcome).toBeNull();
  });

  it('retained withdraws the leaving through stay-on; deciding twice is refused; a manager may not decide', async () => {
    await ppl(mgr, 'post', `/leaving/${leaver.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(403);
    await ppl(c, 'post', `/leaving/${leaver.id}/exit-interview/outcome`, { couldKeep: 'YES', note: 'Offered the lead role' }).expect(200);
    const out = await Promise.all([
      ppl(c, 'post', `/leaving/${leaver.id}/exit-interview/outcome`, { outcome: 'RETAINED', note: 'Offered the lead role' }),
      ppl(c, 'post', `/leaving/${leaver.id}/exit-interview/outcome`, { outcome: 'EXIT_CONFIRMED' }),
    ]);
    expect(out.map((r) => r.status).sort()).toEqual([200, 409]);
    const won = out.find((r) => r.status === 200)!.body.interview.outcome;
    const e = await inTenant(c, () => peoplePrisma.employee.findUnique({ where: { id: leaver.id } }));
    expect(e!.status).toBe(won === 'RETAINED' ? 'ACTIVE' : 'ON_NOTICE');
  });

  it('the People report counts leavers by month and reason', async () => {
    const r = (await ppl(c, 'get', '/reports/leaving-reasons').expect(200)).body;
    /* Twelve months back, and up to three ahead for people already on notice. */
    expect(r.months.length).toBeGreaterThanOrEqual(12);
    expect(r.months.length).toBeLessThanOrEqual(15);
    const total = r.months.reduce((t: number, m: any) => t + m.answered, 0);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(r.reasons.find((x: any) => x.code === 'PAY')).toMatchObject({ label: 'Better pay elsewhere', count: 1 });
    expect((await ppl(other, 'get', '/reports/leaving-reasons').expect(200)).body.reasons).toEqual([]);
  });

  it('HR edits the questions; one must give the main reason; a manager may not', async () => {
    const q = (await ppl(c, 'get', '/exit-questions').expect(200)).body;
    expect(q).toMatchObject({ custom: false, keepMonths: 24, canEdit: true });
    await ppl(mgr, 'put', '/exit-questions', { questions: q.questions, keepMonths: 12 }).expect(403);
    expect((await ppl(c, 'put', '/exit-questions', { questions: q.questions.filter((x: any) => x.kind !== 'REASON'), keepMonths: 12 }).expect(400)).body.error).toMatch(/main reason/);
    const saved = (await ppl(c, 'put', '/exit-questions', { questions: [...q.questions.slice(0, 2), { key: 'notice', text: 'Was your notice period fair?', kind: 'TEXT' }], keepMonths: 12 }).expect(200)).body;
    expect(saved).toMatchObject({ custom: true, keepMonths: 12 });
    expect(saved.questions).toHaveLength(3);
    /* Another company keeps CLOR's five. */
    expect((await ppl(other, 'get', '/exit-questions').expect(200)).body.questions).toHaveLength(5);
    expect((await ppl(c, 'delete', '/exit-questions').expect(200)).body.custom).toBe(false);
  });

  it('answers past the keeping period are erased; the reason stays for the report', async () => {
    await inTenant(c, () => peoplePrisma.exitInterview.updateMany({ where: { orgId: c.orgId, employeeId: leaver.id }, data: { keepUntil: '2020-01-01' } }));
    expect(await eraseExpiredAnswers()).toBeGreaterThanOrEqual(1);
    const row = await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: leaver.id } }));
    expect(row!.answers).toEqual({});
    expect(row!.reason).toBe('GROWTH');
    expect(row!.erasedAt).not.toBeNull();
  });
});

describe('birthdays, anniversaries and the holiday heads-up (4.8)', () => {
  let c: Ctx;
  let mgr: Ctx;
  let lead: any;
  let bday: any;
  let shy: any;
  let mate: any;
  let elsewhere: any;
  const today = istToday();
  const yearsHere = today.slice(5) === '02-29' ? 4 : 2;
  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Neha Lead');
    /* Everyone else joined on a day that is never today's date: the default 2024-01-01 made extra anniversaries every 1 January. */
    const joined = plus(today, -400);
    lead = await person(c, { name: 'Neha Lead', code: `N-${rnd()}`, dateOfJoining: joined });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    /* Born in a leap year, so 29 February 2028 is a real birthday; joined 2 years ago today (4 on 29 February, the last one). */
    bday = await person(c, { name: 'Ravi Kumar', code: `R-${rnd()}`, dateOfBirth: `1992-${today.slice(5)}`, dateOfJoining: `${Number(today.slice(0, 4)) - yearsHere}-${today.slice(5)}` });
    shy = await person(c, { name: 'Quiet Person', code: `Q-${rnd()}`, dateOfBirth: `1988-${today.slice(5)}`, dateOfJoining: joined });
    mate = await person(c, { name: 'Team Mate', code: `M-${rnd()}`, dateOfJoining: joined });
    const branch = await inTenant(c, () => peoplePrisma.employee.findFirst({ where: { id: mate.id } }));
    elsewhere = await person(c, { name: 'Other Branch', code: `O-${rnd()}`, dateOfJoining: joined });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: elsewhere.id }, data: { branchId: `elsewhere-${rnd()}` } }));
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: bday.id }, data: { reportingManagerId: lead.id } }));
    /* A branch holiday tomorrow for the team's branch only, and a company one. */
    await inTenant(c, () => peoplePrisma.holiday.create({ data: { accountId: c.accountId!, orgId: c.orgId, date: plus(today, 1), name: 'Local festival', branchId: branch!.branchId, createdByUserId: 'u' } }));
  }, 180_000);

  it('a person opts out in the app; they leave Home’s list too', async () => {
    const p = await portalOf(c, shy);
    expect((await p.get('/people/engage/celebrations').expect(200)).body.optedOut).toBe(false);
    await p.put('/people/engage/celebrations', { optedOut: true }).expect(200);
    await p.put('/people/engage/celebrations', { optedOut: true }).expect(200);
    expect((await p.get('/people/engage/celebrations').expect(200)).body.optedOut).toBe(true);
    const o = (await ppl(c, 'get', '/overview').expect(200)).body;
    expect(o.upcomingBirthdays.some((b: any) => b.id === shy.id)).toBe(false);
    expect(o.upcomingBirthdays.some((b: any) => b.id === bday.id)).toBe(true);
    expect(o.celebrationOptOuts).toContain(shy.id);
  });

  it('nothing is posted while the recipes are off (the default)', async () => {
    expect(await inTenant(c, () => runCompany(c.accountId!, c.orgId))).toEqual({});
    expect(await inTenant(c, () => peoplePrisma.greetingPost.count({ where: { orgId: c.orgId } }))).toBe(0);
  });

  it('switched on, the morning posts once, with no year; the manager is nudged; a run beside it sends nothing more', async () => {
    await ppl(c, 'put', '/automations', { automations: { birthdays: { on: true }, anniversaries: { on: true }, wishNudge: { on: true }, holidayHeadsUp: { on: true } } }).expect(200);
    const [a, b] = await Promise.all([inTenant(c, () => runCompany(c.accountId!, c.orgId)), inTenant(c, () => runCompany(c.accountId!, c.orgId))]);
    expect(Object.keys({ ...a, ...b }).sort()).toEqual(['anniversaries', 'birthdays', 'holidayHeadsUp', 'wishNudge']);
    const posts = await inTenant(c, () => peoplePrisma.greetingPost.findMany({ where: { orgId: c.orgId } }));
    expect(posts.map((p) => p.kind).sort()).toEqual(['ANNIVERSARY', 'BIRTHDAY', 'HOLIDAY']);
    expect(posts.some((p) => p.employeeId === shy.id)).toBe(false);
    expect(posts.find((p) => p.kind === 'BIRTHDAY')!.text).toBe('Ravi Kumar’s birthday today');
    expect(posts.every((p) => !/19\d\d/.test(p.text))).toBe(true);
    expect(posts.find((p) => p.kind === 'ANNIVERSARY')!.text).toMatch(new RegExp(`${yearsHere === 2 ? '2nd' : '4th'} work anniversary`));
    const wish = await inTenant(c, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: mgr.userId!, kind: 'people.wish' } }));
    expect(wish).toHaveLength(1);
    expect(wish[0].title).toMatch(new RegExp(`Wish Ravi a happy birthday and Ravi on ${yearsHere} years here today`));
    /* A second morning run the same day finds every recipe claimed. */
    expect(await inTenant(c, () => runCompany(c.accountId!, c.orgId))).toEqual({});
    expect(await inTenant(c, () => peoplePrisma.greetingPost.count({ where: { orgId: c.orgId } }))).toBe(3);
  });

  it('the app shows a teammate today’s news; the birthday person a greeting; the branch holiday only to that branch', async () => {
    const m = (await (await portalOf(c, mate)).get('/people/engage/today').expect(200)).body.posts;
    expect(m.map((p: any) => p.kind).sort()).toEqual(['ANNIVERSARY', 'BIRTHDAY', 'HOLIDAY']);
    const mine = (await (await portalOf(c, bday)).get('/people/engage/today').expect(200)).body.posts;
    expect(mine.find((p: any) => p.kind === 'BIRTHDAY')).toMatchObject({ mine: true, text: 'Happy birthday from everyone here' });
    const far = (await (await portalOf(c, elsewhere)).get('/people/engage/today').expect(200)).body.posts;
    expect(far.some((p: any) => p.kind === 'HOLIDAY')).toBe(false);
    expect(far.some((p: any) => p.kind === 'BIRTHDAY')).toBe(true);
  });

  it('Home reads today’s posts; HR may record an opt-out for someone; a manager may not', async () => {
    const h = (await ppl(c, 'get', '/celebrations').expect(200)).body;
    expect(h.today.map((t: any) => t.kind).sort()).toEqual(['ANNIVERSARY', 'BIRTHDAY']);
    await ppl(mgr, 'put', `/employees/${bday.id}/celebrations`, { optedOut: true }).expect(403);
    await ppl(c, 'put', `/employees/${bday.id}/celebrations`, { optedOut: true }).expect(200);
    expect((await ppl(c, 'get', '/celebrations').expect(200)).body.today).toEqual([]);
    await ppl(c, 'put', `/employees/${bday.id}/celebrations`, { optedOut: false }).expect(200);
  });
});

describe('ready-made automations (4.7)', () => {
  let c: Ctx;
  let other: Ctx;
  let mgr: Ctx;
  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Arun Lead');
  }, 120_000);

  it('lists the recipes: what already ran is on, new ones off, attendance ones read from their own settings', async () => {
    const r = (await ppl(c, 'get', '/automations').expect(200)).body;
    expect(r.canEdit).toBe(true);
    expect(r.automations.length).toBeGreaterThanOrEqual(15);
    const of = (k: string) => r.automations.find((a: any) => a.key === k);
    expect(of('taskDigest')).toMatchObject({ on: true, defaultOn: true });
    expect(of('documentExpiry').on).toBe(true);
    expect(of('probationEnds')).toMatchObject({ on: true, n: 14, range: { min: 1, max: 60 } });
    expect(of('birthdays')).toMatchObject({ on: false, lastRun: null, nextRun: null });
    expect(of('leaveWaiting')).toMatchObject({ on: false, n: 2 });
    expect(of('missingPunch')).toMatchObject({ on: true, managedIn: { screen: 'attendanceRules' } });
    expect(of('absence').managedIn).toBeTruthy();
    expect(r.automations.every((a: any) => !/\{n\}/.test(a.sentence) || a.n != null)).toBe(true);
  });

  it('HR switches and sets numbers; out of range, unknown and managed-elsewhere are refused; a manager may not', async () => {
    await ppl(mgr, 'put', '/automations', { automations: { birthdays: { on: true } } }).expect(403);
    await ppl(c, 'put', '/automations', { automations: { probationEnds: { n: 0 } } }).expect(400);
    await ppl(c, 'put', '/automations', { automations: { madeUp: { on: true } } }).expect(400);
    expect((await ppl(c, 'put', '/automations', { automations: { missingPunch: { on: false } } }).expect(400)).body.error).toMatch(/Attendance rules/);
    await ppl(c, 'put', '/automations', { automations: { taskDigest: { n: 3 } } }).expect(400);
    const r = (await ppl(c, 'put', '/automations', { automations: { probationEnds: { n: 15 }, policyAccept: { on: true, n: 5 }, taskDigest: { on: false } } }).expect(200)).body.automations;
    const of = (k: string) => r.find((a: any) => a.key === k);
    expect(of('probationEnds')).toMatchObject({ on: true, n: 15 });
    expect(of('policyAccept')).toMatchObject({ on: true, n: 5 });
    /* After 20:00 IST it waits for the morning (nothing is sent at night). */
    expect(['This morning', 'Within the hour', 'Tomorrow morning']).toContain(of('policyAccept').nextRun);
    expect(of('taskDigest').on).toBe(false);
    /* Another company's are untouched. */
    const o = (await ppl(other, 'get', '/automations').expect(200)).body.automations;
    expect(o.find((a: any) => a.key === 'policyAccept').on).toBe(false);
    expect(o.find((a: any) => a.key === 'taskDigest').on).toBe(true);
  });

  it('the probation number moves the first warning; switched off, HR hears nothing', async () => {
    const p = await person(c, { name: 'On Probation', code: `P-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: p.id }, data: { probationEndDate: plus(istToday(), 15), confirmedOn: null } }));
    await runEndDateReminders();
    const heard = await inTenant(c, () => platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.probation_ending' } }));
    expect(heard).toBeGreaterThan(0);
    const listed = (await ppl(c, 'get', '/automations').expect(200)).body.automations.find((a: any) => a.key === 'probationEnds');
    expect(listed.lastRun).toMatchObject({ on: istToday(), recipients: ['On Probation'] });
    /* Off for another company with the same date: nothing. */
    await ppl(other, 'put', '/automations', { automations: { probationEnds: { on: false } } }).expect(200);
    const q = await person(other, { name: 'Other Probation', code: `P-${rnd()}` });
    await inTenant(other, () => peoplePrisma.employee.update({ where: { id: q.id }, data: { probationEndDate: plus(istToday(), 3), confirmedOn: null } }));
    await runEndDateReminders();
    expect(await inTenant(other, () => platformPrisma.notification.count({ where: { orgId: other.orgId, kind: 'people.probation_ending' } }))).toBe(0);
  });

  it('policy acceptance: one reminder after N days, claimed so a hand reminder or a second run does not repeat it', async () => {
    const e = await person(c, { name: 'Reads Late', code: `RL-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { userId: mgr.userId } }));
    const pol = await inTenant(c, () => peoplePrisma.policy.create({ data: { accountId: c.accountId!, orgId: c.orgId, title: 'Leave policy', category: 'LEAVE', ownerUserId: 'u' } }));
    const ver = await inTenant(c, () => peoplePrisma.policyVersion.create({ data: { accountId: c.accountId!, orgId: c.orgId, policyId: pol.id, version: 1, body: 'x', effectiveFrom: istToday(), appliesTo: {}, status: 'PUBLISHED' } }));
    await inTenant(c, () => peoplePrisma.acknowledgement.create({ data: { accountId: c.accountId!, orgId: c.orgId, targetType: 'POLICY_VERSION', targetId: ver.id, employeeId: e.id, askedAt: new Date(Date.now() - 6 * 86_400_000) } }));
    const out = await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect(out.policyAccept).toBe(1);
    const bell = await inTenant(c, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: mgr.userId!, kind: 'people.acknowledge' } }));
    expect(bell).toHaveLength(1);
    expect(bell[0].title).toMatch(/Leave policy/);
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).policyAccept).toBeUndefined();
  });

  it('the exit-interview reminder goes once, N days before the last day', async () => {
    await ppl(c, 'put', '/automations', { automations: { exitInterview: { on: true, n: 3 } } }).expect(200);
    const e = await person(c, { name: 'Leaving Soon', code: `LS-${rnd()}`, email: `soon.${rnd()}@example.com` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 2), leavingType: 'RESIGNED' }).expect(200);
    /* Today's run already happened for the other recipes; a fresh day's claim is taken here by clearing today's. */
    await inTenant(c, () => peoplePrisma.automationRun.deleteMany({ where: { orgId: c.orgId, key: 'exitInterview' } }));
    const out = await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect(out.exitInterview).toBe(1);
    const row = await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: e.id } }));
    expect(row!.remindedOn).toBe(istToday());
    const mail = await platformPrisma.emailOutbox.count({ where: { orgId: c.orgId, templateKey: 'people.automation', relatedId: row!.id } });
    expect(mail).toBe(1);
    await inTenant(c, () => peoplePrisma.automationRun.deleteMany({ where: { orgId: c.orgId, key: 'exitInterview' } }));
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).exitInterview).toBe(0);
  });

  it('final pay due tomorrow: the owner and HR hear once, unless it is held', async () => {
    await ppl(c, 'put', '/automations', { automations: { finalPayDue: { on: true } } }).expect(200);
    const e = await person(c, { name: 'Paid Soon', code: `PS-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), -1), leavingType: 'RESIGNED' }).expect(200);
    await inTenant(c, () => payrollPrisma.finalSettlement.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: e.id, leavingDate: plus(istToday(), -1), dueDate: plus(istToday(), 1), createdByUserId: 'u' } }));
    const out = await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect(out.finalPayDue).toBeGreaterThan(0);
    const bell = await inTenant(c, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: 'people.final_pay' } }));
    expect(bell[0].title).toBe('Final pay for Paid Soon is due tomorrow');
  });
});

describe('who reads what on a leaving (review of #81)', () => {
  let c: Ctx;
  let mgr: Ctx;
  let itAdmin: Ctx;
  let lead: any;
  let leaver: any;
  let open: any;
  const answers = { reason: 'MANAGER', comeBack: 'NO', keptYou: 'A different manager', liked: 'The work', toOwner: 'Private' };
  const HR_FIELDS = ['couldKeep', 'outcomeNote'];
  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Lata Lead');
    itAdmin = await withRole(c, 'IT Administrator', 'Imran IT');
    lead = await person(c, { name: 'Lata Lead', code: `LL-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    leaver = await person(c, { name: 'Hidden Hari', code: `HH-${rnd()}` });
    open = await person(c, { name: 'Open Omar', code: `OO-${rnd()}` });
    for (const e of [leaver, open]) {
      await inTenant(c, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { reportingManagerId: lead.id } }));
      await inTenant(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: e.id, number: `ADV-${rnd()}`, purpose: 'Site visit', amount: 900, status: 'PAID' } }));
      await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 20), leavingType: 'RESIGNED' }).expect(200);
    }
    await (await portalOf(c, leaver)).post('/people/engage/exit-interview', { answers, hideFromManager: true }).expect(200);
    await ppl(c, 'post', `/leaving/${leaver.id}/exit-interview/outcome`, { couldKeep: 'YES', note: 'HR only note', outcome: 'EXIT_CONFIRMED' }).expect(200);
    await (await portalOf(c, open)).post('/people/engage/exit-interview', { answers }).expect(200);
    await ppl(c, 'post', `/leaving/${open.id}/exit-interview/outcome`, { couldKeep: 'MAYBE', note: 'HR only note', outcome: 'EXIT_CONFIRMED' }).expect(200);
  }, 180_000);

  it('a hidden interview gives the manager no reason, could-keep, outcome or note, in any field', async () => {
    const res = await ppl(mgr, 'get', `/leaving/${leaver.id}`).expect(200);
    const i = res.body.interview;
    expect(i).toMatchObject({ status: 'SUBMITTED', hiddenFromYou: true, answers: null });
    for (const k of ['reason', 'reasonLabel', 'couldKeep', 'outcome', 'outcomeAt', 'outcomeNote']) expect(i).not.toHaveProperty(k);
    expect(JSON.stringify(res.body.interview)).not.toMatch(/A different manager|"reason":|"MANAGER"[^,]*,"reasonLabel|HR only note/);
  });

  it('a manager reading an unhidden interview still gets none of HR’s own view', async () => {
    const i = (await ppl(mgr, 'get', `/leaving/${open.id}`).expect(200)).body.interview;
    expect(i.answers.keptYou).toBe('A different manager');
    expect(i).toMatchObject({ reason: 'MANAGER', outcome: 'EXIT_CONFIRMED' });
    for (const k of HR_FIELDS) expect(i).not.toHaveProperty(k);
    /* HR does get them. */
    expect((await ppl(c, 'get', `/leaving/${open.id}`).expect(200)).body.interview).toMatchObject({ couldKeep: 'MAYBE', outcomeNote: 'HR only note' });
  });

  it('the plan says who reads the answers to its reader; only the leaver is told "your answers"', async () => {
    for (const who of [mgr, c]) {
      const p = (await ppl(who, 'get', `/leaving/${open.id}`).expect(200)).body.interview.purpose;
      expect(p).toMatch(/^The answers help .*their managers too, unless they hide them/);
      expect(p).not.toMatch(/\byour\b/i);
    }
    expect((await (await portalOf(c, open)).get('/people/engage/exit-interview').expect(200)).body.interview.purpose).toMatch(/^Your answers help .*your managers too, unless you hide them/);
  });

  it('the leaver’s own app response carries nothing of HR’s', async () => {
    const res = await (await portalOf(c, open)).get('/people/engage/exit-interview').expect(200);
    const i = res.body.interview;
    expect(i.answers.reason).toBe('MANAGER');
    for (const k of [...HR_FIELDS, 'outcome', 'outcomeAt', 'outcomeByUserId']) expect(i).not.toHaveProperty(k);
    expect(JSON.stringify(res.body)).not.toMatch(/HR only note/);
  });

  it('why people leave is HR’s: a manager gets nothing, hidden or not; HR still counts every row', async () => {
    const m = await ppl(mgr, 'get', '/reports/leaving-reasons').expect(403);
    expect(JSON.stringify(m.body)).not.toMatch(/MANAGER|My manager/);
    await ppl(itAdmin, 'get', '/reports/leaving-reasons').expect(403);
    /* This month's leaver, hidden from the manager: HR counts it, and the two above on notice for next month too. */
    await inTenant(c, () => peoplePrisma.exitInterview.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: leaver.id, leavingDate: `${istToday().slice(0, 7)}-01`, status: 'SUBMITTED', reason: 'MANAGER', hideFromManager: true } }));
    expect((await ppl(c, 'get', '/reports/leaving-reasons').expect(200)).body.reasons).toEqual([expect.objectContaining({ code: 'MANAGER', count: 3 })]);
  });

  it('IT Administrator reads no answers and no money, though the role reads the whole company', async () => {
    const res = await ppl(itAdmin, 'get', `/leaving/${open.id}`).expect(200);
    expect(res.body.interview).toBeNull();
    expect(res.body.canEdit).toBe(false);
    const { clearance } = res.body;
    expect(clearance.found).toBeNull();
    const fin = clearance.lines.find((l: any) => l.dept === 'FINANCE');
    expect(fin).toMatchObject({ moneyHidden: true, canSign: false });
    for (const k of ['direction', 'amount', 'note']) expect(fin).not.toHaveProperty(k);
    /* Their own line, the IT one, is theirs; the totals hold only what they may see. */
    expect(clearance.lines.find((l: any) => l.dept === 'IT')).toMatchObject({ mine: true, direction: 'NONE' });
    expect(clearance.totals).toEqual({ owes: 0, owed: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/Advance |900/);
  });

  it('a manager gets no money on lines that are not theirs, and no totals at all if none are', async () => {
    const r = (await ppl(mgr, 'get', `/leaving/${open.id}`).expect(200)).body.clearance;
    expect(r.lines.find((l: any) => l.dept === 'MANAGER')).toMatchObject({ mine: true, direction: 'NONE' });
    expect(r.lines.find((l: any) => l.dept === 'FINANCE')).toMatchObject({ moneyHidden: true });
    expect(r.totals).toEqual({ owes: 0, owed: 0 });
    /* HR reads it; so does the owner it is handed to. */
    const fin = (await ppl(c, 'get', `/leaving/${open.id}`).expect(200)).body.clearance.lines.find((l: any) => l.dept === 'FINANCE');
    expect(fin).toMatchObject({ direction: 'OWES', amount: 900 });
    await ppl(c, 'patch', `/clearance-lines/${fin.id}`, { ownerUserId: itAdmin.userId }).expect(200);
    expect((await ppl(itAdmin, 'get', `/leaving/${open.id}`).expect(200)).body.clearance.lines.find((l: any) => l.dept === 'FINANCE')).toMatchObject({ mine: true, direction: 'OWES', amount: 900 });
    expect((await ppl(itAdmin, 'get', `/leaving/${open.id}`).expect(200)).body.clearance.totals).toEqual({ owes: 900, owed: 0 });
  });

  it('a line’s owner outside the person’s team sees that line and nothing else; others outside get 404', async () => {
    const outsider = await withRole(c, 'Team Manager', 'Far Manager');
    const far = await person(c, { name: 'Far Manager', code: `FM-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: far.id }, data: { userId: outsider.userId } }));
    await ppl(outsider, 'get', `/leaving/${open.id}`).expect(404);
    const before = (await ppl(c, 'get', `/leaving/${open.id}`).expect(200)).body.clearance.lines.find((l: any) => l.dept === 'ADMIN');
    await ppl(c, 'patch', `/clearance-lines/${before.id}`, { ownerUserId: outsider.userId }).expect(200);
    const res = (await ppl(outsider, 'get', `/leaving/${open.id}`).expect(200)).body;
    expect(res.lineOnly).toBe(true);
    expect(res.person).toMatchObject({ id: open.id, name: 'Open Omar' });
    expect(res.clearance.lines.map((l: any) => l.id)).toEqual([before.id]);
    expect(res.clearance.lines[0].canSign).toBe(true);
    expect(res.interview).toBeNull();
    expect(res.finalPay).toBeNull();
    await ppl(outsider, 'patch', `/clearance-lines/${before.id}`, { sign: true }).expect(200);
  });

  it('a dotted-line manager reads the interview as the line does; hidden, they get nothing of it either', async () => {
    const dot = await withRole(c, 'Team Manager', 'Dina Dotted');
    const dina = await person(c, { name: 'Dina Dotted', code: `DD-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: dina.id }, data: { userId: dot.userId } }));
    for (const e of [open, leaver]) await inTenant(c, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { dottedManagerId: dina.id } }));
    const seen = (await ppl(dot, 'get', `/leaving/${open.id}`).expect(200)).body.interview;
    expect(seen.answers.keptYou).toBe('A different manager');
    expect(seen).toMatchObject({ reason: 'MANAGER', outcome: 'EXIT_CONFIRMED' });
    for (const k of HR_FIELDS) expect(seen).not.toHaveProperty(k);
    const hidden = (await ppl(dot, 'get', `/leaving/${leaver.id}`).expect(200)).body.interview;
    expect(hidden).toMatchObject({ hiddenFromYou: true, answers: null });
    for (const k of ['reason', 'reasonLabel', 'outcome', ...HR_FIELDS]) expect(hidden).not.toHaveProperty(k);
  });

  it('a manager who has left is on nobody’s line: their sign-in reads no answers', async () => {
    const ex = await withRole(c, 'Team Manager', 'Esha Ex');
    const esha = await person(c, { name: 'Esha Ex', code: `EE-${rnd()}` });
    /* Above Lata Lead, so above Omar too, until she left. */
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: esha.id }, data: { userId: ex.userId, status: 'LEFT', dateOfLeaving: plus(istToday(), -30), leavingType: 'RESIGNED' } }));
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { reportingManagerId: esha.id } }));
    const res = await ppl(ex, 'get', `/leaving/${open.id}`);
    if (res.status === 200) expect(res.body.interview).toBeNull();
    else expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/A different manager/);
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { reportingManagerId: null } }));
  });

  it('who an automation told is HR’s to read: an Employees view holder gets no names', async () => {
    await inTenant(c, () => peoplePrisma.automationRun.create({ data: { accountId: c.accountId!, orgId: c.orgId, key: 'documentExpiry', ranOn: istToday(), count: 1, recipients: ['Hidden Hari: Passport'] } }));
    const hrRow = (await ppl(c, 'get', '/automations').expect(200)).body.automations.find((a: any) => a.key === 'documentExpiry');
    expect(hrRow.lastRun.recipients).toEqual(['Hidden Hari: Passport']);
    const res = await ppl(itAdmin, 'get', '/automations').expect(200);
    expect(res.body.automations.find((a: any) => a.key === 'documentExpiry').lastRun).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/Hidden Hari/);
  });
});

describe('nobody clears their own dues (JCL-007)', () => {
  let c: Ctx;
  let hr: Ctx;
  let me: any;
  let lines: any[];
  const answers = { reason: 'PAY', comeBack: 'NO' };
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'Team Manager', 'Placeholder');
    const roles = (await request(app).get(`/api/orgs/${c.orgId}/roles`).set(at(c)).expect(200)).body;
    const hrRole = (roles.roles || roles).find((r: any) => /^HR /.test(r.name) || r.name === 'HR');
    hr = await withRole(c, hrRole.name, 'Harini HR');
    me = await person(c, { name: 'Harini HR', code: `HH-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: hr.userId } }));
    await ppl(c, 'post', `/employees/${me.id}/resign`, { lastDay: plus(istToday(), 9), leavingType: 'RESIGNED' }).expect(200);
    lines = (await ppl(c, 'get', `/leaving/${me.id}`).expect(200)).body.clearance.lines;
  }, 120_000);

  it('a leaving HR person cannot sign or change a line, add or remove one; someone else can', async () => {
    const res = (await ppl(hr, 'get', `/leaving/${me.id}`).expect(200)).body;
    expect(res.canEdit).toBe(false);
    expect(res.clearance.lines.every((l: any) => l.canSign === false)).toBe(true);
    const line = lines.find((l: any) => l.dept === 'FINANCE');
    expect((await ppl(hr, 'patch', `/clearance-lines/${line.id}`, { sign: true }).expect(403)).body.code).toBe('OWN_PLAN');
    expect((await ppl(hr, 'patch', `/clearance-lines/${line.id}`, { direction: 'OWED', amount: 500 }).expect(403)).body.code).toBe('OWN_PLAN');
    expect((await ppl(hr, 'post', `/leaving/${me.id}/clearance-lines`, { label: 'Uniform' }).expect(403)).body.code).toBe('OWN_PLAN');
    await ppl(c, 'patch', `/clearance-lines/${line.id}`, { sign: true }).expect(200);
  });

  it('nor enter or decide their own exit interview, nor read HR’s view of it', async () => {
    expect((await ppl(hr, 'post', `/leaving/${me.id}/exit-interview`, { answers }).expect(403)).body.code).toBe('OWN_PLAN');
    expect((await ppl(hr, 'post', `/leaving/${me.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(403)).body.code).toBe('OWN_PLAN');
    await ppl(c, 'post', `/leaving/${me.id}/exit-interview/outcome`, { couldKeep: 'NO', note: 'About them' }).expect(200);
    const i = (await ppl(hr, 'get', `/leaving/${me.id}`).expect(200)).body.interview;
    expect(i.canDecide).toBe(false);
    for (const k of ['couldKeep', 'outcomeNote', 'outcome']) expect(i).not.toHaveProperty(k);
  });

  it('nor withdraw their own leaving: that would decide the interview and close their own lines', async () => {
    expect((await ppl(hr, 'post', `/employees/${me.id}/stay`, { reason: 'Changed my mind' }).expect(403)).body.code).toBe('OWN_PLAN');
    const row = await inTenant(c, () => peoplePrisma.employee.findFirst({ where: { id: me.id }, select: { status: true } }));
    expect(row!.status).toBe('ON_NOTICE');
    expect(await inTenant(c, () => peoplePrisma.clearanceLine.count({ where: { orgId: c.orgId, employeeId: me.id, status: 'WITHDRAWN' } }))).toBe(0);
    expect((await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: me.id } })))!.outcome).toBeNull();
    /* Someone else may. */
    await ppl(c, 'post', `/employees/${me.id}/stay`, { reason: 'Kept on' }).expect(200);
  });

  it('in a company with nobody else to do it, the only HR person may', async () => {
    const solo = await company();
    const self = await person(solo, { name: 'Sole Owner', code: `SO-${rnd()}` });
    await inTenant(solo, () => peoplePrisma.employee.update({ where: { id: self.id }, data: { userId: solo.userId } }));
    await ppl(solo, 'post', `/employees/${self.id}/resign`, { lastDay: plus(istToday(), 5), leavingType: 'RESIGNED' }).expect(200);
    const line = (await ppl(solo, 'get', `/leaving/${self.id}`).expect(200)).body.clearance.lines[0];
    expect(line.canSign).toBe(true);
    await ppl(solo, 'patch', `/clearance-lines/${line.id}`, { sign: true }).expect(200);
  }, 60_000);
});

describe('a last day that moves, and a leaving withdrawn', () => {
  let c: Ctx;
  let mgr: Ctx;
  let lead: any;
  const newcomer = async (name: string, lastDay: string) => {
    const e = await person(c, { name, code: `X-${rnd()}`, email: `${rnd()}@example.com` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { reportingManagerId: lead.id } }));
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay, leavingType: 'RESIGNED' }).expect(200);
    return e;
  };
  const claimsGone = (key: string) => inTenant(c, () => peoplePrisma.automationRun.deleteMany({ where: { orgId: c.orgId, key } }));
  const notices = (kind: string, userId?: string) => inTenant(c, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind, ...(userId ? { userId } : {}) } }));
  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Moti Lead');
    lead = await person(c, { name: 'Moti Lead', code: `ML-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    await ppl(c, 'put', '/automations', { automations: { exitInterview: { on: true, n: 3 }, clearanceDue: { on: true } } }).expect(200);
  }, 120_000);

  it('extended notice keeps the signed lines and the answers, and does not ask again', async () => {
    const first = plus(istToday(), 10);
    const later = plus(istToday(), 40);
    const e = await newcomer('Extended Esha', first);
    const before = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.clearance.lines;
    const mine = before.find((l: any) => l.dept === 'MANAGER');
    await ppl(mgr, 'patch', `/clearance-lines/${mine.id}`, { sign: true }).expect(200);
    const added = (await ppl(c, 'post', `/leaving/${e.id}/clearance-lines`, { label: 'Library books' }).expect(201)).body.line;
    const phone = await portalOf(c, e);
    await phone.post('/people/engage/exit-interview', { answers: { reason: 'PAY', comeBack: 'NO', liked: 'Tea' } }).expect(200);
    const row = await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: e.id } }));

    await ppl(c, 'put', `/employees/${e.id}`, { dateOfLeaving: later }).expect(200);

    const after = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body;
    expect(after.clearance.lastDay).toBe(later);
    expect(after.clearance.lines.map((l: any) => l.id).sort()).toEqual([...before.map((l: any) => l.id), added.id].sort());
    expect(after.clearance.lines.find((l: any) => l.id === mine.id)).toMatchObject({ status: 'CLEAR', signedBy: 'Moti Lead' });
    expect(after.interview).toMatchObject({ id: row!.id, status: 'SUBMITTED', lastDay: later });
    expect(after.interview.answers.liked).toBe('Tea');
    const i = (await phone.get('/people/engage/exit-interview').expect(200)).body.interview;
    expect(i).toMatchObject({ id: row!.id, status: 'SUBMITTED' });
    await phone.post('/people/engage/exit-interview', { answers: { reason: 'PAY', comeBack: 'NO' } }).expect(409);
    /* The rows moved: nothing is left under the old day, and the keeping period moved with them. */
    expect(await inTenant(c, () => peoplePrisma.clearanceLine.count({ where: { orgId: c.orgId, employeeId: e.id, leavingDate: first } }))).toBe(0);
    expect((await inTenant(c, () => peoplePrisma.exitInterview.findUnique({ where: { id: row!.id } })))!.keepUntil! > row!.keepUntil!).toBe(true);
  });

  it('the exit reminder goes for the day they really leave: not for a day that moved, and again before the new one', async () => {
    const soon = plus(istToday(), 2);
    const e = await newcomer('Moved Mohan', soon);
    await claimsGone('exitInterview');
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).exitInterview).toBe(1);
    const row = await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: e.id } }));
    expect(row!.remindedOn).toBe(istToday());

    /* Moved on the day: the old row is not reminded and nobody hears before the window. */
    const later = plus(istToday(), 30);
    await ppl(c, 'put', `/employees/${e.id}`, { dateOfLeaving: later }).expect(200);
    await inTenant(c, () => peoplePrisma.exitInterview.update({ where: { id: row!.id }, data: { remindedOn: null } }));
    await claimsGone('exitInterview');
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).exitInterview).toBe(0);

    /* Three days before the new day, the same row is reminded, under its new date. */
    const near = new Date(Date.parse(`${plus(later, -3)}T06:00:00Z`));
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId, near))).exitInterview).toBe(1);
    const moved = await inTenant(c, () => peoplePrisma.exitInterview.findUnique({ where: { id: row!.id } }));
    expect(moved).toMatchObject({ leavingDate: later, remindedOn: plus(later, -3) });
    expect(await inTenant(c, () => peoplePrisma.exitInterview.count({ where: { orgId: c.orgId, employeeId: e.id } }))).toBe(1);
  });

  it('the last-day reminder makes lines that were never read, and goes to their owners once', async () => {
    const e = await newcomer('Unread Uma', istToday());
    expect(await inTenant(c, () => peoplePrisma.clearanceLine.count({ where: { orgId: c.orgId, employeeId: e.id } }))).toBe(0);
    await claimsGone('clearanceDue');
    const out = await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect(out.clearanceDue).toBeGreaterThan(0);
    expect(await inTenant(c, () => peoplePrisma.clearanceLine.count({ where: { orgId: c.orgId, employeeId: e.id } }))).toBe(4);
    expect((await notices('people.clearance', mgr.userId)).some((n) => /Unread Uma/.test(`${n.title} ${n.body}`))).toBe(true);
  });

  it('a day that moved away: no last-day reminder for the old date', async () => {
    const e = await newcomer('Later Lila', istToday());
    await ppl(c, 'get', `/leaving/${e.id}`).expect(200);
    await ppl(c, 'put', `/employees/${e.id}`, { dateOfLeaving: plus(istToday(), 15) }).expect(200);
    await claimsGone('clearanceDue');
    await inTenant(c, () => platformPrisma.notification.deleteMany({ where: { orgId: c.orgId, kind: 'people.clearance' } }));
    await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect((await notices('people.clearance')).some((n) => /Later Lila/.test(`${n.title} ${n.body}`))).toBe(false);
  });

  it('retained: their lines close, owners are not reminded, the exit reminder stops, and the outcome stands', async () => {
    const e = await newcomer('Stays Sita', istToday());
    const lines = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.clearance.lines;
    await ppl(c, 'post', `/leaving/${e.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(200);
    expect((await inTenant(c, () => peoplePrisma.employee.findUnique({ where: { id: e.id } })))!.status).toBe('ACTIVE');
    expect(await inTenant(c, () => peoplePrisma.clearanceLine.count({ where: { orgId: c.orgId, employeeId: e.id, status: { not: 'WITHDRAWN' } } }))).toBe(0);
    expect((await ppl(mgr, 'patch', `/clearance-lines/${lines[0].id}`, { sign: true }).expect(409)).body.code).toBe('WITHDRAWN');
    await claimsGone('clearanceDue');
    await claimsGone('exitInterview');
    await inTenant(c, () => platformPrisma.notification.deleteMany({ where: { orgId: c.orgId, kind: 'people.clearance' } }));
    await inTenant(c, () => peoplePrisma.exitInterview.updateMany({ where: { orgId: c.orgId, employeeId: e.id }, data: { remindedOn: null } }));
    await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect((await notices('people.clearance')).some((n) => /Stays Sita/.test(`${n.title} ${n.body}`))).toBe(false);
    expect((await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: e.id } })))!.remindedOn).toBeNull();
  });

  it('withdrawn by hand, then resigning again: a fresh set of lines, a fresh decision, no old signatures', async () => {
    const day = plus(istToday(), 25);
    const e = await newcomer('Back Bala', day);
    const line = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.clearance.lines.find((l: any) => l.dept === 'MANAGER');
    await ppl(mgr, 'patch', `/clearance-lines/${line.id}`, { sign: true }).expect(200);
    await ppl(c, 'post', `/employees/${e.id}/stay`, { reason: 'Changed their mind' }).expect(200);
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: day, leavingType: 'RESIGNED' }).expect(200);
    const again = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body;
    expect(again.clearance.lines).toHaveLength(4);
    expect(again.clearance.lines.every((l: any) => l.status === 'OPEN')).toBe(true);
    expect(again.interview.outcome).toBeNull();
    /* And the "Final wages paid" closed by the withdrawal does not read as paid. */
    expect(again.finalPay.paid).toBe(false);
  });
});

describe('final pay: the plan’s step and the reminder', () => {
  let c: Ctx;
  const tick = async (id: string) => {
    const t = await inTenant(c, () => peoplePrisma.checklistTask.findFirst({ where: { orgId: c.orgId, employeeId: id, kind: 'LEAVING', title: 'Final wages paid' } }));
    expect(t).not.toBeNull();
    return t!;
  };
  beforeAll(async () => {
    c = await company();
  }, 60_000);

  it('a ticked "Final wages paid" clears the Home banner and the clock, with no Payroll settlement at all', async () => {
    const e = await person(c, { name: 'Hand Paid', code: `HP-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), -1), leavingType: 'RESIGNED' }).expect(200);
    expect((await ppl(c, 'get', '/final-pay').expect(200)).body.rows.map((r: any) => r.employeeId)).toContain(e.id);
    const t = await tick(e.id);
    await inTenant(c, () => peoplePrisma.checklistTask.update({ where: { id: t.id }, data: { doneAt: new Date(), doneByUserId: 'u' } }));
    expect((await ppl(c, 'get', '/final-pay').expect(200)).body.rows.map((r: any) => r.employeeId)).not.toContain(e.id);
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.finalPay).toMatchObject({ paid: true, paidOnPlan: true, overdue: false });
  });

  it('an earlier stint’s ticked "Final wages paid" does not pay this leaving', async () => {
    const e = await person(c, { name: 'Back Again', code: `BA-${rnd()}`, dateOfJoining: '2025-06-01' });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), -1), leavingType: 'RESIGNED' }).expect(200);
    const t = await tick(e.id);
    /* The tick is from before this joining: the last stint's plan, paid then. */
    await inTenant(c, () => peoplePrisma.checklistTask.update({ where: { id: t.id }, data: { doneAt: new Date('2025-03-01T00:00:00Z'), doneByUserId: 'u', createdAt: new Date('2025-02-01T00:00:00Z') } }));
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.finalPay).toMatchObject({ paid: false });
    expect((await ppl(c, 'get', '/final-pay').expect(200)).body.rows.map((r: any) => r.employeeId)).toContain(e.id);
  });

  it('a Payroll outage reads as unknown, never as "no settlement" or "no loans"', async () => {
    const e = await person(c, { name: 'Unknown Usha', code: `UU-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 3), leavingType: 'RESIGNED' }).expect(200);
    const down = new Error('payroll down');
    const a = vi.spyOn(payrollPrisma.finalSettlement, 'findFirst').mockRejectedValue(down);
    const b = vi.spyOn(payrollPrisma.payrollLoan, 'findMany').mockRejectedValue(down);
    try {
      const r = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body;
      expect(r.finalPay.payrollUnknown).toBe(true);
      expect(r.clearance.found.loansUnknown).toBe(true);
      expect(r.clearance.lines.find((l: any) => l.dept === 'FINANCE').note).toMatch(/not checked/);
    } finally {
      a.mockRestore();
      b.mockRestore();
    }
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.finalPay.payrollUnknown).toBe(false);
  });

  it('due on a Monday: one notice before it, however many days the weekend adds, and one on the day', async () => {
    await ppl(c, 'put', '/automations', { automations: { finalPayDue: { on: true } } }).expect(200);
    const e = await person(c, { name: 'Monday Mani', code: `MM-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), -1), leavingType: 'RESIGNED' }).expect(200);
    /* The next Monday at least four days off; the company's working week decides which day first has one left. */
    let monday = plus(istToday(), 4);
    while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = plus(monday, 1);
    await inTenant(c, () => payrollPrisma.finalSettlement.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: e.id, leavingDate: plus(istToday(), -1), dueDate: monday, createdByUserId: 'u' } }));
    for (const d of [-3, -2, -1, 0]) await inTenant(c, () => runCompany(c.accountId!, c.orgId, new Date(`${plus(monday, d)}T06:00:00Z`)));
    const bell = await inTenant(c, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: 'people.final_pay', title: { contains: 'Monday Mani' } }, orderBy: { createdAt: 'asc' } }));
    expect(bell.map((n) => n.title).filter((t) => /today/.test(t))).toHaveLength(1);
    expect(bell.map((n) => n.title).filter((t) => !/today/.test(t))).toHaveLength(1);
    /* The two reminders are one each, to each person: not one a day. */
    expect(new Set(bell.map((n) => n.title)).size).toBe(2);
  }, 60_000);
});

describe('a failed run is not sent twice, and not counted as sent', () => {
  let c: Ctx;
  let sam: Ctx;
  beforeAll(async () => {
    c = await company();
    sam = await withRole(c, 'Team Manager', 'Sam Staff');
  }, 60_000);
  afterEach(() => vi.restoreAllMocks());

  it('a first-day e-mail goes once even when the run is taken again the same day', async () => {
    await ppl(c, 'put', '/automations', { automations: { firstDayPlan: { on: true } } }).expect(200);
    const j = await person(c, { name: 'New Nita', code: `NN-${rnd()}`, email: `nita.${rnd()}@example.com`, dateOfJoining: plus(istToday(), 1) });
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).firstDayPlan).toBe(1);
    /* What a throw further on did: gave the claim back, so the next wake sends again. */
    await inTenant(c, () => peoplePrisma.automationRun.updateMany({ where: { orgId: c.orgId, key: 'firstDayPlan' }, data: { retry: true } }));
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).firstDayPlan).toBe(0);
    await inTenant(c, () => peoplePrisma.automationRun.deleteMany({ where: { orgId: c.orgId, key: 'firstDayPlan' } }));
    await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect(await platformPrisma.emailOutbox.count({ where: { orgId: c.orgId, templateKey: 'people.automation', relatedId: j.id } })).toBe(1);
  });

  it('a failed e-mail sent again is claimed first: two at once send it once; one in flight is left alone', async () => {
    const opts = (id: string) => ({ templateKey: 'people.automation', to: `claim.${rnd()}@example.com`, toName: 'Claim', accountId: c.accountId!, orgId: c.orgId, relatedType: 'Employee', relatedId: id, data: { name: 'Claim', orgName: 'Co', headline: 'Hello', body: 'Body' } });
    const failed = opts(`claim-${rnd()}`);
    const row = await sendTemplate(failed);
    await platformPrisma.emailOutbox.update({ where: { id: row!.id }, data: { status: 'FAILED' } });
    const before = (await platformPrisma.emailOutbox.findUnique({ where: { id: row!.id } }))!.attempts;
    const both = await Promise.all([mailOnce(failed), mailOnce(failed)]);
    expect([...both].sort()).toEqual(['SENT', 'SKIPPED']);
    expect((await platformPrisma.emailOutbox.findUnique({ where: { id: row!.id } }))!.attempts).toBe(before + 1);
    /* Queued a moment ago: someone is sending it. Queued and untouched for an hour: a crash's leftover, sent. */
    const queued = opts(`queued-${rnd()}`);
    const q = await sendTemplate(queued);
    await platformPrisma.emailOutbox.update({ where: { id: q!.id }, data: { status: 'QUEUED' } });
    expect(await mailOnce(queued)).toBe('SKIPPED');
    await platformPrisma.emailOutbox.update({ where: { id: q!.id }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    expect(await mailOnce(queued)).toBe('SENT');
  });

  it('a recipe that throws keeps what it sent on record, and the next wake runs it', async () => {
    await ppl(c, 'put', '/automations', { automations: { finalPayDue: { on: true } } }).expect(200);
    const spy = vi.spyOn(peoplePrisma.employee, 'findMany').mockRejectedValueOnce(new Error('database away'));
    const first = await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    spy.mockRestore();
    expect(Object.keys(first)).not.toContain('finalPayDue');
    const row = await inTenant(c, () => peoplePrisma.automationRun.findFirst({ where: { orgId: c.orgId, key: 'finalPayDue', ranOn: istToday() } }));
    expect(row!.retry).toBe(true);
    const again = await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    expect(Object.keys(again)).toContain('finalPayDue');
    expect((await inTenant(c, () => peoplePrisma.automationRun.findFirst({ where: { orgId: c.orgId, key: 'finalPayDue', ranOn: istToday() } })))!.retry).toBe(false);
  });

  it('an exit reminder that could not go is not marked or counted, and goes on the retry', async () => {
    await ppl(c, 'put', '/automations', { automations: { exitInterview: { on: true, n: 3 } } }).expect(200);
    const e = await person(c, { name: 'Failed Farah', code: `FF-${rnd()}`, email: `farah.${rnd()}@example.com` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 2), leavingType: 'RESIGNED' }).expect(200);
    const spy = vi.spyOn(platformPrisma.emailOutbox, 'create').mockRejectedValueOnce(new Error('mail table away'));
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).exitInterview).toBe(0);
    spy.mockRestore();
    const row = await inTenant(c, () => peoplePrisma.exitInterview.findFirst({ where: { orgId: c.orgId, employeeId: e.id } }));
    expect(row!.remindedOn).toBeNull();
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).exitInterview).toBe(1);
    expect((await inTenant(c, () => peoplePrisma.exitInterview.findUnique({ where: { id: row!.id } })))!.remindedOn).toBe(istToday());
    expect(await platformPrisma.emailOutbox.count({ where: { orgId: c.orgId, relatedId: row!.id, status: 'SENT' } })).toBe(1);
  });

  it('a policy reminder that could not go is not marked or counted, and goes on the retry; someone with no sign-in is not counted', async () => {
    await ppl(c, 'put', '/automations', { automations: { policyAccept: { on: true, n: 3 } } }).expect(200);
    const e = await person(c, { name: 'Late Reader', code: `LR-${rnd()}` });
    const noSignIn = await person(c, { name: 'No Sign In', code: `NS-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { userId: sam.userId } }));
    const pol = await inTenant(c, () => peoplePrisma.policy.create({ data: { accountId: c.accountId!, orgId: c.orgId, title: 'Leave policy', category: 'LEAVE', ownerUserId: 'u' } }));
    const ver = await inTenant(c, () => peoplePrisma.policyVersion.create({ data: { accountId: c.accountId!, orgId: c.orgId, policyId: pol.id, version: 1, body: 'x', effectiveFrom: istToday(), appliesTo: {}, status: 'PUBLISHED' } }));
    const ask = (id: string) => inTenant(c, () => peoplePrisma.acknowledgement.create({ data: { accountId: c.accountId!, orgId: c.orgId, targetType: 'POLICY_VERSION', targetId: ver.id, employeeId: id, askedAt: new Date(Date.now() - 6 * 86_400_000) } }));
    const row = await ask(e.id);
    await ask(noSignIn.id);
    const spy = vi.spyOn(platformPrisma.notification, 'createMany').mockRejectedValue(new Error('bell away'));
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).policyAccept).toBe(0);
    spy.mockRestore();
    expect((await inTenant(c, () => peoplePrisma.acknowledgement.findUnique({ where: { id: row.id } })))!.remindedAt).toBeNull();
    expect((await inTenant(c, () => runCompany(c.accountId!, c.orgId))).policyAccept).toBe(1);
    expect((await inTenant(c, () => peoplePrisma.acknowledgement.findUnique({ where: { id: row.id } })))!.remindCount).toBe(1);
  });
});

describe('smaller rules on a line', () => {
  let c: Ctx;
  let other: Ctx;
  beforeAll(async () => {
    c = await company();
    other = await company();
  }, 60_000);

  it('returning "Laptop" ticks its own step, not the charger’s', async () => {
    const e = await person(c, { name: 'Two Things', code: `TT-${rnd()}` });
    await ppl(c, 'post', '/workspace/assets', { title: 'Laptop', status: 'ASSIGNED', employeeId: e.id, details: { assetTag: `T-${rnd()}` } }).expect(201);
    await ppl(c, 'post', '/workspace/assets', { title: 'Laptop charger', status: 'ASSIGNED', employeeId: e.id, details: { assetTag: `T-${rnd()}` } }).expect(201);
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
    const line = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.clearance.lines.find((l: any) => l.dept === 'IT');
    await ppl(c, 'patch', `/clearance-lines/${line.id}`, { items: line.items.map((i: any) => ({ ...i, returned: i.title === 'Laptop' })) }).expect(200);
    const steps = await inTenant(c, () => peoplePrisma.checklistTask.findMany({ where: { orgId: c.orgId, employeeId: e.id, kind: 'LEAVING', title: { startsWith: 'Return ' } } }));
    expect(steps).toHaveLength(2);
    expect(steps.find((s) => /^Return Laptop \(/.test(s.title))!.doneAt).not.toBeNull();
    expect(steps.find((s) => /^Return Laptop charger/.test(s.title))!.doneAt).toBeNull();
  });

  it('a new line’s owner must be in this company; removing one leaves an audit row', async () => {
    const e = await person(c, { name: 'Line Adder', code: `LA-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
    await ppl(c, 'post', `/leaving/${e.id}/clearance-lines`, { label: 'Uniform', ownerUserId: other.userId }).expect(400);
    const line = (await ppl(c, 'post', `/leaving/${e.id}/clearance-lines`, { label: 'Uniform', ownerUserId: c.userId }).expect(201)).body.line;
    await ppl(c, 'delete', `/clearance-lines/${line.id}`).expect(200);
    const log = await request(app).get(`/api/orgs/${c.orgId}/audit`).set(at(c));
    expect(JSON.stringify(log.body)).toMatch(/No-dues line removed: Uniform/);
  });

  it('the exit reminder counts the company’s questions, not five', async () => {
    const q = (await ppl(c, 'get', '/exit-questions').expect(200)).body;
    await ppl(c, 'put', '/exit-questions', { questions: [...q.questions, { key: 'notice', text: 'Was your notice period fair?', kind: 'TEXT' }, { key: 'tools', text: 'Did you have what you needed?', kind: 'TEXT' }, { key: 'pay', text: 'Was your pay fair?', kind: 'TEXT' }], keepMonths: 12 }).expect(200);
    await ppl(c, 'put', '/automations', { automations: { exitInterview: { on: true, n: 3 } } }).expect(200);
    const e = await person(c, { name: 'Eight Questions', code: `EQ-${rnd()}`, email: `eight.${rnd()}@example.com` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 2), leavingType: 'RESIGNED' }).expect(200);
    await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: c.orgId, templateKey: 'people.automation', toName: 'Eight Questions' } });
    expect(mail!.bodyText).toMatch(/answer 8 short questions/);
  });
});

describe('QA on #81: HR and the owner', () => {
  let c: Ctx;
  let mgr: Ctx;
  const steps = async (id: string) => (await ppl(c, 'get', `/employees/${id}/checklist`).expect(200)).body.leaving;
  const wagesStep = (id: string) => inTenant(c, () => peoplePrisma.checklistTask.findFirst({ where: { orgId: c.orgId, employeeId: id, kind: 'LEAVING', title: 'Final wages paid' } }));
  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Manu Manager');
  }, 60_000);

  it('HR gets the company’s people with a sign-in by name, to hand a line or step to; nothing private, and a manager may not', async () => {
    const res = await ppl(c, 'get', '/assignees').expect(200);
    expect(res.body.users.map((u: any) => u.fullName)).toEqual(expect.arrayContaining(['Manu Manager']));
    for (const u of res.body.users) expect(Object.keys(u).sort()).toEqual(['fullName', 'id']);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
    await ppl(mgr, 'get', '/assignees').expect(403);
  });

  it('a later last day opens "Final wages paid" again and moves the steps; the clock warns for the new day', async () => {
    const e = await person(c, { name: 'Moved Mohan', code: `MM-${rnd()}` });
    const t = istToday();
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: t, leavingType: 'RESIGNED' }).expect(200);
    const w = await wagesStep(e.id);
    await inTenant(c, () => peoplePrisma.checklistTask.update({ where: { id: w!.id }, data: { doneAt: new Date(), doneByUserId: c.userId!, note: 'Paid' } }));
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.finalPay.paid).toBe(true);
    const before = (await steps(e.id)).tasks.find((s: any) => s.title === 'Final wages paid').dueDate;
    /* "Change leaving details": the same form, a new day. */
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(t, 14), leavingType: 'RESIGNED' }).expect(200);
    const after = (await steps(e.id)).tasks.find((s: any) => s.title === 'Final wages paid');
    expect(after.done).toBe(false);
    expect(after.note).toMatch(/last day moved/);
    expect(after.dueDate > before).toBe(true);
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.finalPay).toMatchObject({ paid: false, lastDay: plus(t, 14) });
  });

  it('withdrawn, then leaving again: a fresh plan, with none of the withdrawn steps as done', async () => {
    const e = await person(c, { name: 'Again Anil', code: `AA-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
    const fresh = await steps(e.id);
    await ppl(c, 'post', `/employees/${e.id}/stay`, { reason: 'Stays' }).expect(200);
    expect((await steps(e.id)).total).toBe(0);
    /* Kept on the record. */
    expect(await inTenant(c, () => peoplePrisma.checklistTask.count({ where: { orgId: c.orgId, employeeId: e.id, kind: 'LEAVING_WITHDRAWN' } }))).toBe(fresh.total);
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 20), leavingType: 'RESIGNED' }).expect(200);
    const again = await steps(e.id);
    expect(again).toMatchObject({ total: fresh.total, done: 0 });
    expect(again.tasks.some((s: any) => s.done)).toBe(false);
  });

  it('right after "They stay", the plan’s read says so: active, no last day', async () => {
    const e = await person(c, { name: 'Staying Sita', code: `SS-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
    await ppl(c, 'post', `/leaving/${e.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(200);
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.person).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null });
  });

  it('the interview says whether they can answer it in the app themselves', async () => {
    const e = await person(c, { name: 'No App Naveen', code: `NA-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.interview.appAccess).toBe(false);
    await portalOf(c, e);
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.interview.appAccess).toBe(true);
  });

  it('HR reads and changes whether someone is announced, on their record; a manager reads it only', async () => {
    const e = await person(c, { name: 'Quiet Qadir', code: `QQ-${rnd()}` });
    expect((await ppl(c, 'get', `/employees/${e.id}/celebrations`).expect(200)).body).toEqual({ optedOut: false, canEdit: true });
    await ppl(c, 'put', `/employees/${e.id}/celebrations`, { optedOut: true }).expect(200);
    expect((await ppl(c, 'get', `/employees/${e.id}/celebrations`).expect(200)).body.optedOut).toBe(true);
    await ppl(mgr, 'put', `/employees/${e.id}/celebrations`, { optedOut: false }).expect(403);
  });

  it('why people leave counts those on notice in their month, and leaves out anyone who stayed', async () => {
    const solo = await company();
    const next = `${plus(`${istToday().slice(0, 7)}-01`, 40).slice(0, 7)}-10`;
    const go = await person(solo, { name: 'Going Gita', code: `GG-${rnd()}` });
    const stay = await person(solo, { name: 'Kept Kiran', code: `KK-${rnd()}` });
    for (const e of [go, stay]) {
      await ppl(solo, 'post', `/employees/${e.id}/resign`, { lastDay: next, leavingType: 'RESIGNED' }).expect(200);
      await ppl(solo, 'post', `/leaving/${e.id}/exit-interview`, { answers: { reason: 'PAY', comeBack: 'NO' } }).expect(200);
    }
    await ppl(solo, 'post', `/leaving/${stay.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(200);
    const r = (await ppl(solo, 'get', '/reports/leaving-reasons').expect(200)).body;
    const m = r.months.find((x: any) => x.month === next.slice(0, 7));
    expect(m).toMatchObject({ leavers: 1, answered: 1, retained: 1 });
    expect(r.reasons).toEqual([expect.objectContaining({ code: 'PAY', count: 1 })]);
  });

  it('switched on late in the evening, a greeting waits for the morning; final pay does not', async () => {
    const at2316 = new Date('2026-10-30T17:46:00Z');
    await ppl(c, 'put', '/automations', { automations: { birthdays: { on: true } } }).expect(200);
    const list = await inTenant(c, () => listAutomations(c.orgId, { now: at2316 }));
    expect(list.find((a: any) => a.key === 'birthdays').nextRun).toBe('Tomorrow morning');
    /* Greetings wait; final pay does not (re-review: an evening cut-off lost the s.17(2) notice). */
    expect(mayRunNow('birthdays', at2316)).toBe(false);
    expect(mayRunNow('finalPayDue', at2316)).toBe(true);
    expect(inSendingHours(new Date('2026-10-30T04:30:00Z'))).toBe(true);
    expect(inSendingHours(new Date('2026-10-30T01:00:00Z'))).toBe(false);
  });

  it('paise read as two figures on the line’s note: ₹1,250.50', async () => {
    const e = await person(c, { name: 'Paise Priya', code: `PP-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: e.id, number: `ADV-${rnd()}`, purpose: 'Travel', amount: 1250.5, status: 'PAID' } }));
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 10), leavingType: 'RESIGNED' }).expect(200);
    const fin = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.clearance.lines.find((l: any) => l.dept === 'FINANCE');
    expect(fin.note).toMatch(/₹1,250\.50\b/);
  });
});

describe('re-review of #81: stints, evening notices, who may opt someone out', () => {
  let c: Ctx;
  const wages = (id: string) => inTenant(c, () => peoplePrisma.checklistTask.findMany({ where: { orgId: c.orgId, employeeId: id, kind: 'LEAVING', title: 'Final wages paid' }, orderBy: { createdAt: 'asc' } }));
  beforeAll(async () => {
    c = await company();
  }, 60_000);

  it('a rehire’s moved last day opens this stint’s paid step only, never the last stint’s', async () => {
    const e = await person(c, { name: 'Rehired Rekha', code: `RR-${rnd()}`, dateOfJoining: '2025-06-01' });
    /* The 2025 stint's plan, paid then. */
    await inTenant(c, () => peoplePrisma.checklistTask.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: e.id, kind: 'LEAVING', title: 'Final wages paid', owner: 'PAYROLL', dueDate: '2025-03-03', doneAt: new Date('2025-03-03T06:00:00Z'), doneByUserId: c.userId!, note: 'Paid', createdAt: new Date('2025-02-01T00:00:00Z') } }));
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 5), leavingType: 'RESIGNED' }).expect(200);
    const [old, now] = await wages(e.id);
    await inTenant(c, () => peoplePrisma.checklistTask.update({ where: { id: now.id }, data: { doneAt: new Date(), doneByUserId: c.userId!, note: 'Paid early' } }));
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), 15), leavingType: 'RESIGNED' }).expect(200);
    const [oldAfter, nowAfter] = await wages(e.id);
    expect(oldAfter.id).toBe(old.id);
    expect(oldAfter).toMatchObject({ note: 'Paid', dueDate: '2025-03-03' });
    expect(oldAfter.doneAt).not.toBeNull();
    expect(nowAfter.doneAt).toBeNull();
  });

  it('a past last day corrected after they left moves dates, and a paid step stays paid', async () => {
    const e = await person(c, { name: 'Left Lalit', code: `LL-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(istToday(), -3), leavingType: 'RESIGNED' }).expect(200);
    const [w] = await wages(e.id);
    await inTenant(c, () => peoplePrisma.checklistTask.update({ where: { id: w.id }, data: { doneAt: new Date(), doneByUserId: c.userId!, note: 'Paid' } }));
    const row = await inTenant(c, () => peoplePrisma.employee.findFirst({ where: { id: e.id } }));
    expect(row!.status).toBe('LEFT');
    await inTenant(c, () => leaveEmployee({ accountId: c.accountId!, orgId: c.orgId, userId: c.userId! } as any, row as any, { lastDay: plus(istToday(), -5), leavingType: 'RESIGNED', reason: null }));
    const [after] = await wages(e.id);
    expect(after.doneAt).not.toBeNull();
    expect(after.note).toBe('Paid');
  });

  it('final pay due tomorrow for a resignation that came after the day’s run: the next run says so, once', async () => {
    await ppl(c, 'put', '/automations', { automations: { finalPayDue: { on: true } } }).expect(200);
    const day = istToday();
    /* The day's run has been. */
    await inTenant(c, () => runCompany(c.accountId!, c.orgId));
    const e = await person(c, { name: 'Evening Esha', code: `EE-${rnd()}` });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: plus(day, -2), leavingType: 'RESIGNED' }).expect(200);
    const due = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.finalPay.dueDate as string;
    /* The next morning, whatever the clock: due that day or already past, it is said, once. */
    const next = new Date(`${plus(due, 1)}T04:00:00Z`);
    await inTenant(c, () => runCompany(c.accountId!, c.orgId, next, { respectHours: true }));
    await inTenant(c, () => peoplePrisma.automationRun.deleteMany({ where: { orgId: c.orgId, key: 'finalPayDue' } }));
    await inTenant(c, () => runCompany(c.accountId!, c.orgId, next, { respectHours: true }));
    const notes = await platformPrisma.notification.findMany({ where: { orgId: c.orgId, title: { contains: 'Evening Esha' } } });
    const titles = [...new Set(notes.map((n) => n.title))];
    expect(titles).toEqual([expect.stringMatching(/Final pay for Evening Esha was due on/)]);
  });

  it('at 21:00 IST the time-critical recipes still run; greetings wait for the morning', async () => {
    const solo = await company();
    await ppl(solo, 'put', '/automations', { automations: { finalPayDue: { on: true }, birthdays: { on: true } } }).expect(200);
    const nine = new Date(`${istToday()}T15:30:00Z`);
    await inTenant(solo, () => runCompany(solo.accountId!, solo.orgId, nine, { respectHours: true }));
    const ran = await inTenant(solo, () => peoplePrisma.automationRun.findMany({ where: { orgId: solo.orgId }, select: { key: true } }));
    expect(ran.map((r) => r.key)).toContain('finalPayDue');
    expect(ran.map((r) => r.key)).not.toContain('birthdays');
    const list = await inTenant(solo, () => listAutomations(solo.orgId, { now: nine }));
    expect(list.find((a: any) => a.key === 'birthdays').nextRun).toBe('Tomorrow morning');
    expect(list.find((a: any) => a.key === 'finalPayDue').nextRun).toBe('Tomorrow morning');
  });

  it('only HR, for the whole company, records an opt-out: a custom team role with Employees edit may not', async () => {
    const role = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(at(c)).send({ name: `Team ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: true }).expect(201);
    await request(app).put(`/api/orgs/${c.orgId}/roles/${role.body.role.id}/permissions`).set(at(c)).send({ permissions: ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT'] }).expect(200);
    const email = `team.${Date.now()}.${rnd()}@example.com`;
    const user = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'Team Tara', password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
    await request(app).post(`/api/orgs/${c.orgId}/users/${user.body.user.id}/roles`).set(at(c)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
    const tara: Ctx = { token: (await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200)).body.token, orgId: c.orgId, branchId: c.branchId };
    const boss = await person(c, { name: 'Team Tara', code: `TT-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: user.body.user.id } }));
    const report = await person(c, { name: 'Report Ravi', code: `RV-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: report.id }, data: { reportingManagerId: boss.id } }));
    await ppl(tara, 'put', `/employees/${report.id}/celebrations`, { optedOut: true }).expect(403);
    expect((await ppl(tara, 'get', `/employees/${report.id}/celebrations`).expect(200)).body).toEqual({ optedOut: false, canEdit: false });
  });

  it('the report counts someone who stayed in a month with nobody else, and a withdrawal after "exit confirmed"', async () => {
    const solo = await company();
    const later = `${plus(`${istToday().slice(0, 7)}-01`, 70).slice(0, 7)}-12`;
    const a = await person(solo, { name: 'Stays Sunil', code: `SU-${rnd()}` });
    const b = await person(solo, { name: 'Changed Chitra', code: `CC-${rnd()}` });
    for (const e of [a, b]) await ppl(solo, 'post', `/employees/${e.id}/resign`, { lastDay: later, leavingType: 'RESIGNED' }).expect(200);
    for (const e of [a, b]) await ppl(solo, 'get', `/leaving/${e.id}`).expect(200);
    await ppl(solo, 'post', `/leaving/${a.id}/exit-interview/outcome`, { outcome: 'RETAINED' }).expect(200);
    await ppl(solo, 'post', `/leaving/${b.id}/exit-interview/outcome`, { outcome: 'EXIT_CONFIRMED' }).expect(200);
    await ppl(solo, 'post', `/employees/${b.id}/stay`, { reason: 'Changed her mind' }).expect(200);
    const m = (await ppl(solo, 'get', '/reports/leaving-reasons').expect(200)).body.months.find((x: any) => x.month === later.slice(0, 7));
    expect(m).toMatchObject({ leavers: 0, retained: 2 });
  });
});

describe('retest of #81: a new leaving is always asked afresh', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await company();
  }, 60_000);

  it('withdrawn, recorded again, moved onto the old day: a fresh interview, the old one stays withdrawn and counted once', async () => {
    const e = await person(c, { name: 'Round Vikram', code: `RV-${rnd()}` });
    const first = plus(istToday(), 10);
    const second = plus(istToday(), 20);
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: first, leavingType: 'RESIGNED' }).expect(200);
    await ppl(c, 'post', `/leaving/${e.id}/exit-interview`, { answers: { reason: 'PAY', comeBack: 'MAYBE' } }).expect(200);
    await ppl(c, 'post', `/leaving/${e.id}/exit-interview/outcome`, { couldKeep: 'MAYBE' }).expect(200);
    await ppl(c, 'post', `/employees/${e.id}/stay`, { reason: 'Stays' }).expect(200);
    /* Recorded again on another day, then moved onto the first leaving's day. */
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: second, leavingType: 'RESIGNED' }).expect(200);
    expect((await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.interview).toMatchObject({ status: 'OPEN', enteredBy: null });
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: first, leavingType: 'RESIGNED' }).expect(200);
    const iv = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.interview;
    expect(iv).toMatchObject({ status: 'OPEN', lastDay: first });
    expect(iv.answers).toEqual({});
    expect(iv.couldKeep ?? null).toBeNull();
    /* Recorded again on the very same day as the withdrawn one, straight away: also fresh. */
    const rows = await inTenant(c, () => peoplePrisma.exitInterview.findMany({ where: { orgId: c.orgId, employeeId: e.id }, orderBy: { createdAt: 'asc' } }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ leavingDate: first, status: 'SUBMITTED' });
    expect(rows[0].withdrawnAt).not.toBeNull();
    expect(rows[1]).toMatchObject({ leavingDate: first, status: 'OPEN', withdrawnAt: null, round: 0 });
    const m = (await ppl(c, 'get', '/reports/leaving-reasons').expect(200)).body.months.find((x: any) => x.month === first.slice(0, 7));
    expect(m.retained).toBe(1);
  });

  it('withdrawn twice on the same day in quick succession: both answer 200, rounds 1 and 2, the live one 0', async () => {
    const e = await person(c, { name: 'Twice Tanu', code: `TW-${rnd()}` });
    const day = plus(istToday(), 14);
    for (let i = 0; i < 2; i += 1) {
      await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: day, leavingType: 'RESIGNED' }).expect(200);
      await ppl(c, 'get', `/leaving/${e.id}`).expect(200);
      await ppl(c, 'post', `/employees/${e.id}/stay`, { reason: `Round ${i + 1}` }).expect(200);
    }
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: day, leavingType: 'RESIGNED' }).expect(200);
    await ppl(c, 'get', `/leaving/${e.id}`).expect(200);
    const rows = await inTenant(c, () => peoplePrisma.exitInterview.findMany({ where: { orgId: c.orgId, employeeId: e.id }, orderBy: { round: 'asc' } }));
    expect(rows.map((r) => r.round)).toEqual([0, 1, 2]);
    expect(rows[0].withdrawnAt).toBeNull();
  });

  it('withdrawn and recorded again on the same day at once: fresh, not the old answers', async () => {
    const e = await person(c, { name: 'Same Day Sam', code: `SD-${rnd()}` });
    const day = plus(istToday(), 12);
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: day, leavingType: 'RESIGNED' }).expect(200);
    await ppl(c, 'post', `/leaving/${e.id}/exit-interview`, { answers: { reason: 'PAY', comeBack: 'NO' } }).expect(200);
    await ppl(c, 'post', `/employees/${e.id}/stay`, { reason: 'Stays' }).expect(200);
    await ppl(c, 'post', `/employees/${e.id}/resign`, { lastDay: day, leavingType: 'RESIGNED' }).expect(200);
    const iv = (await ppl(c, 'get', `/leaving/${e.id}`).expect(200)).body.interview;
    expect(iv).toMatchObject({ status: 'OPEN', enteredBy: null });
    expect(iv.answers).toEqual({});
  });
});
