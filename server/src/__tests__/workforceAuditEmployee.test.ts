import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Workforce audit 26 Oct 2026, employee and approval findings: the employee
 * app's own requests (answer, withdraw, see HR's comment), no request that
 * approves itself, a manager who may not approve is passed over, names for
 * portal requesters, an approved resignation traced to its request, one open
 * request per field and no silent overwrite, terms in words, a photo through
 * HR, the linked login on portal approvals, and the due days from the rule.
 * Generated local data only.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `wfa.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Wfa Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
async function portalFor(c: Ctx, companyCode: string, employee: { id: string; code: string }) {
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}
const portal = (h: Record<string, string>) => ({
  get: (p: string) => request(app).get(`/api/portal${p}`).set(h),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set(h).send(b as any),
});
const inOrg = <T,>(orgId: string, fn: () => Promise<T>) => runInTenant(orgId, fn);
const MANAGER_PERMS = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];
const future = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
/* A one-pixel PNG: a picture, not a real person. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let hr: Ctx;
let ravi: Ctx; // a manager who may approve
let tara: Ctx; // a team lead with a login but no approve grant
let companyCode = '';
let raviEmp: any;
let taraEmp: any;
beforeAll(async () => {
  hr = await owner();
  ravi = await colleague(hr, 'Ravi', MANAGER_PERMS);
  tara = await colleague(hr, 'Tara', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW']);
  companyCode = (await request(app).get(`/api/orgs/${hr.orgId}/attendance/portal-access`).set(at(hr)).expect(200)).body.company.code;
  raviEmp = (await people(hr).post('/employees', { firstName: 'Ravi', lastName: 'Kumar', code: 'W-1', dateOfJoining: '2025-04-01' }).expect(201)).body.employee;
  taraEmp = (await people(hr).post('/employees', { firstName: 'Tara', lastName: 'Singh', code: 'W-2', dateOfJoining: '2025-04-01' }).expect(201)).body.employee;
  await inOrg(hr.orgId, () => peoplePrisma.employee.update({ where: { id: raviEmp.id }, data: { userId: ravi.userId } }));
  await inOrg(hr.orgId, () => peoplePrisma.employee.update({ where: { id: taraEmp.id }, data: { userId: tara.userId } }));
}, 120_000);

describe('my details in the employee app', () => {
  it('shows my job in words (E13), and a new photo goes to HR, who approve it (E14)', async () => {
    const type = (await people(hr).post('/structure/employee-types', { name: 'Retainer staff', category: 'FIXED_TERM' }).expect(201)).body.item;
    const mode = (await people(hr).post('/structure/work-types', { name: 'Hybrid' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { firstName: 'Neha', lastName: 'Joshi', code: 'W-3', dateOfJoining: '2026-06-01', reportingManagerId: raviEmp.id }).expect(201)).body.employee;
    await inOrg(hr.orgId, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { employeeTypeId: type.id, workTypeId: mode.id, hours: 'PART_TIME', probationEndDate: '2026-12-01', contractEndDate: '2027-05-31' } }));
    const neha = portal(await portalFor(hr, companyCode, e));
    const mine = (await neha.get('/people/me/details').expect(200)).body;
    expect(mine.terms).toMatchObject({ employmentType: 'Retainer staff', hours: 'Part-time', workMode: 'Hybrid', manager: 'Ravi Kumar', joinedOn: '2026-06-01', probationEndsOn: '2026-12-01', confirmedOn: null, contractEndsOn: '2027-05-31' });
    expect(mine.hrDecidesWithinDays).toBe(3);

    await neha.post('/people/me/change-request', { photoUrl: 'data:text/html;base64,PGI+' }).expect(400);
    const asked = (await neha.post('/people/me/change-request', { photoUrl: PIXEL }).expect(202)).body;
    expect(asked.requested).toEqual(['photoUrl']);
    const row = await inOrg(hr.orgId, () => peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: asked.request.id } }));
    expect((row.payload as any).fields.photoUrl).toEqual({ before: null, after: 'New photo' });
    expect((row.payload as any).data.photoUrl).toBe(PIXEL);
    expect((await inOrg(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }))).photoUrl).toBeNull();
    await people(hr).post(`/requests/${asked.request.id}/approve`, {}).expect(200);
    expect((await inOrg(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }))).photoUrl).toBe(PIXEL);
  });

  it('HR sees the employee’s name on a portal request (E15); asked for more, the employee answers, then withdraws (E5); no CLOR notice to a user that does not exist', async () => {
    const e = (await people(hr).post('/employees', { firstName: 'Imran', lastName: 'Patil', code: 'W-4', dateOfJoining: '2026-01-05', city: 'Pune' }).expect(201)).body.employee;
    const imran = portal(await portalFor(hr, companyCode, e));
    const r = (await imran.post('/people/me/change-request', { city: 'Mumbai' }).expect(202)).body.request;
    const shaped = (await people(hr).get(`/requests/${r.id}`).expect(200)).body.request;
    expect(shaped.requesterUserId).toBe(`portal:${e.id}`);
    expect(shaped.requesterName).toBe('Imran Patil');
    expect((await people(hr).get('/requests').expect(200)).body.waitingForMe.find((x: any) => x.id === r.id).requesterName).toBe('Imran Patil');

    await people(hr).post(`/requests/${r.id}/more-info`, { comment: 'Send a utility bill for the new address.' }).expect(200);
    let mine = (await imran.get('/people/me/details').expect(200)).body;
    const open = mine.requests.find((x: any) => x.id === r.id);
    expect(open).toMatchObject({ status: 'MORE_INFO', statusLabel: 'More information asked for', canReply: true, canWithdraw: true, asked: [{ field: 'city', label: 'City', value: 'Mumbai' }] });
    expect(open.comment).toMatchObject({ text: 'Send a utility bill for the new address.', by: 'Asha HR' });
    const updates = (await imran.get('/updates').expect(200)).body.decided;
    expect(updates.some((u: any) => u.key.startsWith(`people:${r.id}:MORE_INFO`) && /more information/.test(u.text))).toBe(true);
    expect(await platformPrisma.notification.count({ where: { orgId: hr.orgId, userId: { startsWith: 'portal:' } } })).toBe(0);

    /* Someone else cannot answer or withdraw it. */
    const other = (await people(hr).post('/employees', { firstName: 'Sana', lastName: 'Rao', code: 'W-5', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const sana = portal(await portalFor(hr, companyCode, other));
    await sana.post(`/people/me/requests/${r.id}/reply`, { note: 'Not mine' }).expect(404);
    await sana.post(`/people/me/requests/${r.id}/withdraw`).expect(404);

    await imran.post(`/people/me/requests/${r.id}/reply`, { note: '' }).expect(400);
    expect((await imran.post(`/people/me/requests/${r.id}/reply`, { note: 'Uploaded the electricity bill to HR by email.' }).expect(200)).body.status).toBe('WAITING');
    mine = (await imran.get('/people/me/details').expect(200)).body;
    expect(mine.requests.find((x: any) => x.id === r.id)).toMatchObject({ status: 'WAITING', canReply: false, replies: [expect.objectContaining({ note: 'Uploaded the electricity bill to HR by email.' })] });

    /* Rejected: still listed, with HR's reason. */
    await people(hr).post(`/requests/${r.id}/reject`, { comment: 'The bill is in someone else’s name.' }).expect(200);
    mine = (await imran.get('/people/me/details').expect(200)).body;
    expect(mine.requests.find((x: any) => x.id === r.id)).toMatchObject({ status: 'REJECTED', statusLabel: 'Not approved', canWithdraw: false, comment: expect.objectContaining({ text: 'The bill is in someone else’s name.' }) });

    /* A fresh one, withdrawn: gone from the list. */
    const again = (await imran.post('/people/me/change-request', { city: 'Thane' }).expect(202)).body.request;
    expect((await imran.post(`/people/me/requests/${again.id}/withdraw`).expect(200)).body.status).toBe('WITHDRAWN');
    await imran.post(`/people/me/requests/${again.id}/withdraw`).expect(409);
    mine = (await imran.get('/people/me/details').expect(200)).body;
    expect(mine.requests.map((x: any) => x.id)).not.toContain(again.id);
  });

  it('one open request per field, and approval refuses to overwrite a value HR changed since (E22)', async () => {
    const e = (await people(hr).post('/employees', { firstName: 'Kavya', lastName: 'Menon', code: 'W-6', dateOfJoining: '2026-01-05', city: 'Kochi' }).expect(201)).body.employee;
    const kavya = portal(await portalFor(hr, companyCode, e));
    const r = (await kavya.post('/people/me/change-request', { city: 'Chennai', state: 'Tamil Nadu' }).expect(202)).body.request;
    const clash = await kavya.post('/people/me/change-request', { city: 'Madurai' }).expect(409);
    expect(clash.body.error).toMatch(/already asked to change city/);
    /* A different field is fine. */
    await kavya.post('/people/me/change-request', { pincode: '600001' }).expect(202);

    /* HR changes the city by hand meanwhile. */
    await inOrg(hr.orgId, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { city: 'Bengaluru' } }));
    const stale = await people(hr).post(`/requests/${r.id}/approve`, {}).expect(409);
    expect(stale.body).toMatchObject({ code: 'STALE' });
    expect(stale.body.error).toMatch(/City changed on the record/);
    expect((await inOrg(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }))).city).toBe('Bengaluru');
    const still = (await people(hr).get(`/requests/${r.id}`).expect(200)).body.request;
    expect(still.status).toBe('WAITING');
    expect(still.steps.map((s: any) => s.status)).toEqual(['WAITING']);
  });

  it('the self-edit settings carry the due days of the active rule (E23)', async () => {
    expect((await people(hr).get('/settings').expect(200)).body.settings).toMatchObject({ profileDecideDays: 3, profileRuleSet: true });
    await people(hr).post('/approval-rules', { requestType: 'PROFILE_CHANGE', name: 'Profile, two steps', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }, { approver: { kind: 'HR' }, dueDays: 5 }] }).expect(201);
    expect((await people(hr).get('/settings').expect(200)).body.settings.profileDecideDays).toBe(7);
    await people(hr).post('/approval-rules', { requestType: 'PROFILE_CHANGE', name: 'Profile changes', steps: [{ approver: { kind: 'HR' }, dueDays: 3 }] }).expect(201);
  });
});

describe('who decides', () => {
  it('a manager who may not approve is passed over for HR (E12); the approved resignation traces to its request (E16)', async () => {
    const e = (await people(hr).post('/employees', { firstName: 'Dev', lastName: 'Shah', code: 'W-7', dateOfJoining: '2025-01-05', reportingManagerId: taraEmp.id }).expect(201)).body.employee;
    const dev = portal(await portalFor(hr, companyCode, e));
    const lastDay = future(20);
    const asked = (await dev.post('/people/me/resign', { lastDay, reason: 'Moving cities' }).expect(202)).body.request;
    const r = (await people(hr).get(`/requests/${asked.id}`).expect(200)).body.request;
    expect(r.steps[0].candidates).not.toContain('Tara');
    expect(r.steps[0].candidates).toContain('Asha HR');
    await people(tara).post(`/requests/${asked.id}/approve`, {}).expect(403);
    await people(hr).post(`/requests/${asked.id}/approve`, {}).expect(200);
    const done = (await people(hr).post(`/requests/${asked.id}/approve`, {}).expect(200)).body.request;
    expect(done.status).toBe('APPROVED');
    const row = await inOrg(hr.orgId, () => peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: asked.id } }));
    const line = await inOrg(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'status', after: 'ON_NOTICE' } }));
    expect(line).toMatchObject({ source: 'APPROVAL', requestId: asked.id, decisionId: row.decisionId, before: 'ACTIVE' });
    expect(row.decisionId).toBeTruthy();
    const dateLine = await inOrg(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'dateOfLeaving' } }));
    expect(dateLine).toMatchObject({ after: lastDay, requestId: asked.id });
  });

  it('a manager with the approve grant still decides first', async () => {
    const e = (await people(hr).post('/employees', { firstName: 'Lata', lastName: 'Iyer', code: 'W-8', dateOfJoining: '2025-01-05', reportingManagerId: raviEmp.id }).expect(201)).body.employee;
    const lata = portal(await portalFor(hr, companyCode, e));
    const asked = (await lata.post('/people/me/resign', { lastDay: future(30) }).expect(202)).body.request;
    const r = (await people(hr).get(`/requests/${asked.id}`).expect(200)).body.request;
    expect(r.steps[0].candidates).toEqual(['Ravi']);
  });

  it('a request only its requester could decide is not approved by itself: it goes to the admins (E11)', async () => {
    const subject = (await people(hr).post('/employees', { firstName: 'Mohan', lastName: 'Das', code: 'W-9', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const dept = (await people(hr).post('/structure/departments', { name: `Stores ${rnd()}` }).expect(201)).body.item;
    /* One step, decided by Ravi; Ravi asks. */
    await people(hr).post('/approval-rules', { requestType: 'SEAT_REQUEST', name: 'Seats: Ravi decides', steps: [{ approver: { kind: 'USER', id: ravi.userId }, dueDays: 2 }] }).expect(201);
    const asked = (await people(ravi).post('/requests', { requestType: 'SEAT_REQUEST', subjectEmployeeId: subject.id, title: 'A seat for Mohan', payload: { employeeId: subject.id, departmentId: dept.id } }).expect(201)).body.request;
    expect(asked.status).toBe('WAITING');
    expect(asked.steps).toHaveLength(1);
    expect(asked.steps[0]).toMatchObject({ status: 'WAITING', comment: 'Sent to the admins: nobody else could decide it' });
    expect(asked.steps[0].candidates).toEqual(['Asha HR']);
    await people(ravi).post(`/requests/${asked.id}/approve`, {}).expect(403);
    expect((await people(hr).post(`/requests/${asked.id}/approve`, {}).expect(200)).body.request.status).toBe('APPROVED');

    /* With a second step someone else decides, the requester's own step is still just skipped. */
    await people(hr).post('/approval-rules', { requestType: 'SEAT_REQUEST', name: 'Seats: Ravi, then HR', steps: [{ approver: { kind: 'USER', id: ravi.userId }, dueDays: 2 }, { approver: { kind: 'HR' }, dueDays: 2 }] }).expect(201);
    const two = (await people(ravi).post('/requests', { requestType: 'SEAT_REQUEST', subjectEmployeeId: subject.id, title: 'Another seat', payload: { employeeId: subject.id } }).expect(201)).body.request;
    expect(two.steps.map((s: any) => [s.order, s.status])).toEqual([[1, 'SKIPPED'], [2, 'WAITING']]);
  });
});

describe('portal approvals', () => {
  it('a manager with a CLOR sign-in decides as that user, not portal:<id> (E18)', async () => {
    const e = (await people(hr).post('/employees', { firstName: 'Arun', lastName: 'Bose', code: 'W-10', dateOfJoining: '2026-01-01', reportingManagerId: raviEmp.id }).expect(201)).body.employee;
    const raviApp = portal(await portalFor(hr, companyCode, raviEmp));
    const fix = (await request(app).post(`/api/orgs/${hr.orgId}/attendance/requests`).set(at(hr)).send({ employeeId: e.id, date: '2026-10-05', checkIn: '09:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201)).body.request;
    const ok = (await raviApp.post(`/approvals/correction/${fix.id}`, { decision: 'approve', note: 'Seen the log' }).expect(200)).body.request;
    expect(ok).toMatchObject({ status: 'APPROVED', reviewedByUserId: ravi.userId });
  });
});
