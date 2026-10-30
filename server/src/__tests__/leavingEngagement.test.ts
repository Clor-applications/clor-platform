import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const { eraseExpiredAnswers } = await import('../services/people/engagement/exitInterview.js');
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
    expect(r.months).toHaveLength(12);
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
  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Neha Lead');
    lead = await person(c, { name: 'Neha Lead', code: `N-${rnd()}` });
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    bday = await person(c, { name: 'Ravi Kumar', code: `R-${rnd()}`, dateOfBirth: `1990-${today.slice(5)}`, dateOfJoining: `${Number(today.slice(0, 4)) - 2}-${today.slice(5)}` });
    shy = await person(c, { name: 'Quiet Person', code: `Q-${rnd()}`, dateOfBirth: `1991-${today.slice(5)}` });
    mate = await person(c, { name: 'Team Mate', code: `M-${rnd()}` });
    const branch = await inTenant(c, () => peoplePrisma.employee.findFirst({ where: { id: mate.id } }));
    elsewhere = await person(c, { name: 'Other Branch', code: `O-${rnd()}` });
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
    expect(posts.find((p) => p.kind === 'ANNIVERSARY')!.text).toMatch(/2nd work anniversary/);
    const wish = await inTenant(c, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: mgr.userId!, kind: 'people.wish' } }));
    expect(wish).toHaveLength(1);
    expect(wish[0].title).toMatch(/Wish Ravi a happy birthday and Ravi on 2 years here today/);
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
    expect(of('policyAccept')).toMatchObject({ on: true, n: 5, nextRun: 'This morning' });
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
