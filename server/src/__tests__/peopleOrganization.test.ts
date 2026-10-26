import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Organization (docs/people/design-v1/ORGANIZATION-DECISIONS.md): department
 * heads, the structure change history, merge, retiring with people moved,
 * the overview, the structure checks in Data Health, branch on the employee,
 * the "Detailed structure" switch and its backfill, and "your department
 * head" in the employee app.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { backfillOrgDetail } = await import('../services/people/organization.js');
const { nameKey } = await import('../services/people/structureHealth.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `orgn.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Orgn Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});
const hire = async (c: Ctx, body: Record<string, unknown>) => (await people(c).post('/employees', { dateOfJoining: '2026-01-05', ...body }).expect(201)).body.employee;
/* Someone who has left, without the leaving flow (that has its own tests). */
const markLeft = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id }, data: { status: 'LEFT', dateOfLeaving: '2026-09-30' } }));
const addBranch = async (c: Ctx, name: string, code: string, isActive = true) => {
  const head = await platformPrisma.branch.findUnique({ where: { id: c.branchId } });
  return platformPrisma.branch.create({ data: { accountId: head!.accountId, orgId: c.orgId, branchCode: code, branchName: name, addressLine1: '1 Main Road', state: 'Karnataka', country: 'India', isActive, createdByUserId: head!.createdByUserId } });
};
const history = async (c: Ctx, q = '') => (await people(c).get(`/structure-history${q}`).expect(200)).body;
const check = async (c: Ctx, id: string) => (await people(c).get('/data-health').expect(200)).body.checks.find((x: any) => x.id === id);

describe('department head', () => {
  it('is someone who works here; a leaver cannot be chosen; the list shows the head and whether they left; null clears', async () => {
    const hr = await owner();
    const meera = await hire(hr, { name: 'Meera Rao', code: 'H-1' });
    const gone = await hire(hr, { name: 'Gone Person', code: 'H-2' });
    await markLeft(hr, gone.id);
    const sales = (await people(hr).post('/structure/departments', { name: 'Sales', headEmployeeId: meera.id }).expect(201)).body.item;
    expect(sales.headEmployeeId).toBe(meera.id);
    expect((await people(hr).post('/structure/departments', { name: 'Accounts', headEmployeeId: gone.id }).expect(400)).body.error).toBe('Choose a head who works here.');
    expect((await people(hr).post('/structure/departments', { name: 'Accounts', headEmployeeId: 'nobody' }).expect(400)).body.error).toBe('Choose a head who works here.');
    let row = (await people(hr).get('/structure/departments').expect(200)).body.items.find((x: any) => x.id === sales.id);
    expect(row).toMatchObject({ headEmployeeId: meera.id, headName: 'Meera Rao', headLeft: false });
    /* The head leaves: still named, flagged; a save that keeps them is not refused, choosing another leaver is. */
    await markLeft(hr, meera.id);
    row = (await people(hr).get('/structure/departments').expect(200)).body.items.find((x: any) => x.id === sales.id);
    expect(row).toMatchObject({ headName: 'Meera Rao', headLeft: true });
    await people(hr).put(`/structure/departments/${sales.id}`, { name: 'Sales', headEmployeeId: meera.id, description: 'Field sales' }).expect(200);
    expect((await people(hr).put(`/structure/departments/${sales.id}`, { name: 'Sales', headEmployeeId: gone.id }).expect(400)).body.error).toBe('Choose a head who works here.');
    await people(hr).put(`/structure/departments/${sales.id}`, { name: 'Sales', headEmployeeId: null }).expect(200);
    row = (await people(hr).get('/structure/departments').expect(200)).body.items.find((x: any) => x.id === sales.id);
    expect(row).toMatchObject({ headEmployeeId: null, headName: null, headLeft: false });
  });
});

describe('structure change history', () => {
  it('logs create, rename, edit, move, retire, reactivate, merge and delete, by name, newest first, paged, with the reason', async () => {
    const hr = await owner();
    const ravi = await hire(hr, { name: 'Ravi Kumar', code: 'C-1' });
    const ops = (await people(hr).post('/structure/departments', { name: 'Ops', reason: 'New warehouse' }).expect(201)).body.item;
    const admin = (await people(hr).post('/structure/departments', { name: 'Admin' }).expect(201)).body.item;
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations', reason: 'Full name' }).expect(200);
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations', description: 'Warehouse and dispatch', headEmployeeId: ravi.id }).expect(200);
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations', parentId: admin.id }).expect(200);
    /* Saving the same thing again is not a change. */
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations' }).expect(200);
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations', isActive: false }).expect(200);
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations', isActive: true }).expect(200);
    const dup = (await people(hr).post('/structure/departments', { name: 'Dispatch' }).expect(201)).body.item;
    await people(hr).post(`/structure/departments/${dup.id}/merge`, { intoId: ops.id, reason: 'Same team' }).expect(200);
    const temp = (await people(hr).post('/structure/departments', { name: 'Temp' }).expect(201)).body.item;
    await people(hr).del(`/structure/departments/${temp.id}`).expect(200);

    const { entries } = await history(hr, '?kind=departments');
    expect(entries.map((e: any) => `${e.itemName}:${e.action}`)).toEqual([
      'Temp:DELETED', 'Temp:CREATED', 'Dispatch:MERGED', 'Dispatch:CREATED', 'Operations:REACTIVATED', 'Operations:RETIRED', 'Operations:MOVED', 'Operations:EDITED', 'Operations:RENAMED', 'Admin:CREATED', 'Ops:CREATED',
    ]);
    const byAction = (a: string, name = 'Operations') => entries.find((e: any) => e.action === a && e.itemName === name);
    expect(byAction('RENAMED')).toMatchObject({ kind: 'departments', kindLabel: 'Department', itemId: ops.id, reason: 'Full name', actorName: 'Asha Owner', changes: [{ field: 'name', label: 'Name', before: 'Ops', after: 'Operations' }] });
    expect(byAction('EDITED').changes).toEqual(expect.arrayContaining([
      { field: 'description', label: 'Description', before: null, after: 'Warehouse and dispatch' },
      { field: 'headEmployeeId', label: 'Head', before: null, after: 'Ravi Kumar' },
    ]));
    expect(byAction('MOVED').changes).toEqual([{ field: 'parentId', label: 'Part of', before: null, after: 'Admin' }]);
    expect(byAction('RETIRED').changes).toEqual([{ field: 'isActive', label: 'In use', before: 'Yes', after: 'No (retired)' }]);
    expect(byAction('MERGED', 'Dispatch')).toMatchObject({ reason: 'Same team', changes: expect.arrayContaining([{ field: 'mergedInto', label: 'Merged into', before: null, after: 'Operations' }]) });
    expect(byAction('DELETED', 'Temp').changes).toEqual([{ field: 'name', label: 'Name', before: 'Temp', after: null }]);
    expect(byAction('CREATED', 'Ops').reason).toBe('New warehouse');

    /* One item, and a page at a time. */
    expect((await history(hr, `?id=${ops.id}`)).entries.map((e: any) => e.action)).toEqual(['REACTIVATED', 'RETIRED', 'MOVED', 'EDITED', 'RENAMED', 'CREATED']);
    const first = await history(hr, '?kind=departments&limit=4');
    expect(first.entries).toHaveLength(4);
    const second = await history(hr, `?kind=departments&limit=4&before=${first.nextBefore}`);
    expect(second.entries.map((e: any) => e.id)).toEqual(entries.slice(4, 8).map((e: any) => e.id));
    /* Other lists are logged too, and filtered by kind. */
    await people(hr).post('/structure/job-positions', { name: 'Picker' }).expect(201);
    expect((await history(hr, '?kind=job-positions')).entries).toEqual([expect.objectContaining({ kind: 'job-positions', kindLabel: 'Designation', itemName: 'Picker', action: 'CREATED' })]);
    await people(hr).get('/structure-history?kind=nonsense').expect(400);
  });
});

describe('merge', () => {
  it('moves people (their history says why), sub-departments, teams and designations; retires the source; refuses bad targets and team-limited roles', async () => {
    const hr = await owner();
    const sales = (await people(hr).post('/structure/departments', { name: 'Sales' }).expect(201)).body.item;
    const salesDup = (await people(hr).post('/structure/departments', { name: 'Sales Dept' }).expect(201)).body.item;
    const sub = (await people(hr).post('/structure/departments', { name: 'Inside sales', parentId: salesDup.id }).expect(201)).body.item;
    const team = (await people(hr).post('/structure/teams', { name: 'North', departmentId: salesDup.id }).expect(201)).body.item;
    const rep = (await people(hr).post('/structure/job-positions', { name: 'Sales rep', departmentId: salesDup.id }).expect(201)).body.item;
    const a = await hire(hr, { name: 'Anu', code: 'M-1', departmentId: salesDup.id });
    const b = await hire(hr, { name: 'Bala', code: 'M-2', departmentId: salesDup.id });
    const left = await hire(hr, { name: 'Left Person', code: 'M-3', departmentId: salesDup.id });
    await markLeft(hr, left.id);

    /* Refused: into itself, a retired one, something inside it, another list, unknown. */
    expect((await people(hr).post(`/structure/departments/${salesDup.id}/merge`, { intoId: salesDup.id }).expect(400)).body.error).toContain('cannot');
    const old = (await people(hr).post('/structure/departments', { name: 'Old', isActive: false }).expect(201)).body.item;
    await people(hr).put(`/structure/departments/${old.id}`, { name: 'Old', isActive: false }).expect(200);
    expect((await people(hr).post(`/structure/departments/${salesDup.id}/merge`, { intoId: old.id }).expect(400)).body.error).toBe('Old is retired. Choose one still in use.');
    expect((await people(hr).post(`/structure/departments/${salesDup.id}/merge`, { intoId: sub.id }).expect(400)).body.error).toContain('inside');
    await people(hr).post(`/structure/departments/${salesDup.id}/merge`, { intoId: rep.id }).expect(400);
    await people(hr).post(`/structure/departments/${salesDup.id}/merge`, {}).expect(400);
    await people(hr).post(`/structure/seats/${salesDup.id}/merge`, { intoId: sales.id }).expect(400);

    /* A team-limited role is refused; so is one without Employees edit. */
    const lead = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Org Structure::VIEW', 'PEOPLE::Org Structure::EDIT'], true);
    expect((await people(lead).post(`/structure/departments/${salesDup.id}/merge`, { intoId: sales.id }).expect(403)).body.error).toContain('whole company');
    const listsOnly = await colleague(hr, ['PEOPLE::Org Structure::VIEW', 'PEOPLE::Org Structure::EDIT']);
    await people(listsOnly).post(`/structure/departments/${salesDup.id}/merge`, { intoId: sales.id }).expect(403);

    const r = (await people(hr).post(`/structure/departments/${salesDup.id}/merge`, { intoId: sales.id, reason: 'Duplicate' }).expect(200)).body;
    expect(r).toMatchObject({ moved: 2, children: 3, item: { id: salesDup.id, isActive: false } });
    for (const p of [a, b]) {
      const e = (await people(hr).get(`/employees/${p.id}`).expect(200)).body.employee;
      expect(e).toMatchObject({ departmentId: sales.id, department: 'Sales' });
      const moved = (await people(hr).get(`/employees/${p.id}/history`).expect(200)).body.events.find((x: any) => x.field === 'departmentId');
      expect(moved).toMatchObject({ from: 'Sales Dept', to: 'Sales', note: 'Merged into Sales' });
    }
    /* Someone who left keeps the department they left from. */
    expect((await people(hr).get(`/employees/${left.id}`).expect(200)).body.employee.departmentId).toBe(salesDup.id);
    const depts = (await people(hr).get('/structure/departments').expect(200)).body.items;
    expect(depts.find((d: any) => d.id === sub.id).parentId).toBe(sales.id);
    expect((await people(hr).get('/structure/teams').expect(200)).body.items.find((t: any) => t.id === team.id).departmentId).toBe(sales.id);
    expect((await people(hr).get('/structure/job-positions').expect(200)).body.items.find((t: any) => t.id === rep.id).departmentId).toBe(sales.id);

    /* Designations: job roles and positions under them move. */
    const rep2 = (await people(hr).post('/structure/job-positions', { name: 'Sales executive' }).expect(201)).body.item;
    const role = (await people(hr).post('/structure/job-roles', { name: 'Key accounts', jobPositionId: rep2.id }).expect(201)).body.item;
    const seat = (await people(hr).post('/structure/seats', { name: 'Exec 1', jobPositionId: rep2.id, teamId: team.id }).expect(201)).body.item;
    const c = await hire(hr, { name: 'Chitra', code: 'M-4', jobPositionId: rep2.id });
    expect((await people(hr).post(`/structure/job-positions/${rep2.id}/merge`, { intoId: rep.id }).expect(200)).body).toMatchObject({ moved: 1, children: 2 });
    expect((await people(hr).get(`/employees/${c.id}`).expect(200)).body.employee).toMatchObject({ jobPositionId: rep.id, designation: 'Sales rep' });
    expect((await people(hr).get('/structure/job-roles').expect(200)).body.items.find((x: any) => x.id === role.id).jobPositionId).toBe(rep.id);
    expect((await people(hr).get('/structure/seats').expect(200)).body.items.find((x: any) => x.id === seat.id).jobPositionId).toBe(rep.id);
  });
});

describe('retire with people', () => {
  it('is refused with the count until a place to move them is chosen; then they move and it is retired, logged', async () => {
    const hr = await owner();
    const stores = (await people(hr).post('/structure/departments', { name: 'Stores' }).expect(201)).body.item;
    const old = (await people(hr).post('/structure/departments', { name: 'Godown' }).expect(201)).body.item;
    const x = await hire(hr, { name: 'Xavier', code: 'R-1', departmentId: old.id });
    await hire(hr, { name: 'Yamini', code: 'R-2', departmentId: old.id });
    const refused = (await people(hr).put(`/structure/departments/${old.id}`, { name: 'Godown', isActive: false }).expect(409)).body;
    expect(refused).toEqual({ code: 'IN_USE', count: 2, error: '2 people are in Godown. Choose where they move, then retire it.' });
    await people(hr).put(`/structure/departments/${old.id}`, { name: 'Godown', isActive: false, moveTo: old.id }).expect(400);
    await people(hr).put(`/structure/departments/${old.id}`, { name: 'Godown', isActive: false, moveTo: 'nope' }).expect(400);
    const done = (await people(hr).put(`/structure/departments/${old.id}`, { name: 'Godown', isActive: false, moveTo: stores.id, reason: 'Closed' }).expect(200)).body;
    expect(done).toMatchObject({ item: { isActive: false }, moved: 2, movedTo: stores.id });
    expect((await people(hr).get(`/employees/${x.id}`).expect(200)).body.employee).toMatchObject({ departmentId: stores.id, department: 'Stores' });
    const [entry] = (await history(hr, `?id=${old.id}`)).entries;
    expect(entry).toMatchObject({ action: 'RETIRED', reason: 'Closed', changes: expect.arrayContaining([{ field: 'peopleMovedTo', label: 'People moved to', before: null, after: 'Stores (2)' }]) });
    /* Nobody left in it: retiring needs nothing more. */
    const empty = (await people(hr).post('/structure/departments', { name: 'Empty' }).expect(201)).body.item;
    await people(hr).put(`/structure/departments/${empty.id}`, { name: 'Empty', isActive: false }).expect(200);
    /* A team-limited role cannot move people this way. */
    const lead = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Org Structure::VIEW', 'PEOPLE::Org Structure::EDIT'], true);
    const other = (await people(hr).post('/structure/departments', { name: 'Other' }).expect(201)).body.item;
    await people(lead).put(`/structure/departments/${stores.id}`, { name: 'Stores', isActive: false, moveTo: other.id }).expect(403);
    /* Into a retired one: refused in words. */
    expect((await people(hr).put(`/structure/departments/${stores.id}`, { name: 'Stores', isActive: false, moveTo: empty.id }).expect(400)).body.error).toBe('Empty is retired. Choose one still in use.');
  });
});

describe('organization overview', () => {
  it('branches, departments with heads and counts, unplaced, list counts, detailed switch and structure checks; a team lead sees their own counts', async () => {
    const hr = await owner();
    const pune = await addBranch(hr, 'Pune', 'PUN');
    const ops = (await people(hr).post('/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    const boss = await hire(hr, { name: 'Boss', code: 'O-1', departmentId: ops.id, branchId: pune.id });
    await people(hr).put(`/structure/departments/${ops.id}`, { name: 'Operations', headEmployeeId: boss.id }).expect(200);
    await hire(hr, { name: 'Worker', code: 'O-2', departmentId: ops.id, reportingManagerId: boss.id, branchId: hr.branchId });
    await hire(hr, { name: 'Floater', code: 'O-3' });
    await hire(hr, { name: 'Joining Later', code: 'O-4', departmentId: ops.id, dateOfJoining: '2099-01-01' });
    const gone = await hire(hr, { name: 'Gone', code: 'O-5', departmentId: ops.id });
    await markLeft(hr, gone.id);
    await people(hr).post('/structure/job-positions', { name: 'Picker' }).expect(201);

    const o = (await people(hr).get('/organization').expect(200)).body;
    expect(o.company.name).toMatch(/^Orgn Co/);
    expect(o.branches.find((b: any) => b.id === pune.id)).toMatchObject({ name: 'Pune', code: 'PUN', state: 'Karnataka', isActive: true, people: 1 });
    expect(o.branches.find((b: any) => b.id === hr.branchId).people).toBe(1);
    expect(o.departments).toEqual([expect.objectContaining({ id: ops.id, name: 'Operations', parentId: null, isActive: true, headEmployeeId: boss.id, headName: 'Boss', headLeft: false, people: 2 })]);
    expect(o.unplaced).toEqual({ noDepartment: 1, noBranch: 1 });
    expect(o.lists).toMatchObject({ designations: 1, teams: 0, positions: 0, units: 0, grades: 0, centres: 0, areas: 0, roles: 0, sites: 0, workModes: 0 });
    expect(o.detailed).toBe(false);
    expect(o.checks.map((c: any) => c.id)).toEqual(['no-branch']);
    expect(o.checks.every((c: any) => c.area === 'Structure')).toBe(true);

    /* A team-limited role: counts for its own people only, and only person rows in the checks. */
    const lead = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    const leadScoped = await colleague(hr, ['PEOPLE::Employees::VIEW'], true);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: leadScoped.userId } }));
    const mine = (await people(leadScoped).get('/organization').expect(200)).body;
    expect(mine.departments[0].people).toBe(2);
    expect(mine.unplaced).toEqual({ noDepartment: 0, noBranch: 0 });
    expect(mine.checks).toEqual([]);
    expect((await people(lead).get('/organization').expect(200)).body.unplaced).toEqual({ noDepartment: 1, noBranch: 1 });
  });
});

describe('structure checks in Data Health', () => {
  it('no head, head who left, retired with people, similar names, team lead who left, no branch; structure rows only for whole-company viewers', async () => {
    const hr = await owner();
    expect(nameKey('Ops Dept.')).toBe(nameKey('operations department'));
    expect(nameKey('HR')).toBe(nameKey('Human Resources'));
    expect(nameKey('Accts')).toBe(nameKey('Accounts'));
    const ops = (await people(hr).post('/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    const opsDup = (await people(hr).post('/structure/departments', { name: 'Ops' }).expect(201)).body.item;
    const hrDept = (await people(hr).post('/structure/departments', { name: 'HR' }).expect(201)).body.item;
    const head = await hire(hr, { name: 'Head Person', code: 'D-1', departmentId: hrDept.id });
    await people(hr).put(`/structure/departments/${hrDept.id}`, { name: 'HR', headEmployeeId: head.id }).expect(200);
    const worker = await hire(hr, { name: 'Worker', code: 'D-2', departmentId: ops.id });
    await people(hr).post('/structure/job-positions', { name: 'Admin Mgr' }).expect(201);
    await people(hr).post('/structure/job-positions', { name: 'Administration Manager' }).expect(201);
    const old = (await people(hr).post('/structure/job-positions', { name: 'Old title' }).expect(201)).body.item;
    await hire(hr, { name: 'Old Title Holder', code: 'D-3', jobPositionId: old.id });
    const lead = await hire(hr, { name: 'Lead Person', code: 'D-4' });
    const team = (await people(hr).post('/structure/teams', { name: 'Night', leadEmployeeId: lead.id }).expect(201)).body.item;
    /* Retired with people: the guard stops it on screen, so made here directly (as an older record would be). */
    await runInTenant(hr.orgId, () => peoplePrisma.jobPosition.update({ where: { id: old.id }, data: { isActive: false } }));

    expect(await check(hr, 'dept-no-head')).toMatchObject({ area: 'Structure', severity: 'TIDY_UP', screen: 'departments', people: [{ id: ops.id, name: 'Operations', code: null, detail: '1 person' }] });
    expect(await check(hr, 'dept-head-left')).toBeUndefined();
    await markLeft(hr, head.id);
    await hire(hr, { name: 'Stays in HR', code: 'D-5', departmentId: hrDept.id });
    expect(await check(hr, 'dept-head-left')).toMatchObject({ severity: 'FIX_SOON', people: [{ id: hrDept.id, name: 'HR', detail: 'Head Person has left' }] });
    expect(await check(hr, 'retired-with-people')).toMatchObject({ severity: 'FIX_SOON', people: [{ id: old.id, name: 'Old title', detail: 'Designation; 1 person' }] });
    const similar = await check(hr, 'similar-names');
    expect(similar.people.map((p: any) => p.name).sort()).toEqual(['Admin Mgr', 'Administration Manager', 'Operations', 'Ops']);
    expect(similar.people.find((p: any) => p.id === opsDup.id).detail).toBe('Department; looks the same as "Operations"');
    expect(await check(hr, 'team-lead-left')).toBeUndefined();
    await markLeft(hr, lead.id);
    expect(await check(hr, 'team-lead-left')).toMatchObject({ screen: 'teams', people: [{ id: team.id, name: 'Night', detail: 'Lead Person has left' }] });
    /* One branch: no branch check. Two: people without one are listed. */
    expect(await check(hr, 'no-branch')).toBeUndefined();
    await addBranch(hr, 'Mysuru', 'MYS');
    /* With one open branch a new hire gets it on their own; with two, someone hired without one is listed. */
    await hire(hr, { name: 'No Branch Yet', code: 'D-9' });
    expect((await check(hr, 'no-branch')).people.map((p: any) => p.name)).toContain('No Branch Yet');

    /* A team lead sees their own people's rows, never a department or team. */
    const scoped = await colleague(hr, ['PEOPLE::Employees::VIEW'], true);
    /* Worker was hired when the company had one branch, so got it on their own; cleared here to be the row in question. */
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: worker.id }, data: { userId: scoped.userId, branchId: null } }));
    const theirs = (await people(scoped).get('/data-health').expect(200)).body.checks.filter((c: any) => c.area === 'Structure');
    expect(theirs.map((c: any) => c.id)).toEqual(['no-branch']);
    expect(theirs[0].people.map((p: any) => p.id)).toEqual([worker.id]);
  });
});

describe('branch on the employee', () => {
  it('is checked on create, update, bulk and import; shows by name; filters and exports; history and scheduled changes name it', async () => {
    const hr = await owner();
    const other = await owner();
    const pune = await addBranch(hr, 'Pune', 'PUN');
    const shut = await addBranch(hr, 'Closed Branch', 'CLS', false);
    await people(hr).post('/employees', { name: 'Wrong Co', code: 'B-0', branchId: other.branchId }).expect(400);
    expect((await people(hr).post('/employees', { name: 'Shut', code: 'B-0', branchId: shut.id }).expect(400)).body.error).toBe('That branch is closed. Choose an open one.');
    const e = await hire(hr, { name: 'Branch Person', code: 'B-1', branchId: hr.branchId });
    const head = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(head.branchName).toBeTruthy();
    await people(hr).put(`/employees/${e.id}`, { branchId: other.branchId }).expect(400);
    const moved = (await people(hr).put(`/employees/${e.id}`, { branchId: pune.id }).expect(200)).body.employee;
    expect(moved).toMatchObject({ branchId: pune.id, branchName: 'Pune' });
    const ev = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.events.find((x: any) => x.field === 'branchId');
    expect(ev).toMatchObject({ from: head.branchName, to: 'Pune' });
    /* A dated move names the branch, not its id. */
    const later = (await people(hr).put(`/employees/${e.id}`, { branchId: hr.branchId, effectiveFrom: '2099-04-01' }).expect(200)).body.scheduled;
    expect(later).toEqual([expect.objectContaining({ field: 'branchId', fromLabel: 'Pune', toLabel: head.branchName })]);

    /* List filter and export column. */
    const f = await hire(hr, { name: 'Head Office Person', code: 'B-2', branchId: hr.branchId });
    const listed = (await people(hr).get(`/employees?branchId=${pune.id}`).expect(200)).body.employees.map((x: any) => x.id);
    expect(listed).toEqual([e.id]);
    const csv = (await people(hr).get(`/employees/export?branchId=${pune.id}&columns=name,branch`).expect(200)).text;
    expect(csv).toContain('Name,Branch');
    expect(csv).toContain('Branch Person,Pune');

    /* Bulk: the platform branch, open, of this company. */
    expect((await people(hr).post('/employees/bulk', { ids: [f.id], set: { branchId: other.branchId } }).expect(400)).body.error).toBe("Choose one of this company's open branches.");
    await people(hr).post('/employees/bulk', { ids: [f.id], set: { branchId: shut.id } }).expect(400);
    expect((await people(hr).post('/employees/bulk', { ids: [f.id], set: { branchId: pune.id } }).expect(200)).body.changed).toBe(1);
    expect((await people(hr).get(`/employees/${f.id}`).expect(200)).body.employee.branchName).toBe('Pune');

    /* Import: by name or code; unknown or closed is that row's error; never created. */
    const imp = (await people(hr).post('/employees/import', { rows: [
      { name: 'By Name', code: 'B-10', branch: 'pune' },
      { name: 'By Code', code: 'B-11', branch: 'PUN' },
      { name: 'Unknown', code: 'B-12', branch: 'Chennai' },
      { name: 'Closed', code: 'B-13', branch: 'Closed Branch' },
    ] }).expect(200)).body;
    expect(imp.results.map((r: any) => r.ok)).toEqual([true, true, false, false]);
    expect(imp.results[2].error).toContain('"Chennai" is not one of the company\'s open branches');
    for (const r of imp.results.slice(0, 2)) expect((await people(hr).get(`/employees/${r.id}`).expect(200)).body.employee.branchId).toBe(pune.id);
    expect(await platformPrisma.branch.count({ where: { orgId: hr.orgId } })).toBe(3);
    const upd = (await people(hr).post('/employees/import', { mode: 'update', rows: [{ name: 'Head Office Person', code: 'B-2', branch: 'PUN' }] }).expect(200)).body;
    expect(upd.results[0].ok).toBe(true);
  });
});

describe('Detailed structure switch', () => {
  it('is off by default; turned on once for a company already using the detailed lists; a company’s own choice stands', async () => {
    const fresh = await owner();
    const features = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
    expect((await features(fresh)).peopleOrgDetail).toBe(false);
    expect((await people(fresh).get('/organization').expect(200)).body.detailed).toBe(false);
    /* Decided once: adding a team later does not turn it on behind the company's back. */
    await people(fresh).post('/structure/teams', { name: 'Later team' }).expect(201);
    expect((await people(fresh).get('/organization').expect(200)).body.detailed).toBe(false);

    /* An existing customer with a team (written before this switch existed). */
    const existing = await owner();
    const accountId = (await platformPrisma.branch.findUnique({ where: { id: existing.branchId } }))!.accountId;
    await runInTenant(existing.orgId, () => peoplePrisma.team.create({ data: { accountId, orgId: existing.orgId, name: 'Old team' } }));
    expect((await people(existing).get('/organization').expect(200)).body.detailed).toBe(true);
    expect((await features(existing)).peopleOrgDetail).toBe(true);

    /* One that switched it off keeps it off. */
    const chose = await owner();
    const chosenAccount = (await platformPrisma.branch.findUnique({ where: { id: chose.branchId } }))!.accountId;
    await request(app).put(`/api/orgs/${chose.orgId}/features`).set(at(chose)).send({ features: { peopleOrgDetail: false } }).expect(200);
    await runInTenant(chose.orgId, () => peoplePrisma.grade.create({ data: { accountId: chosenAccount, orgId: chose.orgId, name: 'G1', createdByUserId: 'x' } }));
    expect((await people(chose).get('/organization').expect(200)).body.detailed).toBe(false);

    /* The boot-time sweep, as the application role under row-level security (maintenance scope). */
    const swept = await owner();
    const sweptAccount = (await platformPrisma.branch.findUnique({ where: { id: swept.branchId } }))!.accountId;
    await runInTenant(swept.orgId, () => peoplePrisma.costCenter.create({ data: { accountId: sweptAccount, orgId: swept.orgId, name: 'CC1', createdByUserId: 'x' } }));
    const r = await backfillOrgDetail();
    expect(r.turnedOn).toBeGreaterThanOrEqual(1);
    expect((await features(swept)).peopleOrgDetail).toBe(true);
    expect((await features(chose)).peopleOrgDetail).toBe(false);
    expect((await backfillOrgDetail()).turnedOn).toBe(0);
  });
});

describe('employee app', () => {
  it('shows the department head beside the manager, unless it is the person themselves or the head has left', async () => {
    const hr = await owner();
    const companyCode = (await request(app).get(`/api/orgs/${hr.orgId}/attendance/portal-access`).set(at(hr)).expect(200)).body.company.code;
    const dept = (await people(hr).post('/structure/departments', { name: 'Kitchen' }).expect(201)).body.item;
    const chef = await hire(hr, { name: 'Chef Head', code: 'E-1', departmentId: dept.id });
    const cook = await hire(hr, { name: 'Line Cook', code: 'E-2', departmentId: dept.id });
    await people(hr).put(`/structure/departments/${dept.id}`, { name: 'Kitchen', headEmployeeId: chef.id }).expect(200);
    const portal = async (e: { id: string; code: string }) => {
      const act = (await request(app).post(`/api/orgs/${hr.orgId}/attendance/portal-access/codes`).set(at(hr)).send({ employeeIds: [e.id] }).expect(200)).body.codes[0].activationCode;
      const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: e.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
      return { Authorization: `Bearer ${token}` };
    };
    const cookApp = await portal(cook);
    expect((await request(app).get('/api/portal/people/me/details').set(cookApp).expect(200)).body.terms.departmentHead).toBe('Chef Head');
    const chefApp = await portal(chef);
    expect((await request(app).get('/api/portal/people/me/details').set(chefApp).expect(200)).body.terms.departmentHead).toBeNull();
    await markLeft(hr, chef.id);
    expect((await request(app).get('/api/portal/people/me/details').set(cookApp).expect(200)).body.terms.departmentHead).toBeNull();
  });
});
