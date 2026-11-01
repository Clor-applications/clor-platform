import { writeFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave on the approval engine (workflow engine 2c-i, SPEC section 9): parity with the old path.
 *
 * Every leave preset (the chains HR, the manager, the manager then HR) × every scenario is run twice in
 * one company, once with the company's switch off (the old path) and once on (the engine), and must give
 * the same people who may decide, the same state after the first decision, the same people after that,
 * the same days written and the same balance, and the same notices. "May decide" is measured, not
 * assumed: every person tries to approve, in CLOR and in the employee app, on a fresh request each time
 * one succeeds. The few differences are written down below with the reason, never hidden.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { todayIst, addDays } = await import('../utils/istDate.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const { balancesFor, leaveYearOf } = await import('../services/attendance/leaveBalances.js');
const { seedPresets } = await import('../services/people/approvals/presets.js');
const { runLeaveHandOns } = await import('../services/attendance/leaveJobs.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `le.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Le Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId };
}
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const people = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const portal = (token: string) => ({
  get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
});

const LEAVE_HR = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE', 'ATTENDANCE::Leave Requests::EDIT', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW', 'ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];

/* Days to ask for: working days from a month ahead of today in India, never a Sunday (the default weekly off), each used once. */
let cursor = addDays(todayIst(), 30);
const nextDay = () => {
  do cursor = addDays(cursor, 1);
  while (new Date(`${cursor}T12:00:00Z`).getUTCDay() === 0);
  return cursor;
};
const normalise = (t: string) => t.replace(/\d{1,2} [A-Z][a-z]{2} \d{4}/g, 'DATE');

let hr: Ctx;
let kavya: Ctx;
let meena: Ctx;
let ravi: Ctx;
let priya: Ctx;
let tara: Ctx;
let om: Ctx;
let lone: Ctx;
const E: Record<string, any> = {};
const T: Record<string, any> = {};
const app_: Record<string, string> = {};
type Actor = { name: string; web?: Ctx; app?: string };
let ACTORS: Actor[] = [];
let names = new Map<string, string>();

const inTenant = <X>(fn: () => Promise<X>) => runInTenant(hr.orgId, fn);
const setSwitch = (on: boolean) => inTenant(() => peoplePrisma.peopleSetting.upsert({ where: { orgId: hr.orgId }, create: { accountId: hr.accountId, orgId: hr.orgId, leaveOnEngine: on }, update: { leaveOnEngine: on } }));
const leaveRow = (id: string) => inTenant(() => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));
const engineOf = (id: string) => inTenant(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: hr.orgId, sourceKind: 'LEAVE', sourceId: id }, include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } } }));

beforeAll(async () => {
  hr = await owner();
  kavya = await colleague(hr, 'Kavya', LEAVE_HR);
  meena = await colleague(hr, 'Meena', LEAVE_HR, true);
  ravi = await colleague(hr, 'Ravi', LEAVE_HR, true);
  priya = await colleague(hr, 'Priya', MY);
  tara = await colleague(hr, 'Tara', MY);
  om = await colleague(hr, 'Om', MY);
  lone = await colleague(hr, 'Lone', MY);
  const emp = async (body: Record<string, unknown>) => (await people(hr).post('/employees', { dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
  E.kavya = await emp({ name: 'Kavya Rao', code: 'L-1' });
  E.meena = await emp({ name: 'Meena Iyer', code: 'L-2' });
  E.ravi = await emp({ name: 'Ravi Kumar', code: 'L-3', reportingManagerId: E.meena.id });
  E.tara = await emp({ name: 'Tara Singh', code: 'L-4', reportingManagerId: E.ravi.id });
  E.priya = await emp({ name: 'Priya Nair', code: 'L-5' });
  E.nadia = await emp({ name: 'Nadia Khan', code: 'L-6' });
  E.om = await emp({ name: 'Om Prakash', code: 'L-7', reportingManagerId: E.nadia.id });
  E.lone = await emp({ name: 'Lone Wolf', code: 'L-8' });
  await inTenant(async () => {
    for (const [k, c] of Object.entries({ kavya, meena, ravi, priya, tara, om, lone })) await peoplePrisma.employee.update({ where: { id: E[k].id }, data: { userId: c.userId } });
  });
  /* The employee app: Priya (a stand-in with no leave rights), Nadia (a manager with no CLOR sign-in) and Ravi. */
  const company = (await att(hr).get('/portal-access').expect(200)).body.company.code;
  for (const k of ['priya', 'nadia', 'ravi']) {
    const code = (await att(hr).post('/portal-access/codes', { employeeIds: [E[k].id] }).expect(200)).body.codes[0].activationCode;
    app_[k] = (await request(app).post('/api/portal/activate').send({ company, employeeCode: E[k].code, activationCode: code, password: 'app pass 123' }).expect(200)).body.token;
  }
  /* Under TEST_TODAY the clock moves but PostgreSQL's now() does not: the app sessions start at the test's own "now", or they read as idle for weeks. */
  await inTenant(() => peoplePrisma.portalSession.updateMany({ where: { orgId: hr.orgId }, data: { createdAt: new Date(), lastSeenAt: new Date() } }));
  /* One type per chain: the type's own approval picks the preset (LeaveType.approval). */
  for (const chain of ['HR', 'MANAGER', 'MANAGER_THEN_HR']) {
    const t = (await att(hr).post('/leave/types', { name: `Casual ${chain}`, annualDays: 300 }).expect(201)).body.type;
    await att(hr).put(`/leave/types/${t.id}`, { name: t.name, annualDays: 300, approval: chain }).expect(200);
    T[chain] = t;
  }
  ACTORS = [
    { name: 'Asha (owner)', web: hr },
    { name: 'Kavya (HR)', web: kavya },
    { name: 'Meena (team)', web: meena },
    { name: 'Ravi (manager)', web: ravi, app: app_.ravi },
    { name: 'Priya (stand-in)', web: priya, app: app_.priya },
    { name: 'Nadia (app manager)', app: app_.nadia },
    { name: 'Tara', web: tara },
    { name: 'Om', web: om },
  ];
  names = new Map([[hr.userId, 'Asha'], [kavya.userId, 'Kavya'], [meena.userId, 'Meena'], [ravi.userId, 'Ravi'], [priya.userId, 'Priya'], [tara.userId, 'Tara'], [om.userId, 'Om'], [lone.userId, 'Lone']]);
}, 180_000);

/** Approve as this person, in CLOR first and then in the employee app. */
async function tryApprove(a: Actor, id: string) {
  if (a.web) {
    const r = await att(a.web).post(`/leave/requests/${id}/approve`, {});
    if (r.status === 200) return { ok: true, stage: r.body.stage || null };
  }
  if (a.app) {
    const r = await portal(a.app).post(`/approvals/leave/${id}`, { decision: 'approve' });
    if (r.status === 200) return { ok: true, stage: r.body.stage || null };
  }
  return { ok: false, stage: null };
}

type Scenario = { name: string; subject: string; asker: () => Ctx; halfDay?: 'FIRST'; before?: () => Promise<void>; after?: () => Promise<void> };
const raviAway = { id: '' };
const SCENARIOS: Scenario[] = [
  { name: 'with a manager', subject: 'tara', asker: () => tara },
  { name: 'no manager', subject: 'lone', asker: () => lone },
  { name: 'manager in the employee app only', subject: 'om', asker: () => om },
  { name: 'half day', subject: 'tara', asker: () => tara, halfDay: 'FIRST' },
  { name: 'entered by HR', subject: 'tara', asker: () => kavya },
  { name: 'own leave of an approver (self-approval refused)', subject: 'ravi', asker: () => ravi },
  {
    name: 'manager away, with a stand-in', subject: 'tara', asker: () => tara,
    before: async () => {
      await awayToday(true);
      const s = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: E.ravi.id, standInEmployeeId: E.priya.id, fromDate: todayIst(), toDate: addDays(todayIst(), 1) }).expect(201)).body.standIn;
      raviAway.id = s.id;
    },
    after: async () => {
      await att(hr).del(`/leave/stand-ins/${raviAway.id}`).expect(200);
      await awayToday(false);
    },
  },
  { name: 'manager away, no stand-in', subject: 'tara', asker: () => tara, before: () => awayToday(true), after: () => awayToday(false) },
];

/* Ravi on approved leave all of today, written straight in (today may be a Sunday or a holiday, which a request refuses). */
async function awayToday(on: boolean) {
  await inTenant(async () => {
    await peoplePrisma.leaveRequest.deleteMany({ where: { orgId: hr.orgId, employeeId: E.ravi.id, reason: 'Away for the parity test' } });
    if (on) await peoplePrisma.leaveRequest.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: E.ravi.id, leaveTypeId: T.HR.id, fromDate: todayIst(), toDate: todayIst(), days: 1, reason: 'Away for the parity test', status: 'APPROVED', requestedByUserId: ravi.userId } });
  });
}

async function ask(sc: Scenario, chain: string, engine: boolean) {
  await setSwitch(engine);
  const day = nextDay();
  const body = { employeeId: E[sc.subject].id, leaveTypeId: T[chain].id, fromDate: day, toDate: day, reason: 'Family visit', ...(sc.halfDay ? { halfDay: sc.halfDay } : {}) };
  const asker = sc.asker();
  const r = asker === kavya ? await att(kavya).post('/leave/requests', body) : await att(asker).post('/me/leave', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await setSwitch(false);
  return r.body.request.id as string;
}

/** Who may approve now, measured: each person tries on a fresh request (`fresh` makes one and takes it as far as it should be). */
async function mayDecide(fresh: () => Promise<string>) {
  const may: string[] = [];
  let id = await fresh();
  for (const a of ACTORS) {
    if ((await tryApprove(a, id)).ok) {
      may.push(a.name);
      id = await fresh();
    }
  }
  await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
  return may;
}

async function noticesFor(id: string) {
  await deliverOutbox(new Date(), 5000);
  const rows = await inTenant(() => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, OR: [{ dedupeKey: { contains: id } }, { subjectKey: `leave:${id}` }] }, orderBy: { createdAt: 'asc' } }));
  return rows.map((n) => `${names.get(n.userId) || n.userId} · ${n.kind} · ${normalise(n.title)}`).sort();
}

async function available(employeeId: string, date: string, typeId: string) {
  return inTenant(async () => {
    const { balances } = await balancesFor(hr.accountId, hr.orgId, [employeeId], await leaveYearOf(hr.orgId, date));
    return balances.get(employeeId)!.get(typeId)!.available;
  });
}

/** One preset × scenario on one path: who decides first, what the first decision leaves, who decides next, and what the leave ends as. */
async function story(chain: string, sc: Scenario, engine: boolean) {
  const first = await mayDecide(() => ask(sc, chain, engine));
  const firstActor = ACTORS.find((a) => a.name === first[0]);
  const out: Record<string, unknown> = { first };
  if (!firstActor) return out;
  /* Who decides after the first decision, measured on requests of its own. */
  const probe = await ask(sc, chain, engine);
  const took = await tryApprove(firstActor, probe);
  const row = await leaveRow(probe);
  out.afterFirst = { status: row.status, managerStep: Boolean(row.managerApprovedAt), stage: took.stage };
  if (row.status === 'PENDING') {
    await att(hr).post(`/leave/requests/${probe}/cancel`).expect(200);
    out.next = await mayDecide(async () => {
      const x = await ask(sc, chain, engine);
      expect((await tryApprove(firstActor, x)).ok).toBe(true);
      return x;
    });
  }
  const nextActor = ACTORS.find((a) => a.name === ((out.next as string[] | undefined) || [])[0]);
  /* The one request followed to the end, with nothing else asked meanwhile: the balance moves only by it. */
  const id = await ask(sc, chain, engine);
  const day = (await leaveRow(id)).fromDate;
  const waiting = await available(E[sc.subject].id, day, T[chain].id);
  await tryApprove(firstActor, id);
  if (nextActor) await tryApprove(nextActor, id);
  const done = await leaveRow(id);
  const written = () => inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, leaveRequestId: id } }));
  const approved = await available(E[sc.subject].id, day, T[chain].id);
  out.end = { status: done.status, days: done.days, daysWritten: await written(), sameAsWhileWaiting: approved === waiting };
  /* Cancelled after approval: the days come off the record and back to the balance. */
  if (done.status === 'APPROVED') {
    await att(kavya).post(`/leave/requests/${id}/cancel`).expect(200);
    const back = await available(E[sc.subject].id, day, T[chain].id);
    out.cancelled = { status: (await leaveRow(id)).status, daysWritten: await written(), restored: back == null || approved == null ? null : Math.round((back - approved) * 100) / 100 };
  }
  out.notices = await noticesFor(id);
  if (engine) {
    const r = await engineOf(id);
    out.engine = r ? { status: r.status, steps: r.steps.map((s) => `${s.order}:${s.status}:${s.resolvedHow || ''}`) } : null;
  }
  return out;
}

/**
 * The differences, each with its reason (SPEC 5.3, 5.6). Anything not listed here must be identical.
 *  - Manager away all day with no stand-in, where the manager alone decides a step (MANAGER_THEN_HR's
 *    first step): the engine sends it up to the manager's manager (SPEC 5.3 step 2, "Away: Ravi on leave,
 *    sent to Meena"); the old path kept waiting for the away manager. Under "the manager" HR can step in
 *    either way, so the people are the same and only who is told differs.
 */
const DIFFERENT: Record<string, (old: any, eng: any) => void> = {
  /*
   * The manager then HR, where the only one who could take HR's step is the manager who took the first (a small
   * business whose owner is manager and HR). The old path refused the owner HR's step and the leave waited for
   * ever; the engine skips HR's step, approves on the one decision, and the leave's history says so. Owner's
   * decision (review of PR #102, item 5): no dead ends.
   */
  'MANAGER_THEN_HR / the only HR is the manager': (old, eng) => {
    expect(old.afterFirst).toEqual({ status: 'PENDING', stage: 'HR' });
    expect(old.second).toEqual({ status: 403, code: 'HR_STEP' });
    expect(old.end).toBe('PENDING');
    expect(eng.afterFirst).toEqual({ status: 'APPROVED', stage: null });
    expect(eng.end).toBe('APPROVED');
    expect(eng.steps).toEqual(['1:APPROVED', '2:SKIPPED']);
    expect(eng.history).toContain('HR step skipped: nobody else can approve');
  },
  'MANAGER_THEN_HR / manager away, no stand-in': (old, eng) => {
    expect(old.first).toEqual(['Ravi (manager)']);
    expect(eng.first).toEqual(['Meena (team)']);
    expect(eng.afterFirst).toEqual(old.afterFirst);
    expect(eng.next).toEqual(old.next);
    expect(eng.end).toEqual(old.end);
    expect(eng.cancelled).toEqual(old.cancelled);
    expect(eng.engine.steps).toEqual(['1:APPROVED:AWAY_HANDED_UP', '2:APPROVED:HR']);
    /* Told: the request goes to Meena, to whom it was sent, not to the away manager; the rest is the same. */
    const asked = (n: string[]) => n.filter((x) => x.includes(' asks for '));
    expect(asked(old.notices).map((n: string) => n.split(' · ')[0])).toEqual(['Ravi']);
    expect(asked(eng.notices).map((n: string) => n.split(' · ')[0])).toEqual(['Meena']);
    expect(eng.notices.filter((n: string) => !n.includes(' asks for '))).toEqual(old.notices.filter((n: string) => !n.includes(' asks for ')));
  },
  'MANAGER / manager away, no stand-in': (old, eng) => {
    expect(eng.first).toEqual(old.first);
    expect(eng.end).toEqual(old.end);
    expect(eng.afterFirst).toEqual(old.afterFirst);
    expect(eng.cancelled).toEqual(old.cancelled);
    /* Told: the old path told the away manager; the engine tells Meena, to whom it was sent. The rest is the same. */
    const asked = (n: string[]) => n.filter((x) => x.includes(' asks for '));
    expect(asked(old.notices).map((n: string) => n.split(' · ')[0])).toEqual(['Ravi']);
    expect(asked(eng.notices).map((n: string) => n.split(' · ')[0])).toEqual(['Meena']);
    expect(eng.notices.filter((n: string) => !n.includes(' asks for '))).toEqual(old.notices.filter((n: string) => !n.includes(' asks for ')));
  },
};

describe('leave on the approval engine: parity with the old path', () => {
  const results: Record<string, { old: any; eng: any }> = {};
  /* LEAVE_PARITY_OUT=<path>: the whole table, both paths side by side, for the PR. */
  afterAll(() => {
    if (process.env.LEAVE_PARITY_OUT) writeFileSync(process.env.LEAVE_PARITY_OUT, `${JSON.stringify(results, null, 1)}\n`);
  });

  for (const chain of ['HR', 'MANAGER', 'MANAGER_THEN_HR']) {
    for (const sc of SCENARIOS) {
      it(`${chain} / ${sc.name}`, async () => {
        await sc.before?.();
        try {
          const old = await story(chain, sc, false);
          const eng = await story(chain, sc, true);
          results[`${chain} / ${sc.name}`] = { old, eng };
          const key = `${chain} / ${sc.name}`;
          if (DIFFERENT[key]) DIFFERENT[key](old, eng);
          else {
            const { engine: _e, ...same } = eng;
            expect(same).toEqual(old);
          }
          /* Never double-posted: one approval writes the day once, and a leave the engine approved shows one approved request. */
          if ((eng.end as any)?.status === 'APPROVED') expect((eng.end as any).daysWritten).toBe(1);
          /* Self-approval refused: nobody approves their own leave on either path. */
          if (sc.subject === 'ravi') for (const s of [old, eng]) expect((s.first as string[]).includes('Ravi (manager)')).toBe(false);
        } finally {
          await sc.after?.();
        }
      }, 240_000);
    }
  }
});

describe('leave on the approval engine: what the old path refuses, the engine refuses the same way', () => {
  it('HR override: under the manager, HR approves; under the manager then HR, HR may reject but not approve while the manager decides', async () => {
    const sc = SCENARIOS[0];
    for (const engine of [false, true]) {
      const a = await ask(sc, 'MANAGER', engine);
      expect((await att(kavya).post(`/leave/requests/${a}/approve`, {})).status).toBe(200);
      const b = await ask(sc, 'MANAGER_THEN_HR', engine);
      const refused = await att(kavya).post(`/leave/requests/${b}/approve`, {});
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('MANAGER_FIRST');
      expect((await att(kavya).post(`/leave/requests/${b}/reject`, { note: 'Not this week' })).status).toBe(200);
      expect((await leaveRow(b)).status).toBe('REJECTED');
      if (engine) expect((await engineOf(b))?.status).toBe('REJECTED');
      /* After the manager's step, HR's is not the manager's, nor a team-scoped approver's. */
      const c = await ask(sc, 'MANAGER_THEN_HR', engine);
      expect((await att(ravi).post(`/leave/requests/${c}/approve`, {})).body.stage).toBe('HR');
      for (const who of [ravi, meena]) {
        const r = await att(who).post(`/leave/requests/${c}/approve`, {});
        expect([r.status, r.body.code]).toEqual([403, 'HR_STEP']);
      }
      const app = await portal(app_.ravi).post(`/approvals/leave/${c}`, { decision: 'approve' });
      expect(app.status).toBe(409);
      expect((await att(kavya).post(`/leave/requests/${c}/approve`, {})).status).toBe(200);
    }
  }, 120_000);

  it('a period Payroll has taken: 409 on both, the leave keeps waiting and so does its step; once released it is approved, written once', async () => {
    const sc = SCENARIOS[0];
    for (const engine of [false, true]) {
      const id = await ask(sc, 'HR', engine);
      const day = (await leaveRow(id)).fromDate;
      const run = await runInTenant(hr.orgId, async () => {
        const period = await payrollPrisma.payrollPeriod.create({ data: { accountId: hr.accountId, orgId: hr.orgId, name: `Parity ${day}`, startDate: day, endDate: day, createdByUserId: hr.userId } });
        const r = await payrollPrisma.payrollRun.create({ data: { accountId: hr.accountId, orgId: hr.orgId, number: `PR-${rnd()}`, periodId: period.id, payrollDate: day, status: 'LOCKED', createdByUserId: hr.userId } as any });
        await payrollPrisma.payrollRunEmployee.create({ data: { accountId: hr.accountId, orgId: hr.orgId, runId: r.id, employeeId: E.tara.id, inclusion: 'INCLUDED' } as any });
        return r;
      });
      const refused = await att(kavya).post(`/leave/requests/${id}/approve`, {});
      expect([refused.status, refused.body.code]).toEqual([409, 'PAYROLL_TAKEN']);
      expect((await leaveRow(id)).status).toBe('PENDING');
      if (engine) {
        const r = await engineOf(id);
        expect(r?.status).toBe('WAITING');
        expect(r?.steps.filter((s) => s.status === 'WAITING')).toHaveLength(1);
      }
      await runInTenant(hr.orgId, () => payrollPrisma.payrollRun.update({ where: { id: run.id }, data: { status: 'CANCELLED' } }));
      expect((await att(kavya).post(`/leave/requests/${id}/approve`, {})).status).toBe(200);
      expect(await inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, leaveRequestId: id } }))).toBe(1);
      if (engine) expect((await engineOf(id))?.status).toBe('APPROVED');
    }
  }, 120_000);

  it('a manager who can decide nowhere (no sign-in, no employee app), under the manager then HR: the old path waits for the type’s hand-on; the engine skips to HR and tells HR (SPEC 5.6, no dead ends)', async () => {
    const zed = (await people(hr).post('/employees', { name: 'Zed Offline', code: 'L-9', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const yuv = await colleague(hr, 'Yuv', MY);
    const yuvE = (await people(hr).post('/employees', { name: 'Yuv Raj', code: 'L-10', dateOfJoining: '2024-01-01', reportingManagerId: zed.id }).expect(201)).body.employee;
    await inTenant(() => peoplePrisma.employee.update({ where: { id: yuvE.id }, data: { userId: yuv.userId } }));
    names.set(yuv.userId, 'Yuv');
    E.yuv = yuvE;
    const sc: Scenario = { name: 'offline manager', subject: 'yuv', asker: () => yuv };
    const old = await ask(sc, 'MANAGER_THEN_HR', false);
    const refused = await att(kavya).post(`/leave/requests/${old}/approve`, {});
    expect([refused.status, refused.body.code]).toEqual([409, 'MANAGER_FIRST']);
    const eng = await ask(sc, 'MANAGER_THEN_HR', true);
    const r = await engineOf(eng);
    expect(r?.steps.map((s) => `${s.order}:${s.status}`)).toEqual(['1:SKIPPED', '2:WAITING']);
    const told = (await noticesFor(eng)).filter((n) => n.includes(' asks for ')).map((n) => n.split(' · ')[0]).sort();
    expect(told).toEqual(['Asha', 'Kavya']);
    expect((await att(kavya).post(`/leave/requests/${eng}/approve`, {})).status).toBe(200);
    await att(hr).post(`/leave/requests/${old}/cancel`).expect(200);
  }, 60_000);

  it('over the balance: refused the same way when asked, and nothing is opened on the engine', async () => {
    const short = (await att(hr).post('/leave/types', { name: `Short ${rnd()}`, annualDays: 1 }).expect(201)).body.type;
    await att(hr).put(`/leave/types/${short.id}`, { name: short.name, annualDays: 1, approval: 'MANAGER' }).expect(200);
    for (const engine of [false, true]) {
      await setSwitch(engine);
      const from = nextDay();
      let to = nextDay();
      to = nextDay();
      const r = await att(tara).post('/me/leave', { leaveTypeId: short.id, fromDate: from, toDate: to, reason: 'Long trip' });
      await setSwitch(false);
      expect([r.status, r.body.code]).toEqual([400, 'NO_BALANCE']);
    }
    expect(await inTenant(() => peoplePrisma.approvalRequest.count({ where: { orgId: hr.orgId, sourceKind: 'LEAVE', payload: { path: ['leaveTypeId'], equals: short.id } } }))).toBe(0);
  }, 60_000);
});

describe('leave on the approval engine: the switch, the presets, the old rows', () => {
  it('switch off (the default): nothing is written on the engine, and no preset is made', async () => {
    const c = await owner();
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const e = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Solo Staff', code: 'S-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const day = nextDay();
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: e.id, leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Errand' }).expect(201);
    await runInTenant(c.orgId, async () => {
      expect(await peoplePrisma.approvalRequest.count({ where: { orgId: c.orgId } })).toBe(0);
      expect(await peoplePrisma.approvalRule.count({ where: { orgId: c.orgId, requestType: 'LEAVE' } })).toBe(0);
    });
  }, 60_000);

  it('seedPresets: idempotent, safe when two run at once, one company each, never the main rule', async () => {
    const c = await owner();
    const who = { accountId: c.accountId, orgId: c.orgId };
    await runInTenant(c.orgId, () => Promise.all([seedPresets(who), seedPresets(who), seedPresets(who)]));
    await runInTenant(c.orgId, () => seedPresets(who));
    const rows = await runInTenant(c.orgId, () => peoplePrisma.approvalRule.findMany({ where: { orgId: c.orgId, requestType: 'LEAVE' }, orderBy: { variantKey: 'asc' } }));
    expect(rows.map((r) => [r.variantKey, r.version, r.active, r.presetKey])).toEqual([
      ['preset:HR_OR_MANAGER', 1, true, 'HR_OR_MANAGER'],
      ['preset:MANAGER', 1, true, 'MANAGER'],
      ['preset:MANAGER_THEN_HR', 1, true, 'MANAGER_THEN_HR'],
    ]);
    /* The rules API cannot name, retire or overwrite a preset, and the company's main leave rule stays unset. */
    expect((await request(app).delete(`/api/orgs/${c.orgId}/people/approval-rules/LEAVE/preset:MANAGER`).set(at(c))).status).toBe(404);
    expect((await request(app).post(`/api/orgs/${c.orgId}/people/approval-rules`).set(at(c)).send({ requestType: 'LEAVE', name: 'x', variantKey: 'preset:MANAGER', steps: [{ approver: { kind: 'HR' }, dueDays: 1 }] })).status).toBe(400);
    expect(await runInTenant(c.orgId, () => peoplePrisma.approvalRule.count({ where: { orgId: c.orgId, requestType: 'LEAVE', variantKey: '' } }))).toBe(0);
    /* Another company sees none of them. */
    expect(await runInTenant(hr.orgId, () => peoplePrisma.approvalRule.count({ where: { orgId: c.orgId } }))).toBe(0);
  }, 60_000);

  it('a request already waiting when the switch goes on finishes on the old path; new ones go on the engine', async () => {
    const sc = SCENARIOS[0];
    const old = await ask(sc, 'MANAGER_THEN_HR', false);
    await setSwitch(true);
    expect(await engineOf(old)).toBeNull();
    expect((await att(ravi).post(`/leave/requests/${old}/approve`, {})).body.stage).toBe('HR');
    expect((await att(kavya).post(`/leave/requests/${old}/approve`, {})).status).toBe(200);
    expect(await engineOf(old)).toBeNull();
    await setSwitch(false);
    const fresh = await ask(sc, 'MANAGER_THEN_HR', true);
    expect((await engineOf(fresh))?.status).toBe('WAITING');
    await att(hr).post(`/leave/requests/${fresh}/cancel`).expect(200);
    expect((await engineOf(fresh))?.status).toBe('WITHDRAWN');
  }, 60_000);

  it('rollback: an older API that approves only the engine request (it has no leave effect) leaves the leave on the old path, never stuck; one that decides the leave leaves an engine request nobody is shown', async () => {
    const id = await ask(SCENARIOS[0], 'MANAGER_THEN_HR', true);
    const r = await engineOf(id);
    /* As rel-eed8908's People → Approvals would: the step and the request approved, the leave untouched. */
    await inTenant(async () => {
      await peoplePrisma.approvalStep.updateMany({ where: { requestId: r!.id, status: 'WAITING' }, data: { status: 'APPROVED', decidedByUserId: ravi.userId, decidedAt: new Date() } });
      await peoplePrisma.approvalRequest.update({ where: { id: r!.id }, data: { status: 'APPROVED' } });
    });
    const refused = await att(kavya).post(`/leave/requests/${id}/approve`, {});
    expect([refused.status, refused.body.code]).toEqual([409, 'MANAGER_FIRST']);
    expect((await att(ravi).post(`/leave/requests/${id}/approve`, {})).body.stage).toBe('HR');
    expect((await att(kavya).post(`/leave/requests/${id}/approve`, {})).status).toBe(200);
    /* As rel-eed8908's leave screens would: the leave decided on the old path, its engine request left waiting. */
    const other = await ask(SCENARIOS[0], 'HR', true);
    await inTenant(() => peoplePrisma.leaveRequest.update({ where: { id: other }, data: { status: 'REJECTED' } }));
    expect((await engineOf(other))?.status).toBe('WAITING');
    const inbox = (await people(kavya).get('/inbox').expect(200)).body.items.map((i: any) => i.id);
    expect(inbox).not.toContain(other);
    expect(inbox).not.toContain((await engineOf(other))!.id);
  }, 60_000);

  it('the People approvals lists leave it out, and refuse to decide it there: leave is decided where it was asked', async () => {
    const id = await ask(SCENARIOS[0], 'HR', true);
    const r = await engineOf(id);
    const list = (await people(hr).get('/requests').expect(200)).body;
    expect(list.waitingForMe.some((x: any) => x.id === r!.id)).toBe(false);
    const there = await people(hr).post(`/requests/${r!.id}/approve`, {});
    expect(there.status).toBe(409);
    expect((await leaveRow(id)).status).toBe('PENDING');
    /* The one inbox lists it once, as leave. */
    const inbox = (await people(hr).get('/inbox').expect(200)).body.items.filter((i: any) => i.id === id || i.id === r!.id);
    expect(inbox.map((i: any) => i.kind)).toEqual(['LEAVE']);
    await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
  }, 60_000);

  it('the employee app queue: the manager sees their team’s leave while it is theirs, not after it went to HR', async () => {
    const id = await ask(SCENARIOS[0], 'MANAGER_THEN_HR', true);
    const queue = async () => (await portal(app_.ravi).get('/approvals').expect(200)).body.leaves.map((l: any) => l.id);
    expect(await queue()).toContain(id);
    expect((await portal(app_.ravi).post(`/approvals/leave/${id}`, { decision: 'approve' }).expect(200)).body.stage).toBe('HR');
    expect(await queue()).not.toContain(id);
    expect((await leaveRow(id)).managerApprovedAt).not.toBeNull();
    await att(kavya).post(`/leave/requests/${id}/approve`, {}).expect(200);
  }, 60_000);

  it('changed while it waits: asked again from the first step', async () => {
    const id = await ask(SCENARIOS[0], 'MANAGER_THEN_HR', true);
    expect((await att(ravi).post(`/leave/requests/${id}/approve`, {})).body.stage).toBe('HR');
    const day = nextDay();
    await request(app).put(`/api/orgs/${tara.orgId}/attendance/me/leave/${id}`).set(at(tara)).send({ leaveTypeId: T.MANAGER_THEN_HR.id, fromDate: day, toDate: day, reason: 'Moved a day' }).expect(200);
    const r = await engineOf(id);
    expect(r?.currentStep).toBe(1);
    expect(r?.steps.filter((s) => s.status === 'WAITING').map((s) => s.candidateUserIds)).toEqual([[ravi.userId]]);
    expect((await leaveRow(id)).managerApprovedAt).toBeNull();
    await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);
  }, 60_000);

  it('the type’s hand-on moves the manager’s step to HR on the engine too', async () => {
    await att(hr).put(`/leave/types/${T.MANAGER_THEN_HR.id}`, { name: T.MANAGER_THEN_HR.name, annualDays: 300, approval: 'MANAGER_THEN_HR', handOnAfterDays: 1 }).expect(200);
    try {
      const id = await ask(SCENARIOS[0], 'MANAGER_THEN_HR', true);
      await inTenant(() => peoplePrisma.leaveRequest.update({ where: { id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } }));
      await runLeaveHandOns(new Date());
      const r = await engineOf(id);
      expect(r?.currentStep).toBe(2);
      expect(r?.steps.find((s) => s.order === 1)?.status).toBe('HANDED_ON');
      expect((await att(kavya).post(`/leave/requests/${id}/approve`, {})).status).toBe(200);
    } finally {
      await att(hr).put(`/leave/types/${T.MANAGER_THEN_HR.id}`, { name: T.MANAGER_THEN_HR.name, annualDays: 300, approval: 'MANAGER_THEN_HR', handOnAfterDays: null }).expect(200);
    }
  }, 60_000);

  it('two approvers at once: one decision, one approval, the days written once', async () => {
    const id = await ask(SCENARIOS[0], 'HR', true);
    const [a, b] = await Promise.all([att(kavya).post(`/leave/requests/${id}/approve`, {}), att(hr).post(`/leave/requests/${id}/approve`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, leaveRequestId: id } }))).toBe(1);
    const r = await engineOf(id);
    expect(r?.steps.filter((s) => s.status === 'APPROVED')).toHaveLength(1);
  }, 60_000);
});

describe('leave on the approval engine: review of PR #102', () => {
  it('who decides is worked out live at decision time: (a) HR who lost the right, (b) an expired stand-in, (c) a stand-in named after it opened, (d) a new manager under HR or the manager, (e) HR who started later', async () => {
    const sc = SCENARIOS[0];
    /* (a) Hema approved leave when it opened, and no longer does. */
    const hema = await colleague(hr, 'Hema', LEAVE_HR);
    const a = await ask(sc, 'HR', true);
    expect((await engineOf(a))?.steps.find((s) => s.status === 'WAITING')?.candidateUserIds).toContain(hema.userId);
    await inTenant(() => platformPrisma.userRoleAssignment.deleteMany({ where: { orgId: hr.orgId, userId: hema.userId } }));
    expect((await att(hema).post(`/leave/requests/${a}/approve`, {})).status).toBe(403);
    expect((await leaveRow(a)).status).toBe('PENDING');
    /* (e) Hari starts approving leave after it opened, and decides it. */
    const hari = await colleague(hr, 'Hari', LEAVE_HR);
    expect((await people(hari).get('/inbox').expect(200)).body.items.map((i: any) => i.id)).toContain(a);
    expect((await att(hari).post(`/leave/requests/${a}/approve`, {})).status).toBe(200);
    expect((await engineOf(a))?.steps.find((s) => s.status === 'APPROVED')?.decidedByUserId).toBe(hari.userId);

    /* (c) Priya named Ravi's stand-in after the leave opened: she decides it from the employee app. */
    const c = await ask(sc, 'MANAGER_THEN_HR', true);
    expect((await portal(app_.priya).post(`/approvals/leave/${c}`, { decision: 'approve' })).status).toBe(403);
    const standIn = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: E.ravi.id, standInEmployeeId: E.priya.id, fromDate: todayIst(), toDate: addDays(todayIst(), 1) }).expect(201)).body.standIn;
    expect((await engineOf(c))?.steps.find((s) => s.status === 'WAITING')?.candidateUserIds).toContain(priya.userId);
    /* (b) Its dates end: she no longer decides, even with her name still on the step. */
    const b = await ask(sc, 'MANAGER_THEN_HR', true);
    expect((await engineOf(b))?.steps.find((s) => s.status === 'WAITING')?.candidateUserIds).toContain(priya.userId);
    await inTenant(() => peoplePrisma.standIn.update({ where: { id: standIn.id }, data: { fromDate: addDays(todayIst(), -3), toDate: addDays(todayIst(), -1) } }));
    const legacy = await inTenant(() => peoplePrisma.standIn.findUnique({ where: { id: standIn.id }, select: { legacyId: true } }));
    if (legacy?.legacyId) await inTenant(() => peoplePrisma.approvalStandIn.updateMany({ where: { id: legacy.legacyId! }, data: { fromDate: addDays(todayIst(), -3), toDate: addDays(todayIst(), -1) } }));
    expect((await portal(app_.priya).post(`/approvals/leave/${b}`, { decision: 'approve' })).status).toBe(403);
    expect((await att(priya).post(`/leave/requests/${b}/approve`, {})).status).toBe(403);
    expect((await att(ravi).post(`/leave/requests/${b}/approve`, {})).body.stage).toBe('HR');
    await att(hr).del(`/leave/stand-ins/${standIn.id}`).expect(200);
    for (const id of [b, c]) await att(hr).post(`/leave/requests/${id}/cancel`).expect(200);

    /* (d) Om's manager changes from Nadia to Ravi while his leave waits on "HR or the manager": Ravi takes it, Nadia no longer. */
    const d = await ask({ name: 'om', subject: 'om', asker: () => om }, 'HR', true);
    expect((await engineOf(d))?.steps.find((s) => s.status === 'WAITING')?.candidateUserIds).toContain(`portal:${E.nadia.id}`);
    await people(hr).put(`/employees/${E.om.id}`, { reportingManagerId: E.ravi.id }).expect(200);
    try {
      const now = (await engineOf(d))?.steps.find((s) => s.status === 'WAITING')?.candidateUserIds as string[];
      expect(now).toContain(ravi.userId);
      expect(now).not.toContain(`portal:${E.nadia.id}`);
      expect((await portal(app_.nadia).post(`/approvals/leave/${d}`, { decision: 'approve' })).status).toBe(403);
      /* The new manager is told. */
      expect((await noticesFor(d)).some((n) => n.startsWith('Ravi · attendance.leave_asked'))).toBe(true);
      expect((await portal(app_.ravi).post(`/approvals/leave/${d}`, { decision: 'approve' })).status).toBe(200);
    } finally {
      await people(hr).put(`/employees/${E.om.id}`, { reportingManagerId: E.nadia.id }).expect(200);
    }
  }, 180_000);

  it('rollback: an older API took the manager’s step on the leave row while the engine waited at step 1; on the newer API HR decides it, the manager cannot take it twice', async () => {
    const sc = SCENARIOS[0];
    const id = await ask(sc, 'MANAGER_THEN_HR', true);
    await inTenant(() => peoplePrisma.leaveRequest.update({ where: { id }, data: { managerApprovedAt: new Date(), managerApprovedById: E.ravi.id, managerNote: 'Fine' } }));
    const again = await att(ravi).post(`/leave/requests/${id}/approve`, {});
    expect([again.status, again.body.code]).toEqual([403, 'HR_STEP']);
    expect((await att(kavya).post(`/leave/requests/${id}/approve`, {})).status).toBe(200);
    const r = await engineOf(id);
    expect(r?.steps.map((s) => `${s.order}:${s.status}:${s.decidedByUserId === ravi.userId ? 'ravi' : s.decidedByUserId === kavya.userId ? 'kavya' : ''}`)).toEqual(['1:APPROVED:ravi', '2:APPROVED:kavya']);
    expect((await leaveRow(id)).status).toBe('APPROVED');
  }, 60_000);

  it('a hand-on with nobody to hand it to leaves the step waiting: never approved on nobody’s decision, and one company’s failure does not stop the job', async () => {
    const c = await owner();
    const inC = <X>(fn: () => Promise<X>) => runInTenant(c.orgId, fn);
    const mo = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Mo Manager', code: 'M-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const me = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01', reportingManagerId: mo.id }).expect(201)).body.employee;
    await inC(async () => {
      await peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId } });
      await peoplePrisma.employee.update({ where: { id: mo.id }, data: { portalEnabled: true } });
      await peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, leaveOnEngine: true }, update: { leaveOnEngine: true } });
    });
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await request(app).put(`/api/orgs/${c.orgId}/attendance/leave/types/${type.id}`).set(at(c)).send({ name: 'Casual', annualDays: 12, approval: 'MANAGER', handOnAfterDays: 1 }).expect(200);
    const day = nextDay();
    const asked = (await request(app).post(`/api/orgs/${c.orgId}/attendance/me/leave`).set(at(c)).send({ leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Rest' }).expect(201)).body.request;
    await inC(() => peoplePrisma.leaveRequest.update({ where: { id: asked.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } }));
    await runLeaveHandOns(new Date());
    const r = await inC(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: c.orgId, sourceKind: 'LEAVE', sourceId: asked.id }, include: { steps: true } }));
    expect(r?.status).toBe('WAITING');
    expect(r?.steps.filter((s) => s.status === 'WAITING').map((s) => s.candidateUserIds)).toEqual([[`portal:${mo.id}`]]);
    expect((await inC(() => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: asked.id } }))).status).toBe('PENDING');
  }, 60_000);

  it('a leave on the engine shows once: not again as an HR approval in Workforce, the weekly summary, the person’s activity or the employee app’s updates', async () => {
    const { weeklySummaryFor } = await import('../services/people/weeklySummary.js');
    const { activityOf } = await import('../services/people/activity.js');
    const id = await ask({ name: 'priya', subject: 'priya', asker: () => priya }, 'HR', true);
    const r = await engineOf(id);
    const pending = JSON.stringify((await people(hr).get('/workforce/pending').expect(200)).body);
    expect(pending).not.toContain(r!.id);
    const summary = await inTenant(() => weeklySummaryFor(hr.accountId, hr.orgId));
    expect(summary.waiting.some((w: any) => w.kind === 'approval')).toBe(false);
    expect(JSON.stringify(await inTenant(() => activityOf({ orgId: hr.orgId, canStatutory: true, canNotes: true }, E.priya.id)))).not.toContain(r!.id);
    await att(kavya).post(`/leave/requests/${id}/approve`, {}).expect(200);
    await inTenant(() => peoplePrisma.portalSession.updateMany({ where: { orgId: hr.orgId }, data: { lastSeenAt: new Date() } }));
    expect(JSON.stringify((await portal(app_.priya).get('/updates').expect(200)).body)).not.toContain(r!.id);
  }, 60_000);

  it('the only one who could take HR’s step is the manager who took the first: approved on the one decision, written down (deliberate difference)', async () => {
    const c = await owner();
    const inC = <X>(fn: () => Promise<X>) => runInTenant(c.orgId, fn);
    const boss = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const ted = await colleague(c, 'Ted', MY);
    const tedE = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ted Staff', code: 'T-1', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
    await inC(async () => {
      await peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: c.userId } });
      await peoplePrisma.employee.update({ where: { id: tedE.id }, data: { userId: ted.userId } });
    });
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await request(app).put(`/api/orgs/${c.orgId}/attendance/leave/types/${type.id}`).set(at(c)).send({ name: 'Casual', annualDays: 12, approval: 'MANAGER_THEN_HR' }).expect(200);
    const setOn = (on: boolean) => inC(() => peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, leaveOnEngine: on }, update: { leaveOnEngine: on } }));
    const run = async (engine: boolean) => {
      await setOn(engine);
      const day = nextDay();
      const id = (await request(app).post(`/api/orgs/${c.orgId}/attendance/me/leave`).set(at(ted)).send({ leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Trip' }).expect(201)).body.request.id;
      await setOn(false);
      const first = await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests/${id}/approve`).set(at(c)).send({});
      const row = await inC(() => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));
      const out: any = { afterFirst: { status: row.status, stage: first.body.stage ?? null } };
      if (row.status === 'PENDING') {
        const second = await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests/${id}/approve`).set(at(c)).send({});
        out.second = { status: second.status, code: second.body.code };
      }
      const done = await inC(() => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));
      out.end = done.status;
      out.history = ((done.history as any[]) || []).map((h) => h.note).filter(Boolean);
      const r = await inC(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: c.orgId, sourceKind: 'LEAVE', sourceId: id }, include: { steps: { orderBy: { order: 'asc' } } } }));
      if (r) out.steps = r.steps.map((s) => `${s.order}:${s.status}`);
      return out;
    };
    const old = await run(false);
    const eng = await run(true);
    DIFFERENT['MANAGER_THEN_HR / the only HR is the manager'](old, eng);
  }, 60_000);

  it('approved at once (nobody else could) but the leave refuses it (a clock-in that day): it waits, as the old path left it, instead of failing the request', async () => {
    const c = await owner();
    const me = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(c.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId } });
      await peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, leaveOnEngine: true }, update: { leaveOnEngine: true } });
    });
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const day = nextDay();
    await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: me.id, date: day, status: 'PRESENT', checkIn: new Date(`${day}T04:00:00Z`), source: 'MANUAL', createdByUserId: c.userId } as any }));
    const asked = await request(app).post(`/api/orgs/${c.orgId}/attendance/me/leave`).set(at(c)).send({ leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Rest' });
    expect(asked.status).toBe(201);
    expect(asked.body.request.status).toBe('PENDING');
    const row = await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: asked.body.request.id } }));
    expect(JSON.stringify(row.history)).toContain('Not approved at once');
    expect(await runInTenant(c.orgId, () => peoplePrisma.approvalRequest.count({ where: { orgId: c.orgId, sourceKind: 'LEAVE' } }))).toBe(0);
  }, 60_000);

  it('the employee app: an HR approver decides there only when they may decide it now (a manager’s step is not theirs)', async () => {
    const id = await ask(SCENARIOS[0], 'MANAGER_THEN_HR', true);
    /* Ravi is the manager: his. */
    const notYet = await att(kavya).post(`/leave/requests/${id}/approve`, {});
    expect(notYet.body.code).toBe('MANAGER_FIRST');
    expect((await portal(app_.ravi).post(`/approvals/leave/${id}`, { decision: 'approve' })).body.stage).toBe('HR');
    /* HR's step: Ravi, in the app, is not HR here. */
    expect((await portal(app_.ravi).post(`/approvals/leave/${id}`, { decision: 'approve' })).status).toBe(409);
    await att(kavya).post(`/leave/requests/${id}/approve`, {}).expect(200);
  }, 60_000);
});

describe('leave on the approval engine: a one-person company', () => {
  it('the owner’s own leave: the old path waits for the owner to approve it themselves; the engine records it at once, written SELF_APPROVED (SPEC 5.6); STRICT refuses it', async () => {
    const c = await owner();
    const me = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId } }));
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const askOwn = async () => {
      const day = nextDay();
      return request(app).post(`/api/orgs/${c.orgId}/attendance/me/leave`).set(at(c)).send({ leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Rest' });
    };
    const old = (await askOwn()).body.request;
    expect(old.status).toBe('PENDING');
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests/${old.id}/approve`).set(at(c)).send({}).expect(200);
    await runInTenant(c.orgId, () => peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, leaveOnEngine: true }, update: { leaveOnEngine: true } }));
    const now = (await askOwn().then((r) => r.body)).request;
    expect(now.status).toBe('APPROVED');
    const r = await runInTenant(c.orgId, () => peoplePrisma.approvalRequest.findFirst({ where: { orgId: c.orgId, sourceKind: 'LEAVE', sourceId: now.id }, include: { steps: true } }));
    expect(r?.status).toBe('APPROVED');
    expect(r?.steps.map((s) => s.resolvedHow)).toEqual(['SELF_APPROVED']);
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entityId: r!.id, action: 'SELF_APPROVED' } });
    expect(audit?.message).toMatch(/Asha Owner|Asha/);
    await platformPrisma.authPolicy.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, makerChecker: 'STRICT', updatedByUserId: c.userId }, update: { makerChecker: 'STRICT' } });
    const strict = await askOwn();
    expect([strict.status, strict.body.code]).toEqual([409, 'NO_APPROVER']);
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.count({ where: { orgId: c.orgId } }))).toBe(2);
  }, 60_000);
});
