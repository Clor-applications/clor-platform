import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

/**
 * Employee app access in bulk (HR-VIEW gap 3): from the directory HR picks
 * people and each gets a one-time activation code: by e-mail where there is
 * one (HR never sees the code), else once in the reply for a printed sheet
 * and a WhatsApp link. Every send is recorded; a code is never shown twice.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `aa.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `AA Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `v.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Viewer', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

describe('send employee app access', () => {
  let hr: Ctx;
  beforeAll(async () => {
    hr = await owner();
  }, 60_000);

  it('e-mails a code where there is an address, hands one over once for a phone, and skips who cannot get one', async () => {
    const mailed = (await people(hr).post('/employees', { name: 'Mail Person', code: 'AA-1', email: 'mail.person@example.com', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const phoned = (await people(hr).post('/employees', { name: 'Phone Person', code: 'AA-2', phone: '98450 12345', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const nothing = (await people(hr).post('/employees', { name: 'No Contact', code: 'AA-3', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const noCode = (await people(hr).post('/employees', { name: 'No Code', email: 'nocode@example.com', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;

    const r = (await people(hr).post('/app-access/send', { employeeIds: [mailed.id, phoned.id, nothing.id, noCode.id] }).expect(200)).body;
    expect(r.sent).toHaveLength(2);
    const byMail = r.sent.find((s: any) => s.employeeId === mailed.id);
    expect(byMail).toEqual({ employeeId: mailed.id, name: 'Mail Person', employeeCode: 'AA-1', channel: 'EMAIL', sentTo: 'mail.person@example.com' });
    expect(byMail).not.toHaveProperty('activationCode');
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: hr.orgId, templateKey: 'attendance.portal_invite', toEmail: 'mail.person@example.com' } });
    expect(mail?.bodyText).toMatch(/Activation code: {2}[A-Z0-9]{4}-[A-Z0-9]{4}/);
    expect(mail?.bodyText).toContain('e=AA-1');

    const byPhone = r.sent.find((s: any) => s.employeeId === phoned.id);
    expect(byPhone).toMatchObject({ channel: 'PRINT', phoneEnding: '2345', activationCode: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) });
    expect(byPhone.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919845012345\?text=/);
    expect(decodeURIComponent(byPhone.whatsappUrl)).toContain(byPhone.activationCode);
    /* One wording for when the code stops, in India's time: the WhatsApp text says exactly what HR's screen shows. */
    expect(r.expiresWords).toBe(new Date(r.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }));
    expect(decodeURIComponent(byPhone.whatsappUrl)).toContain(`until ${r.expiresWords})`);
    /* The code handed over is the one that works: only its hash is kept. */
    const row = await runInTenant(hr.orgId, () => peoplePrisma.employee.findFirst({ where: { id: phoned.id }, select: { portalEnabled: true, portalSetupHash: true } }));
    expect(row?.portalEnabled).toBe(true);
    expect(await bcrypt.compare(byPhone.activationCode.replace('-', ''), row!.portalSetupHash!)).toBe(true);

    expect(r.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: nothing.id, reason: 'No e-mail or phone on file.' }),
      expect.objectContaining({ employeeId: noCode.id, reason: expect.stringMatching(/No employee code/) }),
    ]));

    /* Recorded: who, how, when; never the code. */
    const sends = (await people(hr).get('/app-access/sends').expect(200)).body.sends;
    expect(sends.map((s: any) => [s.employeeName, s.channel, s.sentTo]).sort()).toEqual([['Mail Person', 'EMAIL', 'mail.person@example.com'], ['Phone Person', 'PRINT', 'phone ending 2345']]);
    expect(JSON.stringify(sends)).not.toContain(byPhone.activationCode);
    expect(sends[0].sentByUserId).toBe(hr.userId);
    const one = (await people(hr).get(`/app-access/sends?employeeId=${phoned.id}`).expect(200)).body.sends;
    expect(one).toHaveLength(1);

    /* Sending again makes a new code; the old one stops working. */
    const again = (await people(hr).post('/app-access/send', { employeeIds: [phoned.id] }).expect(200)).body.sent[0];
    expect(again.activationCode).not.toBe(byPhone.activationCode);
    const after = await runInTenant(hr.orgId, () => peoplePrisma.employee.findFirst({ where: { id: phoned.id }, select: { portalSetupHash: true } }));
    expect(await bcrypt.compare(byPhone.activationCode.replace('-', ''), after!.portalSetupHash!)).toBe(false);
  });

  it('needs the Lifecycle grant, someone picked, and people from this company only', async () => {
    await people(hr).post('/app-access/send', { employeeIds: [] }).expect(400);
    const r = (await people(hr).post('/app-access/send', { employeeIds: ['not-here'] }).expect(200)).body;
    expect(r.skipped).toEqual([{ employeeId: 'not-here', name: '', reason: 'Not in this company.' }]);
    const viewer = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    await people(viewer).post('/app-access/send', { employeeIds: ['x'] }).expect(403);
    await people(viewer).get('/app-access/sends').expect(403);
  });
});
