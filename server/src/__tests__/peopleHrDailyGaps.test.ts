import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * HR daily gaps (FEATURE-UI-AUDIT 30 Oct 2026, batch 3): the routes the new
 * screens lean on, each checked for who may, who may not, another company and
 * a team-limited role. Document acceptance on the record's list, a comment
 * its author takes back, the probation review with the reviewer's name,
 * People approval delegates named by their record, offers and joining forms
 * kept to a team, policies for one person, import undo racing itself, bulk
 * change of the newer fields, and held statutory details sent to Payroll.
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
async function owner(features: Record<string, boolean> = {}): Promise<Ctx> {
  const email = `hrgap.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Kavya HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Asha Textiles ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, peopleOrgDetail: true, ...features } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
/** A colleague holding these permissions, on a role limited to their own team when asked. */
async function colleague(boss: Ctx, permissions: string[], ownOnly = false, name = 'Colleague'): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});
/** The same path, aimed at another company's id while signed in to this one. */
const crossed = (c: Ctx, other: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${other.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${other.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ mime: 'text/plain', data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` });
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));

let hr: Ctx;
let other: Ctx;
let manager: Ctx;
let rahul: any;
let priya: any;
let arjun: any;
beforeAll(async () => {
  hr = await owner({ payroll: false });
  other = await owner();
  manager = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Lifecycle::VIEW', 'PEOPLE::Lifecycle::EDIT', 'PEOPLE::Employee Notes::VIEW', 'PEOPLE::Employee Notes::CREATE'], true, 'Rahul Manager');
  rahul = (await people(hr).post('/employees', { name: 'Rahul Manager', code: 'G-1' }).expect(201)).body.employee;
  await link(hr, rahul.id, manager.userId);
  priya = (await people(hr).post('/employees', { name: 'Priya Rao', code: 'G-2', reportingManagerId: rahul.id, dateOfJoining: '2026-08-01', probationEndDate: '2026-11-15' }).expect(201)).body.employee;
  arjun = (await people(hr).post('/employees', { name: 'Arjun Das', code: 'G-3' }).expect(201)).body.employee;
}, 120_000);

describe('ask to accept a document (gap 6)', () => {
  it('the record list says who was asked and when they accepted; a file the person cannot see cannot be asked', async () => {
    const shown = (await people(hr).post(`/employees/${priya.id}/documents`, { title: 'Code of conduct', kind: 'OTHER', classification: 'EMPLOYEE_VISIBLE', ...file('read me') }).expect(201)).body.document;
    const hidden = (await people(hr).post(`/employees/${priya.id}/documents`, { title: 'Pay notes', kind: 'OTHER', classification: 'HR_ONLY', ...file('hr') }).expect(201)).body.document;
    let docs = (await people(hr).get(`/employees/${priya.id}/documents`).expect(200)).body.documents;
    expect(docs.find((d: any) => d.id === shown.id).acceptance).toBeNull();

    await people(hr).post(`/documents/${hidden.id}/ask-to-read`, {}).expect(400);
    const asked = (await people(hr).post(`/documents/${shown.id}/ask-to-read`, {}).expect(200)).body;
    expect(asked).toMatchObject({ newlyAsked: 1, asked: 1, pending: 1 });
    /* Asking twice does not ask twice. */
    expect((await people(hr).post(`/documents/${shown.id}/ask-to-read`, {}).expect(200)).body.newlyAsked).toBe(0);
    expect((await people(hr).post(`/documents/${shown.id}/remind`, {}).expect(200)).body.reminded).toBe(1);

    docs = (await people(hr).get(`/employees/${priya.id}/documents`).expect(200)).body.documents;
    const line = docs.find((d: any) => d.id === shown.id).acceptance;
    expect(line).toMatchObject({ acceptedAt: null, remindCount: 1 });
    expect(line.askedAt).toBeTruthy();
    expect(docs.find((d: any) => d.id === hidden.id).acceptance).toBeNull();

    /* The person accepts in the employee app (the service the portal route calls); the record shows the day. */
    const ack = await runInTenant(hr.orgId, () => peoplePrisma.acknowledgement.findFirst({ where: { targetId: shown.id } }));
    await runInTenant(hr.orgId, () => peoplePrisma.acknowledgement.update({ where: { id: ack!.id }, data: { acceptedAt: new Date() } }));
    docs = (await people(hr).get(`/employees/${priya.id}/documents`).expect(200)).body.documents;
    expect(docs.find((d: any) => d.id === shown.id).acceptance.acceptedAt).toBeTruthy();
  });

  it('refused without the grant, outside the team, and from another company', async () => {
    const d = (await people(hr).post(`/employees/${arjun.id}/documents`, { title: 'Arjun letter', kind: 'OTHER', classification: 'EMPLOYEE_VISIBLE', ...file('x') }).expect(201)).body.document;
    /* The team manager may read documents but not ask (Documents EDIT). */
    await people(manager).post(`/documents/${d.id}/ask-to-read`, {}).expect(403);
    await people(manager).get(`/employees/${arjun.id}/documents`).expect(404);
    await crossed(other, hr).get(`/employees/${priya.id}/documents`).expect(403);
    await people(other).post(`/documents/${d.id}/ask-to-read`, {}).expect(404);
  });
});

describe('a comment its author takes back (gap 22)', () => {
  it('the author deletes their own; not someone else’s without the delete grant; the activity says which', async () => {
    const mine = (await people(manager).post(`/employees/${priya.id}/notes`, { body: 'Doing well on the floor' }).expect(201)).body.note;
    const hrs = (await people(hr).post(`/employees/${priya.id}/notes`, { body: 'HR note' }).expect(201)).body.note;
    const events = (await people(manager).get(`/employees/${priya.id}/activity`).expect(200)).body.events;
    expect(events.find((e: any) => e.noteId === mine.id)).toMatchObject({ canDelete: true });
    expect(events.find((e: any) => e.noteId === hrs.id)).toMatchObject({ canDelete: false });
    /* HR holds the delete grant, so every comment may go. */
    const hrEvents = (await people(hr).get(`/employees/${priya.id}/activity`).expect(200)).body.events;
    expect(hrEvents.find((e: any) => e.noteId === mine.id)).toMatchObject({ canDelete: true });

    await people(manager).del(`/notes/${hrs.id}`).expect(403);
    await people(other).del(`/notes/${mine.id}`).expect(404);
    await people(manager).del(`/notes/${mine.id}`).expect(200);
    await people(manager).del(`/notes/${mine.id}`).expect(404);
    await people(hr).del(`/notes/${hrs.id}`).expect(200);
  });

  it('a reader without the comment grant cannot delete at all', async () => {
    const reader = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employee Notes::VIEW']);
    const n = (await people(hr).post(`/employees/${arjun.id}/notes`, { body: 'Kept' }).expect(201)).body.note;
    await people(reader).del(`/notes/${n.id}`).expect(403);
  });
});

describe('probation review (gap 8)', () => {
  it('the manager writes it, HR reads it with the writer’s name, and decides', async () => {
    const review = (await people(manager).post(`/employees/${priya.id}/probation/review`, { goals: 'Run the cutting floor', observations: 'Reliable, learns fast', recommendation: 'EXTEND', newEndDate: '2027-01-15' }).expect(201)).body.review;
    expect(review).toMatchObject({ recommendation: 'EXTEND', newEndDate: '2027-01-15' });
    /* Saving again edits the open review, not a second one. */
    await people(manager).post(`/employees/${priya.id}/probation/review`, { goals: 'Run the cutting floor', observations: 'Reliable, learns fast; two late days', recommendation: 'EXTEND', newEndDate: '2027-01-15' }).expect(201);
    const reviews = (await people(hr).get(`/employees/${priya.id}/probation`).expect(200)).body.reviews;
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ observations: 'Reliable, learns fast; two late days', reviewedBy: 'Rahul Manager', outcome: null });
    /* The manager may review but not decide. */
    await people(manager).post(`/employees/${priya.id}/probation/decide`, { outcome: 'CONFIRM' }).expect(403);
  });

  it('refused: on yourself, outside the team, without the grant, another company', async () => {
    const own = (await people(hr).post('/employees', { name: 'Self Review', code: 'G-9', probationEndDate: '2026-12-01' }).expect(201)).body.employee;
    await link(hr, own.id, hr.userId);
    await people(hr).post(`/employees/${own.id}/probation/review`, { goals: 'x' }).expect(403);
    await people(manager).post(`/employees/${arjun.id}/probation/review`, { goals: 'x' }).expect(404);
    await people(manager).get(`/employees/${arjun.id}/probation`).expect(404);
    const reader = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    await people(reader).post(`/employees/${priya.id}/probation/review`, { goals: 'x' }).expect(403);
    await people(other).post(`/employees/${priya.id}/probation/review`, { goals: 'x' }).expect(404);
  });
});

describe('People approval delegates (gap 9)', () => {
  it('named by their record; the list says who, from the record, and whether it is live', async () => {
    const kavyaUser = await colleague(hr, ['PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE'], false, 'Kavya HR');
    const kavya = (await people(hr).post('/employees', { name: 'Kavya Iyer', code: 'G-4' }).expect(201)).body.employee;
    await link(hr, kavya.id, kavyaUser.userId);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const made = (await people(manager).post('/stand-ins', { standInEmployeeId: kavya.id, fromDate: today, toDate: '2099-01-01' }).expect(201)).body.standIn;
    expect(made.standInUserId).toBe(kavyaUser.userId);
    const list = (await people(manager).get('/stand-ins').expect(200)).body;
    expect(list.selfEmployeeId).toBe(rahul.id);
    expect(list.today).toBe(today);
    expect(list.standIns[0]).toMatchObject({ standInEmployeeId: kavya.id, standInName: 'Kavya Iyer', live: true });
    /* Who may be chosen reaches past the manager's team: names and codes of everyone with a sign-in, nothing more. */
    const candidates = (await people(manager).get('/stand-ins/candidates').expect(200)).body.people;
    expect(candidates.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Kavya Iyer', 'Rahul Manager']));
    expect(candidates.map((c: any) => c.name)).not.toContain('Arjun Das');
    expect(Object.keys(candidates[0]).sort()).toEqual(['code', 'id', 'name']);
    await crossed(other, hr).get('/stand-ins/candidates').expect(403);
    /* Each sees only their own. */
    expect((await people(hr).get('/stand-ins').expect(200)).body.standIns).toEqual([]);
    await people(hr).del(`/stand-ins/${made.id}`).expect(404);
    await people(manager).del(`/stand-ins/${made.id}`).expect(200);
  });

  it('refused: someone with no sign-in, yourself, someone gone, another company’s person', async () => {
    const noLogin = await people(manager).post('/stand-ins', { standInEmployeeId: arjun.id, fromDate: '2026-12-01', toDate: '2026-12-05' }).expect(400);
    expect(noLogin.body.error).toMatch(/no CLOR sign-in/);
    await people(manager).post('/stand-ins', { standInEmployeeId: rahul.id, fromDate: '2026-12-01', toDate: '2026-12-05' }).expect(400);
    const foreign = (await people(other).post('/employees', { name: 'Other Co Person', code: 'O-1' }).expect(201)).body.employee;
    await people(manager).post('/stand-ins', { standInEmployeeId: foreign.id, fromDate: '2026-12-01', toDate: '2026-12-05' }).expect(400);
    await people(manager).post('/stand-ins', { fromDate: '2026-12-01', toDate: '2026-12-05' }).expect(400);
    await crossed(manager, other).get('/stand-ins').expect(403);
  });
});

describe('offers and joining forms kept to a team (gaps 7, 22)', () => {
  it('a team-limited role sees offers and forms of its own team only; withdraw once', async () => {
    const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const joiner = (await people(hr).post('/employees', { name: 'Neha Joiner', code: 'G-5', email: 'neha.joiner@example.com', reportingManagerId: rahul.id, dateOfJoining: plus(30) }).expect(201)).body.employee;
    const outsider = (await people(hr).post('/employees', { name: 'Out Sider', code: 'G-6', email: 'out.sider@example.com', dateOfJoining: plus(30) }).expect(201)).body.employee;
    const offer = (o: any) => ({ employeeId: o.id, designation: 'Tailor', joiningDate: plus(30), acceptBy: plus(5), annualCtc: 300000, signatory: 'Kavya, HR', lines: [{ label: 'Basic', monthly: 15000 }] });
    const mine = (await people(hr).post('/offers', offer(joiner)).expect(201)).body.offer;
    await people(hr).post('/offers', offer(outsider)).expect(201);
    expect((await people(hr).get('/offers').expect(200)).body.offers.map((o: any) => o.name).sort()).toEqual(['Neha Joiner', 'Out Sider']);
    expect((await people(manager).get('/offers').expect(200)).body.offers.map((o: any) => o.name)).toEqual(['Neha Joiner']);
    await crossed(other, hr).get('/offers').expect(403);

    await people(manager).post(`/offers/${mine.id}/withdraw`, {}).expect(403);
    await people(other).post(`/offers/${mine.id}/withdraw`, {}).expect(409);
    const [a, b] = await Promise.all([people(hr).post(`/offers/${mine.id}/withdraw`, {}), people(hr).post(`/offers/${mine.id}/withdraw`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await people(hr).get('/offers').expect(200)).body.offers.find((o: any) => o.id === mine.id).status).toBe('WITHDRAWN');

    await people(hr).post(`/employees/${joiner.id}/invites`, { channel: 'EMAIL', sentTo: 'neha.joiner@example.com' }).expect(201);
    await people(hr).post(`/employees/${outsider.id}/invites`, { channel: 'EMAIL', sentTo: 'out.sider@example.com' }).expect(201);
    expect((await people(hr).get('/invites').expect(200)).body.invites.map((i: any) => i.employeeName).sort()).toEqual(['Neha Joiner', 'Out Sider']);
    expect((await people(manager).get('/invites').expect(200)).body.invites.map((i: any) => i.employeeName)).toEqual(['Neha Joiner']);
    expect((await people(hr).get('/invites?status=SENT').expect(200)).body.invites).toHaveLength(2);
    await people(hr).get('/invites?status=NOPE').expect(400);
  });

  it('app-access sends follow the team too', async () => {
    await people(manager).get(`/app-access/sends?employeeId=${arjun.id}`).expect(404);
    await people(manager).get(`/app-access/sends?employeeId=${priya.id}`).expect(200);
    await crossed(other, hr).get('/app-access/sends').expect(403);
  });
});

describe('policies that apply to one person (gap 22)', () => {
  it('HR reads anyone; a team-limited role only its team; another company never', async () => {
    expect((await people(hr).get(`/employees/${arjun.id}/policies`).expect(200)).body.policies).toEqual([]);
    await people(manager).get(`/employees/${priya.id}/policies`).expect(200);
    await people(manager).get(`/employees/${arjun.id}/policies`).expect(404);
    await crossed(other, hr).get(`/employees/${arjun.id}/policies`).expect(403);
  });
});

describe('import history and undo (gap 14)', () => {
  it('lists the company’s imports; undo races itself once; refused to other companies and team roles', async () => {
    const done = (await people(hr).post('/employees/import', { rows: [{ name: 'Imported One', code: 'IMP-1' }, { name: 'Imported Two', code: 'IMP-2' }] }).expect(200)).body;
    const batches = (await people(hr).get('/employees/import/batches').expect(200)).body.batches;
    expect(batches[0]).toMatchObject({ id: done.batchId, created: 2, canUndo: true, undoneAt: null });
    expect((await people(other).get('/employees/import/batches').expect(200)).body.batches).toEqual([]);
    await people(other).post(`/employees/import/${done.batchId}/undo`, {}).expect(404);
    await people(manager).get('/employees/import/batches').expect(403);
    const [a, b] = await Promise.all([people(hr).post(`/employees/import/${done.batchId}/undo`, {}), people(hr).post(`/employees/import/${done.batchId}/undo`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await people(hr).get('/employees/import/batches').expect(200)).body.batches[0]).toMatchObject({ canUndo: false });
  });
});

describe('bulk change of the newer fields (gap 13)', () => {
  it('grade, cost centre, team and business unit change for everyone picked; another company’s item is refused', async () => {
    const grade = (await people(hr).post('/structure/grades', { name: `G${rnd()}` }).expect(201)).body.item;
    const centre = (await people(hr).post('/structure/cost-centres', { name: `CC ${rnd()}`, code: `CC${rnd()}` }).expect(201)).body.item;
    const unit = (await people(hr).post('/structure/business-units', { name: `Unit ${rnd()}` }).expect(201)).body.item;
    const r = (await people(hr).post('/employees/bulk', { ids: [priya.id, arjun.id], set: { gradeId: grade.id, costCenterId: centre.id, businessUnitId: unit.id }, reason: 'Pay bands' }).expect(200)).body;
    expect(r).toMatchObject({ asked: 2, changed: 2 });
    const after = (await people(hr).get(`/employees/${arjun.id}`).expect(200)).body.employee;
    expect(after).toMatchObject({ gradeId: grade.id, costCenterId: centre.id, businessUnitId: unit.id });
    const foreign = (await people(other).post('/structure/grades', { name: 'Foreign' }).expect(201)).body.item;
    await people(hr).post('/employees/bulk', { ids: [arjun.id], set: { gradeId: foreign.id } }).expect(400);
    await people(manager).post('/employees/bulk', { ids: [priya.id], set: { gradeId: grade.id } }).expect(403);
    await people(hr).post('/employees/bulk', { ids: [arjun.id], set: { jobRoleId: 'x' } }).expect(400);
  });
});

describe('held statutory details to Payroll (gap 15)', () => {
  it('refused while Payroll is off, and without the statutory grant', async () => {
    const r = await people(hr).post('/joining-statutory/send-held', {}).expect(409);
    expect(r.body.error).toMatch(/Payroll is not on/);
    await people(manager).post('/joining-statutory/send-held', {}).expect(403);
  });
});
