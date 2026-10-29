import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

/**
 * People audit, 30 Oct 2026, batch 2 (access and visibility).
 *
 * Gap 3: HR User, HR Manager and Team Manager were given My attendance VIEW
 * only, so asking for leave and checking in were refused although the buttons
 * showed. The templates now carry CREATE, and a migration brings roles made
 * from them before this change up to the same.
 *
 * Gap 5: Audit evidence and Confidential cases open to a grant or a seat, not
 * a role, so the menu asks the server (`/people/my-access`) whether this
 * person holds a live auditor grant or sits on a case or a committee.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant, outsideTenant } = await import('../utils/tenantScope.js');
const { ROLE_PRESETS, expandPreset } = await import('../constants/permissionCatalog.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `acc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Access Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
/** A colleague holding one of the company's stock roles, by its label ("HR User"), as an owner gives it on Users. */
async function withRole(boss: Ctx, label: string, name = label): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  expect(role, label).toBeTruthy();
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const people = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const att = (c: Ctx, p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
/** An employee file carrying the person's sign-in email, which links it the first time they open their own days. */
const fileFor = (boss: Ctx, who: Ctx, code: string) => people(boss).post('/employees', { name: `Staff ${code}`, code, dateOfJoining: '2026-01-05', workEmail: who.email }).expect(201);
const MY_CREATE = 'ATTENDANCE::My Attendance::CREATE';
const keysOf = (preset: string) => expandPreset(preset).map((r) => `${r.module}::${r.subModule}::${r.action}`);

let boss: Ctx;
beforeAll(async () => {
  boss = await owner();
}, 60_000);

describe('gap 3: People roles may act on their own leave and attendance', () => {
  it('HR User, HR Manager and Team Manager templates carry My attendance CREATE', () => {
    for (const key of ['HR_USER', 'HR_MANAGER', 'TEAM_MANAGER']) {
      const rows = expandPreset(key).map((r) => `${r.module}::${r.subModule}::${r.action}`);
      expect(rows, key).toContain('ATTENDANCE::My Attendance::VIEW');
      expect(rows, key).toContain(MY_CREATE);
    }
    /* Every template that may see its own days may also act on them: no VIEW without CREATE left. */
    for (const key of Object.keys(ROLE_PRESETS)) {
      const rows = expandPreset(key).map((r) => `${r.module}::${r.subModule}::${r.action}`);
      if (rows.includes('ATTENDANCE::My Attendance::VIEW') && key !== 'VIEWER') expect(rows, key).toContain(MY_CREATE);
    }
  });

  it('an HR user and a team manager check in and reach the leave preview; a viewer is refused', async () => {
    for (const [label, code] of [['HR User', 'AC-1'], ['Team Manager', 'AC-2'], ['HR Manager', 'AC-3']] as const) {
      const who = await withRole(boss, label);
      await fileFor(boss, who, code);
      expect((await request(app).get(`/api/orgs/${boss.orgId}/permissions/me`).set(at(who)).expect(200)).body.permissions).toContain(MY_CREATE);
      const clocked = await att(who, '/clock', { direction: 'IN' });
      expect(clocked.status, label).toBe(200);
      expect(clocked.body.kind).toBe('IN');
      /* Allowed through the permission: the answer is about the input, not "Permission denied". */
      const preview = await att(who, '/me/leave/preview', { leaveTypeId: 'none', fromDate: '2026-11-10', toDate: '2026-11-10' });
      expect(preview.status, label).toBe(200);
    }
    const viewer = await withRole(boss, 'Viewer');
    await fileFor(boss, viewer, 'AC-4');
    const refused = await att(viewer, '/clock', { direction: 'IN' }).expect(403);
    expect(refused.body.permission).toMatchObject({ module: 'ATTENDANCE', subModule: 'My Attendance', action: 'CREATE' });
  });

  it('the migration gives what the templates now carry only to roles still exactly the old template', async () => {
    const other = await owner();
    const wide = await owner();
    for (const c of [other, wide]) await request(app).get(`/api/orgs/${c.orgId}/roles`).set(at(c)).expect(200);
    const sql = fs.readFileSync(path.resolve('prisma/platform/migrations/20261102090000_people_role_template_grants/migration.sql'), 'utf8');
    const statements = sql.split(/;\s*\n/).map((st) => st.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    const roleOf = (c: Ctx, name: string) => runInTenant(c.orgId, () => platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, name, branchId: null }, select: { id: true } }));
    const perm = (module: string, subModule: string, action: string) => outsideTenant('test: permission row', () => platformPrisma.permission.findFirstOrThrow({ where: { module, subModule, action } }));
    const create = await perm('ATTENDANCE', 'My Attendance', 'CREATE');
    const perf = await perm('PEOPLE', 'Performance', 'VIEW');
    const empDelete = await perm('PEOPLE', 'Employees', 'DELETE');
    const hrUser = await roleOf(boss, 'HR User');
    const teamMgr = await roleOf(other, 'Team Manager');
    const hrMgr = await roleOf(other, 'HR Manager');
    const wideMgr = await roleOf(wide, 'Team Manager');
    const viewer = await roleOf(boss, 'Viewer');
    const all = [hrUser.id, teamMgr.id, hrMgr.id, wideMgr.id];
    await outsideTenant('test: roles as they were before the change, and as administrators changed some', async () => {
      /* Made from the old templates: no My attendance CREATE, and Team Manager without Performance VIEW. */
      await platformPrisma.rolePermission.deleteMany({ where: { roleId: { in: all }, permissionId: create.id } });
      await platformPrisma.rolePermission.deleteMany({ where: { roleId: { in: [teamMgr.id, wideMgr.id] }, permissionId: perf.id } });
      /* An administrator unticked something on this HR Manager: the roles screen deletes the row, no refusal is kept. */
      await platformPrisma.rolePermission.deleteMany({ where: { roleId: hrMgr.id, permissionId: empDelete.id } });
      /* Someone made this company's Team Manager company-wide: not the team-only template any more. */
      await platformPrisma.role.update({ where: { id: wideMgr.id }, data: { ownDocumentsOnly: false } });
    });
    const grants = (permissionId: string) => outsideTenant('test: read grants', async () => new Set((await platformPrisma.rolePermission.findMany({ where: { permissionId, allowed: true, roleId: { in: [...all, viewer.id] } }, select: { roleId: true } })).map((r) => r.roleId)));
    expect((await grants(create.id)).size).toBe(0);

    const run = () => outsideTenant('test: the role template migration', () => platformPrisma.$transaction(async (tx) => {
      /* As the application role (not a superuser), as production runs it at start. */
      for (const st of statements) await tx.$executeRawUnsafe(st);
    }));
    await run();
    const created = await grants(create.id);
    expect(created.has(hrUser.id)).toBe(true);
    expect(created.has(teamMgr.id)).toBe(true);
    expect(created.has(hrMgr.id)).toBe(false);
    expect(created.has(wideMgr.id)).toBe(false);
    const performance = await grants(perf.id);
    expect(performance.has(teamMgr.id)).toBe(true);
    /* A company-wide role named Team Manager would have opened everyone's goals: it is left alone. */
    expect(performance.has(wideMgr.id)).toBe(false);
    /* Run twice, nothing more changes. */
    await run();
    expect((await grants(create.id)).size).toBe(created.size);
    expect((await grants(perf.id)).size).toBe(performance.size);
  });
});

describe('Talent: a team manager acts on their own team’s goals', () => {
  it('the Team Manager template reads Performance, so a manager sets a report’s goal; not someone else’s, and not a cycle', async () => {
    expect(keysOf('TEAM_MANAGER')).toContain('PEOPLE::Performance::VIEW');
    expect(keysOf('TEAM_MANAGER')).not.toContain('PEOPLE::Performance::EDIT');
    const c = await owner();
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { peoplePerformance: true } }).expect(200);
    const mgr = await withRole(c, 'Team Manager', 'Rahul Lead');
    const mgrEmp = (await people(c).post('/employees', { name: 'Rahul Lead', code: 'TM-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: mgrEmp.id }, data: { userId: mgr.userId } }));
    const report = (await people(c).post('/employees', { name: 'Priya Report', code: 'TM-2', dateOfJoining: '2024-02-01', reportingManagerId: mgrEmp.id }).expect(201)).body.employee;
    const other = (await people(c).post('/employees', { name: 'Arjun Other', code: 'TM-3', dateOfJoining: '2024-02-01' }).expect(201)).body.employee;
    await people(mgr).post('/talent/goals', { employeeId: report.id, title: 'Close the month by the 5th' }).expect(201);
    /* Outside the team the person is not found at all (team scope), rather than refused. */
    await people(mgr).post('/talent/goals', { employeeId: other.id, title: 'Not my team' }).expect(404);
    await people(mgr).post('/talent/cycles', { name: 'FY review', periodFrom: '2026-04-01', periodTo: '2027-03-31' }).expect(403);
  }, 60_000);
});

describe('gap 5: access that comes from a grant or a seat', () => {
  it('says no to someone with neither, whatever their role', async () => {
    const hr = await withRole(boss, 'HR Manager', 'Plain HR');
    expect((await people(hr).get('/my-access').expect(200)).body).toEqual({ auditEvidence: false, privateCases: false });
    expect((await people(boss).get('/my-access').expect(200)).body).toEqual({ auditEvidence: false, privateCases: false });
  });

  it('an auditor with a live grant gets Audit evidence; revoked or another company’s grant does not count', async () => {
    const e = (await people(boss).post('/employees', { name: 'Audit Subject', code: 'AC-10', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const doc = (await people(boss).post(`/employees/${e.id}/documents`, { title: 'Wage register', kind: 'OTHER', classification: 'HR_ONLY', ...file('wages') }).expect(201)).body.document;
    const auditor = await withRole(boss, 'External Auditor', 'Outside Auditor');
    expect((await people(auditor).get('/my-access').expect(200)).body.auditEvidence).toBe(false);
    const grant = (await people(boss).post('/privacy/auditor-grants', { userId: auditor.userId, purpose: 'Statutory audit', documentIds: [doc.id], untilAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body.grant;
    expect((await people(auditor).get('/my-access').expect(200)).body).toEqual({ auditEvidence: true, privateCases: false });

    /* The same user signed into another company sees nothing from this one's grant. */
    const elsewhere = await owner();
    await request(app).post('/api/users').set(at(elsewhere)).send({ email: auditor.email, fullName: 'Outside Auditor', password: 'Passw0rd!23', orgIds: [elsewhere.orgId], branchIdsByOrg: { [elsewhere.orgId]: [elsewhere.branchId] } });
    const there = { ...auditor, orgId: elsewhere.orgId, branchId: elsewhere.branchId };
    const r = await people(there).get('/my-access');
    if (r.status === 200) expect(r.body.auditEvidence).toBe(false);
    else expect([401, 403]).toContain(r.status);
    /* Nor does another person's request in this company with the auditor's id: the route reads the signed-in user only. */
    expect((await people(boss).get(`/my-access?userId=${auditor.userId}`).expect(200)).body.auditEvidence).toBe(false);

    await people(boss).post(`/privacy/auditor-grants/${grant.id}/revoke`, {}).expect(200);
    expect((await people(auditor).get('/my-access').expect(200)).body.auditEvidence).toBe(false);
  });

  it('a committee member or someone named on a case gets Confidential cases, without any People grant', async () => {
    const hr = await colleague(boss, 'Case Officer', ['PEOPLE::Private Cases::VIEW', 'PEOPLE::Private Cases::EDIT', 'PEOPLE::Private Cases::CREATE', 'PEOPLE::Employees::VIEW']);
    const member = await withRole(boss, 'Employee (self-service)', 'Committee Member');
    const named = await withRole(boss, 'Employee (self-service)', 'Named Member');
    const outsider = await withRole(boss, 'Employee (self-service)', 'Not On It');
    expect((await people(member).get('/my-access').expect(200)).body.privateCases).toBe(false);
    await people(hr).put('/private-cases/committee/GRIEVANCE', { members: [{ userId: member.userId, role: 'PRESIDING', gender: 'FEMALE' }] }).expect(200);
    expect((await people(member).get('/my-access').expect(200)).body).toEqual({ auditEvidence: false, privateCases: true });
    /* The committee route itself still needs the grant; the list is theirs. */
    await people(member).get('/private-cases/committee/GRIEVANCE').expect(403);
    await people(member).get('/private-cases').expect(200);

    const c = await runInTenant(boss.orgId, async () => {
      const acc = await platformPrisma.org.findUniqueOrThrow({ where: { id: boss.orgId }, select: { accountId: true } });
      const pc = await peoplePrisma.privateCase.create({ data: { accountId: acc.accountId, orgId: boss.orgId, kind: 'GRIEVANCE', reference: `PC-T-${rnd()}`, respondentEmployeeIds: [], summaryEnc: 'x', incidentOn: '2026-10-01', receivedOn: '2026-10-02', filingDeadline: '2026-12-30', inquiryDue: '2026-12-31', excluded: [] } });
      await peoplePrisma.privateCaseMember.create({ data: { accountId: acc.accountId, orgId: boss.orgId, caseId: pc.id, userId: named.userId, role: 'MEMBER' } });
      return pc;
    });
    expect(c.id).toBeTruthy();
    expect((await people(named).get('/my-access').expect(200)).body.privateCases).toBe(true);
    expect((await people(outsider).get('/my-access').expect(200)).body.privateCases).toBe(false);
    /* The person who takes cases in holds the grant; the menu shows it on that, not on a seat. */
    expect((await people(hr).get('/my-access').expect(200)).body.privateCases).toBe(false);
  });

  it('answers only where People (or Attendance, which shares its people) is on, and only for the company in the address', async () => {
    const off = await owner();
    await request(app).put(`/api/orgs/${off.orgId}/features`).set(at(off)).send({ features: { people: false, attendance: false } }).expect(200);
    expect((await people(off).get('/my-access').expect(403)).body.code).toBe('PEOPLE_DISABLED');
    await request(app).get(`/api/orgs/${off.orgId}/people/my-access`).set(at(boss)).expect(403);
  });
});
