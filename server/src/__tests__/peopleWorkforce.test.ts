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

  it('a change applied a moment ago (an instant approval) is not recorded again by a save made from the older copy', async () => {
    const { updateEmployee } = await import('../services/people/employees.js');
    const lead = (await people(boss).post('/employees', { name: 'Ravi Lead', code: 'W-012' }).expect(201)).body.employee;
    const e = (await people(boss).post('/employees', { name: 'Tara Iyer', code: 'W-011' }).expect(201)).body.employee;
    const stale = await runInTenant(boss.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }));
    const actor = (source: 'APPROVAL' | 'FORM') => ({ accountId: stale.accountId, orgId: boss.orgId, userId: boss.userId, source, correlationId: `corr_${rnd()}` });
    await runInTenant(boss.orgId, () => updateEmployee(actor('APPROVAL'), stale, { reportingManagerId: lead.id }));
    await runInTenant(boss.orgId, () => updateEmployee(actor('FORM'), stale, { reportingManagerId: lead.id }));
    const events = await runInTenant(boss.orgId, () => peoplePrisma.employmentEvent.findMany({ where: { orgId: boss.orgId, employeeId: e.id, kind: 'CHANGED' } }));
    const lines = await runInTenant(boss.orgId, () => peoplePrisma.changeLog.findMany({ where: { orgId: boss.orgId, employeeId: e.id, field: 'reportingManagerId' } }));
    expect(events.filter((x) => x.field === 'reportingManagerId')).toHaveLength(1);
    expect(lines).toHaveLength(1);
    /* A designation picked from the list writes the id and its text copy: the journey shows it once. */
    await put(boss, `/employees/${e.id}`, { designation: 'Clerk', jobPositionId: null }).expect(200);
    const journey = (await people(boss).get(`/employees/${e.id}/journey`).expect(200)).body;
    for (const entry of journey.entries) expect(new Set(entry.changes.map((c: { field: string }) => c.field)).size).toBe(entry.changes.length);
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
    expect(lines[0]).toBe('Employee ID,Name,Preferred name,Work email,Phone,Department,Designation,Manager,Location,Joining date,Status');
    /* Chosen columns come back in the catalogue's order; a key outside it reaches nothing; statutory fields are not in it at all. */
    const catalogue = (await people(boss).get('/employees/export/columns').expect(200)).body.columns;
    expect(catalogue.map((c: { key: string }) => c.key)).not.toEqual(expect.arrayContaining(['pan', 'aadhaarLast4', 'dateOfBirth', 'gender', 'email']));
    const picked = (await people(boss).get('/employees/export?q=W-00&sort=code&columns=status,code,dateOfBirth,devicePassword').expect(200)).text.replace(/^\ufeff/, '').split('\r\n');
    expect(picked[0]).toBe('Employee ID,Status');
    expect(picked[1]).toBe('W-001,Active');
    await people(boss).get('/employees/export?columns=dateOfBirth').expect(400);
    /* Selected rows: only those, and an id from another company adds nothing. */
    const w2 = (await people(boss).get('/employees?q=W-002').expect(200)).body.employees[0];
    const stranger = await owner();
    const foreign = (await people(stranger).post('/employees', { name: 'Elsewhere', code: 'X-1' }).expect(201)).body.employee;
    const sel = (await people(boss).get(`/employees/export?ids=${w2.id},${foreign.id}&columns=code`).expect(200)).text.replace(/^\ufeff/, '').split('\r\n');
    expect(sel).toEqual(['Employee ID', 'W-002']);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['W-001', 'W-002', 'W-003']);
    expect(csv.text).not.toMatch(/portal|Hash|devicePassword/i);
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const { runInTenant } = await import('../utils/tenantScope.js');
    const audits = await runInTenant(boss.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: boss.orgId, entity: 'PEOPLE_EMPLOYEES', action: 'EXPORT' } }));
    expect(audits.map((a) => a.message)).toEqual(expect.arrayContaining(['Exported 3 employees', 'Exported 1 employee']));
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

  it('a save returns the record with its tags, photo kept small, and reader fields', async () => {
    const tag = (await people(boss).post('/tags', { name: 'Night shift', color: '#A45761' }).expect(201)).body.tag;
    const e = (await people(boss).post('/employees', { name: 'Tag Holder', code: 'W-060', tagIds: [tag.id] }).expect(201)).body.employee;
    expect(e.tags.map((t: any) => t.name)).toEqual(['Night shift']);
    const after = (await put(boss, `/employees/${e.id}`, { phone: '9000000060', guardianName: 'R. Holder', workLocation: 'Client site, Whitefield' }).expect(200)).body.employee;
    expect(after.tags.map((t: any) => t.name)).toEqual(['Night shift']);
    expect(after).toMatchObject({ guardianName: 'R. Holder', workLocation: 'Client site, Whitefield' });
    const cleared = (await put(boss, `/employees/${e.id}`, { tagIds: [] }).expect(200)).body.employee;
    expect(cleared.tags).toEqual([]);
    const tagEvent = (await people(boss).get(`/employees/${e.id}/activity`).expect(200)).body.events.find((x: any) => x.changes?.some((c: any) => c.field === 'tags'));
    expect(tagEvent.changes.find((c: any) => c.field === 'tags')).toMatchObject({ label: 'Tags', before: 'Night shift', after: null });
    await put(boss, `/employees/${e.id}`, { photoUrl: `data:image/jpeg;base64,${'A'.repeat(400_000)}` }).expect(400);
  });

  it('filters by grade, business unit, work type, establishment and tag; searches phone and designation; exports a team', async () => {
    const grade = (await people(boss).post('/structure/grades', { name: 'G7' }).expect(201)).body.item;
    const unit = (await people(boss).post('/structure/business-units', { name: 'Retail' }).expect(201)).body.item;
    const tag = (await people(boss).post('/tags', { name: 'Field', color: '#333333' }).expect(201)).body.tag;
    await people(boss).post('/employees', { name: 'Filter Match', code: 'W-070', gradeId: grade.id, businessUnitId: unit.id, tagIds: [tag.id], phone: '9123456789' }).expect(201);
    await people(boss).post('/employees', { name: 'Filter Other', code: 'W-071' }).expect(201);
    for (const q of [`gradeId=${grade.id}`, `businessUnitId=${unit.id}`, `tagId=${tag.id}`, 'q=9123456789']) {
      expect((await people(boss).get(`/employees?${q}`).expect(200)).body.employees.map((e: any) => e.name), q).toEqual(['Filter Match']);
    }
    const csv = (await people(boss).get(`/employees/export?gradeId=${grade.id}`).expect(200)).text;
    expect(csv).toContain('Filter Match');
    expect(csv).not.toContain('Filter Other');
    expect((await people(boss).get('/employees/export?team=mine').expect(200)).text.split('\r\n')).toHaveLength(1);
  });

  it('Pending actions lists dated changes, waiting requests (with whose turn it is) and the caller\'s own drafts', async () => {
    const own = await owner();
    const approver = await colleague(own, 'Approver', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE']);
    const pos = (await people(own).post('/structure/job-positions', { name: 'Lead' }).expect(201)).body.item;
    const dept = (await people(own).post('/structure/departments', { name: 'Ops' }).expect(201)).body.item;
    const e = (await people(own).post('/employees', { name: 'Pending Person', code: 'P-1' }).expect(201)).body.employee;
    const later = new Date(Date.now() + 330 * 60_000 + 20 * 86_400_000).toISOString().slice(0, 10);
    await put(own, `/employees/${e.id}`, { departmentId: dept.id, effectiveFrom: later, changeNote: 'Moving next month' }).expect(200);
    await people(own).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'USER', id: approver.userId }, dueDays: 3 }] }).expect(201);
    await put(own, `/employees/${e.id}`, { jobPositionId: pos.id }).expect(200);
    await put(own, '/employee-drafts', { step: 1, data: { firstName: 'Draft', lastName: 'Joiner' } }).expect(201);
    const mine = (await people(own).get('/workforce/pending').expect(200)).body;
    expect(mine.scheduled).toEqual([expect.objectContaining({ label: 'Department', to: 'Ops', effectiveOn: later, reason: 'Moving next month' })]);
    expect(mine.requests).toEqual([expect.objectContaining({ employee: expect.objectContaining({ name: 'Pending Person' }), mine: false })]);
    expect(mine.drafts.map((d: any) => d.label)).toEqual(['Draft Joiner']);
    const theirs = (await people(approver).get('/workforce/pending').expect(200)).body;
    expect(theirs.requests[0].mine).toBe(true);
    expect(theirs.drafts).toEqual([]);
  });

  it('another company cannot reach any Workforce endpoint of this one, and a colleague without the grants is refused', async () => {
    const e = (await people(boss).post('/employees', { name: 'Isha Rao', code: 'W-090' }).expect(201)).body.employee;
    const d = (await put(boss, '/employee-drafts', { step: 1, data: { firstName: 'Draft' } }).expect(201)).body.draft;
    const stranger = await owner();
    /* The stranger's own token, pointed at this company: refused before any People code runs. */
    const into = (path: string) => request(app).get(`/api/orgs/${boss.orgId}/people${path}`).set({ Authorization: `Bearer ${stranger.token}`, 'x-org-id': boss.orgId, 'x-branch-id': boss.branchId });
    for (const path of ['/employees/counts', '/employees/next-code', '/workforce/pending', '/employees/export', `/employees/${e.id}`, `/employees/${e.id}/activity`, `/employees/${e.id}/journey`, '/employee-drafts', `/employee-drafts/${d.id}`, '/employees?search=Isha']) {
      const r = await into(path);
      expect([401, 403, 404], `${path} answered ${r.status}`).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toContain('Isha');
    }
    /* Through the stranger's own company, this company's record id is simply not there. */
    await people(stranger).get(`/employees/${e.id}`).expect(404);
    await people(stranger).get(`/employees/${e.id}/activity`).expect(404);
    expect((await people(stranger).get('/employees/counts').expect(200)).body.total).toBe(0);
    expect((await people(stranger).get('/workforce/pending').expect(200)).body.drafts).toEqual([]);
    /* A colleague with no People grants at all. */
    const nobody = await colleague(boss, 'No Grants', []);
    for (const path of ['/employees/counts', '/employees/next-code', '/workforce/pending', '/employees/export', `/employees/${e.id}/activity`]) {
      expect(await people(nobody).get(path).then((r) => r.status), path).toBe(403);
    }
  });

  it('refuses a date that does not exist and a phone that is too short, on the form and in an import check', async () => {
    const bad = await people(boss).post('/employees', { name: 'Bad Date', code: 'W-120', dateOfJoining: '2026-13-01' }).expect(400);
    expect(bad.body.error).toMatch(/does not exist/);
    await people(boss).post('/employees', { name: 'Short Phone', code: 'W-121', phone: '98111' }).expect(400);
    await people(boss).post('/employees', { name: 'Fine Phone', code: 'W-122', phone: '+91 98111 00001' }).expect(201);
    const check = (await people(boss).post('/employees/import', { dryRun: true, rows: [
      { name: 'Rohan Mehta', code: 'IM-901', phone: '9811100001', dateOfJoining: '2026-11-03' },
      { name: 'Leela Rao', code: 'IM-902', phone: '98111', dateOfJoining: '2026-11-03' },
      { name: 'Ira Sen', code: 'IM-903', dateOfJoining: '2026-02-30' },
    ] }).expect(200)).body;
    expect(check.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, false]);
  });

  it('CURRENT leaves out people who have left, ALL includes them, a single status narrows; the export follows the same rule', async () => {
    const gone = (await people(boss).post('/employees', { name: 'Gone Person', code: 'W-140', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await people(boss).post(`/employees/${gone.id}/resign`, { lastDay: '2026-10-01', leavingType: 'RESIGNED' });
    const codes = async (status: string) => ((await people(boss).get(`/employees?q=W-140&status=${status}`).expect(200)).body.employees as Array<{ code: string }>).map((e) => e.code);
    expect(await codes('CURRENT')).toEqual([]);
    expect(await codes('ALL')).toEqual(['W-140']);
    expect(await codes('LEFT')).toEqual(['W-140']);
    const csv = (await people(boss).get('/employees/export?q=W-140&status=CURRENT&columns=code').expect(200)).text.replace(/^\ufeff/, '').split('\r\n');
    expect(csv).toEqual(['Employee ID']);
  });

  it('idsOnly gives every id the filters match, within scope, for a bulk change across pages', async () => {
    const r = (await people(boss).get('/employees?q=W-00&idsOnly=1').expect(200)).body;
    expect(r.total).toBe(3);
    expect(r.ids).toHaveLength(3);
    expect(r.capped).toBe(false);
    const lead = await colleague(boss, 'Scoped Lead', ['PEOPLE::Employees::VIEW']);
    const scoped = (await people(lead).get('/employees?q=W-00&idsOnly=1').expect(200)).body;
    expect(scoped.ids.every((id: string) => r.ids.includes(id))).toBe(true);
  });
});

