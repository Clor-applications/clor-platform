import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Help desk (docs/people/02-PRD.md DESK-01..06): a request from the app
 * reaches HR at once; internal notes never reach the employee; the category
 * sets the queue and the times, and overdue goes to the queue lead;
 * resolved with a reason, reopened within seven days; moved to Private
 * cases, only the date stays; a template answer cites the policy version.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runDeskDues, addWorkingDays } = await import('../services/people/desk.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `desk.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Desk Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, peopleEngage: true } }).expect(200);
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
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });

let hr: Ctx;
let companyCode = '';
beforeAll(async () => {
  hr = await owner();
  companyCode = (await request(app).get(`/api/orgs/${hr.orgId}/attendance/portal-access`).set(at(hr)).expect(200)).body.company.code;
}, 90_000);

describe('help desk', () => {
  it('a request from the app reaches HR at once with its queue and times; internal notes never reach the employee (DESK-01, 02, 03)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Imran Patil', code: 'D-1', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const imran = await portalFor(hr, companyCode, e);
    const cats = (await request(app).get('/api/portal/people/desk').set(imran).expect(200)).body.categories;
    expect(cats.map((c: any) => c.key)).toEqual(['PAYROLL', 'LEAVE', 'DOCUMENTS', 'POLICY', 'IT', 'FACILITIES', 'OTHER']);
    await request(app).post('/api/portal/people/desk').set(imran).send({ category: 'PAYROLL', subject: '', description: 'x' }).expect(400);
    const before = Date.now();
    const raised = (await request(app).post('/api/portal/people/desk').set(imran).send({ category: 'PAYROLL', subject: 'PF number wrong on payslip', description: 'My UAN on the September payslip is not mine.', urgency: 'HIGH', replyChannel: 'PHONE', attachment: { title: 'September payslip', ...file('payslip') } }).expect(201)).body.request;
    expect(raised).toMatchObject({ queue: 'Payroll', category: 'PAYROLL', status: 'OPEN', urgency: 'HIGH', replyChannel: 'PHONE' });
    expect(new Date(raised.replyBy).getTime() - before).toBeGreaterThan(23 * 3_600_000);
    expect(new Date(raised.resolveBy).toISOString().slice(0, 10)).toBe(addWorkingDays(new Date(before), 3).toISOString().slice(0, 10));

    /* HR sees it in the Payroll queue straight away, with the attachment on the person's file. */
    const list = (await people(hr).get('/desk?status=OPEN&queue=Payroll').expect(200)).body;
    expect(list.requests.map((r: any) => r.subject)).toEqual(['PF number wrong on payslip']);
    expect(list.queues).toEqual(expect.arrayContaining(['Payroll', 'HR', 'IT', 'Admin']));
    const bell = await platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, kind: 'people.desk', title: { contains: 'PF number wrong' } } });
    expect(bell?.title).toBe('Imran Patil (D-1) asked Payroll: PF number wrong on payslip');
    const docs = (await people(hr).get(`/employees/${e.id}/documents`).expect(200)).body.documents;
    expect(docs.map((d: any) => d.title)).toContain('September payslip');

    /* An internal note, then an answer. The employee sees only the answer. */
    await people(hr).post(`/desk/${raised.id}/messages`, { body: 'Check with Payroll whether the UAN was keyed wrong at joining.', internal: true }).expect(201);
    await people(hr).post(`/desk/${raised.id}/messages`, { body: 'Thanks — we are checking the UAN with Payroll and will call you.', waitForEmployee: true }).expect(201);
    const hrView = (await people(hr).get(`/desk/${raised.id}`).expect(200)).body.request;
    expect(hrView.messages.map((m: any) => [m.from, m.internal])).toEqual([['EMPLOYEE', false], ['HR', true], ['HR', false]]);
    expect(hrView.firstReplyAt).toBeTruthy();
    expect(hrView.status).toBe('WAITING_EMPLOYEE');
    const mine = (await request(app).get(`/api/portal/people/desk/${raised.id}`).set(imran).expect(200)).body.request;
    expect(mine.messages.map((m: any) => m.body)).toEqual(['Attachment', 'Thanks — we are checking the UAN with Payroll and will call you.']);
    expect(JSON.stringify(mine)).not.toContain('keyed wrong');
    /* The employee replies; it goes back to the queue. */
    await request(app).post(`/api/portal/people/desk/${raised.id}/messages`).set(imran).send({ body: 'It was right on the August payslip.' }).expect(201);
    expect((await people(hr).get(`/desk/${raised.id}`).expect(200)).body.request.status).toBe('OPEN');
    /* Nobody else's request. */
    const other = (await people(hr).post('/employees', { name: 'Other Person', code: 'D-0', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const stranger = await portalFor(hr, companyCode, other);
    await request(app).get(`/api/portal/people/desk/${raised.id}`).set(stranger).expect(404);
    /* The grant: Employees VIEW alone opens nothing. */
    const viewer = await colleague(hr, 'Viewer', ['PEOPLE::Employees::VIEW']);
    await people(viewer).get('/desk').expect(403);
  });

  it('a category sets reply-by and resolve-by; overdue goes to the queue lead once per clock (DESK-03)', async () => {
    const lead = await colleague(hr, 'Lead', ['PEOPLE::HR Cases::VIEW', 'PEOPLE::HR Cases::EDIT']);
    const cat = (await people(hr).put('/desk/categories/PAYROLL', { leadUserId: lead.userId, resolveDays: 3, replyHours: 24 }).expect(200)).body.category;
    expect(cat).toMatchObject({ queue: 'Payroll', leadUserId: lead.userId, resolveDays: 3 });
    await people(hr).put('/desk/categories/PAYROLL', { resolveDays: 0 }).expect(400);
    const e = (await people(hr).post('/employees', { name: 'Kavya Reddy', code: 'D-2', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const r = (await people(hr).post('/desk', { employeeId: e.id, category: 'PAYROLL', subject: 'Form 16 not received', description: 'Asked at the desk on Monday.' }).expect(201)).body.request;
    /* Not yet due: nothing is sent. */
    expect(await runDeskDues(new Date())).toBe(0);
    /* A day and a bit later: the reply clock is late; the lead is told once. */
    const later = new Date(Date.now() + 26 * 3_600_000);
    /* The job runs for every company in the database, so the count is at least ours; the lead's bell is the exact check. */
    expect(await runDeskDues(later)).toBeGreaterThanOrEqual(1);
    expect(await runDeskDues(later)).toBe(0);
    const told = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, userId: lead.userId, kind: 'people.desk_overdue', title: { contains: 'Form 16' } } });
    expect(told.map((n) => n.title)).toEqual(['No reply yet: Form 16 not received (Kavya Reddy)']);
    /* A week later the resolve clock is late too: told once more, and no more after that. */
    const week = new Date(Date.now() + 8 * 86_400_000);
    expect(await runDeskDues(week)).toBeGreaterThanOrEqual(1);
    expect(await runDeskDues(week)).toBe(0);
    /* The Payroll lead also hears about the earlier test's Payroll request once its resolve-by passes; Form 16 is told of exactly twice. */
    expect((await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, userId: lead.userId, kind: 'people.desk_overdue', title: { contains: 'Form 16' } }, orderBy: { createdAt: 'asc' } })).map((n) => n.title)).toEqual(['No reply yet: Form 16 not received (Kavya Reddy)', 'Not resolved: Form 16 not received (Kavya Reddy)']);
    /* Both clocks are marked as escalated on the row; in real time it is not yet late, so the list does not flag it. */
    const row = await runInTenant(hr.orgId, () => peoplePrisma.deskRequest.findUniqueOrThrow({ where: { id: r.id } }));
    expect(row.replyEscalatedAt && row.resolveEscalatedAt).toBeTruthy();
    expect((await people(hr).get('/desk?mine=1').expect(200)).body.requests).toEqual([]);
    await people(hr).post(`/desk/${r.id}/assign`, { assigneeUserId: lead.userId }).expect(200);
    expect((await people(lead).get('/desk?mine=1').expect(200)).body.requests.map((x: any) => x.id)).toEqual([r.id]);
  });

  it('resolved with a reason; reopened within seven days, refused on day eight (DESK-04)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'D-3', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const ravi = await portalFor(hr, companyCode, e);
    const r = (await request(app).post('/api/portal/people/desk').set(ravi).send({ category: 'LEAVE', subject: 'Leave balance looks short', description: 'I see 4 days; it should be 6.' }).expect(201)).body.request;
    await people(hr).post(`/desk/${r.id}/resolve`, {}).expect(400);
    const done = (await people(hr).post(`/desk/${r.id}/resolve`, { resolution: 'Two days were taken in March; the balance is right.' }).expect(200)).body.request;
    expect(done).toMatchObject({ status: 'RESOLVED', resolution: 'Two days were taken in March; the balance is right.' });
    expect((await request(app).get(`/api/portal/people/desk/${r.id}`).set(ravi).expect(200)).body.request.resolution).toContain('March');
    await request(app).post(`/api/portal/people/desk/${r.id}/messages`).set(ravi).send({ body: 'Still wrong.' }).expect(409);
    const again = (await request(app).post(`/api/portal/people/desk/${r.id}/reopen`).set(ravi).expect(200)).body.request;
    expect(again.status).toBe('REOPENED');
    await people(hr).post(`/desk/${r.id}/resolve`, { resolution: 'Checked again with the leave register; settled.' }).expect(200);
    await runInTenant(hr.orgId, () => peoplePrisma.deskRequest.update({ where: { id: r.id }, data: { resolvedAt: new Date(Date.now() - 8 * 86_400_000) } }));
    const late = await request(app).post(`/api/portal/people/desk/${r.id}/reopen`).set(ravi).expect(409);
    expect(late.body.error).toContain('raise a new request');
  });

  it('moved to Private cases, the help desk copy shrinks to the date it moved (DESK-05)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Sana Reddy', code: 'D-4', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const sana = await portalFor(hr, companyCode, e);
    const r = (await request(app).post('/api/portal/people/desk').set(sana).send({ category: 'OTHER', subject: 'A colleague keeps making remarks', description: 'It has happened three times this month; I have names and dates.' }).expect(201)).body.request;
    await people(hr).post(`/desk/${r.id}/messages`, { body: 'Taking this to the committee.', internal: true }).expect(201);
    const moved = (await people(hr).post(`/desk/${r.id}/move-to-case`, {}).expect(200)).body.request;
    expect(moved.status).toBe('MOVED');
    expect(moved.subject).toMatch(/^Moved on \d{4}-\d{2}-\d{2}$/);
    expect(moved.description).toBe('');
    expect(moved.messages).toEqual([]);
    expect(JSON.stringify(moved)).not.toContain('remarks');
    const mine = (await request(app).get(`/api/portal/people/desk/${r.id}`).set(sana).expect(200)).body.request;
    expect(mine.subject).toMatch(/^Moved on/);
    expect(JSON.stringify(mine)).not.toContain('names and dates');
    await people(hr).post(`/desk/${r.id}/messages`, { body: 'x' }).expect(409);
  });

  it('a template answer cites the policy version in force (DESK-06)', async () => {
    const p = (await people(hr).post('/policies', { title: 'Leave policy', category: 'LEAVE' }).expect(201)).body.policy;
    await people(hr).post(`/policies/${p.id}/versions`, { body: 'Earned leave accrues at 1.5 days a month.', effectiveFrom: '2026-01-01' }).expect(201);
    await people(hr).post(`/policies/${p.id}/versions/1/submit`, {}).expect(200);
    await people(hr).post(`/policies/${p.id}/versions`, { body: 'Earned leave accrues at 1.75 days a month.', effectiveFrom: '2026-10-01' }).expect(201);
    await people(hr).post(`/policies/${p.id}/versions/2/submit`, {}).expect(200);
    const t = (await people(hr).post('/desk/templates', { title: 'How earned leave accrues', body: 'Earned leave is credited every month as the policy sets out; your balance shows in the app.', category: 'LEAVE', policyId: p.id }).expect(201)).body.template;
    expect((await people(hr).get('/desk/templates').expect(200)).body.templates).toEqual([expect.objectContaining({ title: 'How earned leave accrues', policyTitle: 'Leave policy' })]);
    const e = (await people(hr).post('/employees', { name: 'Pooja Kumar', code: 'D-5', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const r = (await people(hr).post('/desk', { employeeId: e.id, category: 'LEAVE', subject: 'How is earned leave credited?', description: 'Monthly or yearly?' }).expect(201)).body.request;
    const m = (await people(hr).post(`/desk/${r.id}/messages`, { templateId: t.id, body: 'Hope that helps.' }).expect(201)).body.message;
    expect(m.body).toContain('Policy: Leave policy, version 2, in force from 2026-10-01.');
    expect(m.body.endsWith('Hope that helps.')).toBe(true);
    const v2 = await runInTenant(hr.orgId, () => peoplePrisma.policyVersion.findFirst({ where: { policyId: p.id, version: 2 } }));
    expect(m.policyVersionId).toBe(v2?.id);
  });
});
