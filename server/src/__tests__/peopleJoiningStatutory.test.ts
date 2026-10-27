import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Statutory details at joining (HR-VIEW gap 2): the joiner sends PAN, UAN,
 * ESIC, bank and PF nominees on their invite; they are checked for form,
 * shown masked everywhere but the approval view, and reach Payroll's record
 * only once HR approves, with an audit line. A bank account that differs
 * from the one on file waits for Payroll's bank change approval. Without
 * Payroll the approved set waits in People until Payroll is switched on.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `js.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `JS Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
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
const tokenOf = (link: string) => link.split('/').pop()!;
const STATUTORY = {
  pan: 'abcde1234f', uan: '100200300400', esicNumber: '1234567890',
  bankAccountName: 'Pooja Kumar', bankAccountNumber: '123456789012', bankIfsc: 'hdfc0001234', bankName: 'HDFC Bank',
  nominees: [{ name: 'Lata Kumar', relation: 'mother', sharePercent: 60 }, { name: 'Ravi Kumar', relation: 'FATHER', sharePercent: 40, dateOfBirth: '1965-02-01' }],
};
async function joinerSends(c: Ctx, code: string, statutory: unknown) {
  const e = (await people(c).post('/employees', { name: `Joiner ${code}`, code, dateOfJoining: '2026-12-01' }).expect(201)).body.employee;
  const sms = (await people(c).post(`/employees/${e.id}/invites`, { channel: 'SMS', sentTo: '9876543210' }).expect(201)).body;
  const sent = await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: { city: 'Mysuru' }, statutory, declarations: { accurate: true } });
  return { e, invite: sms.invite, link: sms.link, sent };
}

describe('statutory details at joining', () => {
  let hr: Ctx;
  beforeAll(async () => {
    hr = await owner({ people: true, attendance: true, payroll: true });
  }, 60_000);

  it('checks the form of each number and that nominee shares add up to 100', async () => {
    const e = (await people(hr).post('/employees', { name: 'Form Check', code: 'JS-0', dateOfJoining: '2026-12-01' }).expect(201)).body.employee;
    const sms = (await people(hr).post(`/employees/${e.id}/invites`, { channel: 'SMS', sentTo: '9876543210' }).expect(201)).body;
    const send = (statutory: unknown) => request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: {}, statutory, declarations: { accurate: true } });
    expect((await send({ pan: 'ABCD1234F' }).expect(400)).body.error).toMatch(/PAN/);
    expect((await send({ uan: '12345678901' }).expect(400)).body.error).toMatch(/UAN is 12 digits/);
    expect((await send({ esicNumber: '123456789012' }).expect(400)).body.error).toMatch(/10 or 17 digits/);
    expect((await send({ bankAccountNumber: '123456789012', bankIfsc: 'HDFC1001234' }).expect(400)).body.error).toMatch(/IFSC/);
    expect((await send({ bankAccountNumber: '123456789012' }).expect(400)).body.error).toMatch(/together/);
    expect((await send({ nominees: [{ name: 'A', relation: 'SPOUSE', sharePercent: 50 }] }).expect(400)).body.error).toMatch(/add up to 50%/);
    expect((await send({ nominees: [{ name: 'A', relation: 'COUSIN', sharePercent: 100 }] }).expect(400)).body.error).toMatch(/relation/);
    /* A 17-digit ESIC is fine; nothing was kept from the refused attempts. */
    await send({ esicNumber: '12345678901234567' }).expect(200);
  });

  it('is masked in lists, in full only in the approval view (logged), and reaches Payroll only after approval, with an audit line', async () => {
    const { e, invite, sent } = await joinerSends(hr, 'JS-1', STATUTORY);
    expect(sent.status).toBe(200);

    /* Masked in the list of invites: no full PAN, UAN, ESIC or account number anywhere in it. */
    const list = (await people(hr).get('/invites?status=RETURNED').expect(200)).body.invites;
    const mine = list.find((i: any) => i.id === invite.id);
    expect(mine.statutory).toMatchObject({ status: 'SENT', masked: true, values: { pan: 'AB*******F', bankIfsc: 'HDFC0001234', nominees: [{ name: 'Lata Kumar', relation: 'MOTHER', sharePercent: 60 }, { name: 'Ravi Kumar', relation: 'FATHER', sharePercent: 40 }] } });
    const text = JSON.stringify(list);
    for (const secret of ['ABCDE1234F', '100200300400', '1234567890', '123456789012', '1965-02-01']) expect(text).not.toContain(secret);
    expect(mine.submitted).not.toHaveProperty('statutory');

    /* Nothing in Payroll yet. */
    expect(await runInTenant(hr.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: e.id } }))).toBeNull();
    const record = (await people(hr).get(`/employees/${e.id}/statutory`).expect(200)).body;
    expect(record.joining).toMatchObject({ status: 'SENT', masked: true });
    expect(JSON.stringify(record)).not.toContain('ABCDE1234F');

    /* The approval view needs the Statutory Details grant. */
    const lifecycleOnly = await colleague(hr, 'Lifecycle', ['PEOPLE::Employees::VIEW', 'PEOPLE::Lifecycle::VIEW', 'PEOPLE::Lifecycle::EDIT']);
    await people(lifecycleOnly).get(`/invites/${invite.id}/statutory`).expect(403);
    await people(lifecycleOnly).post(`/invites/${invite.id}/statutory/approve`, {}).expect(403);
    const full = (await people(hr).get(`/invites/${invite.id}/statutory`).expect(200)).body.statutory;
    expect(full).toMatchObject({ masked: false, values: { pan: 'ABCDE1234F', uan: '100200300400', esicNumber: '1234567890', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' } });
    const seen = await runInTenant(hr.orgId, () => peoplePrisma.accessLog.findFirst({ where: { orgId: hr.orgId, what: 'STATUTORY', employeeId: e.id, field: 'joining' } }));
    expect(seen?.userId).toBe(hr.userId);

    /* Approved: on Payroll's record for the same employee id, bank as first details, nominees stored there. */
    const approved = (await people(hr).post(`/invites/${invite.id}/statutory/approve`, {}).expect(200)).body;
    expect(approved).toMatchObject({ payroll: 'SENT', statutory: { status: 'APPLIED', bankOutcome: 'APPLIED', masked: true } });
    const profile = await runInTenant(hr.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: e.id } }));
    expect(profile).toMatchObject({ pan: 'ABCDE1234F', uan: '100200300400', esiNumber: '1234567890', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' });
    const nominees = await runInTenant(hr.orgId, () => payrollPrisma.pfNominee.findMany({ where: { employeeId: e.id }, orderBy: { name: 'asc' } }));
    expect(nominees.map((n) => [n.name, n.relation, Number(n.sharePercent), n.source])).toEqual([['Lata Kumar', 'MOTHER', 60, 'JOINING'], ['Ravi Kumar', 'FATHER', 40, 'JOINING']]);
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: hr.orgId, action: 'JOINING_STATUTORY', entityId: profile!.id } });
    expect(audit?.message).toMatch(/PAN, UAN, ESIC, bank \(first on file\), 2 PF nominees/);
    expect(audit?.metadata).not.toContain('ABCDE1234F');
    expect(audit?.createdByUserId).toBe(hr.userId);
    /* People's change log says what changed, never the value. */
    const lines = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { employeeId: e.id, entity: 'JoinStatutory' } }));
    expect(lines.find((l) => l.field === 'pan')).toMatchObject({ before: null, after: null });
    /* People keeps only the masked copy; the approval view no longer shows it in full. */
    const stored = await runInTenant(hr.orgId, () => peoplePrisma.joinStatutory.findFirst({ where: { inviteId: invite.id } }));
    expect(JSON.stringify(stored?.data)).not.toContain('ABCDE1234F');
    expect((await people(hr).get(`/invites/${invite.id}/statutory`).expect(200)).body.statutory.masked).toBe(true);
    await people(hr).post(`/invites/${invite.id}/statutory/approve`, {}).expect(409);
    /* Payroll's own employee record shows the nominees. */
    const pr = (await request(app).get(`/api/orgs/${hr.orgId}/payroll/employees/${e.id}`).set(at(hr)).expect(200)).body;
    expect(pr.nominees).toHaveLength(2);
  });

  it('a different bank account than the one on file waits for Payroll’s bank change approval', async () => {
    const first = await joinerSends(hr, 'JS-2', { bankAccountNumber: '111122223333', bankIfsc: 'SBIN0000001' });
    await people(hr).post(`/invites/${first.invite.id}/statutory/approve`, {}).expect(200);
    const sms = (await people(hr).post(`/employees/${first.e.id}/invites`, { channel: 'SMS', sentTo: '9876543210' }).expect(201)).body;
    await request(app).post(`/api/people/join/${tokenOf(sms.link)}`).send({ fields: {}, statutory: { bankAccountNumber: '999988887777', bankIfsc: 'ICIC0000002' }, declarations: { accurate: true } }).expect(200);
    const r = (await people(hr).post(`/invites/${sms.invite.id}/statutory/approve`, {}).expect(200)).body;
    expect(r.statutory.bankOutcome).toBe('PENDING');
    const profile = await runInTenant(hr.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: first.e.id } }));
    expect(profile?.bankAccountNumber).toBe('111122223333');
    const change = await runInTenant(hr.orgId, () => payrollPrisma.bankDetailChange.findFirst({ where: { employeeId: first.e.id, status: 'PENDING' } }));
    expect(change).toMatchObject({ newAccountNumber: '999988887777', newIfsc: 'ICIC0000002' });
  });

  it('HR may correct a value when approving, or turn the details down', async () => {
    const a = await joinerSends(hr, 'JS-3', { pan: 'ABCDE1234F' });
    await people(hr).post(`/invites/${a.invite.id}/statutory/approve`, { values: { pan: 'BADPAN' } }).expect(400);
    await people(hr).post(`/invites/${a.invite.id}/statutory/approve`, { values: { pan: 'PQRST6789Z' } }).expect(200);
    expect((await runInTenant(hr.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: a.e.id } })))?.pan).toBe('PQRST6789Z');
    const b = await joinerSends(hr, 'JS-4', { pan: 'ABCDE1234F' });
    const no = (await people(hr).post(`/invites/${b.invite.id}/statutory/reject`, { note: 'PAN card does not match' }).expect(200)).body.statutory;
    expect(no).toMatchObject({ status: 'REJECTED', note: 'PAN card does not match' });
    expect(await runInTenant(hr.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: b.e.id } }))).toBeNull();
    const stored = await runInTenant(hr.orgId, () => peoplePrisma.joinStatutory.findFirst({ where: { inviteId: b.invite.id } }));
    expect(JSON.stringify(stored?.data)).not.toContain('ABCDE1234F');
  });

  it('without Payroll the approved details stay in People until Payroll is switched on', async () => {
    const solo = await owner({ people: true, attendance: true, payroll: false });
    const { e, invite } = await joinerSends(solo, 'SO-1', { pan: 'ABCDE1234F', nominees: [{ name: 'Lata', relation: 'MOTHER', sharePercent: 100 }] });
    const r = (await people(solo).post(`/invites/${invite.id}/statutory/approve`, {}).expect(200)).body;
    expect(r).toMatchObject({ payroll: 'HELD_UNTIL_PAYROLL', statutory: { status: 'HELD' } });
    expect(await runInTenant(solo.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: e.id } }))).toBeNull();
    const record = (await people(solo).get(`/employees/${e.id}/statutory`).expect(200)).body;
    expect(record.joining).toMatchObject({ status: 'HELD', values: { pan: 'AB*******F' } });
    await people(solo).post('/joining-statutory/send-held', {}).expect(409);

    await request(app).put(`/api/orgs/${solo.orgId}/features`).set(at(solo)).send({ features: { payroll: true } }).expect(200);
    expect((await people(solo).post('/joining-statutory/send-held', {}).expect(200)).body).toEqual({ sent: 1 });
    expect((await runInTenant(solo.orgId, () => payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId: e.id } })))?.pan).toBe('ABCDE1234F');
    expect(await runInTenant(solo.orgId, () => payrollPrisma.pfNominee.count({ where: { employeeId: e.id } }))).toBe(1);
    expect((await people(solo).post('/joining-statutory/send-held', {}).expect(200)).body).toEqual({ sent: 0 });
  }, 60_000);
});
