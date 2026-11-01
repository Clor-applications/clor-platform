import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Parity with the engine before workflow engine 2a (review of PR #93): the
 * same presets and scenarios run here and were run on origin/main (commit in
 * the fixture), and who decides and what happens after the first decision
 * must match. The fixture was recorded by running this file on main with
 * PARITY_RECORD=<path>; it uses only the API and columns main has.
 *
 * The one difference allowed is written down, not hidden: a team-scoped
 * approver named through a role no longer decides for someone outside their
 * team (SPEC 5.3, accepted engine behaviour, in the PR's release note).
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const FIXTURE = fileURLToPath(new URL('./fixtures/approvalParityMain.json', import.meta.url));
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; roleId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `pm.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Pm Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.userId = me.body.user.id;
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
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
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

let hr: Ctx;
let ravi: Ctx;
let meena: Ctx;
let priya: Ctx;
let kiran: Ctx;
let byUser: Map<string, Ctx>;
let raviEmp: any;
let tara: any;
let lone: any;
let orphan: any;
beforeAll(async () => {
  hr = await owner();
  ravi = await colleague(hr, 'Ravi', APPROVER);
  meena = await colleague(hr, 'Meena', APPROVER);
  priya = await colleague(hr, 'Priya', APPROVER);
  kiran = await colleague(hr, 'Kiran', APPROVER, true);
  byUser = new Map([hr, ravi, meena, priya, kiran].map((c) => [c.userId, c]));
  const meenaEmp = (await people(hr).post('/employees', { name: 'Meena Iyer', code: 'P-1' }).expect(201)).body.employee;
  raviEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'P-2', reportingManagerId: meenaEmp.id }).expect(201)).body.employee;
  tara = (await people(hr).post('/employees', { name: 'Tara Singh', code: 'P-4', reportingManagerId: raviEmp.id }).expect(201)).body.employee;
  lone = (await people(hr).post('/employees', { name: 'Lone Wolf', code: 'P-5' }).expect(201)).body.employee;
  const gone = (await people(hr).post('/employees', { name: 'Gone Away', code: 'P-6' }).expect(201)).body.employee;
  orphan = (await people(hr).post('/employees', { name: 'Orphan Kid', code: 'P-7', reportingManagerId: gone.id }).expect(201)).body.employee;
  await runInTenant(hr.orgId, async () => {
    await peoplePrisma.employee.update({ where: { id: meenaEmp.id }, data: { userId: meena.userId } });
    await peoplePrisma.employee.update({ where: { id: raviEmp.id }, data: { userId: ravi.userId } });
    await peoplePrisma.employee.update({ where: { id: gone.id }, data: { status: 'LEFT' } });
  });
}, 120_000);

/* Written with the columns main has: a rule as every rule saved before 2a is. */
async function storeV1(requestType: string, steps: unknown[]) {
  return runInTenant(hr.orgId, async () => {
    const latest = await peoplePrisma.approvalRule.findFirst({ where: { orgId: hr.orgId, requestType }, orderBy: { version: 'desc' } });
    await peoplePrisma.approvalRule.updateMany({ where: { orgId: hr.orgId, requestType, active: true }, data: { active: false } });
    return peoplePrisma.approvalRule.create({ data: { accountId: hr.accountId, orgId: hr.orgId, requestType, name: 'v1', version: (latest?.version || 0) + 1, active: true, steps: steps as any } });
  });
}
const story = (r: any) => ({ status: r.status, steps: r.steps.map((s: any) => ({ order: s.order, status: s.status, candidates: [...s.candidates].sort(), comment: s.comment, standInFor: s.standInFor, decidedBy: s.decidedBy })) });

describe('parity with the engine on main', () => {
  it('every preset × scenario: the same deciders, and the same outcome after the first decision', async () => {
    const presets: Record<string, unknown[]> = {
      HR: [{ order: 1, approver: { kind: 'HR' }, dueDays: 5, overdue: { action: 'REMIND' } }],
      MANAGER: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }],
      MANAGER_THEN_HR: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 3, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } }, { order: 2, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } }],
      MONEY: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }, { order: 2, approver: { kind: 'HR' }, condition: { field: 'monthTotal', op: 'gt', value: '5000' }, dueDays: 2 }],
      GRADE: [{ order: 1, approver: { kind: 'MANAGER_OF_MANAGER' }, dueDays: 2 }, { order: 2, approver: { kind: 'USER', id: priya.userId }, condition: { field: 'gradeId', op: 'changed' }, dueDays: 2 }],
      ROLE: [{ order: 1, approver: { kind: 'ROLE', id: kiran.roleId }, dueDays: 2 }, { order: 2, approver: { kind: 'USER', id: meena.userId }, dueDays: 2 }],
    };
    const scenarios: Array<{ name: string; by: Ctx; subject: any; standIn?: boolean }> = [
      { name: 'with a manager', by: hr, subject: tara },
      { name: 'no manager', by: ravi, subject: lone },
      { name: 'manager left', by: ravi, subject: orphan },
      { name: 'stand-in', by: priya, subject: tara, standIn: true },
      { name: 'own request', by: ravi, subject: raviEmp },
      { name: 'requester is the approver', by: ravi, subject: tara },
    ];
    const payload = { monthTotal: 6000, fields: { gradeId: { before: 'g1', after: 'g2' } } };
    const results: Record<string, unknown> = {};
    for (const [preset, steps] of Object.entries(presets)) {
      for (const sc of scenarios) {
        await storeV1('SEAT_REQUEST', steps);
        const stand = sc.standIn ? await runInTenant(hr.orgId, () => peoplePrisma.standIn.create({ data: { accountId: hr.accountId, orgId: hr.orgId, userId: ravi.userId, standInUserId: meena.userId, fromDate: todayIst(), toDate: todayIst() } })) : null;
        try {
          const r = (await people(sc.by).post('/requests', { requestType: 'SEAT_REQUEST', subjectEmployeeId: sc.subject.id, title: `${preset} ${sc.name}`, payload: { employeeId: sc.subject.id, ...payload } }).expect(201)).body.request;
          const view = async () => (await people(hr).get(`/requests/${r.id}`).expect(200)).body.request;
          const opened = story(await view());
          const raw = await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.findFirst({ where: { requestId: r.id, status: 'WAITING' } }));
          const decider = raw ? byUser.get((raw.candidateUserIds as string[])[0]) : null;
          if (decider) await people(decider).post(`/requests/${r.id}/approve`, {}).expect(200);
          results[`${preset} / ${sc.name}`] = { opened, after: story(await view()) };
        } finally {
          if (stand) await runInTenant(hr.orgId, () => peoplePrisma.standIn.delete({ where: { id: stand.id } }));
        }
      }
    }
    if (process.env.PARITY_RECORD) {
      writeFileSync(process.env.PARITY_RECORD, `${JSON.stringify({ recordedOn: process.env.PARITY_COMMIT || 'origin/main', results }, null, 1)}\n`);
      return;
    }
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')).results as Record<string, any>;
    expect(Object.keys(results).sort()).toEqual(Object.keys(main).sort());
    /*
     * Kiran is team-scoped with nobody in his team. On main he was also one of the deciders whenever a step fell
     * back to "anyone who may approve" (the requester being the only admin); now that last resort keeps team scope
     * too (review of PR #93, (c)). Taking him out of main's lists is the only change made to main's results.
     */
    const withoutKiran = (x: any) => ({ ...x, steps: x.steps.map((s: any) => ({ ...s, candidates: s.candidates.filter((n: string) => n !== 'Kiran') })) });
    let kiranOnly = 0;
    for (const key of Object.keys(main)) {
      if (key.startsWith('ROLE / ')) continue;
      const expected = { opened: withoutKiran(main[key].opened), after: withoutKiran(main[key].after) };
      if (JSON.stringify(expected) !== JSON.stringify(main[key])) kiranOnly += 1;
      expect(results[key], key).toEqual(expected);
    }
    expect(kiranOnly).toBeLessThan(Object.keys(main).length);
    /*
     * The accepted change: Kiran (team-scoped, nobody in his team) was a decider for step 1 on main; now he is not,
     * so step 1 is skipped and Meena (step 2) decides. Everything else about these cases is as on main.
     */
    for (const key of Object.keys(main).filter((k) => k.startsWith('ROLE / '))) {
      const before = main[key];
      const now = results[key] as any;
      expect(before.opened.steps[0].candidates, key).toEqual(['Kiran']);
      expect(now.opened.steps[0], key).toMatchObject({ order: 1, status: 'SKIPPED', candidates: [] });
      /* Step 2 opens with exactly the people it opened with on main once Kiran had approved. */
      expect(now.opened.steps[1], key).toEqual(before.after.steps[1]);
      expect(now.opened.steps.flatMap((s: any) => s.candidates), key).not.toContain('Kiran');
    }
  }, 900_000);
});
