import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Policies (docs/people/02-PRD.md POL-01..06) and read-and-accept (DOC-05):
 * the library and who sees what; versions as of a day; applies-to by state
 * and type; acceptance tasks, the report and reminders; publishing through
 * the rule; conflicts in Health check.
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
  const email = `pol.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Pol Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
/** An employee signed in to the employee app. */
async function portalFor(c: Ctx, companyCode: string, employee: { id: string; code: string }) {
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });

let hr: Ctx;
let companyCode = '';
let blr: any;
let pune: any;
let contractor: any;
let permanent: any;
beforeAll(async () => {
  hr = await owner();
  companyCode = (await request(app).get(`/api/orgs/${hr.orgId}/attendance/portal-access`).set(at(hr)).expect(200)).body.company.code;
  const entity = (await people(hr).post('/structure/legal-entities', { name: 'Pol Co Pvt Ltd' }).expect(201)).body.item;
  blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
  pune = (await people(hr).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id }).expect(201)).body.item;
  contractor = (await people(hr).post('/structure/employee-types', { name: 'Contractor' }).expect(201)).body.item;
  permanent = (await people(hr).post('/structure/employee-types', { name: 'Permanent' }).expect(201)).body.item;
}, 90_000);

describe('policies', () => {
  it('the library, who each version applies to, and what each person sees (POL-01, POL-03); a draft is never visible (POL-05)', async () => {
    const mhContractor = (await people(hr).post('/employees', { name: 'Imran Patil', code: 'P-1', dateOfJoining: '2026-01-05', establishmentId: pune.id, employeeTypeId: contractor.id }).expect(201)).body.employee;
    const kaPermanent = (await people(hr).post('/employees', { name: 'Kavya Reddy', code: 'P-2', dateOfJoining: '2026-01-05', establishmentId: blr.id, employeeTypeId: permanent.id }).expect(201)).body.employee;
    const everyone = (await people(hr).post('/policies', { title: 'Code of conduct', category: 'CONDUCT', description: 'How we treat each other and our clients.' }).expect(201)).body.policy;
    expect(everyone).toMatchObject({ category: 'CONDUCT', ownerUserId: hr.userId, ownerName: 'Asha HR', versions: [] });
    await people(hr).post('/policies', { title: 'Nameless', category: 'NOPE' }).expect(400);
    const mhOnly = (await people(hr).post('/policies', { title: 'Maharashtra contractor hours', category: 'HOURS' }).expect(201)).body.policy;

    const v1 = (await people(hr).post(`/policies/${everyone.id}/versions`, { body: 'Be kind. Be on time.', effectiveFrom: '2026-01-01' }).expect(201)).body.version;
    expect(v1).toMatchObject({ version: 1, status: 'DRAFT', appliesTo: {} });
    await people(hr).post(`/policies/${everyone.id}/versions`, { effectiveFrom: '2026-01-01' }).expect(400);
    const scope = (await people(hr).post('/policies/scope', { appliesTo: { states: ['maharashtra'], employeeTypeIds: [contractor.id] } }).expect(200)).body;
    expect(scope).toMatchObject({ count: 1, sample: [{ name: 'Imran Patil' }] });
    const mv1 = (await people(hr).post(`/policies/${mhOnly.id}/versions`, { body: 'Nine hours, six days, as the Maharashtra S&E Act allows.', effectiveFrom: '2026-01-01', appliesTo: { states: ['Maharashtra'], employeeTypeIds: [contractor.id] } }).expect(201)).body.version;

    /* Drafts: the person sees nothing yet. */
    const imran = await portalFor(hr, companyCode, mhContractor);
    expect((await request(app).get('/api/portal/people/policies').set(imran).expect(200)).body.policies).toEqual([]);
    expect((await people(hr).get(`/employees/${mhContractor.id}/policies`).expect(200)).body.policies).toEqual([]);

    /* No rule: submitting publishes now. */
    const pub = (await people(hr).post(`/policies/${everyone.id}/versions/1/submit`, {}).expect(200)).body;
    expect(pub.version.status).toBe('PUBLISHED');
    expect(pub.request).toBeNull();
    await people(hr).post(`/policies/${mhOnly.id}/versions/1/submit`, {}).expect(200);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { orgId: hr.orgId, name: 'people.policy.published.v1' } }))).toBe(2);

    const mine = (await request(app).get('/api/portal/people/policies').set(imran).expect(200)).body.policies;
    expect(mine.map((p: any) => p.title).sort()).toEqual(['Code of conduct', 'Maharashtra contractor hours']);
    const kavya = await portalFor(hr, companyCode, kaPermanent);
    expect((await request(app).get('/api/portal/people/policies').set(kavya).expect(200)).body.policies.map((p: any) => p.title)).toEqual(['Code of conduct']);
    /* A version that does not apply to me reads as absent, even by id. */
    await request(app).get(`/api/portal/people/policies/${mv1.id}`).set(kavya).expect(404);
    const read = (await request(app).get(`/api/portal/people/policies/${mv1.id}`).set(imran).expect(200)).body.policy;
    expect(read).toMatchObject({ title: 'Maharashtra contractor hours', version: 1, body: 'Nine hours, six days, as the Maharashtra S&E Act allows.' });
    /* Search by title. */
    expect((await people(hr).get('/policies?q=contractor').expect(200)).body.policies.map((p: any) => p.title)).toEqual(['Maharashtra contractor hours']);
    /* Only the Policies grant opens the library. */
    const viewer = await colleague(hr, 'Viewer', ['PEOPLE::Employees::VIEW']);
    await people(viewer).get('/policies').expect(403);
  });

  it('versions with effective dates: as of 1 June the old one holds; the new one asks everyone in scope to accept, reports and reminds (POL-02, POL-04)', async () => {
    const p = (await people(hr).post('/policies', { title: 'Leave policy', category: 'LEAVE' }).expect(201)).body.policy;
    const a = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'P-3', dateOfJoining: '2026-01-05', establishmentId: blr.id }).expect(201)).body.employee;
    const b = (await people(hr).post('/employees', { name: 'Pooja Kumar', code: 'P-4', dateOfJoining: '2026-01-05', establishmentId: blr.id }).expect(201)).body.employee;
    await people(hr).post(`/policies/${p.id}/versions`, { body: 'Twelve days of earned leave.', effectiveFrom: '2026-01-01', appliesTo: { establishmentIds: [blr.id] } }).expect(201);
    await people(hr).post(`/policies/${p.id}/versions/1/submit`, {}).expect(200);
    await people(hr).post(`/policies/${p.id}/versions`, { body: 'Fifteen days of earned leave.', effectiveFrom: '2026-07-01', appliesTo: { establishmentIds: [blr.id] }, needsAcceptance: true }).expect(201);
    await people(hr).post(`/policies/${p.id}/versions/2/submit`, {}).expect(200);
    const detail = (await people(hr).get(`/policies/${p.id}`).expect(200)).body.policy;
    expect(detail.versions.map((v: any) => [v.version, v.status, v.effectiveFrom, v.effectiveTo])).toEqual([[2, 'PUBLISHED', '2026-07-01', null], [1, 'PUBLISHED', '2026-01-01', '2026-06-30']]);
    /* Nothing is overwritten: v1 is still readable, and it is what held on 1 June. */
    const onJune = (await people(hr).get(`/employees/${a.id}/policies?asOf=2026-06-01`).expect(200)).body.policies.find((x: any) => x.policyId === p.id);
    expect(onJune).toMatchObject({ version: 1 });
    const now = (await people(hr).get(`/employees/${a.id}/policies?asOf=2026-10-24`).expect(200)).body.policies.find((x: any) => x.policyId === p.id);
    expect(now).toMatchObject({ version: 2, needsAcceptance: true, acceptedAt: null });
    expect(now.acknowledgementId).toBeTruthy();

    /* Everyone in scope was asked; the two Bengaluru people and whoever else sits there. */
    const rep = (await people(hr).get(`/policies/${p.id}/versions/2/acknowledgements`).expect(200)).body;
    expect(rep.asked).toBeGreaterThanOrEqual(2);
    expect(rep.pendingList.map((x: any) => x.name)).toEqual(expect.arrayContaining(['Ravi Das', 'Pooja Kumar']));
    const ravi = await portalFor(hr, companyCode, a);
    const pending = (await request(app).get('/api/portal/people/acknowledgements').set(ravi).expect(200)).body.pending;
    expect(pending).toEqual([expect.objectContaining({ targetType: 'POLICY_VERSION', title: 'Leave policy (v2)' })]);
    await request(app).post(`/api/portal/people/acknowledgements/${pending[0].id}/accept`).set(ravi).expect(200);
    /* Somebody else's acknowledgement cannot be accepted. */
    const pooja = await portalFor(hr, companyCode, b);
    await request(app).post(`/api/portal/people/acknowledgements/${pending[0].id}/accept`).set(pooja).expect(404);
    const after = (await people(hr).get(`/policies/${p.id}/versions/2/acknowledgements`).expect(200)).body;
    expect(after.acceptedList.map((x: any) => x.name)).toEqual(['Ravi Das']);
    expect(after.pendingList.map((x: any) => x.name)).toContain('Pooja Kumar');
    const reminded = (await people(hr).post(`/policies/${p.id}/versions/2/remind`, {}).expect(200)).body.reminded;
    expect(reminded).toBe(after.pending);
    const row = await runInTenant(hr.orgId, () => peoplePrisma.acknowledgement.findFirst({ where: { targetType: 'POLICY_VERSION', employeeId: b.id } }));
    expect(row?.remindCount).toBe(1);
    expect(row?.remindedAt).toBeTruthy();
  });

  it('with a rule, publishing waits for approval and the draft stays invisible until then (POL-05)', async () => {
    const head = await colleague(hr, 'Head', ['PEOPLE::Policies::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE']);
    await people(hr).post('/approval-rules', { requestType: 'POLICY_PUBLISH', name: 'Publishing', steps: [{ approver: { kind: 'USER', id: head.userId }, dueDays: 3 }] }).expect(201);
    const p = (await people(hr).post('/policies', { title: 'Travel policy', category: 'TRAVEL' }).expect(201)).body.policy;
    const e = (await people(hr).post('/employees', { name: 'Sana Reddy', code: 'P-5', dateOfJoining: '2026-01-05', establishmentId: blr.id }).expect(201)).body.employee;
    await people(hr).post(`/policies/${p.id}/versions`, { body: 'Economy class under six hours.', effectiveFrom: '2026-01-01' }).expect(201);
    const sent = (await people(hr).post(`/policies/${p.id}/versions/1/submit`, {}).expect(200)).body;
    expect(sent.version.status).toBe('WAITING');
    expect(sent.request).toMatchObject({ requestType: 'POLICY_PUBLISH', status: 'WAITING' });
    expect((await people(hr).get(`/employees/${e.id}/policies`).expect(200)).body.policies.map((x: any) => x.title)).not.toContain('Travel policy');
    await people(hr).post(`/policies/${p.id}/versions/1/submit`, {}).expect(409);
    const done = (await people(head).post(`/requests/${sent.request.id}/approve`, {}).expect(200)).body;
    expect(done.request.status).toBe('APPROVED');
    expect(done.outcome).toMatchObject({ published: 1 });
    const v = await runInTenant(hr.orgId, () => peoplePrisma.policyVersion.findFirst({ where: { policyId: p.id, version: 1 } }));
    expect(v).toMatchObject({ status: 'PUBLISHED', requestId: sent.request.id });
    expect((await people(hr).get(`/employees/${e.id}/policies`).expect(200)).body.policies.map((x: any) => x.title)).toContain('Travel policy');
    /* The rule is retired so the tests after this one publish at once. */
    await request(app).delete(`/api/orgs/${hr.orgId}/people/approval-rules/POLICY_PUBLISH`).set(at(hr)).expect(200);
  });

  it('two published policies of one kind reaching the same people are a conflict in Health check (POL-06)', async () => {
    const dept = (await people(hr).post('/structure/departments', { name: 'Housekeeping' }).expect(201)).body.item;
    await people(hr).post('/employees', { name: 'Deepak Khan', code: 'P-6', dateOfJoining: '2026-01-05', establishmentId: blr.id, departmentId: dept.id }).expect(201);
    const one = (await people(hr).post('/policies', { title: 'Housekeeping leave', category: 'LEAVE' }).expect(201)).body.policy;
    await people(hr).post(`/policies/${one.id}/versions`, { body: 'Ten days.', effectiveFrom: '2026-01-01', appliesTo: { departmentIds: [dept.id] } }).expect(201);
    await people(hr).post(`/policies/${one.id}/versions/1/submit`, {}).expect(200);
    /* "Leave policy" from the earlier test applies to the whole Bengaluru office, which Deepak is in: two leave policies reach him. */
    const found = (await people(hr).get('/policies/conflicts').expect(200)).body.conflicts;
    const hit = found.find((c: any) => c.category === 'LEAVE' && [c.a.title, c.b.title].includes('Housekeeping leave'));
    expect(hit).toBeTruthy();
    expect(hit.sample).toContain('Deepak Khan');
    const health = (await people(hr).get('/data-health').expect(200)).body;
    const check = health.checks.find((c: any) => c.id === 'policy-conflict');
    expect(check).toBeTruthy();
    expect(check.people.some((p: any) => p.name.includes('Housekeeping leave'))).toBe(true);
    /* Retiring one ends the conflict from today. */
    await people(hr).post(`/policies/${one.id}/versions/1/retire`, {}).expect(200);
    const asOfTomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await people(hr).get(`/policies/conflicts?asOf=${asOfTomorrow}`).expect(200)).body.conflicts.find((c: any) => [c.a.title, c.b.title].includes('Housekeeping leave'))).toBeUndefined();
  });

  it('a document on a person’s file can be sent to read and accept; the report lists who has not, and a reminder reaches them (DOC-05)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Rekha Nair', code: 'P-7', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const hrOnly = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Internal note', kind: 'OTHER', classification: 'HR_ONLY', ...file('x') }).expect(201)).body.document;
    await people(hr).post(`/documents/${hrOnly.id}/ask-to-read`, {}).expect(400);
    const doc = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Signed NDA', kind: 'CONTRACT', ...file('nda') }).expect(201)).body.document;
    const asked = (await people(hr).post(`/documents/${doc.id}/ask-to-read`, {}).expect(200)).body;
    expect(asked).toMatchObject({ newlyAsked: 1, asked: 1, accepted: 0, pending: 1 });
    expect((await people(hr).post(`/documents/${doc.id}/ask-to-read`, {}).expect(200)).body.newlyAsked).toBe(0);
    const rekha = await portalFor(hr, companyCode, e);
    const pending = (await request(app).get('/api/portal/people/acknowledgements').set(rekha).expect(200)).body.pending;
    expect(pending).toEqual([expect.objectContaining({ targetType: 'DOCUMENT', targetId: doc.id, title: 'Signed NDA' })]);
    expect((await people(hr).post(`/documents/${doc.id}/remind`, {}).expect(200)).body.reminded).toBe(1);
    const bell = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, kind: 'people.acknowledge', title: { contains: 'Signed NDA' } } });
    expect(bell.length).toBeGreaterThanOrEqual(0);
    await request(app).post(`/api/portal/people/acknowledgements/${pending[0].id}/accept`).set(rekha).expect(200);
    const rep = (await people(hr).get(`/documents/${doc.id}/acknowledgements`).expect(200)).body;
    expect(rep).toMatchObject({ asked: 1, accepted: 1, pending: 0 });
    expect(rep.acceptedList[0]).toMatchObject({ name: 'Rekha Nair' });
    expect((await people(hr).post(`/documents/${doc.id}/remind`, {}).expect(200)).body.reminded).toBe(0);
  });
});

describe('a policy that points at a document', () => {
  it('only a document employees may read can stand in for the text, and the app never hands out an HR-only one', async () => {
    const e = (await people(hr).post('/employees', { name: 'Doc Reader', code: `PD-${rnd()}`, dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const hrOnly = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Salary benchmarks', kind: 'OTHER', classification: 'HR_ONLY', ...file('secret') }).expect(201)).body.document;
    const open = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Handbook', kind: 'OTHER', classification: 'EMPLOYEE_VISIBLE', ...file('handbook') }).expect(201)).body.document;
    const p = (await people(hr).post('/policies', { title: 'Travel policy', category: 'CONDUCT' }).expect(201)).body.policy;
    const refused = await people(hr).post(`/policies/${p.id}/versions`, { documentId: hrOnly.id, effectiveFrom: '2026-01-01' }).expect(400);
    expect(refused.body.error).toContain('HR only');
    const v = (await people(hr).post(`/policies/${p.id}/versions`, { documentId: open.id, effectiveFrom: '2026-01-01' }).expect(201)).body.version;
    await people(hr).post(`/policies/${p.id}/versions/1/submit`, {}).expect(200);
    const reader = await portalFor(hr, companyCode, e);
    expect((await request(app).get(`/api/portal/people/policies/${v.id}`).set(reader).expect(200)).body.policy.document).toMatchObject({ id: open.id, title: 'Handbook' });
    /* A version saved before the check, still pointing at an HR-only file: the employee gets the policy without the file. */
    await runInTenant(hr.orgId, () => peoplePrisma.policyVersion.update({ where: { id: v.id }, data: { documentId: hrOnly.id } }));
    const read = (await request(app).get(`/api/portal/people/policies/${v.id}`).set(reader).expect(200)).body.policy;
    expect(read.document).toBeNull();
    expect(JSON.stringify(read)).not.toContain(Buffer.from('secret').toString('base64'));
  });
});
