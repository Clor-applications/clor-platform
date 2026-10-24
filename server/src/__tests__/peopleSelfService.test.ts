import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Personal details from the employee app (docs/people/02-PRD.md CORE-03;
 * decision D-02): contact details save at once and are logged as the
 * person's own change; an address or a date of birth waits for HR as a
 * PROFILE_CHANGE request; the company setting can move the line.
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
  const email = `self.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Self Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
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

let hr: Ctx;
let companyCode = '';
beforeAll(async () => {
  hr = await owner();
  companyCode = (await request(app).get(`/api/orgs/${hr.orgId}/attendance/portal-access`).set(at(hr)).expect(200)).body.company.code;
}, 60_000);

describe('personal details from the employee app', () => {
  it('a phone saves at once as the person’s own change; an address waits for HR, who approve it; the setting moves the line', async () => {
    const e = (await people(hr).post('/employees', { firstName: 'Imran', lastName: 'Patil', code: 'S-1', dateOfJoining: '2026-01-05', phone: '9000000001', city: 'Pune' }).expect(201)).body.employee;
    const imran = await portalFor(hr, companyCode, e);
    const mine = (await request(app).get('/api/portal/people/me/details').set(imran).expect(200)).body;
    expect(mine.fields).toMatchObject({ firstName: 'Imran', phone: '9000000001', city: 'Pune' });
    expect(mine.labels.gender).toBe('Gender');

    /* Contact detail: saved now, logged as self-service. */
    const r1 = (await request(app).post('/api/portal/people/me/change-request').set(imran).send({ phone: '9000000002', emergencyContactName: 'Sana Patil' }).expect(200)).body;
    expect(r1).toMatchObject({ saved: ['phone', 'emergencyContactName'], request: null });
    const line = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'phone' } }));
    expect(line).toMatchObject({ after: '9000000002', source: 'SELF_SERVICE', actorUserId: null });

    /* Address and gender: a request, under a default rule made on the spot; nothing on the record yet. */
    await request(app).post('/api/portal/people/me/change-request').set(imran).send({ gender: 'maybe' }).expect(400);
    const r2 = (await request(app).post('/api/portal/people/me/change-request').set(imran).send({ city: 'Mumbai', gender: 'prefer_not_to_say' }).expect(202)).body;
    expect(r2.saved).toEqual([]);
    expect(r2.requested).toEqual(['city', 'gender']);
    expect(r2.request).toMatchObject({ status: 'WAITING', title: 'Imran Patil: city, gender change' });
    expect((await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee.city).toBe('Pune');
    expect((await request(app).get('/api/portal/people/me/details').set(imran).expect(200)).body.waiting).toEqual([expect.objectContaining({ id: r2.request.id, fields: ['city', 'gender'] })]);
    const rule = (await people(hr).get('/approval-rules/active/PROFILE_CHANGE').expect(200)).body;
    expect(JSON.stringify(rule)).toContain('Profile changes (default: HR decides)');
    /* HR (the owner holds Employees EDIT) approves; the record changes through the write path with the request on the log. */
    const done = (await people(hr).post(`/requests/${r2.request.id}/approve`, {}).expect(200)).body;
    expect(done.request.status).toBe('APPROVED');
    const after = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(after).toMatchObject({ city: 'Mumbai', gender: 'PREFER_NOT_TO_SAY' });
    const approved = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'city' } }));
    expect(approved).toMatchObject({ after: 'Mumbai', source: 'APPROVAL', requestId: r2.request.id });

    /* The setting: everything waits. */
    expect((await people(hr).get('/settings').expect(200)).body.settings.selfServiceChanges).toBe('CONTACT_DIRECT');
    await people(hr).put('/settings', { selfServiceChanges: 'sometimes' }).expect(400);
    await people(hr).put('/settings', { selfServiceChanges: 'ALL' }).expect(200);
    const r3 = (await request(app).post('/api/portal/people/me/change-request').set(imran).send({ phone: '9000000003' }).expect(202)).body;
    expect(r3).toMatchObject({ saved: [], requested: ['phone'] });
    /* And: nothing waits, HR is told. */
    await people(hr).put('/settings', { selfServiceChanges: 'NONE' }).expect(200);
    const r4 = (await request(app).post('/api/portal/people/me/change-request').set(imran).send({ city: 'Nashik' }).expect(200)).body;
    expect(r4).toMatchObject({ saved: ['city'], request: null });
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    expect(await platformPrisma.notification.count({ where: { orgId: hr.orgId, kind: 'people.self_change' } })).toBeGreaterThanOrEqual(1);
    /* Nothing changed: nothing happens. */
    expect((await request(app).post('/api/portal/people/me/change-request').set(imran).send({ city: 'Nashik' }).expect(200)).body.saved).toEqual([]);
  });
});
