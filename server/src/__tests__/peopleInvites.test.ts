import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Before day one (docs/people/02-PRD.md LIFE-01): the invite works once,
 * runs out in fourteen days, shows the joiner only their own data, and what
 * they send waits as "sent, not checked" until HR checks it onto the record.
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
  const email = `inv.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Inv Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
const tokenOf = (link: string) => link.split('/').pop()!;

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('invites before day one', () => {
  it('works once, shows only the joiner’s own data, and what they send waits until HR checks it onto the record', async () => {
    await people(hr).post('/employees', { name: 'Other Person', code: 'IN-0', dateOfJoining: '2025-01-05' }).expect(201);
    const e = (await people(hr).post('/employees', { name: 'Pooja Kumar', code: 'IN-1', dateOfJoining: '2026-11-10', designation: 'Designer' }).expect(201)).body.employee;

    /* By e-mail the link goes only to the joiner; by phone HR is handed it to send. */
    const mailed = (await people(hr).post(`/employees/${e.id}/invites`, { channel: 'EMAIL', sentTo: 'pooja@example.com', message: 'Read the leave policy before you come.' }).expect(201)).body;
    expect(mailed.invite).toMatchObject({ status: 'SENT', channel: 'EMAIL', sentTo: 'pooja@example.com' });
    expect(mailed.link).toBeNull();
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: hr.orgId, templateKey: 'people.join_invite', toEmail: 'pooja@example.com' } });
    expect(mail?.bodyText).toContain('/api/people/join/');
    expect(mail?.bodyText).toContain('Read the leave policy');
    const sms = (await people(hr).post(`/employees/${e.id}/invites`, { channel: 'SMS', sentTo: '9876543210' }).expect(201)).body;
    expect(sms.link).toMatch(/\/api\/people\/join\/[a-f0-9]{64}$/);
    /* The newer invite replaces the earlier one. */
    const first = tokenOf(/\/api\/people\/join\/[a-f0-9]{64}/.exec(mail!.bodyText)![0]);
    await request(app).get(`/api/people/join/${first}`).set('Accept', 'application/json').expect(410);

    /* The joiner sees their own name and joining date and nothing about anyone else. */
    const page = await request(app).get(`/api/people/join/${tokenOf(sms.link)}`).expect(200);
    expect(page.text).toContain('Pooja Kumar');
    expect(page.text).toContain('2026-11-10');
    expect(page.text).not.toContain('Other Person');
    const view = (await request(app).get(`/api/people/join/${tokenOf(sms.link)}`).set('Accept', 'application/json').expect(200)).body;
    expect(view).toMatchObject({ status: 'STARTED', name: 'Pooja Kumar', dateOfJoining: '2026-11-10', message: null });
    expect(Object.keys(view)).not.toContain('employees');

    /* Sending needs the declaration; then it works once. */
    await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: { city: 'Mysuru' }, declarations: { accurate: false } }).expect(400);
    await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: { pincode: '12' }, declarations: { accurate: true } }).expect(400);
    const sent = (await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({
      fields: { personalEmail: 'pooja.k@example.com', phone: '9876543210', dateOfBirth: '1998-04-12', gender: 'female', city: 'Mysuru', state: 'Karnataka', pincode: '570001', emergencyContactName: 'Lata Kumar', emergencyContactPhone: '9000000000', emergencyContactRelation: 'Mother' },
      documents: [{ kind: 'ID_PROOF', title: 'Aadhaar', ...file('aadhaar') }],
      declarations: { accurate: true, policiesRead: true },
    }).expect(200)).body;
    expect(sent.status).toBe('RETURNED');
    await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: { city: 'Again' }, declarations: { accurate: true } }).expect(410);
    await request(app).get(`/api/people/join/${tokenOf(sms.link)}`).set('Accept', 'application/json').expect(410);

    /* Nothing is on the record yet; the document is, marked as the joiner's. */
    const before = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(before.city).toBeNull();
    const docs = (await people(hr).get(`/employees/${e.id}/documents`).expect(200)).body.documents;
    expect(docs).toEqual([expect.objectContaining({ title: 'Aadhaar', kind: 'ID_PROOF', classification: 'EMPLOYEE_VISIBLE', uploadedByUserId: 'JOINER' })]);
    const waiting = (await people(hr).get('/invites?status=RETURNED').expect(200)).body.invites;
    expect(waiting).toEqual([expect.objectContaining({ employeeName: 'Pooja Kumar', status: 'RETURNED' })]);
    expect(waiting[0].submitted).toMatchObject({ fields: { city: 'Mysuru', gender: 'FEMALE' }, declarations: { accurate: true, policiesRead: true } });
    expect(waiting[0]).not.toHaveProperty('tokenHash');
    const bell = await platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, kind: 'people.invite' } });
    expect(bell?.title).toBe('Pooja Kumar sent their joining details');

    /* HR checks, correcting one field; the record changes through the one write path and the log says where it came from. */
    const checked = (await people(hr).post(`/invites/${waiting[0].id}/check`, { fields: { city: 'Mysore' } }).expect(200)).body;
    expect(checked.invite.status).toBe('CHECKED');
    expect(checked.applied.sort()).toEqual(['city', 'dateOfBirth', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'gender', 'personalEmail', 'phone', 'pincode', 'state']);
    const after = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(after).toMatchObject({ city: 'Mysore', personalEmail: 'pooja.k@example.com', gender: 'FEMALE', pincode: '570001' });
    const line = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'city' } }));
    expect(line).toMatchObject({ after: 'Mysore', source: 'SELF_SERVICE', actorUserId: hr.userId });
    await people(hr).post(`/invites/${waiting[0].id}/check`, {}).expect(409);
  });

  it('runs out after fourteen days, and sending one needs the Lifecycle grant', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'IN-2', dateOfJoining: '2026-12-01' }).expect(201)).body.employee;
    const sms = (await people(hr).post(`/employees/${e.id}/invites`, { channel: 'SMS', sentTo: '9876500000' }).expect(201)).body;
    expect(new Date(sms.invite.expiresAt).getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    await runInTenant(hr.orgId, () => peoplePrisma.joinInvite.update({ where: { id: sms.invite.id }, data: { expiresAt: new Date(Date.now() - 60_000) } }));
    const gone = await request(app).get(`/api/people/join/${tokenOf(sms.link)}`).set('Accept', 'application/json').expect(410);
    expect(gone.body.status).toBe('EXPIRED');
    await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: {}, declarations: { accurate: true } }).expect(410);
    await request(app).get('/api/people/join/not-a-token').set('Accept', 'application/json').expect(404);

    const viewer = await colleague(hr, 'Viewer', ['PEOPLE::Employees::VIEW']);
    await people(viewer).post(`/employees/${e.id}/invites`, { channel: 'SMS', sentTo: '9876500000' }).expect(403);
    await people(viewer).get('/invites').expect(403);
  });
});
