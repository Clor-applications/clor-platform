import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The rule preview for LEAVE, with leave on the engine switched off, is what it was on main before
 * workflow engine 2c (review of PR #102, item 6): leave's own words for who decides apply only to the
 * engine requests leave opens itself (sourceKind LEAVE, a preset), never to a preview or anything else
 * of the same type. The fixture was recorded by running this file on origin/main with
 * PARITY_RECORD=<path>; it uses only what main has (previewRule, the stand-in table).
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { previewRule } = await import('../services/people/approvals/engine.js');

const FIXTURE = fileURLToPath(new URL('./fixtures/leavePreviewMain.json', import.meta.url));
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; roleId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `lp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Lp Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  c.userId = me.body.user.id;
  c.accountId = me.body.orgs.find((o: any) => o.orgId === c.orgId).accountId;
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId, roleId: role.body.role.id };
}
const APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE', 'ATTENDANCE::Leave Requests::APPROVE'];

let hr: Ctx;
const emp: Record<string, any> = {};
const users: Record<string, Ctx> = {};
beforeAll(async () => {
  hr = await owner();
  users.ravi = await colleague(hr, 'Ravi', APPROVER);
  users.meena = await colleague(hr, 'Meena', APPROVER);
  users.priya = await colleague(hr, 'Priya', APPROVER);
  users.kiran = await colleague(hr, 'Kiran', APPROVER, true);
  const add = async (name: string, code: string, managerId?: string) => (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ name, code, ...(managerId ? { reportingManagerId: managerId } : {}) }).expect(201)).body.employee;
  emp.meena = await add('Meena Iyer', 'P-1');
  emp.ravi = await add('Ravi Kumar', 'P-2', emp.meena.id);
  emp.tara = await add('Tara Singh', 'P-3', emp.ravi.id);
  emp.lone = await add('Lone Wolf', 'P-4');
  await runInTenant(hr.orgId, async () => {
    for (const k of ['meena', 'ravi']) await peoplePrisma.employee.update({ where: { id: emp[k].id }, data: { userId: users[k].userId } });
    await peoplePrisma.employee.update({ where: { id: emp.lone.id }, data: { portalEnabled: true } });
    /* A stand-in by sign-in (a People stand-in), as main stores one. */
    await peoplePrisma.standIn.create({ data: { accountId: hr.accountId, orgId: hr.orgId, userId: users.ravi.userId, standInUserId: users.priya.userId, fromDate: todayIst(), toDate: todayIst() } as any });
  });
}, 120_000);

describe('the LEAVE rule preview, leave on the engine off', () => {
  it('names the same people, for the same reasons, as main', async () => {
    const drafts: Record<string, unknown[]> = {
      HR: [{ order: 1, approver: { kind: 'HR' }, dueDays: 2 }],
      MANAGER: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }],
      MANAGER_THEN_HR: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }, { order: 2, approver: { kind: 'HR' }, dueDays: 2 }],
      MANAGER_OF_MANAGER: [{ order: 1, approver: { kind: 'MANAGER_OF_MANAGER' }, dueDays: 2 }],
      ROLE: [{ order: 1, approver: { kind: 'ROLE', id: users.kiran.roleId }, dueDays: 2 }, { order: 2, approver: { kind: 'USER', id: users.meena.userId }, dueDays: 2 }],
    };
    const { normaliseSteps } = await import('../services/people/approvals/spec.js');
    const results: Record<string, unknown> = {};
    for (const [name, steps] of Object.entries(drafts)) {
      for (const who of ['tara', 'ravi', 'lone']) {
        const out = await runInTenant(hr.orgId, () => previewRule({ accountId: hr.accountId, orgId: hr.orgId }, { requestType: 'LEAVE', rule: { name, steps: normaliseSteps(steps, 'LEAVE'), autoApprove: [] } as any, sample: { employeeId: emp[who].id, payload: { days: 1 } } }));
        results[`${name} / ${who}`] = { ...out, steps: out.steps.map((s: any) => ({ ...s, dueAt: s.dueAt ? 'set' : null, slots: s.slots.map((x: any) => ({ ...x, people: [...x.people].sort() })) })) };
      }
    }
    if (process.env.PARITY_RECORD) {
      writeFileSync(process.env.PARITY_RECORD, `${JSON.stringify({ recordedOn: process.env.PARITY_COMMIT || 'origin/main', results }, null, 1)}\n`);
      return;
    }
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')).results;
    expect(JSON.stringify(results)).toBe(JSON.stringify(main));
  }, 120_000);
});
