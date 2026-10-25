import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Workforce backend (People design spec v1, Module 01): directory sort,
 * filters and counts; the next employee ID; a stale edit refused with 409;
 * the preferred name; add-employee drafts that only their maker sees; the
 * directory export behind its own grant, audited, with no secrets.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `wf.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Workforce Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\s/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}

const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let boss: Ctx;
beforeAll(async () => {
  boss = await owner();
}, 120_000);
const put = (c: Ctx, path: string, body: unknown, headers: Record<string, string> = {}) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...headers }).send(body as any);

describe('workforce backend', () => {
  it('sorts, filters by joining date and location, and counts joiners and people on leave', async () => {
    const site = (await people(boss).post('/structure/areas', { name: 'Pune plant' }).expect(201)).body.item;
    const future = new Date(Date.now() + 330 * 60_000 + 10 * 86_400_000).toISOString().slice(0, 10);
    await people(boss).post('/employees', { name: 'Zoya Ali', code: 'W-003', dateOfJoining: '2024-03-01' }).expect(201);
    await people(boss).post('/employees', { name: 'Arun Bose', code: 'W-001', dateOfJoining: '2025-06-01', areaId: site.id }).expect(201);
    await people(boss).post('/employees', { name: 'Mira Sen', code: 'W-002', dateOfJoining: future }).expect(201);
    const byCode = (await people(boss).get('/employees?sort=code&dir=desc&limit=25').expect(200)).body.employees.map((e: any) => e.code);
    expect(byCode).toEqual(['W-003', 'W-002', 'W-001']);
    /* Every sortable column answers, in both directions. */
    for (const sort of ['name', 'code', 'department', 'designation', 'dateOfJoining', 'status', 'location']) {
      for (const dir of ['asc', 'desc']) await people(boss).get(`/employees?sort=${sort}&dir=${dir}&limit=25`).expect(200);
    }
    expect((await people(boss).get('/employees?sort=name').expect(200)).body.employees.map((e: any) => e.name)).toEqual(['Arun Bose', 'Mira Sen', 'Zoya Ali']);
    const joined = (await people(boss).get('/employees?joinedFrom=2025-01-01&joinedTo=2025-12-31').expect(200)).body.employees.map((e: any) => e.name);
    expect(joined).toEqual(['Arun Bose']);
    expect((await people(boss).get(`/employees?areaId=${site.id}`).expect(200)).body.employees.map((e: any) => e.name)).toEqual(['Arun Bose']);
    const counts = (await people(boss).get('/employees/counts').expect(200)).body;
    expect(counts).toMatchObject({ total: 3, active: 3, joining: 1, onLeave: 0 });
  });

  it('suggests the next employee ID from the company pattern', async () => {
    expect((await people(boss).get('/employees/next-code').expect(200)).body.code).toBe('W-004');
    const { nextCode } = await import('../routes/people.js');
    expect(nextCode([])).toBe('EMP-0001');
    expect(nextCode(['EMP-009', 'EMP-010', 'X1'])).toBe('EMP-011');
  });

  it('refuses an edit made against an older version, and returns the current record', async () => {
    const e = (await people(boss).post('/employees', { name: 'Kabir Rao', code: 'W-010' }).expect(201)).body.employee;
    expect(e.version).toBe(1);
    const saved = (await put(boss, `/employees/${e.id}`, { phone: '9000000010', preferredName: 'Kabs', version: 1 }).expect(200)).body.employee;
    expect(saved).toMatchObject({ version: 2, preferredName: 'Kabs' });
    const stale = (await put(boss, `/employees/${e.id}`, { phone: '9000000011', version: 1 }).expect(409)).body;
    expect(stale).toMatchObject({ code: 'STALE', employee: { phone: '9000000010', version: 2 } });
    await put(boss, `/employees/${e.id}`, { phone: '9000000011' }, { 'If-Match': '"1"' }).expect(409);
    await put(boss, `/employees/${e.id}`, { phone: '9000000011' }, { 'If-Match': '"2"' }).expect(200);
    /* An edit that names no version still saves, for older clients. */
    await put(boss, `/employees/${e.id}`, { phone: '9000000012' }).expect(200);
  });

  it('a draft is its maker\'s alone, never keeps statutory numbers, and goes when the person is created from it', async () => {
    const other = await colleague(boss, 'Other HR', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::CREATE']);
    const d = (await put(boss, '/employee-drafts', { step: 2, data: { firstName: 'Tara', lastName: 'Iyer', pan: 'ABCDE1234F', email: 'tara@example.com' } }).expect(201)).body.draft;
    expect(d).toMatchObject({ step: 2, label: 'Tara Iyer' });
    expect(d.data.pan).toBeUndefined();
    expect((await people(other).get('/employee-drafts').expect(200)).body.drafts).toEqual([]);
    await people(other).get(`/employee-drafts/${d.id}`).expect(404);
    await put(other, `/employee-drafts/${d.id}`, { data: { firstName: 'x' } }).expect(404);
    const upd = (await put(boss, `/employee-drafts/${d.id}`, { step: 3, data: { firstName: 'Tara', lastName: 'Iyer', departmentId: null } }).expect(200)).body.draft;
    expect(upd.step).toBe(3);
    await people(boss).post('/employees', { firstName: 'Tara', lastName: 'Iyer', code: 'W-020', draftId: d.id }).expect(201);
    expect((await people(boss).get('/employee-drafts').expect(200)).body.drafts).toEqual([]);
  });

  it('exports the filtered directory only with the export grant, audited, and without secrets', async () => {
    const viewer = await colleague(boss, 'Viewer', ['PEOPLE::Employees::VIEW']);
    await people(viewer).get('/employees/export').expect(403);
    const csv = await people(boss).get('/employees/export?q=W-00&sort=code').expect(200);
    const lines = csv.text.replace(/^\ufeff/, '').split('\r\n');
    expect(lines[0]).toBe('Employee ID,Name,Preferred name,Work email,Phone,Department,Designation,Reports to,Location,Joined,Status');
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['W-001', 'W-002', 'W-003']);
    expect(csv.text).not.toMatch(/portal|Hash|devicePassword/i);
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const { runInTenant } = await import('../utils/tenantScope.js');
    const audit = await runInTenant(boss.orgId, () => platformPrisma.auditLog.findFirst({ where: { orgId: boss.orgId, entity: 'PEOPLE_EMPLOYEES', action: 'EXPORT' } }));
    expect(audit?.message).toBe('Exported 3 employees');
  });

  it('Activity: changes, documents, comments and approvals, newest first, redacted for a viewer with less access', async () => {
    const senior = (await people(boss).post('/structure/job-positions', { name: 'Lead analyst' }).expect(201)).body.item;
    const e = (await people(boss).post('/employees', { name: 'Ritu Das', code: 'W-030' }).expect(201)).body.employee;
    await put(boss, `/employees/${e.id}`, { jobPositionId: senior.id, changeNote: 'Promotion' }).expect(200);
    await put(boss, `/employees/${e.id}/identity`, { passportNumber: 'Z1234567' }).expect(200);
    const file = { data: `data:text/plain;base64,${Buffer.from('x').toString('base64')}`, mime: 'text/plain' };
    await people(boss).post(`/employees/${e.id}/documents`, { title: 'Offer letter', kind: 'OTHER', classification: 'HR_ONLY', ...file }).expect(201);
    const med = (await people(boss).post(`/employees/${e.id}/documents`, { title: 'Medical note', kind: 'OTHER', classification: 'CONFIDENTIAL', ...file }).expect(201)).body.document;
    await people(boss).post(`/employees/${e.id}/notes`, { body: 'Spoke to the manager about the move.' }).expect(201);
    await request(app).delete(`/api/orgs/${boss.orgId}/people/documents/${med.id}`).set(at(boss)).expect(200);

    const all = (await people(boss).get(`/employees/${e.id}/activity`).expect(200)).body.events;
    const types = all.map((x: any) => x.type);
    expect(types).toEqual(expect.arrayContaining(['create', 'update', 'upload', 'comment']));
    expect(all[all.length - 1]).toMatchObject({ type: 'create', title: 'Employee created', actor: 'Owner' });
    const promo = all.find((x: any) => x.changes?.some((c: any) => c.field === 'jobPositionId'));
    expect(promo.changes.find((c: any) => c.field === 'jobPositionId')).toMatchObject({ after: 'Lead analyst', redacted: false });
    expect(promo.reason).toBe('Promotion');
    /* The designation text copy does not repeat the change. */
    expect(promo.changes.filter((c: any) => c.label === 'Designation')).toHaveLength(1);
    expect(all.find((x: any) => x.title === 'Identity details updated')).toBeTruthy();
    /* The removed file's upload goes with its row; its removal stays on the trail. */
    expect(all.some((x: any) => x.title === 'Uploaded Medical note')).toBe(false);
    expect(all.some((x: any) => x.changes?.some((c: any) => c.field === 'document' && c.before === 'Medical note'))).toBe(true);
    const times = all.map((x: any) => x.at);
    expect([...times].sort().reverse()).toEqual(times);

    const viewer = await colleague(boss, 'Line Viewer', ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW']);
    const seen = (await people(viewer).get(`/employees/${e.id}/activity`).expect(200)).body.events;
    expect(seen.some((x: any) => x.type === 'comment')).toBe(false);
    expect(seen.some((x: any) => /Medical note/.test(x.title))).toBe(false);
    expect(seen.some((x: any) => x.title === 'Uploaded Offer letter')).toBe(true);
    const identity = seen.find((x: any) => x.title === 'Identity details updated');
    expect(identity.changes.every((c: any) => c.redacted && c.before === null && c.after === null)).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('Z1234567');

    /* D-V8: the platform audit row for the same request carries its id, and Activity does not repeat it. */
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const { runInTenant } = await import('../utils/tenantScope.js');
    const rows = await runInTenant(boss.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: boss.orgId, entityId: e.id } }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => typeof r.correlationId === 'string' && r.correlationId.length > 0)).toBe(true);
    const ids = all.map((x: any) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.filter((x: any) => x.source === 'PLATFORM' && /employee/i.test(x.title) && x.type === 'update')).toEqual([]);

    const stranger = await owner();
    await people(stranger).get(`/employees/${e.id}/activity`).expect(404);
  });

  it('suspends and reactivates through the edit, but someone who has left only comes back through Rehire', async () => {
    const e = (await people(boss).post('/employees', { name: 'Omar Shah', code: 'W-040', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await put(boss, `/employees/${e.id}`, { status: 'SUSPENDED', changeNote: 'Inquiry' }).expect(200);
    await put(boss, `/employees/${e.id}`, { status: 'ACTIVE' }).expect(200);
    await put(boss, `/employees/${e.id}`, { status: 'LEFT', dateOfLeaving: '2026-09-30' }).expect(200);
    expect((await put(boss, `/employees/${e.id}`, { status: 'ACTIVE' }).expect(409)).body.code).toBe('USE_REHIRE');
    await people(boss).post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-10-05' }).expect(200);
  });

  it('My team lists the caller\'s own reports, and counts them', async () => {
    const lead = await colleague(boss, 'Team Lead', ['PEOPLE::Employees::VIEW']);
    const me = (await people(boss).post('/employees', { name: 'Lead Person', code: 'W-050' }).expect(201)).body.employee;
    const { runInTenant } = await import('../utils/tenantScope.js');
    const { peoplePrisma } = await import('../utils/peoplePrisma.js');
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: lead.userId } }));
    await people(boss).post('/employees', { name: 'Report One', code: 'W-051', reportingManagerId: me.id }).expect(201);
    await people(boss).post('/employees', { name: 'Dotted Two', code: 'W-052', dottedManagerId: me.id }).expect(201);
    const team = (await people(lead).get('/employees?team=mine').expect(200)).body;
    expect(team.employees.map((e: any) => e.name).sort()).toEqual(['Dotted Two', 'Report One']);
    expect((await people(lead).get('/employees/counts').expect(200)).body.myTeam).toBe(2);
    expect((await people(boss).get('/employees?team=mine').expect(200)).body).toMatchObject({ employees: [], total: 0 });
  });
});
