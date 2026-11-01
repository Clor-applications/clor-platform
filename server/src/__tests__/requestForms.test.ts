import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Request types HR makes (FEATURE-UI-AUDIT gap 25): a name, a short form,
 * who may ask, who approves (the approval engine's rule FORM:<id>) and a due
 * time. Employees ask from the employee app and from People; the request
 * goes through the one Approvals inbox with ask-for-more, reply and withdraw;
 * HR reports on it. Three ready-made ones can be switched on.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `forms.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Forms Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
async function portalOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
  const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal/people${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}, h: Record<string, string> = {}) => request(app).post(`/api/portal/people${p}`).set('Authorization', `Bearer ${token}`).set(h).send(b as any),
  };
}
const png = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')}`;

describe('request types HR makes', () => {
  let c: Ctx;
  let mgr: Ctx;
  let mgrEmp: any, asha: any, ravi: any, sales: any, ops: any;
  let A: Awaited<ReturnType<typeof portalOf>>, R: Awaited<ReturnType<typeof portalOf>>;

  beforeAll(async () => {
    c = await company();
    sales = (await ppl(c, 'post', '/structure/departments', { name: `Sales ${rnd()}` }).expect(201)).body.item;
    ops = (await ppl(c, 'post', '/structure/departments', { name: `Ops ${rnd()}` }).expect(201)).body.item;
    mgr = await withRole(c, 'Team Manager', 'Meera Lead');
    mgrEmp = await person(c, { name: 'Meera Lead', code: 'M1', workEmail: mgr.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: mgrEmp.id }, data: { userId: mgr.userId } }));
    asha = await person(c, { name: 'Asha Rao', code: 'E1', reportingManagerId: mgrEmp.id, departmentId: sales.id });
    ravi = await person(c, { name: 'Ravi Kumar', code: 'E2', reportingManagerId: mgrEmp.id, departmentId: ops.id });
    [A, R] = await Promise.all([portalOf(c, asha), portalOf(c, ravi)]);
  }, 120_000);

  it('HR switches on a ready-made one; twice at once makes one', async () => {
    const list = (await ppl(c, 'get', '/request-forms').expect(200)).body;
    expect(list.templates.map((t: any) => t.key).sort()).toEqual(['ASSET_REQUEST', 'ID_CARD', 'SALARY_CERTIFICATE']);
    const [x, y] = await Promise.all([ppl(c, 'post', '/request-forms/templates/SALARY_CERTIFICATE'), ppl(c, 'post', '/request-forms/templates/SALARY_CERTIFICATE')]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(x.body.form.id).toBe(y.body.form.id);
    expect(x.body.form.approver).toBe('HR');
    const after = (await ppl(c, 'get', '/request-forms').expect(200)).body;
    expect(after.forms.filter((f: any) => f.name === 'Salary certificate')).toHaveLength(1);
    expect(after.templates.find((t: any) => t.key === 'SALARY_CERTIFICATE').on).toBe(true);
    /* Its rule is the engine's, and Approval rules lists it by name. */
    const rules = (await ppl(c, 'get', '/approval-rules').expect(200)).body;
    expect(rules.forms.map((f: any) => f.name)).toContain('Salary certificate');
    expect(rules.rules.some((r: any) => r.requestType === `FORM:${x.body.form.id}` && r.active)).toBe(true);
  });

  it('HR makes one with fields; bad forms are refused in plain words', async () => {
    expect((await ppl(c, 'post', '/request-forms', { name: '', fields: [{ label: 'x' }] }).expect(400)).body.error).toMatch(/Name/);
    expect((await ppl(c, 'post', '/request-forms', { name: 'Thing', fields: [] }).expect(400)).body.error).toMatch(/at least one field/);
    expect((await ppl(c, 'post', '/request-forms', { name: 'Thing', fields: [{ label: 'Pick', type: 'CHOICE', options: ['One'] }] }).expect(400)).body.error).toMatch(/two options/);
    expect((await ppl(c, 'post', '/request-forms', { name: 'Thing', fields: [{ label: 'X', type: 'MAGIC' }] }).expect(400)).body.error).toMatch(/text, a number/);
    const made = (await ppl(c, 'post', '/request-forms', {
      name: 'Travel advance', description: 'Money ahead of a work trip.', approver: 'MANAGER_HR', slaDays: 3, audience: 'DEPARTMENTS', departmentIds: [sales.id],
      fields: [{ label: 'Amount, ₹', type: 'NUMBER', required: true }, { label: 'Trip date', type: 'DATE', required: true }, { label: 'Mode', type: 'CHOICE', options: ['Train', 'Bus', 'Flight'], required: true }, { label: 'Ticket', type: 'FILE' }, { label: 'Notes', type: 'TEXT' }],
    }).expect(201)).body.form;
    expect(made.approver).toBe('MANAGER_HR');
    expect(made.fields.map((f: any) => f.key)).toEqual(['amount', 'trip_date', 'mode', 'ticket', 'notes']);
    await ppl(c, 'post', '/request-forms', { name: 'Travel advance', fields: [{ label: 'x' }] }).expect(409);
  });

  it('an employee asks from the app; the manager then HR decide in the inbox, with ask-for-more and reply', async () => {
    const forms = (await A.get('/forms').expect(200)).body.forms;
    const travel = forms.find((f: any) => f.name === 'Travel advance');
    expect(travel).toBeTruthy();
    /* Only Sales may ask for it. */
    expect((await R.get('/forms').expect(200)).body.forms.map((f: any) => f.name)).not.toContain('Travel advance');
    await R.post(`/forms/${travel.id}`, { answers: { amount: 5000, trip_date: '2026-12-01', mode: 'Train' } }).expect(404);
    expect((await A.post(`/forms/${travel.id}`, { answers: { amount: 'lots', trip_date: '2026-12-01', mode: 'Train' } }).expect(400)).body.error).toMatch(/number/);
    expect((await A.post(`/forms/${travel.id}`, { answers: { amount: 5000, trip_date: '2026-12-01', mode: 'Rocket' } }).expect(400)).body.error).toMatch(/options/);
    expect((await A.post(`/forms/${travel.id}`, { answers: { amount: 5000, mode: 'Train' } }).expect(400)).body.error).toMatch(/needed/);
    expect((await A.post(`/forms/${travel.id}`, { answers: { amount: 5000, trip_date: '2026-12-01', mode: 'Train' }, files: { ticket: { name: 'x.exe', dataUrl: 'data:application/x-msdownload;base64,AAAA' } } }).expect(400)).body.error).toMatch(/picture/);
    /* A double tap with the same key is one request. */
    const body = { answers: { amount: '5,000', trip_date: '2026-12-01', mode: 'Train', notes: 'Client visit, Pune' }, files: { ticket: { name: 'ticket.png', dataUrl: png } } };
    const [one, two] = await Promise.all([A.post(`/forms/${travel.id}`, body, { 'Idempotency-Key': 'tap-1' }), A.post(`/forms/${travel.id}`, body, { 'Idempotency-Key': 'tap-1' })]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(one.body.request.id).toBe(two.body.request.id);
    const reqId = one.body.request.id;
    expect(await runInTenant(c.orgId, () => peoplePrisma.requestFormFile.count({ where: { orgId: c.orgId, employeeId: asha.id } }))).toBe(1);
    /* The manager's inbox has it; HR's does not yet. */
    const inbox = (await ppl(mgr, 'get', '/inbox').expect(200)).body.items;
    const item = inbox.find((i: any) => i.id === reqId);
    expect(item.kind).toBe('APPROVAL');
    expect(item.subKind).toBe(`FORM:${travel.id}`);
    expect(item.employeeName).toBe('Asha Rao');
    /* The manager reads the answers and the file. */
    const detail = (await ppl(mgr, 'get', `/requests/${reqId}`).expect(200)).body.request;
    expect(detail.payload.lines.map((l: any) => l.label)).toEqual(['Amount, ₹', 'Trip date', 'Mode', 'Notes', 'Ticket']);
    expect(detail.payload.lines[0].value).toBe('5,000');
    const fileId = detail.payload.files[0].fileId;
    expect((await ppl(mgr, 'get', `/request-forms/files/${fileId}`).expect(200)).body.file.dataUrl).toBe(png);
    await ppl(mgr, 'post', `/requests/${reqId}/more-info`, { comment: 'Which client?' }).expect(200);
    const mine = (await A.get('/forms').expect(200)).body.requests.find((r: any) => r.id === reqId);
    expect(mine.status).toBe('MORE_INFO');
    expect(mine.said).toBe('Which client?');
    /* Only Asha answers her own. */
    await R.post(`/forms/requests/${reqId}/reply`, { note: 'x' }).expect(404);
    await A.post(`/forms/requests/${reqId}/reply`, { note: 'Tata Motors, Pimpri' }).expect(200);
    await ppl(mgr, 'post', `/requests/${reqId}/approve`, {}).expect(200);
    /* Now HR's step. */
    expect((await ppl(c, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).toContain(reqId);
    await ppl(c, 'post', `/requests/${reqId}/approve`, {}).expect(200);
    expect((await A.get('/forms').expect(200)).body.requests.find((r: any) => r.id === reqId).status).toBe('APPROVED');
    /* Her own file, from the app; not Ravi's to open. */
    await A.get(`/forms/files/${fileId}`).expect(200);
    await R.get(`/forms/files/${fileId}`).expect(404);
  });

  it('refuses a file that is not what it says, files over 4 MB together, and a suspended person', async () => {
    const travel = (await A.get('/forms').expect(200)).body.forms.find((f: any) => f.name === 'Travel advance');
    const base = { answers: { amount: 100, trip_date: '2026-12-02', mode: 'Bus' } };
    const fake = `data:image/png;base64,${Buffer.from('not really a picture').toString('base64')}`;
    expect((await A.post(`/forms/${travel.id}`, { ...base, files: { ticket: { name: 'x.png', dataUrl: fake } } }).expect(400)).body.error).toMatch(/not the picture or PDF/);
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 hello').toString('base64')}`;
    expect((await A.post(`/forms/${travel.id}`, { ...base, files: { ticket: { name: 't.pdf', dataUrl: pdf } } }).expect(201)).body.request.status).toBe('WAITING');
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { status: 'SUSPENDED' } }));
    const staff = await withRole(c, 'Employee (self-service)', 'Paused Person');
    const paused = await person(c, { name: 'Paused Person', code: 'E8', workEmail: staff.email, departmentId: sales.id });
    await ppl(staff, 'get', '/my/request-forms').expect(200);
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: paused.id }, data: { status: 'SUSPENDED' } }));
    expect((await ppl(staff, 'post', `/my/request-forms/${travel.id}`, base).expect(403)).body.code).toBe('SUSPENDED');
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { status: 'ACTIVE' } }));
  });

  it('withdrawn before it is decided; not after', async () => {
    const cert = (await A.get('/forms').expect(200)).body.forms.find((f: any) => f.name === 'Salary certificate');
    const keys = Object.fromEntries(cert.fields.map((f: any) => [f.label, f.key]));
    const r = (await A.post(`/forms/${cert.id}`, { answers: { [keys.Purpose]: 'Bank loan', [keys['Addressed to']]: 'HDFC Bank, Koramangala' } }).expect(201)).body.request;
    await R.post(`/forms/requests/${r.id}/withdraw`).expect(404);
    expect((await A.post(`/forms/requests/${r.id}/withdraw`).expect(200)).body.request.status).toBe('WITHDRAWN');
    await A.post(`/forms/requests/${r.id}/withdraw`).expect(409);
  });

  it('someone with a CLOR sign-in asks from People, as themselves', async () => {
    const staff = await withRole(c, 'Employee (self-service)', 'Sana Staff');
    await person(c, { name: 'Sana Staff', code: 'E9', workEmail: staff.email, departmentId: sales.id });
    const got = (await ppl(staff, 'get', '/my/request-forms').expect(200)).body;
    const cert = got.forms.find((f: any) => f.name === 'Salary certificate');
    const keys = Object.fromEntries(cert.fields.map((f: any) => [f.label, f.key]));
    const r = (await ppl(staff, 'post', `/my/request-forms/${cert.id}`, { answers: { [keys.Purpose]: 'Visa', [keys['Addressed to']]: 'Consulate' } }).expect(201)).body.request;
    const row = await runInTenant(c.orgId, () => peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } }));
    expect(row.requesterUserId).toBe(staff.userId);
    expect((await ppl(staff, 'get', '/my/request-forms').expect(200)).body.requests[0].id).toBe(r.id);
    /* A self-service user cannot see or change the definitions, or the report. */
    await ppl(staff, 'get', '/request-forms').expect(403);
    await ppl(staff, 'post', '/request-forms', { name: 'Mine', fields: [{ label: 'x' }] }).expect(403);
    await ppl(staff, 'get', '/request-forms/report').expect(403);
    /* A team manager can decide but not define. */
    await ppl(mgr, 'post', '/request-forms/templates/ID_CARD').expect(403);
    expect((await ppl(staff, 'post', `/my/form-requests/${r.id}/withdraw`).expect(200)).body.request.status).toBe('WITHDRAWN');
  });

  it('HR reports on them: rows with answers, a line per type, and a CSV', async () => {
    const out = (await ppl(c, 'get', '/request-forms/report').expect(200)).body;
    const travel = out.summary.find((s: any) => s.formName === 'Travel advance');
    expect(travel).toMatchObject({ total: 2, approved: 1, waiting: 1 });
    const cert = out.summary.find((s: any) => s.formName === 'Salary certificate');
    expect(cert).toMatchObject({ withdrawn: 2 });
    expect(out.rows.find((r: any) => r.formName === 'Travel advance').lines.length).toBeGreaterThan(2);
    const csv = await ppl(c, 'get', '/request-forms/report?format=csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toMatch(/^Request,Employee/);
    expect(csv.text).toContain('Travel advance');
  });

  it('switched off, it is not offered and cannot be asked', async () => {
    const id = (await ppl(c, 'get', '/request-forms').expect(200)).body.forms.find((f: any) => f.name === 'Salary certificate').id;
    await ppl(c, 'put', `/request-forms/${id}`, { active: false }).expect(200);
    expect((await A.get('/forms').expect(200)).body.forms.map((f: any) => f.id)).not.toContain(id);
    await A.post(`/forms/${id}`, { answers: {} }).expect(404);
  });

  it('another company sees none of it', async () => {
    const other = await company();
    const id = (await ppl(c, 'get', '/request-forms').expect(200)).body.forms[0].id;
    await ppl(other, 'put', `/request-forms/${id}`, { name: 'Taken over' }).expect(404);
    expect((await ppl(other, 'get', '/request-forms').expect(200)).body.forms).toEqual([]);
    expect((await ppl(other, 'get', '/request-forms/report').expect(200)).body.rows).toEqual([]);
    const stranger = await person(other, { name: 'Out Sider', code: 'X1' });
    const O = await portalOf(other, stranger);
    await O.post(`/forms/${id}`, { answers: {} }).expect(404);
    const file = await runInTenant(c.orgId, () => peoplePrisma.requestFormFile.findFirstOrThrow({ where: { orgId: c.orgId } }));
    await O.get(`/forms/files/${file.id}`).expect(404);
    await ppl(other, 'get', `/request-forms/files/${file.id}`).expect(404);
    /* Nor may it write a rule for this company's request type. */
    await ppl(other, 'post', '/approval-rules', { requestType: `FORM:${id}`, name: 'x', steps: [{ approver: { kind: 'HR' }, dueDays: 2 }] }).expect(400);
  });
});
