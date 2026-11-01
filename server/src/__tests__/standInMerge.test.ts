import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Stand-in merge, workflow engine phase 2b (docs/people/workflow-engine/SPEC.md
 * 5.3 step 1, 6, 9): one StandIn table for People approval stand-ins and leave
 * delegates, read by the engine and by leave and attendance alike, with the
 * retired ApprovalStandIn still read as a fallback until phase 3c.
 *
 *  - the data migration copies every leave delegate once, overlapping ranges
 *    and all, as the application role (no superuser, no BYPASSRLS), twice;
 *  - an approver away with a stand-in in either table: the stand-in decides;
 *  - what a stand-in hands on (all, leave only, chosen types) is honoured;
 *  - a stand-in never decides their own request, from either table;
 *  - removing one removes the copy and the old row, so the fallback cannot
 *    bring it back.
 *
 * Every date is worked out from today in India's time (TEAM.md).
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { resolveApprover } = await import('../services/people/approvals/engine.js');
const { deciderFor, managerStepBy, standingInFor } = await import('../services/attendance/standIns.js');
const { covers, cleanTypes } = await import('../services/people/approvals/standIns.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.parse(`${todayIst()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(name = 'Asha HR'): Promise<Ctx> {
  const email = `sim.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Sim Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.userId = me.body.user.id;
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});
const att = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${path}`).set(at(c)),
  post: (path: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${path}`).set(at(c)),
});
const APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE'];

let hr: Ctx;
let ravi: Ctx;
let meena: Ctx;
let priya: Ctx;
let meenaEmp: any;
let raviEmp: any;
let priyaEmp: any;
let tara: any; // reports to Ravi; no sign-in

beforeAll(async () => {
  hr = await owner();
  ravi = await colleague(hr, 'Ravi', APPROVER);
  meena = await colleague(hr, 'Meena', APPROVER);
  priya = await colleague(hr, 'Priya', APPROVER);
  meenaEmp = (await people(hr).post('/employees', { name: 'Meena Iyer', code: 'S-1' }).expect(201)).body.employee;
  raviEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'S-2', reportingManagerId: meenaEmp.id }).expect(201)).body.employee;
  priyaEmp = (await people(hr).post('/employees', { name: 'Priya Rao', code: 'S-3' }).expect(201)).body.employee;
  tara = (await people(hr).post('/employees', { name: 'Tara Singh', code: 'S-4', reportingManagerId: raviEmp.id }).expect(201)).body.employee;
  await runInTenant(hr.orgId, async () => {
    await peoplePrisma.employee.update({ where: { id: meenaEmp.id }, data: { userId: meena.userId } });
    await peoplePrisma.employee.update({ where: { id: raviEmp.id }, data: { userId: ravi.userId } });
    await peoplePrisma.employee.update({ where: { id: priyaEmp.id }, data: { userId: priya.userId } });
  });
  await people(hr).post('/approval-rules', { name: 'Manager', requestType: 'DESK_ESCALATION', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }] }).expect(201);
}, 120_000);

/* A leave delegate as an older API writes it, straight into the retired table. */
const oldRow = (c: Ctx, managerEmployeeId: string, standInEmployeeId: string, fromDate: string, toDate: string, createdAt?: Date) =>
  runInTenant(c.orgId, () => peoplePrisma.approvalStandIn.create({ data: { accountId: c.accountId, orgId: c.orgId, managerEmployeeId, standInEmployeeId, fromDate, toDate, createdByUserId: c.userId, ...(createdAt ? { createdAt } : {}) } }));
const newRow = (c: Ctx, data: Record<string, unknown>) =>
  runInTenant(c.orgId, () => peoplePrisma.standIn.create({ data: { accountId: c.accountId, orgId: c.orgId, fromDate: todayIst(), toDate: todayIst(), ...data } as any }));
const clear = (c: Ctx) => runInTenant(c.orgId, async () => {
  await peoplePrisma.standIn.deleteMany({ where: { orgId: c.orgId } });
  await peoplePrisma.approvalStandIn.deleteMany({ where: { orgId: c.orgId } });
});
const leaveToday = (c: Ctx, employeeId: string) => runInTenant(c.orgId, () => peoplePrisma.leaveRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, leaveTypeId: 'lt-test', fromDate: todayIst(), toDate: todayIst(), days: 1, reason: 'Away', requestedByUserId: c.userId, status: 'APPROVED' } }));
const ask = async (c: Ctx, requestType: string, subject: any) =>
  (await people(c).post('/requests', { requestType, subjectEmployeeId: subject?.id ?? null, title: `${requestType} ${rnd()}`, payload: { employeeId: subject?.id ?? null } }).expect(201)).body.request;
const inTenant = <T>(fn: () => Promise<T>) => runInTenant(hr.orgId, fn);

describe('what a stand-in hands on', () => {
  it('all approvals, leave only, leave and attendance, or chosen types; unknown types refused', () => {
    expect(covers(['ALL'], 'DESK_ESCALATION')).toBe(true);
    expect(covers(['ALL'], 'LEAVE')).toBe(true);
    expect(covers(['ALL'], undefined)).toBe(true);
    /* A People stand-in from before the merge, or written by an older API (empty list): People requests only, never leave or attendance. */
    for (const old of [[], ['PEOPLE']]) {
      expect(covers(old, 'DESK_ESCALATION')).toBe(true);
      expect(covers(old, 'FORM:abcd1234')).toBe(true);
      expect(covers(old, undefined)).toBe(true);
      expect(covers(old, 'LEAVE')).toBe(false);
      expect(covers(old, 'ATTENDANCE:MISSED_PUNCH')).toBe(false);
      expect(covers(old, 'OVERTIME')).toBe(false);
      expect(covers(old, 'TIME')).toBe(false);
    }
    expect(covers(['LEAVE'], 'LEAVE')).toBe(true);
    expect(covers(['LEAVE'], 'ATTENDANCE')).toBe(false);
    expect(covers(['LEAVE'], 'DESK_ESCALATION')).toBe(false);
    expect(covers(['LEAVE', 'ATTENDANCE'], 'ATTENDANCE:MISSED_PUNCH')).toBe(true);
    expect(covers(['LEAVE', 'ATTENDANCE'], 'OVERTIME')).toBe(true);
    expect(covers(['ATTENDANCE'], 'TIME')).toBe(true);
    expect(covers(['EXPENSE_CLAIM'], 'TIME')).toBe(false);
    expect(covers(['EXPENSE_CLAIM'], undefined)).toBe(false);
    expect(cleanTypes(['LEAVE', 'FORM:abcd1234', 'EXPENSE_CLAIM', 'LEAVE'])).toEqual(['EXPENSE_CLAIM', 'FORM:abcd1234', 'LEAVE']);
    /* Always written as a list: nothing named is all approvals. */
    expect(cleanTypes(undefined)).toEqual(['ALL']);
    expect(cleanTypes([])).toEqual(['ALL']);
    expect(cleanTypes(['ALL', 'LEAVE'])).toEqual(['ALL']);
    /* A request type HR made, as the engine names it, and nothing looser. */
    expect(cleanTypes(['FORM:abc_1'])).toBeNull();
    expect(cleanTypes(['PAYDAY'])).toBeNull();
    expect(cleanTypes('LEAVE')).toBeNull();
  });
});

describe('an approver away, with a stand-in in either table', () => {
  it('new table, named by People record only (as a leave delegate is): the stand-in decides a People request, nobody is handed up', async () => {
    await clear(hr);
    await newRow(hr, { employeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, requestTypes: ['ALL'] });
    const leave = await leaveToday(hr, raviEmp.id);
    try {
      const r = await ask(hr, 'DESK_ESCALATION', tara);
      expect(r.steps[0].how).toBe('STAND_IN');
      expect(r.steps[0].candidates).toEqual(expect.arrayContaining(['Priya']));
      expect(r.steps[0].candidates).not.toContain('Meena');
      await people(priya).post(`/requests/${r.id}/approve`, {}).expect(200);
    } finally {
      await inTenant(() => peoplePrisma.leaveRequest.delete({ where: { id: leave.id } }));
    }
  });

  it('new table, leave only: a People request is not handed on, so the away approver is passed up', async () => {
    await clear(hr);
    await newRow(hr, { userId: ravi.userId, standInUserId: priya.userId, requestTypes: ['LEAVE'] });
    const leave = await leaveToday(hr, raviEmp.id);
    try {
      const r = await ask(hr, 'DESK_ESCALATION', tara);
      expect(r.steps[0]).toMatchObject({ candidates: ['Meena'], how: 'AWAY_HANDED_UP' });
    } finally {
      await inTenant(() => peoplePrisma.leaveRequest.delete({ where: { id: leave.id } }));
    }
    /* …but leave is: the leave path takes it by People record, the engine by sign-in. */
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(priyaEmp.id);
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'ATTENDANCE'))).toBe(raviEmp.id);
    expect((await inTenant(() => resolveApprover(hr, { kind: 'MANAGER' }, tara.id, todayIst(), 'LEAVE'))).standIns).toEqual([{ for: ravi.userId, user: priya.userId }]);
  });

  it('old table only (a row an older API wrote during the deploy): leave and attendance still go to the stand-in', async () => {
    await clear(hr);
    await oldRow(hr, raviEmp.id, priyaEmp.id, todayIst(), todayIst());
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(priyaEmp.id);
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'ATTENDANCE'))).toBe(priyaEmp.id);
    expect(await inTenant(() => managerStepBy(hr.orgId, priyaEmp.id, tara.id, todayIst(), 'LEAVE'))).toBe(raviEmp.id);
    expect(await inTenant(() => standingInFor(hr.orgId, priyaEmp.id, todayIst()))).toEqual([raviEmp.id]);
    /* The engine reads it too, by the sign-ins its people have, for leave. */
    expect((await inTenant(() => resolveApprover(hr, { kind: 'MANAGER' }, tara.id, todayIst(), 'LEAVE'))).standIns).toEqual([{ for: ravi.userId, user: priya.userId }]);
    /* A leave delegate never handed on People requests, and still does not. */
    const leave = await leaveToday(hr, raviEmp.id);
    try {
      const r = await ask(hr, 'DESK_ESCALATION', tara);
      expect(r.steps[0]).toMatchObject({ candidates: ['Meena'], how: 'AWAY_HANDED_UP' });
    } finally {
      await inTenant(() => peoplePrisma.leaveRequest.delete({ where: { id: leave.id } }));
    }
    /* Listed once, and removed from the old table by the leave route. */
    const listed = (await att(hr).get('/leave/stand-ins').expect(200)).body.standIns;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ managerName: 'Ravi Kumar', standInName: 'Priya Rao', requestTypes: ['LEAVE', 'ATTENDANCE'], live: true });
    await att(hr).del(`/leave/stand-ins/${listed[0].id}`).expect(200);
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(raviEmp.id);
  });

  it('outside its dates a stand-in from either table decides nothing', async () => {
    await clear(hr);
    await oldRow(hr, raviEmp.id, priyaEmp.id, plus(5), plus(6));
    await newRow(hr, { userId: ravi.userId, standInUserId: priya.userId, employeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, fromDate: plus(5), toDate: plus(6) });
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(raviEmp.id);
    expect((await inTenant(() => resolveApprover(hr, { kind: 'MANAGER' }, tara.id, todayIst(), 'DESK_ESCALATION'))).standIns).toEqual([]);
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, plus(6), 'LEAVE'))).toBe(priyaEmp.id);
    await clear(hr);
  });
});

describe('a stand-in never decides their own request', () => {
  it('engine: standing in for their own manager (new table), they are taken out and cannot approve', async () => {
    await clear(hr);
    /* Ravi stands in for Meena, who decides Ravi's requests. */
    await newRow(hr, { userId: meena.userId, standInUserId: ravi.userId, requestTypes: [] });
    const r = await ask(ravi, 'DESK_ESCALATION', raviEmp);
    expect(r.steps[0].candidates).toContain('Meena');
    expect(r.steps[0].candidates).not.toContain('Ravi');
    await people(ravi).post(`/requests/${r.id}/approve`, {}).expect(403);
    await people(meena).post(`/requests/${r.id}/approve`, {}).expect(200);
    await clear(hr);
  });

  it('leave and attendance: from either table, never their own', async () => {
    for (const make of [() => oldRow(hr, meenaEmp.id, raviEmp.id, todayIst(), todayIst()), () => newRow(hr, { employeeId: meenaEmp.id, standInEmployeeId: raviEmp.id, requestTypes: ['LEAVE', 'ATTENDANCE'] })]) {
      await clear(hr);
      await make();
      expect(await inTenant(() => standingInFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toEqual([meenaEmp.id]);
      expect(await inTenant(() => managerStepBy(hr.orgId, raviEmp.id, raviEmp.id, todayIst(), 'LEAVE'))).toBeNull();
      expect(await inTenant(() => managerStepBy(hr.orgId, raviEmp.id, raviEmp.id, todayIst(), 'ATTENDANCE'))).toBeNull();
    }
    await clear(hr);
  });
});

describe('one list, one table, through both routes', () => {
  it('a leave delegate HR names is seen from the manager’s own list; one they name for all approvals is seen by HR; each once', async () => {
    await clear(hr);
    const leaveRow = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, fromDate: plus(10), toDate: plus(12) }).expect(201)).body.standIn;
    /* Leave and attendance only: no sign-ins stored (an older engine or People list, after a rollback, never sees it), and a linked old row (an older leave path still does). */
    expect(leaveRow).toMatchObject({ employeeId: raviEmp.id, userId: null, standInUserId: null, requestTypes: ['LEAVE', 'ATTENDANCE'], legacyId: expect.any(String) });
    expect(await inTenant(() => peoplePrisma.approvalStandIn.findFirst({ where: { id: leaveRow.legacyId } }))).toMatchObject({ managerEmployeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, fromDate: plus(10), toDate: plus(12) });
    expect(await inTenant(() => peoplePrisma.standIn.findMany({ where: { orgId: hr.orgId, userId: { in: [ravi.userId] } } }))).toEqual([]);
    const all = (await people(ravi).post('/stand-ins', { standInEmployeeId: priyaEmp.id, fromDate: plus(20), toDate: plus(21) }).expect(201)).body.standIn;
    expect(all).toMatchObject({ userId: ravi.userId, standInUserId: priya.userId, employeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, requestTypes: ['ALL'] });
    const mine = (await people(ravi).get('/stand-ins').expect(200)).body.standIns;
    expect(mine.map((r: any) => r.id).sort()).toEqual([leaveRow.id, all.id].sort());
    const hrList = (await att(hr).get('/leave/stand-ins').expect(200)).body.standIns;
    expect(hrList.map((r: any) => r.id).sort()).toEqual([leaveRow.id, all.id].sort());
    /* The all-approvals one covers leave too. */
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, plus(20), 'LEAVE'))).toBe(priyaEmp.id);
    /* HR removes leave and attendance ones only; one that also hands on Ravi's other approvals is his. */
    const theirs = await att(hr).del(`/leave/stand-ins/${all.id}`).expect(403);
    expect(theirs.body.error).toBe('This one also hands on their other approvals, so only they can remove it.');
    await people(ravi).del(`/stand-ins/${leaveRow.id}`).expect(200);
    await people(ravi).del(`/stand-ins/${all.id}`).expect(200);
    expect((await people(ravi).get('/stand-ins').expect(200)).body.standIns).toEqual([]);
    expect(await inTenant(() => peoplePrisma.approvalStandIn.count({ where: { orgId: hr.orgId } }))).toBe(0);
    /* People requests only: on the manager's own list, not the leave list, and not removable there. */
    const peopleOnly = (await people(ravi).post('/stand-ins', { standInEmployeeId: priyaEmp.id, fromDate: plus(20), toDate: plus(21), requestTypes: ['PEOPLE'] }).expect(201)).body.standIn;
    expect((await att(hr).get('/leave/stand-ins').expect(200)).body.standIns).toEqual([]);
    await att(hr).del(`/leave/stand-ins/${peopleOnly.id}`).expect(404);
    expect((await people(ravi).get('/stand-ins').expect(200)).body.standIns.map((r: any) => r.id)).toEqual([peopleOnly.id]);
    await clear(hr);
  });

  it('HR hands on only leave and attendance for another manager; more is the manager’s own to hand on', async () => {
    const refused = await att(hr).post('/leave/stand-ins', { managerEmployeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, fromDate: plus(10), toDate: plus(12), requestTypes: ['ALL'] }).expect(403);
    expect(refused.body.error).toBe('Only Ravi Kumar can hand on their other approvals, from their own sign-in.');
    await att(hr).post('/leave/stand-ins', { managerEmployeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, fromDate: plus(10), toDate: plus(12), requestTypes: ['PAYDAY'] }).expect(400);
    const leaveOnly = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: raviEmp.id, standInEmployeeId: tara.id, fromDate: plus(10), toDate: plus(12), requestTypes: ['LEAVE'] }).expect(201)).body.standIn;
    /* Leave alone may go to someone without a sign-in (they decide in the employee app). */
    expect(leaveOnly).toMatchObject({ standInEmployeeId: tara.id, standInUserId: null, requestTypes: ['LEAVE'] });
    /* For all approvals they must sign in. */
    const noLogin = await people(ravi).post('/stand-ins', { standInEmployeeId: tara.id, fromDate: plus(10), toDate: plus(12) }).expect(400);
    expect(noLogin.body.error).toMatch(/no CLOR sign-in/);
    await people(ravi).post('/stand-ins', { standInEmployeeId: tara.id, fromDate: plus(10), toDate: plus(12), requestTypes: ['LEAVE'] }).expect(201);
    await clear(hr);
  });
});

describe('the data migration (20261118090000_stand_in_merge)', () => {
  it('copies each leave delegate once, overlapping ranges and all, as the application role, and the latest named still wins', async () => {
    const other = await owner('Other HR');
    await clear(hr);
    const t0 = Date.now() - 3_600_000;
    /* Overlapping: Ravi's team goes to Priya for days 30..32, then to Tara (no sign-in) for 31..33, named later. */
    const first = await oldRow(hr, raviEmp.id, priyaEmp.id, plus(30), plus(32), new Date(t0));
    const second = await oldRow(hr, raviEmp.id, tara.id, plus(31), plus(33), new Date(t0 + 60_000));
    const otherBoss = (await people(other).post('/employees', { name: 'Other Boss', code: 'O-1' }).expect(201)).body.employee;
    const otherDeputy = (await people(other).post('/employees', { name: 'Other Deputy', code: 'O-2' }).expect(201)).body.employee;
    const theirs = await oldRow(other, otherBoss.id, otherDeputy.id, plus(30), plus(30));
    /* A People stand-in named before the merge (as the old API wrote it: no list), Ravi to Meena over the same days. */
    const before0 = await newRow(hr, { userId: ravi.userId, standInUserId: meena.userId, fromDate: plus(30), toDate: plus(33), createdAt: new Date(t0 + 120_000) });
    expect(before0.requestTypes).toEqual([]);
    /* Read before the copy (fallback) and after it must agree. */
    const before = [plus(30), plus(31), plus(33)];
    const decidedBefore = await Promise.all(before.map((d) => inTenant(() => deciderFor(hr.orgId, raviEmp.id, d, 'LEAVE'))));
    expect(decidedBefore).toEqual([priyaEmp.id, tara.id, tara.id]);

    const sql = readFileSync(resolve(process.cwd(), 'prisma/people/migrations/20261118090000_stand_in_merge/migration.sql'), 'utf8');
    const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
    /* The columns are in the test schema already (pushed by its owner, so the application role may not alter it here; production runs the whole file as the owning application role). The copy runs as the application role. */
    const copy = statements.filter((x) => !/^(ALTER|CREATE)\b/.test(x));
    expect(copy.some((x) => x.startsWith('INSERT INTO "StandIn"'))).toBe(true);
    const db = new PrismaClient({ datasources: { db: { url: `${process.env.PEOPLE_DATABASE_URL}&connection_limit=1` } } });
    try {
      const [role] = await db.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      for (const x of copy) await db.$executeRawUnsafe(x);
      for (const x of copy) await db.$executeRawUnsafe(x);
    } finally {
      await db.$disconnect();
    }

    /* The People stand-in hands on People requests only, as before: leave still goes as it did, and its approvals still go to Meena. */
    expect((await inTenant(() => peoplePrisma.standIn.findUniqueOrThrow({ where: { id: before0.id } }))).requestTypes).toEqual(['PEOPLE']);
    expect((await inTenant(() => resolveApprover(hr, { kind: 'MANAGER' }, tara.id, plus(31), 'DESK_ESCALATION'))).standIns).toEqual([{ for: ravi.userId, user: meena.userId }]);
    const copied = await inTenant(() => peoplePrisma.standIn.findMany({ where: { orgId: hr.orgId, legacyId: { not: null } }, orderBy: { createdAt: 'asc' } }));
    expect(copied).toHaveLength(2);
    expect(copied.map((r) => r.legacyId)).toEqual([first.id, second.id]);
    /* No sign-ins stored: an older engine (a rollback) never takes a leave delegate for a People stand-in. */
    expect(copied[0]).toMatchObject({ id: `lsi_${first.id}`, employeeId: raviEmp.id, userId: null, standInEmployeeId: priyaEmp.id, standInUserId: null, fromDate: plus(30), toDate: plus(32), requestTypes: ['LEAVE', 'ATTENDANCE'], createdByUserId: hr.userId });
    expect(copied[0].createdAt.getTime()).toBe(first.createdAt.getTime());
    expect(copied[1]).toMatchObject({ standInEmployeeId: tara.id, standInUserId: null });
    /* The other company's row stays the other company's. */
    const theirsCopied = await runInTenant(other.orgId, () => peoplePrisma.standIn.findMany({ where: { orgId: other.orgId } }));
    expect(theirsCopied).toHaveLength(1);
    expect(theirsCopied[0]).toMatchObject({ legacyId: theirs.id, orgId: other.orgId, accountId: other.accountId });

    /* Same answers after the copy; each listed once though it is in both tables. */
    const decidedAfter = await Promise.all(before.map((d) => inTenant(() => deciderFor(hr.orgId, raviEmp.id, d, 'LEAVE'))));
    expect(decidedAfter).toEqual(decidedBefore);
    const listed = (await att(hr).get('/leave/stand-ins').expect(200)).body.standIns;
    expect(listed.map((r: any) => r.legacyId).sort()).toEqual([first.id, second.id].sort());
    expect(listed.find((r: any) => r.legacyId === first.id)).toMatchObject({ managerName: 'Ravi Kumar', standInName: 'Priya Rao', userId: ravi.userId, standInUserId: priya.userId });

    /* Removing the later one takes it from both tables: the earlier one decides again, and nothing comes back. */
    await att(hr).del(`/leave/stand-ins/lsi_${second.id}`).expect(200);
    expect(await inTenant(() => peoplePrisma.approvalStandIn.findFirst({ where: { id: second.id } }))).toBeNull();
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, plus(31), 'LEAVE'))).toBe(priyaEmp.id);
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, plus(33), 'LEAVE'))).toBe(raviEmp.id);
    await clear(hr);
  }, 60_000);
});

describe('during the deploy and after a rollback (until phase 3c)', () => {
  it('a delegate an older API removes (its old row) is gone here too', async () => {
    await clear(hr);
    const row = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, fromDate: todayIst(), toDate: todayIst() }).expect(201)).body.standIn;
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(priyaEmp.id);
    /* The older leave route deletes from ApprovalStandIn only. */
    await inTenant(() => peoplePrisma.approvalStandIn.delete({ where: { id: row.legacyId } }));
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(raviEmp.id);
    expect((await att(hr).get('/leave/stand-ins').expect(200)).body.standIns).toEqual([]);
    await clear(hr);
  });

  it('the latest named wins on both paths, even when it names someone without a sign-in', async () => {
    await clear(hr);
    const t0 = Date.now() - 600_000;
    await newRow(hr, { userId: ravi.userId, standInUserId: priya.userId, employeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, requestTypes: ['ALL'], createdAt: new Date(t0) });
    /* Named later: Tara, who decides in the employee app only. */
    await newRow(hr, { employeeId: raviEmp.id, standInEmployeeId: tara.id, requestTypes: ['LEAVE'], createdAt: new Date(t0 + 60_000) });
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'LEAVE'))).toBe(tara.id);
    /* The engine does not fall back to the older one: nobody with a sign-in stands in for leave today. */
    expect((await inTenant(() => resolveApprover(hr, { kind: 'MANAGER' }, tara.id, todayIst(), 'LEAVE'))).standIns).toEqual([]);
    /* For a People request the leave-only row does not count, so the older one does, on both paths. */
    expect((await inTenant(() => resolveApprover(hr, { kind: 'MANAGER' }, tara.id, todayIst(), 'DESK_ESCALATION'))).standIns).toEqual([{ for: ravi.userId, user: priya.userId }]);
    expect(await inTenant(() => deciderFor(hr.orgId, raviEmp.id, todayIst(), 'ATTENDANCE'))).toBe(priyaEmp.id);
    await clear(hr);
  });
});

describe('the employee app queue of a stand-in', () => {
  it('a leave-only stand-in does not get the team’s field punches or overtime; leave and attendance does', async () => {
    await clear(hr);
    const access = (await att(hr).get('/portal-access').expect(200)).body.company.code;
    const issued = (await att(hr).post('/portal-access/codes', { employeeIds: [priyaEmp.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: access, employeeCode: 'S-3', activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
    const queue = async () => (await request(app).get('/api/portal/approvals').set('Authorization', `Bearer ${token}`).expect(200)).body;
    const day = plus(-7);
    const t = await inTenant(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id: tara.id } }));
    await inTenant(async () => {
      await peoplePrisma.devicePunch.create({ data: { accountId: t.accountId, orgId: hr.orgId, deviceId: 'phone', serialNumber: 'PHONE', pin: tara.id, at: new Date(`${day}T04:00:00Z`), localTime: `${day}T09:30:00`, state: 'IN', employeeId: tara.id, shiftDate: day, outsideSite: true, reviewStatus: 'PENDING' } });
      await peoplePrisma.overtimeRequest.create({ data: { accountId: t.accountId, orgId: hr.orgId, employeeId: tara.id, date: day, kind: 'OVERTIME', minutes: 60, reason: 'Stock count', status: 'PENDING' } });
      /* Overtime has a manager's step only when the company says so. */
      await peoplePrisma.attendanceSettings.upsert({ where: { orgId: hr.orgId }, create: { accountId: t.accountId, orgId: hr.orgId, overtimeApproval: 'MANAGER', updatedByUserId: hr.userId }, update: { overtimeApproval: 'MANAGER' } });
    });
    expect((await queue()).approver).toBe(false);
    await newRow(hr, { employeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, requestTypes: ['LEAVE'] });
    const leaveOnly = await queue();
    expect(leaveOnly.approver).toBe(true);
    expect(leaveOnly.punches).toEqual([]);
    expect(leaveOnly.overtime).toEqual([]);
    expect(leaveOnly.corrections).toEqual([]);
    expect(leaveOnly.requests).toEqual([]);
    await clear(hr);
    await newRow(hr, { employeeId: raviEmp.id, standInEmployeeId: priyaEmp.id, requestTypes: ['LEAVE', 'ATTENDANCE'] });
    const both = await queue();
    expect(both.punches.map((p: any) => p.employeeName)).toEqual(['Tara Singh']);
    expect(both.overtime.map((p: any) => p.employeeName)).toEqual(['Tara Singh']);
    await clear(hr);
  }, 60_000);
});
