import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Joining & Leaving (docs/people/design-v1/JOINING-LEAVING-DECISIONS.md):
 * reader removal waits for the readers, final wages fall due in working
 * days, a step can need a note, moved dates move the plan, nobody closes
 * their own plan, a plan that never started is started, one digest a day,
 * the lists keep to the caller's team and keep why someone left private,
 * and the employee app shows a person only their own steps.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { taskDoneToken } = await import('../services/people/checklists.js');
const { checkReaderTasks } = await import('../services/people/lifecycle/readersDone.js');
const { runDigests, startMissingPlans } = await import('../services/people/lifecycle/jobs.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** The next given weekday (0 Sunday … 6 Saturday) at least `min` days ahead. */
const nextWeekday = (wd: number, min: number) => { let d = plus(istToday(), min); while (weekday(d) !== wd) d = plus(d, 1); return d; };

async function owner(name = 'Asha Owner'): Promise<Ctx> {
  const email = `life.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Life Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  patch: (p: string, b?: unknown) => request(app).patch(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const tasksOf = (c: Ctx, employeeId: string, kind: string) => runInTenant(c.orgId, () => peoplePrisma.checklistTask.findMany({ where: { orgId: c.orgId, employeeId, kind }, orderBy: { sortOrder: 'asc' } }));
const reader = async (c: Ctx) => (await request(app).post(`/api/orgs/${c.orgId}/attendance/devices`).set(at(c)).send({ serialNumber: `SN${Date.now()}${rnd()}`.toUpperCase(), name: 'Front door', direction: 'both' }).expect(201)).body.device;

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('reader removal waits for the readers (JCL-A02)', () => {
  it('stays open while queued, closes when every reader confirms, and fails visibly when one refuses', async () => {
    const door = await reader(hr);
    const ok = (await api(hr).post('/employees', { name: 'Kiran Reader', code: 'R-1', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    const bad = (await api(hr).post('/employees', { name: 'Meena Reader', code: 'R-2', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    for (const e of [ok, bad]) await api(hr).post(`/employees/${e.id}/resign`, { lastDay: plus(istToday(), -2), leavingType: 'RESIGNED' }).expect(200);

    const waiting = (await tasksOf(hr, ok.id, 'LEAVING')).find((t) => t.system === 'READERS')!;
    /* Queued is not done: before this fix the task was ticked the moment the commands were queued. */
    expect(waiting).toMatchObject({ systemState: 'WAITING', doneAt: null });
    expect((waiting.systemRefs as number[]).length).toBeGreaterThan(0);
    await api(hr).patch(`/checklist-tasks/${waiting.id}`, { done: true }).expect(409);
    /* Nor can the e-mail link close it. */
    await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.update({ where: { id: waiting.id }, data: { ownerUserId: hr.userId } }));
    expect((await request(app).post(`/api/people/task-links/${taskDoneToken({ id: waiting.id, orgId: hr.orgId, ownerUserId: hr.userId })}`).expect(409)).text).toMatch(/CLOR closes this one itself/);

    /* The reader answers for the first person; refuses for the second. */
    await runInTenant(hr.orgId, async () => {
      await peoplePrisma.deviceCommand.updateMany({ where: { id: { in: waiting.systemRefs as number[] } }, data: { status: 'DONE', doneAt: new Date() } });
      const theirs = (await tasksOf(hr, bad.id, 'LEAVING')).find((t) => t.system === 'READERS')!;
      await peoplePrisma.deviceCommand.updateMany({ where: { id: { in: theirs.systemRefs as number[] } }, data: { status: 'FAILED', lastError: 'User not found' } });
    });
    const run = await checkReaderTasks();
    expect(run.confirmed).toBeGreaterThanOrEqual(1);
    const done = (await tasksOf(hr, ok.id, 'LEAVING')).find((t) => t.system === 'READERS')!;
    expect(done).toMatchObject({ systemState: 'CONFIRMED', doneByUserId: null });
    expect(done.doneAt).not.toBeNull();
    expect(done.note).toMatch(/Every reader confirmed/);

    const failed = (await tasksOf(hr, bad.id, 'LEAVING')).find((t) => t.system === 'READERS')!;
    expect(failed).toMatchObject({ systemState: 'FAILED', doneAt: null });
    expect(failed.note).toMatch(/Front door/);
    const told = await runInTenant(hr.orgId, () => platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, userId: hr.userId, title: { contains: 'Meena Reader' } } }));
    expect(told).not.toBeNull();
    /* A person closes it, saying how. */
    await api(hr).patch(`/checklist-tasks/${failed.id}`, { done: true }).expect(400);
    await api(hr).patch(`/checklist-tasks/${failed.id}`, { done: true, note: 'Deleted at the reader by hand' }).expect(200);
    /* Closed by a person, not confirmed by the reader: the list says so. */
    expect((await api(hr).get('/lifecycle/leavers?view=all').expect(200)).body.rows.find((r: any) => r.id === bad.id).readers).toMatchObject({ state: 'MANUAL', word: 'Removed by hand' });
    /* The list says where each stands. */
    const list = (await api(hr).get('/lifecycle/leavers?view=all').expect(200)).body;
    expect(list.rows.find((r: any) => r.id === ok.id).readers.state).toBe('CONFIRMED');
    void door;
  }, 60_000);

  it('closes at once, saying so, when no reader held the person', async () => {
    const c = await owner();
    const e = (await api(c).post('/employees', { name: 'No Reader', code: 'N-1', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await api(c).post(`/employees/${e.id}/resign`, { lastDay: plus(istToday(), -2), leavingType: 'RESIGNED' }).expect(200);
    const t = (await tasksOf(c, e.id, 'LEAVING')).find((x) => x.system === 'READERS')!;
    expect(t).toMatchObject({ systemState: 'NONE' });
    expect(t.doneAt).not.toBeNull();
    expect(t.note).toMatch(/No reader held them/);
  }, 60_000);
});

describe('final wages in working days, with a payment note (JCL-A03)', () => {
  it('counts two working days past weekly offs and holidays, and refuses to close without a reference', async () => {
    const c = await owner();
    /* Saturday and Sunday off; the Monday after the last day is a holiday. */
    const accountId = (await platformPrisma.org.findUniqueOrThrow({ where: { id: c.orgId } })).accountId;
    await request(app).put(`/api/orgs/${c.orgId}/attendance/leave/working-week`).set(at(c)).send({ weeklyOffDays: '0,6', offSaturdays: '' }).expect(200);
    const friday = nextWeekday(5, 3);
    const monday = plus(friday, 3);
    await runInTenant(c.orgId, () => peoplePrisma.holiday.create({ data: { accountId, orgId: c.orgId, date: monday, name: 'Test holiday', createdByUserId: c.userId } as any }));
    const e = (await api(c).post('/employees', { name: 'Wage Person', code: 'W-1', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await api(c).post(`/employees/${e.id}/resign`, { lastDay: friday, leavingType: 'RESIGNED' }).expect(200);
    const tasks = await tasksOf(c, e.id, 'LEAVING');
    const wages = tasks.find((t) => t.title === 'Final wages paid')!;
    /* Friday + 2 working days: Monday is a holiday, so Tuesday and Wednesday. Calendar counting gave Sunday. */
    expect(wages).toMatchObject({ dueDate: plus(friday, 5), workingDays: true, needsNote: true, offsetDays: 2 });
    expect(tasks.find((t) => t.title.startsWith('Full and final settlement closed'))!.dueDate).toBe(plus(friday, 30));

    await api(c).patch(`/checklist-tasks/${wages.id}`, { done: true }).expect(400);
    await runInTenant(c.orgId, () => peoplePrisma.checklistTask.update({ where: { id: wages.id }, data: { ownerUserId: c.userId } }));
    expect((await request(app).post(`/api/people/task-links/${taskDoneToken({ id: wages.id, orgId: c.orgId, ownerUserId: c.userId })}`).expect(409)).text).toMatch(/needs a note/);
    const after = (await api(c).patch(`/checklist-tasks/${wages.id}`, { done: true, note: 'NEFT UTR 12345' }).expect(200)).body.leaving.tasks.find((t: any) => t.id === wages.id);
    expect(after).toMatchObject({ done: true, note: 'NEFT UTR 12345' });
  }, 60_000);
});

describe('a legal clock does not restart', () => {
  it('a leaving recorded after the last day keeps final wages on their real date, late', async () => {
    const c = await owner();
    await request(app).put(`/api/orgs/${c.orgId}/attendance/leave/working-week`).set(at(c)).send({ weeklyOffDays: '0', offSaturdays: '' }).expect(200);
    /* Last day nine days back: two working days later is well past, whatever the weekday. */
    const last = plus(istToday(), -9);
    const e = (await api(c).post('/employees', { name: 'Late Record', code: 'LR-1', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await api(c).post(`/employees/${e.id}/resign`, { lastDay: last, leavingType: 'RESIGNED' }).expect(200);
    const tasks = await tasksOf(c, e.id, 'LEAVING');
    const wages = tasks.find((t) => t.title === 'Final wages paid')!;
    expect(wages.dueDate! < istToday()).toBe(true);
    expect(wages.dueDate! > last).toBe(true);
    /* Other steps start from today, as before. */
    expect(tasks.find((t) => t.title === 'Exit interview')!.dueDate).toBe(istToday());
    const row = (await api(c).get('/lifecycle/leavers?view=clearing').expect(200)).body.rows.find((r: any) => r.id === e.id);
    expect(row.wages).toMatchObject({ paid: false, late: true });
    expect((await api(c).get('/lifecycle/overview').expect(200)).body.counts.wagesLate).toBe(1);
  }, 60_000);
});

describe('a moved date moves the plan (JCL-A04)', () => {
  it('moves open joining tasks with the joining day, and leaving tasks with the last day while on notice', async () => {
    const doj = plus(istToday(), 20);
    const e = (await api(hr).post('/employees', { name: 'Moved Joiner', code: 'M-1', dateOfJoining: doj }).expect(201)).body.employee;
    const before = await tasksOf(hr, e.id, 'JOINING');
    const salary = before.find((t) => t.title === 'Assign the salary structure')!;
    expect(salary.dueDate).toBe(plus(doj, 3));
    await api(hr).patch(`/checklist-tasks/${before[0].id}`, { done: true }).expect(200);
    await api(hr).put(`/employees/${e.id}`, { dateOfJoining: plus(doj, 7) }).expect(200);
    const after = await tasksOf(hr, e.id, 'JOINING');
    expect(after.find((t) => t.id === salary.id)!.dueDate).toBe(plus(doj, 10));
    /* A done task keeps its date. */
    expect(after.find((t) => t.id === before[0].id)!.dueDate).toBe(before[0].dueDate);

    const last = plus(istToday(), 40);
    const l = (await api(hr).post('/employees', { name: 'Moved Leaver', code: 'M-2', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await api(hr).post(`/employees/${l.id}/resign`, { lastDay: last, leavingType: 'RESIGNED' }).expect(200);
    const handover = (await tasksOf(hr, l.id, 'LEAVING')).find((t) => t.title === 'Handover plan agreed')!;
    expect(handover.dueDate).toBe(plus(last, -7));
    await api(hr).put(`/employees/${l.id}`, { dateOfLeaving: plus(last, 10) }).expect(200);
    expect((await tasksOf(hr, l.id, 'LEAVING')).find((t) => t.id === handover.id)!.dueDate).toBe(plus(last, 3));
  }, 60_000);
});

describe('nobody closes their own plan (JCL-007)', () => {
  it('refuses HR ticking their own leaving tasks while someone else can, and lets a colleague do it', async () => {
    const c = await owner();
    const other = await colleague(c, 'Priya', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT']);
    const me = (await api(c).post('/employees', { name: 'Owner Self', code: 'O-1', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId } }));
    await api(other).post(`/employees/${me.id}/resign`, { lastDay: plus(istToday(), 30), leavingType: 'RESIGNED' }).expect(200);
    const exit = (await tasksOf(c, me.id, 'LEAVING')).find((t) => t.title === 'Exit interview')!;
    const refused = await api(c).patch(`/checklist-tasks/${exit.id}`, { done: true }).expect(403);
    expect(refused.body.code).toBe('OWN_PLAN');
    await api(c).patch(`/checklist-tasks/${exit.id}`, { ownerUserId: c.userId }).expect(403);
    expect((await api(c).get(`/lifecycle/tasks?view=open&employeeId=${me.id}`).expect(200)).body.rows.find((t: any) => t.id === exit.id).ownPlan).toBe(true);
    await api(other).patch(`/checklist-tasks/${exit.id}`, { done: true }).expect(200);
  }, 60_000);
});

describe('steps a company sets', () => {
  it('keeps working days, a needed note and employment types, refuses another company\'s types, and logs the save', async () => {
    const c = await owner();
    const got = (await api(c).get('/structure/employee-types').expect(200)).body;
    let list = got.items || got.rows || got;
    if (list.length < 2) {
      await api(c).post('/structure/employee-types', { name: 'Permanent' }).expect(201);
      await api(c).post('/structure/employee-types', { name: 'Contractor' }).expect(201);
      const again = (await api(c).get('/structure/employee-types').expect(200)).body;
      list = again.items || again.rows || again;
    }
    const contractor = list.find((t: any) => /contract/i.test(t.name)) || list[0];
    const permanent = list.find((t: any) => t.id !== contractor.id);
    await api(c).put('/checklist-templates/JOINING', { items: [{ title: 'Everyone', owner: 'HR', dueDays: 0 }, { title: 'PF form', owner: 'PAYROLL', dueDays: 3, workingDays: true, needsNote: true, types: [permanent.id] }] }).expect(200);
    await api(c).put('/checklist-templates/JOINING', { items: [{ title: 'Bad', owner: 'HR', dueDays: 0, types: ['not-a-type'] }] }).expect(400);
    const saved = (await api(c).get('/checklist-templates').expect(200)).body.joining.items;
    expect(saved[1]).toMatchObject({ workingDays: true, needsNote: true, types: [permanent.id] });
    const a = (await api(c).post('/employees', { name: 'Perm One', code: 'T-1', dateOfJoining: plus(istToday(), 10), employeeTypeId: permanent.id }).expect(201)).body.employee;
    const b = (await api(c).post('/employees', { name: 'Contract One', code: 'T-2', dateOfJoining: plus(istToday(), 10), employeeTypeId: contractor.id }).expect(201)).body.employee;
    expect((await tasksOf(c, a.id, 'JOINING')).map((t) => t.title)).toEqual(['Everyone', 'PF form']);
    expect((await tasksOf(c, b.id, 'JOINING')).map((t) => t.title)).toEqual(['Everyone']);
    const audit = await runInTenant(c.orgId, () => platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'ChecklistTemplate' } }));
    expect(audit).not.toBeNull();
  }, 60_000);
});

describe('a plan that never started is started (JCL-A01)', () => {
  it('shows Plan not started on the list, and the job starts it once', async () => {
    const c = await owner();
    const e = (await api(c).post('/employees', { name: 'Lost Plan', code: 'L-1', dateOfJoining: plus(istToday(), 5) }).expect(201)).body.employee;
    await runInTenant(c.orgId, async () => {
      await peoplePrisma.checklistTask.deleteMany({ where: { orgId: c.orgId, employeeId: e.id } });
      await peoplePrisma.employee.update({ where: { id: e.id }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
    });
    const before = (await api(c).get('/lifecycle/joiners?view=preparing').expect(200)).body.rows.find((r: any) => r.id === e.id);
    expect(before.stage).toBe('NO_PLAN');
    await startMissingPlans();
    await startMissingPlans();
    const tasks = await tasksOf(c, e.id, 'JOINING');
    expect(tasks.length).toBe(8);
    expect((await api(c).get('/lifecycle/joiners?view=preparing').expect(200)).body.rows.find((r: any) => r.id === e.id).stage).toBe('PREPARING');
  }, 60_000);
});

describe('lists keep to the team, and leaving stays private (JCL-006, JCL-009)', () => {
  it('a team lead sees their own team, never why someone leaves; someone without the Employees right sees only their own tasks', async () => {
    const c = await owner();
    const lead = await colleague(c, 'Lead', ['PEOPLE::Employees::VIEW'], true);
    const it = await colleague(c, 'Imran', ['PEOPLE::Assets::VIEW', 'PEOPLE::Assets::EDIT']);
    const leadEmp = (await api(c).post('/employees', { name: 'Lead Person', code: 'S-0', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
    const mine = (await api(c).post('/employees', { name: 'Team Joiner', code: 'S-1', dateOfJoining: plus(istToday(), 4), reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    const other = (await api(c).post('/employees', { name: 'Other Joiner', code: 'S-2', dateOfJoining: plus(istToday(), 4) }).expect(201)).body.employee;
    const leaver = (await api(c).post('/employees', { name: 'Team Leaver', code: 'S-3', dateOfJoining: '2024-01-01', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    await api(c).post(`/employees/${leaver.id}/resign`, { lastDay: plus(istToday(), 20), leavingType: 'TERMINATED', reason: 'Misconduct' }).expect(200);

    const theirs = (await api(lead).get('/lifecycle/joiners?view=week').expect(200)).body;
    expect(theirs.rows.map((r: any) => r.id)).toEqual([mine.id]);
    const all = (await api(c).get('/lifecycle/joiners?view=week').expect(200)).body;
    expect(all.rows.map((r: any) => r.id).sort()).toEqual([mine.id, other.id].sort());
    expect(all.counts.week).toBe(2);

    const leadView = (await api(lead).get('/lifecycle/leavers?view=notice').expect(200)).body.rows.find((r: any) => r.id === leaver.id);
    expect(leadView).toBeTruthy();
    expect(leadView.leavingType).toBeUndefined();
    expect(leadView.leavingReason).toBeUndefined();
    const hrView = (await api(c).get('/lifecycle/leavers?view=notice').expect(200)).body.rows.find((r: any) => r.id === leaver.id);
    expect(hrView).toMatchObject({ leavingType: 'TERMINATED', leavingReason: 'Misconduct', stage: 'NOTICE' });
    await api(lead).get(`/lifecycle/leaving-preview/${other.id}`).expect(404);

    /* IT has no Employees right: only their own tasks, whatever view is asked for. */
    const itTask = (await tasksOf(c, leaver.id, 'LEAVING')).find((t) => t.owner === 'IT')!;
    await runInTenant(c.orgId, () => peoplePrisma.checklistTask.update({ where: { id: itTask.id }, data: { ownerUserId: it.userId } }));
    const q = (await api(it).get('/lifecycle/tasks?view=open').expect(200)).body;
    expect(q.mineOnly).toBe(true);
    expect(q.rows.map((t: any) => t.id)).toEqual([itTask.id]);
    expect(q.rows[0].canClose).toBe(true);
    /* The lead sees their team's tasks but closes only their own. */
    const leadQueue = (await api(lead).get('/lifecycle/tasks?view=open').expect(200)).body;
    expect(leadQueue.rows.length).toBeGreaterThan(0);
    expect(leadQueue.rows.every((t: any) => t.canClose === (t.ownerUserId === lead.userId))).toBe(true);
    await api(it).get('/lifecycle/joiners').expect(403);
    const hrQueue = (await api(c).get('/lifecycle/tasks?view=open&q=Team%20Leaver').expect(200)).body;
    expect(hrQueue.total).toBeGreaterThan(1);

    const ov = (await api(c).get('/lifecycle/overview').expect(200)).body;
    expect(ov.counts.startingThisWeek).toBe(2);
    expect((await api(lead).get('/lifecycle/overview').expect(200)).body.counts.startingThisWeek).toBe(1);
  }, 90_000);
});

describe('one digest a day (JCL-060)', () => {
  it('sends each owner one notice listing what is due or late, and not again that day', async () => {
    const c = await owner();
    const e = (await api(c).post('/employees', { name: 'Digest Joiner', code: 'D-1', dateOfJoining: plus(istToday(), -1) }).expect(201)).body.employee;
    await runInTenant(c.orgId, () => peoplePrisma.checklistTask.updateMany({ where: { orgId: c.orgId, employeeId: e.id }, data: { ownerUserId: c.userId, dueDate: plus(istToday(), -1) } }));
    const tenAm = new Date(`${istToday()}T10:00:00+05:30`);
    await runDigests(tenAm);
    await runDigests(new Date(tenAm.getTime() + 3_600_000));
    const notes = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: c.userId, dedupeKey: { startsWith: 'lifecycle-digest:' } } }));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toMatch(/Digest Joiner/);
    /* Before 9 am nothing goes. */
    expect(await runDigests(new Date(`${istToday()}T08:00:00+05:30`))).toBe(0);
  }, 60_000);
});

describe('the employee app (JCL-041)', () => {
  it('shows a person their own steps and hand-back items, and lets them tick only their own', async () => {
    const c = await owner();
    const companyCode = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
    await api(c).put('/checklist-templates/LEAVING', { items: [{ title: 'Write handover notes', owner: 'EMPLOYEE', dueDays: -3 }, { title: 'Exit interview', owner: 'HR', dueDays: -1, note: 'HR only: was unhappy with pay' }] }).expect(200);
    const e = (await api(c).post('/employees', { name: 'App Leaver', code: 'A-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await api(c).post('/workspace/assets', { title: 'Laptop', status: 'ASSIGNED', employeeId: e.id, details: { assetTag: 'LT-9' } }).expect(201);
    await api(c).post(`/employees/${e.id}/resign`, { lastDay: plus(istToday(), 15), leavingType: 'RESIGNED' }).expect(200);
    const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [e.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'A-1', activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
    const portal = { Authorization: `Bearer ${token}` };
    const j = (await request(app).get('/api/portal/people/me/journey').set(portal).expect(200)).body;
    expect(j.leaving.map((t: any) => t.title).sort()).toEqual(['Return Laptop (LT-9)', 'Write handover notes']);
    expect(JSON.stringify(j)).not.toMatch(/unhappy|Exit interview/);
    expect(j.handBack).toEqual([expect.objectContaining({ title: 'Return Laptop (LT-9)', mine: false })]);
    const own = j.leaving.find((t: any) => t.mine);
    await request(app).post(`/api/portal/people/me/journey/tasks/${j.handBack[0].id}/done`).set(portal).send({}).expect(404);
    await request(app).post(`/api/portal/people/me/journey/tasks/${own.id}/done`).set(portal).send({}).expect(200);
    expect((await request(app).get('/api/portal/people/me/journey').set(portal).expect(200)).body.leaving.find((t: any) => t.id === own.id).done).toBe(true);
    const log = await runInTenant(c.orgId, () => peoplePrisma.changeLog.findFirst({ where: { orgId: c.orgId, entity: 'ChecklistTask', entityId: own.id, field: 'done' } }));
    expect(log).toMatchObject({ source: 'SELF_SERVICE', after: 'yes' });
  }, 60_000);
});
