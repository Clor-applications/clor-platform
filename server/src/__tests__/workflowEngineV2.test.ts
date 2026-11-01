import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The approval engine, phase 2a (docs/people/workflow-engine/SPEC.md 5, 7, 8):
 * a version 1 rule and its version 2 normalisation decide identically; the
 * new approver kinds; ALL slots and their claim race; conditions, variants
 * and auto-approve; due times in hours and approving on its own when late;
 * away hand-up when a step opens and from the dues job, once; NEXT_UP;
 * step-in; the maker-checker fall-through, so no request reaches a state
 * where nobody may decide; the preview API, which creates nothing; and
 * company isolation on the new routes.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const engineFns = await import('../services/people/approvals/engine.js');
const { runApprovalDues } = engineFns;
const { normaliseSteps } = await import('../services/people/approvals/spec.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; roleId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(name = 'Asha HR'): Promise<Ctx> {
  const email = `wf.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Wf Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});
const APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

let hr: Ctx; // Asha HR: the owner, an administrator
let ravi: Ctx;
let meena: Ctx;
let priya: Ctx;
let kiran: Ctx; // team-scoped, manages nobody
let byUser: Map<string, Ctx>;
let meenaEmp: any;
let raviEmp: any;
let tara: any; // reports to Ravi, in Design, grade G2
let lone: any; // no manager
let orphan: any; // manager has left
let design: any;
let g2: any;

beforeAll(async () => {
  hr = await owner();
  ravi = await colleague(hr, 'Ravi', APPROVER);
  meena = await colleague(hr, 'Meena', APPROVER);
  priya = await colleague(hr, 'Priya', APPROVER);
  kiran = await colleague(hr, 'Kiran', APPROVER, true);
  byUser = new Map([hr, ravi, meena, priya, kiran].map((c) => [c.userId, c]));
  design = (await people(hr).post('/structure/departments', { name: 'Design' }).expect(201)).body.item;
  g2 = (await people(hr).post('/structure/grades', { name: 'G2' }).expect(201)).body.item;
  meenaEmp = (await people(hr).post('/employees', { name: 'Meena Iyer', code: 'W-1' }).expect(201)).body.employee;
  raviEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'W-2', reportingManagerId: meenaEmp.id }).expect(201)).body.employee;
  const priyaEmp = (await people(hr).post('/employees', { name: 'Priya Rao', code: 'W-3', departmentId: design.id }).expect(201)).body.employee;
  tara = (await people(hr).post('/employees', { name: 'Tara Singh', code: 'W-4', departmentId: design.id, gradeId: g2.id, reportingManagerId: raviEmp.id }).expect(201)).body.employee;
  lone = (await people(hr).post('/employees', { name: 'Lone Wolf', code: 'W-5' }).expect(201)).body.employee;
  const gone = (await people(hr).post('/employees', { name: 'Gone Away', code: 'W-6' }).expect(201)).body.employee;
  orphan = (await people(hr).post('/employees', { name: 'Orphan Kid', code: 'W-7', reportingManagerId: gone.id }).expect(201)).body.employee;
  await runInTenant(hr.orgId, async () => {
    await peoplePrisma.employee.update({ where: { id: meenaEmp.id }, data: { userId: meena.userId } });
    await peoplePrisma.employee.update({ where: { id: raviEmp.id }, data: { userId: ravi.userId } });
    await peoplePrisma.employee.update({ where: { id: priyaEmp.id }, data: { userId: priya.userId } });
    await peoplePrisma.employee.update({ where: { id: gone.id }, data: { status: 'LEFT' } });
    await peoplePrisma.department.update({ where: { id: design.id }, data: { headEmployeeId: priyaEmp.id } });
  });
}, 120_000);

/* A rule written straight into the table in the first shape, as every rule saved before 2a is. */
async function storeV1(c: Ctx, requestType: string, steps: unknown[]) {
  return runInTenant(c.orgId, async () => {
    const latest = await peoplePrisma.approvalRule.findFirst({ where: { orgId: c.orgId, requestType, variantKey: '' }, orderBy: { version: 'desc' } });
    await peoplePrisma.approvalRule.updateMany({ where: { orgId: c.orgId, requestType, variantKey: '', active: true }, data: { active: false } });
    return peoplePrisma.approvalRule.create({ data: { accountId: c.accountId, orgId: c.orgId, requestType, name: 'v1', version: (latest?.version || 0) + 1, active: true, steps: steps as any, specVersion: 1 } });
  });
}
async function storeV2(c: Ctx, requestType: string, steps: unknown[]) {
  return runInTenant(c.orgId, async () => {
    const latest = await peoplePrisma.approvalRule.findFirst({ where: { orgId: c.orgId, requestType, variantKey: '' }, orderBy: { version: 'desc' } });
    await peoplePrisma.approvalRule.updateMany({ where: { orgId: c.orgId, requestType, variantKey: '', active: true }, data: { active: false } });
    return peoplePrisma.approvalRule.create({ data: { accountId: c.accountId, orgId: c.orgId, requestType, name: 'v2', version: (latest?.version || 0) + 1, active: true, steps: steps as any, specVersion: 2 } });
  });
}
const saveV2 = async (c: Ctx, body: Record<string, unknown>) => (await people(c).post('/approval-rules', { name: 'v2', ...body }).expect(201)).body.rule;
const ask = async (c: Ctx, requestType: string, subject: any, payload: Record<string, unknown> = {}, expectStatus = 201) =>
  (await people(c).post('/requests', { requestType, subjectEmployeeId: subject?.id ?? null, title: `${requestType} ${rnd()}`, payload: { employeeId: subject?.id ?? null, ...payload } }).expect(expectStatus)).body.request;
const view = async (id: string) => (await people(hr).get(`/requests/${id}`).expect(200)).body.request;
/* What "who decides, and what happened" is, without ids or times. */
const story = (r: any) => ({ status: r.status, steps: r.steps.map((s: any) => ({ order: s.order, status: s.status, candidates: [...s.candidates].sort(), comment: s.comment, standInFor: s.standInFor, decidedBy: s.decidedBy })) });
const leaveToday = (c: Ctx, employeeId: string) => runInTenant(c.orgId, () => peoplePrisma.leaveRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, leaveTypeId: 'lt-test', fromDate: todayIst(), toDate: todayIst(), days: 1, reason: 'Away', requestedByUserId: c.userId, status: 'APPROVED' } }));

describe('parity: a version 1 rule and its version 2 normalisation decide identically', () => {
  /* Today's presets and chains, in the first shape (services/people/selfService.ts, lifecycle/leaving.ts, money/expenses.ts, SPEC 5.4). */
  const presets = (): Record<string, unknown[]> => ({
    HR: [{ order: 1, approver: { kind: 'HR' }, dueDays: 5, overdue: { action: 'REMIND' } }],
    MANAGER: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }],
    MANAGER_THEN_HR: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 3, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } }, { order: 2, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } }],
    MONEY: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }, { order: 2, approver: { kind: 'HR' }, condition: { field: 'monthTotal', op: 'gt', value: '5000' }, dueDays: 2 }],
    GRADE: [{ order: 1, approver: { kind: 'MANAGER_OF_MANAGER' }, dueDays: 2 }, { order: 2, approver: { kind: 'USER', id: priya.userId }, condition: { field: 'gradeId', op: 'changed' }, dueDays: 2 }],
    ROLE: [{ order: 1, approver: { kind: 'ROLE', id: kiran.roleId }, dueDays: 2 }, { order: 2, approver: { kind: 'USER', id: meena.userId }, dueDays: 2 }],
  });
  /* No manager, manager left, a stand-in, an own request, the requester as the approver, a team-scoped approver outside their team. */
  const scenarios = (): Array<{ name: string; by: Ctx; subject: any; standIn?: boolean }> => [
    { name: 'with a manager', by: hr, subject: tara },
    { name: 'no manager', by: ravi, subject: lone },
    { name: 'manager left', by: ravi, subject: orphan },
    { name: 'stand-in', by: priya, subject: tara, standIn: true },
    { name: 'own request', by: ravi, subject: raviEmp },
    { name: 'requester is the approver', by: ravi, subject: tara },
  ];
  const payload = { monthTotal: 6000, fields: { gradeId: { before: 'g1', after: 'g2' } } };

  it('same deciders after submitting, and the same outcome after the first decision, for every preset × scenario', async () => {
    let compared = 0;
    for (const [preset, steps] of Object.entries(presets())) {
      for (const sc of scenarios()) {
        const runOnce = async (save: () => Promise<unknown>) => {
          await save();
          const stand = sc.standIn ? await runInTenant(hr.orgId, () => peoplePrisma.standIn.create({ data: { accountId: hr.accountId, orgId: hr.orgId, userId: ravi.userId, standInUserId: meena.userId, fromDate: todayIst(), toDate: todayIst() } })) : null;
          try {
            const r = await ask(sc.by, 'SEAT_REQUEST', sc.subject, payload);
            const opened = story(await view(r.id));
            const waiting = (await view(r.id)).steps.find((s: any) => s.status === 'WAITING');
            const raw = await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.findFirst({ where: { requestId: r.id, status: 'WAITING' } }));
            const decider = raw ? byUser.get((raw.candidateUserIds as string[])[0]) : null;
            if (decider && waiting) await people(decider).post(`/requests/${r.id}/approve`, {}).expect(200);
            return { opened, after: story(await view(r.id)) };
          } finally {
            if (stand) await runInTenant(hr.orgId, () => peoplePrisma.standIn.delete({ where: { id: stand.id } }));
          }
        };
        const v1 = await runOnce(() => storeV1(hr, 'SEAT_REQUEST', steps));
        /* Saved through the API as the rules screen saves it (the first shape), written as version 2. */
        /* Written as version 2: the stored rule is the v1 rule normalised (a new save of a condition a position request does not carry is refused, re-review of PR #93). */
        const v2 = await runOnce(() => storeV2(hr, 'SEAT_REQUEST', normaliseSteps(steps, 'SEAT_REQUEST')));
        expect(v2, `${preset} / ${sc.name}`).toEqual(v1);
        compared += 1;
      }
    }
    expect(compared).toBe(36);
  }, 900_000);

  it('the rules screen gets the first shape back from a version 2 rule, and can edit it', async () => {
    /* A condition the request carries: a job change's grade (re-review of PR #93: conditions read only what the type carries). */
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }] });
    await saveV2(hr, { requestType: 'JOB_CHANGE', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2, condition: { field: 'gradeId', op: 'changed' } }] });
    const rules = (await people(hr).get('/approval-rules').expect(200)).body.rules;
    const rule = rules.find((r: any) => r.requestType === 'JOB_CHANGE' && r.active);
    expect(rule).toMatchObject({ specVersion: 2, editableHere: true, steps: [{ order: 1, approver: { kind: 'MANAGER' }, condition: { field: 'gradeId', op: 'changed', value: null }, dueDays: 2 }] });
    expect(rule.spec[0]).toMatchObject({ approvers: [{ kind: 'MANAGER' }], mode: 'ANY', due: { workingDays: 2 } });
    /* A rule the old screen cannot say is marked so. */
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approvers: [{ kind: 'MANAGER' }, { kind: 'HR' }], mode: 'ALL', due: { hours: 4 } }] });
    const after = (await people(hr).get('/approval-rules').expect(200)).body.rules.find((r: any) => r.requestType === 'DESK_ESCALATION' && r.active);
    expect(after.editableHere).toBe(false);
  });

  it('saving a rule is audited by name, with the version before and after', async () => {
    const rule = await saveV2(hr, { requestType: 'LETTER_REQUEST', name: 'Letters', steps: [{ approver: { kind: 'HR' }, dueDays: 2 }] });
    const line = await platformPrisma.auditLog.findFirstOrThrow({ where: { orgId: hr.orgId, entity: 'APPROVAL_RULE', entityId: rule.id } });
    expect(line).toMatchObject({ action: 'SAVED', createdByUserId: hr.userId });
    expect(line.message).toContain('Asha HR saved the approval rule "Letters"');
    expect(JSON.parse(line.metadata!)).toMatchObject({ version: rule.version, after: { steps: [{ approvers: [{ kind: 'HR' }] }] } });
  });
});

describe('who decides: new kinds, ALL slots, conditions, variants, auto-approve', () => {
  it('the department head, the owner and Payroll resolve; the preview shows it and creates nothing', async () => {
    const count = () => runInTenant(hr.orgId, async () => [await peoplePrisma.approvalRequest.count({ where: { orgId: hr.orgId } }), await peoplePrisma.approvalStep.count({ where: { orgId: hr.orgId } })]);
    const before = await count();
    const p = (await people(hr).post('/approval-rules/preview', {
      requestType: 'SEAT_REQUEST',
      rule: { name: 'Try', steps: [{ approvers: [{ kind: 'DEPARTMENT_HEAD' }], due: { workingDays: 2 } }, { approvers: [{ kind: 'OWNER' }], due: { hours: 4 } }, { approvers: [{ kind: 'PAYROLL' }], due: { workingDays: 1 } }] },
      sample: { employeeId: tara.id, requesterUserId: ravi.userId },
    }).expect(200)).body;
    expect(p.rule).toMatchObject({ draft: true, name: 'Try' });
    expect(p.steps.map((s: any) => [s.order, s.outcome, s.slots[0]?.people])).toEqual([[1, 'DECIDES', ['Priya']], [2, 'DECIDES', ['Asha HR']], [3, 'DECIDES', ['Asha HR']]]);
    /* Someone outside the Design department has no head: HR takes it. */
    const lonely = (await people(hr).post('/approval-rules/preview', { requestType: 'SEAT_REQUEST', rule: { steps: [{ approvers: [{ kind: 'DEPARTMENT_HEAD' }], due: { workingDays: 2 } }] }, sample: { employeeId: lone.id, requesterUserId: ravi.userId } }).expect(200)).body;
    expect(lonely.steps[0].slots[0].people).toEqual(['Asha HR']);
    expect(await count()).toEqual(before);
  });

  it('ALL: each slot must approve, two approving at once open the next step exactly once, and one rejection rejects', async () => {
    await saveV2(hr, { requestType: 'DOCUMENT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'USER', id: priya.userId }], mode: 'ALL', due: { workingDays: 2 } }, { approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }] });
    const r = await ask(ravi, 'DOCUMENT_REQUEST', tara);
    expect(r.steps.map((s: any) => [s.order, s.slot, s.mode, s.status, s.candidates])).toEqual([[1, 0, 'ALL', 'WAITING', ['Meena']], [1, 1, 'ALL', 'WAITING', ['Priya']]]);
    const both = await Promise.all([people(meena).post(`/requests/${r.id}/approve`, {}), people(priya).post(`/requests/${r.id}/approve`, {})]);
    expect(both.map((x) => x.status)).toEqual([200, 200]);
    const next = await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.findMany({ where: { requestId: r.id, order: 2 } }));
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe('WAITING');
    expect((await people(hr).post(`/requests/${r.id}/approve`, {}).expect(200)).body.request.status).toBe('APPROVED');
    /* The same person deciding a slot twice: one decision. */
    const twice = await ask(ravi, 'DOCUMENT_REQUEST', tara);
    const again = await Promise.all([people(meena).post(`/requests/${twice.id}/approve`, {}), people(meena).post(`/requests/${twice.id}/approve`, {})]);
    const codes = again.map((x) => x.status).sort((a, b) => a - b);
    expect(codes[0]).toBe(200);
    expect([403, 409]).toContain(codes[1]);
    expect((await view(twice.id)).steps.filter((s: any) => s.order === 1 && s.status === 'APPROVED')).toHaveLength(1);

    const no = await ask(ravi, 'DOCUMENT_REQUEST', tara);
    await people(meena).post(`/requests/${no.id}/approve`, {}).expect(200);
    const rejected = (await people(priya).post(`/requests/${no.id}/reject`, { comment: 'Not this one' }).expect(200)).body.request;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.steps.filter((s: any) => s.status === 'WAITING')).toHaveLength(0);
  });

  it('conditions in version 2 read amounts and the person; a variant for a department wins, the most specific first; retiring it falls back', async () => {
    await saveV2(hr, { requestType: 'LETTER_REQUEST', steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }, { approvers: [{ kind: 'USER', id: meena.userId }], when: [{ field: 'departmentId', op: 'in', value: [design.id, 'other'] }], due: { workingDays: 2 } }] });
    await saveV2(hr, { requestType: 'LETTER_REQUEST', variantKey: 'design', appliesWhen: [{ field: 'departmentId', op: 'eq', value: design.id }], steps: [{ approvers: [{ kind: 'USER', id: priya.userId }], due: { workingDays: 2 } }] });
    await saveV2(hr, { requestType: 'LETTER_REQUEST', variantKey: 'design-g2', appliesWhen: [{ field: 'departmentId', op: 'eq', value: design.id }, { field: 'gradeId', op: 'eq', value: g2.id }], steps: [{ approvers: [{ kind: 'USER', id: meena.userId }], due: { workingDays: 2 } }] });
    const forTara = await ask(ravi, 'LETTER_REQUEST', tara);
    expect(forTara.ruleVariant).toBe('design-g2');
    expect(forTara.steps[0].candidates).toEqual(['Meena']);
    /* Amounts: a money type's own figure (set by the money module), tried through the preview. */
    const tryAmount = async (amount: number) => (await people(hr).post('/approval-rules/preview', { requestType: 'EXPENSE_CLAIM', rule: { steps: [{ approvers: [{ kind: 'HR' }], when: [{ field: 'amount', op: 'gte', value: 5000 }], due: { workingDays: 2 } }, { approvers: [{ kind: 'OWNER' }], due: { workingDays: 2 } }] }, sample: { employeeId: tara.id, requesterUserId: ravi.userId, payload: { amount } } }).expect(200)).body.steps[0].outcome;
    expect(await tryAmount(6000)).toBe('DECIDES');
    expect(await tryAmount(100)).toBe('SKIPPED');
    await people(ravi).del('/approval-rules/LETTER_REQUEST/design-g2').expect(403);
    await people(hr).del('/approval-rules/LETTER_REQUEST/design-g2').expect(200);
    await people(hr).del('/approval-rules/LETTER_REQUEST/design-g2').expect(404);
    expect((await ask(ravi, 'LETTER_REQUEST', tara)).steps[0].candidates).toEqual(['Priya']);
  });

  it('a requester cannot pick a variant or skip a step by putting the person’s department or grade in the request', async () => {
    /* Lone is in no department: a faked departmentId and gradeId in the payload are ignored. */
    const faked = await ask(ravi, 'LETTER_REQUEST', lone, { departmentId: design.id, gradeId: g2.id, fields: { departmentId: { before: null, after: design.id } } });
    expect(faked.ruleVariant).toBe('');
    await people(hr).post(`/requests/${faked.id}/approve`, {}).expect(200);
    expect((await view(faked.id)).steps.map((s: any) => [s.order, s.status])).toEqual([[1, 'APPROVED'], [2, 'SKIPPED']]);
    const p = (await people(hr).post('/approval-rules/preview', { requestType: 'LETTER_REQUEST', sample: { employeeId: lone.id, requesterUserId: ravi.userId, payload: { departmentId: design.id } } }).expect(200)).body;
    expect(p.rule.variantKey).toBe('');
  });

  it('auto-approve: a matching request is approved with nobody asked; a faked payload does not match; never for money; only fields the type has', async () => {
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }], autoApprove: [{ when: [{ field: 'departmentId', op: 'eq', value: design.id }] }] });
    const auto = await ask(ravi, 'DESK_ESCALATION', tara);
    expect(auto.status).toBe('APPROVED');
    expect(auto.steps).toEqual([expect.objectContaining({ status: 'APPROVED', how: 'AUTO_APPROVED', candidates: [] })]);
    expect((await ask(ravi, 'DESK_ESCALATION', lone, { departmentId: design.id })).status).toBe('WAITING');
    /* Ravi's own request, with Design written into it: not approved on its own. */
    expect((await ask(ravi, 'DESK_ESCALATION', raviEmp, { departmentId: design.id, fields: { departmentId: { before: null, after: design.id } } })).status).toBe('WAITING');
    const money = await people(hr).post('/approval-rules', { requestType: 'SALARY_ADVANCE', name: 'x', steps: [{ approver: { kind: 'HR' }, dueDays: 2 }], autoApprove: [{ when: [{ field: 'amount', op: 'lt', value: 1000 }] }] }).expect(400);
    expect(money.body).toMatchObject({ code: 'RULE_INVALID', field: 'autoApprove' });
    /* A help-desk escalation carries no "kind" or amount the server sets: refused, as is reading the department from the request. */
    const kind = await people(hr).post('/approval-rules', { requestType: 'DESK_ESCALATION', name: 'x', steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }], autoApprove: [{ when: [{ field: 'kind', op: 'eq', value: 'PAYSLIP' }] }] }).expect(400);
    expect(kind.body).toMatchObject({ code: 'RULE_INVALID', field: 'autoApprove' });
    await people(hr).post('/approval-rules', { requestType: 'DESK_ESCALATION', name: 'x', steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 }, when: [{ field: 'departmentId', op: 'eq', value: design.id, from: 'request' }] }] }).expect(400);
    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'x', steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 }, when: [{ field: 'departmentId', op: 'eq', value: design.id, from: 'request' }] }] }).expect(201);
  });
});

describe('time: due in hours, approved on its own when late, never on the last step', () => {
  it('a step due in hours is due then; late, it is reminded, and later approved on its own, and the next step opens', async () => {
    const last = await people(hr).post('/approval-rules', { requestType: 'SEAT_REQUEST', name: 'x', steps: [{ approvers: [{ kind: 'HR' }], due: { hours: 2 }, overdue: { action: 'AUTO_APPROVE' } }] }).expect(400);
    expect(last.body).toMatchObject({ code: 'RULE_INVALID', step: 1, field: 'overdue' });
    await saveV2(hr, { requestType: 'SEAT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }], due: { hours: 2 }, overdue: { action: 'AUTO_APPROVE', afterHours: 3 } }, { approvers: [{ kind: 'USER', id: priya.userId }], due: { workingDays: 2 } }] });
    const r = await ask(ravi, 'SEAT_REQUEST', tara);
    const due = new Date(r.steps[0].dueAt).getTime();
    expect(Math.abs(due - (Date.now() + 2 * 3_600_000))).toBeLessThan(5 * 60_000);
    await runApprovalDues(new Date(due + 60_000));
    expect((await view(r.id)).steps[0].status).toBe('WAITING');
    const later = await runApprovalDues(new Date(due + 60_000 + 4 * 3_600_000));
    expect(later.autoApproved).toBeGreaterThanOrEqual(1);
    const after = await view(r.id);
    expect(after.steps.map((s: any) => [s.order, s.status, s.how])).toEqual([[1, 'APPROVED', 'AUTO_APPROVED'], [2, 'WAITING', 'USER']]);
    expect(after.steps[1].candidates).toEqual(['Priya']);
    /* Run again: nothing more happens to it. */
    await runApprovalDues(new Date(due + 60_000 + 5 * 3_600_000));
    expect((await view(r.id)).steps).toHaveLength(2);
  });
});

describe('away, own-record rule and step-in', () => {
  it('an approver on leave all day with no stand-in is passed up when the step opens, and said so', async () => {
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }] });
    const leave = await leaveToday(hr, raviEmp.id);
    try {
      const r = await ask(priya, 'DESK_ESCALATION', tara);
      expect(r.steps[0]).toMatchObject({ candidates: ['Meena'], how: 'AWAY_HANDED_UP', comment: 'Away: Ravi on leave, sent to Meena' });
    } finally {
      await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.delete({ where: { id: leave.id } }));
    }
  });

  it('the dues job hands up a waiting step whose approver went on leave, once', async () => {
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }] });
    const r = await ask(priya, 'DESK_ESCALATION', tara);
    expect(r.steps[0].candidates).toEqual(['Ravi']);
    const leave = await leaveToday(hr, raviEmp.id);
    try {
      const first = await runApprovalDues(new Date());
      expect(first.awayHandedUp).toBeGreaterThanOrEqual(1);
      await runApprovalDues(new Date());
      const after = await view(r.id);
      expect(after.steps.map((s: any) => [s.status, s.candidates, s.how])).toEqual([['HANDED_ON', ['Ravi'], 'MANAGER'], ['WAITING', ['Meena'], 'AWAY_HANDED_UP']]);
      expect(after.steps[1].comment).toBe('Away: Ravi on leave, sent to Meena');
      await people(meena).post(`/requests/${r.id}/approve`, {}).expect(200);
    } finally {
      await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.delete({ where: { id: leave.id } }));
    }
  });

  it('a named approver who has left is treated as away: it goes up, never nowhere', async () => {
    const sam = await colleague(hr, 'Sam', APPROVER);
    const samEmp = (await people(hr).post('/employees', { name: 'Sam Paul', code: `W-${rnd()}`, reportingManagerId: meenaEmp.id }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: samEmp.id }, data: { userId: sam.userId, status: 'LEFT' } }));
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approver: { kind: 'USER', id: sam.userId }, dueDays: 2 }] });
    const r = await ask(ravi, 'DESK_ESCALATION', lone);
    expect(r.steps[0]).toMatchObject({ candidates: ['Meena'], how: 'AWAY_HANDED_UP' });
  });

  it('NEXT_UP sends a step that would be the requester’s own to their manager; SKIP keeps today’s rule (to the admins)', async () => {
    await saveV2(hr, { requestType: 'LETTER_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: ravi.userId }], due: { workingDays: 2 }, ifRequester: 'NEXT_UP' }] });
    const up = await ask(ravi, 'LETTER_REQUEST', lone);
    expect(up.steps[0]).toMatchObject({ candidates: ['Meena'], how: 'NEXT_UP' });
    await saveV2(hr, { requestType: 'LETTER_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: ravi.userId }], due: { workingDays: 2 } }] });
    const skip = await ask(ravi, 'LETTER_REQUEST', lone);
    expect(skip.steps[0]).toMatchObject({ candidates: ['Asha HR'], how: 'LAST_RESORT', comment: 'Sent to the admins: nobody else could decide it' });
  });

  it('step-in: HR decides in the approver’s place, logged as such and told to the requester; nobody else may', async () => {
    await saveV2(hr, { requestType: 'SEAT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }], due: { workingDays: 2 }, stepIn: 'HR' }] });
    const r = await ask(ravi, 'SEAT_REQUEST', tara);
    await people(priya).post(`/requests/${r.id}/approve`, {}).expect(403);
    const done = (await people(hr).post(`/requests/${r.id}/approve`, {}).expect(200)).body.request;
    expect(done.status).toBe('APPROVED');
    expect(done.steps[0]).toMatchObject({ decidedBy: 'Asha HR', standInFor: 'Meena', how: 'STEP_IN' });
    const log = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { orgId: hr.orgId, entityId: r.id, field: 'step 1 decided for' } }));
    expect(log?.after).toBe('Meena (stepped in as HR)');
    const told = await platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, userId: ravi.userId, title: { startsWith: 'Decided by Asha HR (HR) for Meena' } } });
    expect(told).toBeTruthy();
  });
});

describe('no dead ends: a company of one, and the maker-checker setting', () => {
  let solo: Ctx;
  let me: any;
  const setMode = async (c: Ctx, makerChecker: string) => {
    const current = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...current, makerChecker }).expect(200);
  };
  beforeAll(async () => {
    solo = await owner('Owner Alone');
    me = (await people(solo).post('/employees', { name: 'Owner Alone', code: 'O-1' }).expect(201)).body.employee;
    await runInTenant(solo.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: solo.userId } }));
  }, 60_000);

  it('every People request type submits and closes for the owner alone, written SELF_APPROVED by name; none returns 409', async () => {
    const types = ['PROFILE_CHANGE', 'JOB_CHANGE', 'LEAVING', 'DOCUMENT_REQUEST', 'LETTER_REQUEST', 'POLICY_PUBLISH', 'DESK_ESCALATION', 'SEAT_REQUEST', 'PROBATION'];
    for (const t of types) {
      await people(solo).post('/approval-rules', { requestType: t, name: t, steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }, { approver: { kind: 'HR' }, dueDays: 2 }] }).expect(201);
      const r = (await people(solo).post('/requests', { requestType: t, subjectEmployeeId: me.id, title: `Mine: ${t}`, payload: { employeeId: me.id, fields: {} } })).body;
      expect(r.request?.status, t).toBe('APPROVED');
      expect(r.request.steps.find((s: any) => s.how === 'SELF_APPROVED'), t).toMatchObject({ status: 'APPROVED', decidedBy: 'Owner Alone', comment: 'Nobody else in the company can decide this' });
      const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: solo.orgId, entityId: r.request.id, action: 'SELF_APPROVED' } });
      expect(audit?.message, t).toContain('approved by Owner Alone, who asked for it: nobody else in the company can decide this');
      expect(JSON.parse(audit!.metadata!)).toMatchObject({ makerChecker: 'AUTO' });
    }
  }, 120_000);

  it('money from the employee app: the owner’s own advance is recorded at once', async () => {
    const code = (await request(app).get(`/api/orgs/${solo.orgId}/attendance/portal-access`).set(at(solo)).expect(200)).body.company.code;
    const issued = (await request(app).post(`/api/orgs/${solo.orgId}/attendance/portal-access/codes`).set(at(solo)).send({ employeeIds: [me.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: me.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
    const advance = (await request(app).post('/api/portal/people/money/advances').set('Authorization', `Bearer ${token}`).send({ purpose: 'Stock for the shop', amount: 2000 }).expect(201)).body.advance;
    const row = await runInTenant(solo.orgId, () => peoplePrisma.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } }));
    expect(row.status).not.toBe('WAITING');
  });

  it('STRICT refuses with the plain words; ALLOW approves and names the setting', async () => {
    await setMode(solo, 'STRICT');
    const refused = await people(solo).post('/requests', { requestType: 'SEAT_REQUEST', subjectEmployeeId: me.id, title: 'Strict', payload: { employeeId: me.id } }).expect(409);
    expect(refused.body).toMatchObject({ code: 'NO_APPROVER', error: expect.stringContaining('Give someone else the right to approve') });
    await setMode(solo, 'ALLOW');
    const ok = (await people(solo).post('/requests', { requestType: 'SEAT_REQUEST', subjectEmployeeId: me.id, title: 'Allow', payload: { employeeId: me.id } }).expect(201)).body.request;
    expect(ok.status).toBe('APPROVED');
    const audit = await platformPrisma.auditLog.findFirstOrThrow({ where: { orgId: solo.orgId, entityId: ok.id, action: 'SELF_APPROVED' } });
    expect(JSON.parse(audit.metadata!)).toMatchObject({ makerChecker: 'ALLOW' });
    expect(audit.message).toContain('the company allows one person to do both');
    await setMode(solo, 'AUTO');
  });

  it('the preview says so before anything is asked', async () => {
    const p = (await people(solo).post('/approval-rules/preview', { requestType: 'SEAT_REQUEST', sample: { employeeId: me.id } }).expect(200)).body;
    expect(p.steps[0]).toMatchObject({ outcome: 'SELF_APPROVED', why: expect.stringContaining('Nobody else in the company can decide this') });
  });
});

describe('the preview and variants stay inside the company and need the right', () => {
  it('another company’s person is refused; a user without Approvals edit is refused; leave waits for its phase', async () => {
    const other = await owner('Other Owner');
    await people(other).post('/approval-rules/preview', { requestType: 'SEAT_REQUEST', sample: { employeeId: tara.id } }).expect(400);
    await people(other).post('/approval-rules/preview', { requestType: 'SEAT_REQUEST', sample: { employeeId: null, requesterUserId: ravi.userId } }).expect(400);
    await people(ravi).post('/approval-rules/preview', { requestType: 'SEAT_REQUEST', sample: { employeeId: tara.id } }).expect(403);
    await people(hr).post('/approval-rules/preview', { requestType: 'LEAVE', sample: { employeeId: tara.id } }).expect(400);
    await people(other).del('/approval-rules/LETTER_REQUEST/design').expect(404);
    const theirs = (await people(other).get('/approval-rules').expect(200)).body.rules;
    expect(theirs.some((r: any) => r.orgId === hr.orgId)).toBe(false);
  });
});

describe('review of PR #93', () => {
  const { beforeApproving, lastResortDeciders } = engineFns;
  it('ALL: a step-in takes one slot, and whoever decided a slot cannot take another', async () => {
    await saveV2(hr, { requestType: 'SEAT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'USER', id: priya.userId }], mode: 'ALL', due: { workingDays: 2 }, stepIn: 'HR' }] });
    const r = await ask(ravi, 'SEAT_REQUEST', tara);
    await people(hr).post(`/requests/${r.id}/approve`, {}).expect(200);
    const again = await people(hr).post(`/requests/${r.id}/approve`, {}).expect(403);
    expect(again.body.code).toBe('ALREADY_DECIDED_PART');
    expect((await view(r.id)).status).toBe('WAITING');
  });

  it('ALL: one person on two slots takes one while someone else could take the other; both only when nobody else could, audited', async () => {
    const shared = (await request(app).post(`/api/orgs/${hr.orgId}/roles`).set(at(hr)).send({ name: `Shared ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201)).body.role;
    /* A person holds one role here, so the shared role carries the same rights. */
    await request(app).put(`/api/orgs/${hr.orgId}/roles/${shared.id}/permissions`).set(at(hr)).send({ permissions: APPROVER }).expect(200);
    for (const c of [meena, priya]) await request(app).post(`/api/orgs/${hr.orgId}/users/${c.userId}/roles`).set(at(hr)).send({ roleId: shared.id, branchId: null }).expect(201);
    await saveV2(hr, { requestType: 'SEAT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'ROLE', id: shared.id }], mode: 'ALL', due: { workingDays: 2 } }] });
    const r = await ask(ravi, 'SEAT_REQUEST', tara);
    expect((await people(meena).post(`/requests/${r.id}/approve`, {}).expect(200)).body.request.status).toBe('WAITING');
    await people(meena).post(`/requests/${r.id}/approve`, {}).expect(403);
    expect((await people(priya).post(`/requests/${r.id}/approve`, {}).expect(200)).body.request.status).toBe('APPROVED');

    await saveV2(hr, { requestType: 'SEAT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'USER', id: meena.userId }], mode: 'ALL', due: { workingDays: 2 } }] });
    const alone = await ask(ravi, 'SEAT_REQUEST', tara);
    const done = (await people(meena).post(`/requests/${alone.id}/approve`, {}).expect(200)).body.request;
    expect(done.status).toBe('APPROVED');
    expect(done.steps.map((s: any) => s.how).sort()).toEqual(['SAME_PERSON', 'USER']);
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: hr.orgId, entityId: alone.id, action: 'SAME_PERSON_APPROVED' } });
    expect(audit?.message).toContain('Meena approved both parts of step 1: nobody else could');
  });

  it('ALL on money: always two different people; the second part goes to someone else', async () => {
    beforeApproving('SALARY_ADVANCE', async () => {});
    await saveV2(hr, { requestType: 'SALARY_ADVANCE', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'USER', id: meena.userId }], mode: 'ALL', due: { workingDays: 2 } }] });
    const r = await ask(ravi, 'SALARY_ADVANCE', tara, { amount: 5000 });
    const after = (await people(meena).post(`/requests/${r.id}/approve`, {}).expect(200)).body.request;
    expect(after.status).toBe('WAITING');
    const open = after.steps.filter((s: any) => s.status === 'WAITING');
    expect(open).toHaveLength(1);
    expect(open[0].candidates).toEqual(['Asha HR']);
    await people(meena).post(`/requests/${r.id}/approve`, {}).expect(403);
  });

  it('the dues job never hands up a step opened before this release (no resolvedHow)', async () => {
    await saveV2(hr, { requestType: 'DESK_ESCALATION', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }] });
    const r = await ask(priya, 'DESK_ESCALATION', tara);
    await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.updateMany({ where: { requestId: r.id }, data: { resolvedHow: null } }));
    const leave = await leaveToday(hr, raviEmp.id);
    try {
      await runApprovalDues(new Date());
      const after = await view(r.id);
      expect(after.steps.map((s: any) => [s.status, s.candidates])).toEqual([['WAITING', ['Ravi']]]);
    } finally {
      await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.delete({ where: { id: leave.id } }));
    }
  });

  it('the last resort keeps a team-scoped approver to their team', async () => {
    const c = await owner('Scope Owner');
    const k = await colleague(c, 'Kumar', APPROVER, true);
    const n = await colleague(c, 'Nisha', APPROVER);
    const subject = (await people(c).post('/employees', { name: 'Sub Ject', code: 'S-1' }).expect(201)).body.employee;
    const admin = await platformPrisma.role.findMany({ where: { orgId: c.orgId, roleType: 'ADMIN' }, select: { id: true } });
    await platformPrisma.userRoleAssignment.deleteMany({ where: { orgId: c.orgId, roleId: { in: admin.map((a) => a.id) } } });
    const who = await runInTenant(c.orgId, () => (lastResortDeciders as any)(c.accountId, c.orgId, [], subject.id));
    expect(who).toContain(n.userId);
    expect(who).not.toContain(k.userId);
  });

  it('retiring a rule or a variant is audited by name', async () => {
    await saveV2(hr, { requestType: 'LETTER_REQUEST', variantKey: 'audit-me', appliesWhen: [{ field: 'branchId', op: 'eq', value: 'nowhere' }], steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }] });
    await people(hr).del('/approval-rules/LETTER_REQUEST/audit-me').expect(200);
    await people(hr).del('/approval-rules/DESK_ESCALATION').expect(200);
    const lines = (await platformPrisma.auditLog.findMany({ where: { orgId: hr.orgId, entity: 'APPROVAL_RULE', action: 'RETIRED' } })).map((l) => l.message);
    expect(lines).toEqual(expect.arrayContaining(['Asha HR switched off the approval rule "v2" (variant audit-me)', 'Asha HR switched off the approval rule "v2"']));
  });

  it('a team-scoped rules editor previews only people in their team', async () => {
    const tam = await colleague(hr, 'Tam', [...APPROVER, 'PEOPLE::Approvals::VIEW', 'PEOPLE::Approvals::EDIT'], true);
    await people(tam).post('/approval-rules/preview', { requestType: 'SEAT_REQUEST', sample: { employeeId: tara.id } }).expect(404);
  });

  it('changing a request type’s approver keeps its rule’s auto-approve', async () => {
    const form = (await people(hr).post('/request-forms', { name: `Gate pass ${rnd()}`, approver: 'HR', fields: [{ label: 'Why', type: 'TEXT' }] }).expect(201)).body.form;
    await saveV2(hr, { requestType: form.requestType, steps: [{ approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }], autoApprove: [{ when: [{ field: 'departmentId', op: 'eq', value: design.id }] }] });
    await request(app).put(`/api/orgs/${hr.orgId}/people/request-forms/${form.id}`).set(at(hr)).send({ approver: 'MANAGER' }).expect(200);
    const rule = (await people(hr).get('/approval-rules').expect(200)).body.rules.find((x: any) => x.requestType === form.requestType && x.active && !x.variantKey);
    expect(rule.spec[0].approvers).toEqual([{ kind: 'MANAGER' }]);
    expect(rule.autoApprove).toEqual([{ when: [{ field: 'departmentId', op: 'eq', value: design.id }] }]);
  });
});

describe('re-review of PR #93', () => {
  const { beforeApproving } = engineFns;
  it('an old-style condition on the person is refused at save; a stored version 1 row reads the person from their record', async () => {
    const probe = await people(hr).post('/approval-rules', { requestType: 'DESK_ESCALATION', name: 'Probe', steps: [{ approver: { kind: 'HR' }, dueDays: 2, condition: { field: 'departmentId', op: 'ne', value: 'zzz' } }, { approver: { kind: 'USER', id: meena.userId }, dueDays: 2 }] }).expect(400);
    expect(probe.body).toMatchObject({ code: 'RULE_INVALID', step: 1, field: 'condition' });
    /* The same rule written before this release: the requester writes departmentId "zzz" to skip step 1, and it is not skipped. */
    await storeV1(hr, 'DESK_ESCALATION', [{ order: 1, approver: { kind: 'HR' }, dueDays: 2, condition: { field: 'departmentId', op: 'ne', value: 'zzz' } }, { order: 2, approver: { kind: 'USER', id: meena.userId }, dueDays: 2 }]);
    const r = await ask(ravi, 'DESK_ESCALATION', lone, { departmentId: 'zzz', fields: { departmentId: { before: null, after: 'zzz' } } });
    expect(r.steps.map((s: any) => [s.order, s.status])).toEqual([[1, 'WAITING']]);
    /* A job change still reads the new department from the request, as before. */
    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Moves', steps: [{ approver: { kind: 'HR' }, dueDays: 2, condition: { field: 'departmentId', op: 'eq', value: design.id } }] }).expect(201);
  });

  it('money, all of them: a company that cannot supply two different people cannot save it', async () => {
    const solo = await owner('Solo Owner');
    const refused = await people(solo).post('/approval-rules', { requestType: 'SALARY_ADVANCE', name: 'Both', steps: [{ approvers: [{ kind: 'OWNER' }, { kind: 'HR' }], mode: 'ALL', due: { workingDays: 2 } }] }).expect(400);
    expect(refused.body).toMatchObject({ code: 'RULE_INVALID', step: 1, field: 'mode' });
    expect(refused.body.error).toContain('two different people');
    /* Any one of them is fine. */
    await people(solo).post('/approval-rules', { requestType: 'SALARY_ADVANCE', name: 'Either', steps: [{ approvers: [{ kind: 'OWNER' }, { kind: 'HR' }], mode: 'ANY', due: { workingDays: 2 } }] }).expect(201);
  });

  it('money, all of them: when only one other person is left, approvers are told plainly and can reject; never a dead end', async () => {
    beforeApproving('SALARY_ADVANCE', async () => {});
    const boss = await owner('Olu Owner');
    const mia = await colleague(boss, 'Mia', APPROVER);
    const miaEmp = (await people(boss).post('/employees', { name: 'Mia Das', code: 'M-1' }).expect(201)).body.employee;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: miaEmp.id }, data: { userId: mia.userId } }));
    await people(boss).post('/approval-rules', { requestType: 'SALARY_ADVANCE', name: 'Both', steps: [{ approvers: [{ kind: 'OWNER' }, { kind: 'USER', id: mia.userId }], mode: 'ALL', due: { workingDays: 2 } }] }).expect(201);
    /* Mia asks for herself: only Olu is left to decide, and money needs two. */
    const r = (await people(mia).post('/requests', { requestType: 'SALARY_ADVANCE', subjectEmployeeId: miaEmp.id, title: 'Advance for Mia', payload: { employeeId: miaEmp.id, amount: 5000 } }).expect(201)).body.request;
    const PLAIN = 'This needs two different people to approve; nobody else can. Reject it or add an approver.';
    expect(r.steps.some((s: any) => s.comment === PLAIN)).toBe(true);
    const tried = await people(boss).post(`/requests/${r.id}/approve`, {}).expect(409);
    expect(tried.body).toMatchObject({ code: 'TWO_PEOPLE', error: PLAIN });
    expect((await people(boss).post(`/requests/${r.id}/reject`, { comment: 'Add a second approver first' }).expect(200)).body.request.status).toBe('REJECTED');
  });
});
