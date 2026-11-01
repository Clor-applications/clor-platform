import { writeFileSync } from 'node:fs';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Attendance on the approval engine (workflow engine 2d, SPEC section 9): parity with the old path.
 *
 * Each request kind (attendance requests, overtime, field punches) × each chain it can be under × each scenario is
 * run twice in one company, once with the company's switch off (the old path) and once on (the engine), and must give
 * the same people who may decide, the same state after the first decision, the same people after that, the same days
 * written and the same notices. "May decide" is measured, not assumed: every person tries to approve, in CLOR and in
 * the employee app, on a fresh request each time one succeeds. The differences are written down with the reason.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { todayIst, addDays } = await import('../utils/istDate.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const { timePresetRule } = await import('../services/people/approvals/presets.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
/* Everyone signed in here, signed in again before each test: the file runs longer than a sign-in lasts when the Mac is busy. */
const signedIn: Array<{ ctx: Ctx; email: string }> = [];
beforeEach(async () => {
  for (const s of signedIn) s.ctx.token = (await request(app).post('/api/auth/login').send({ email: s.email, password: 'Passw0rd!23' }).expect(200)).body.token;
});
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `ae.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Ae Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  c.userId = me.body.user.id;
  c.accountId = me.body.orgs.find((o: any) => o.orgId === c.orgId).accountId;
  signedIn.push({ ctx: c, email });
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  const ctx: Ctx = { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId };
  signedIn.push({ ctx, email });
  return ctx;
}
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const people = (c: Ctx) => ({
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const portal = (token: string) => ({
  get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
});

/* Whoever decides attendance today: attendance requests (approve), overtime (records, edit), field punches (devices, edit). */
const TIME_HR = [
  'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::CREATE', 'ATTENDANCE::Attendance Requests::APPROVE',
  'ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::EDIT', 'ATTENDANCE::Attendance Devices::VIEW', 'ATTENDANCE::Attendance Devices::EDIT',
  'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE', 'ATTENDANCE::Leave Requests::APPROVE',
  'PEOPLE::Employees::VIEW', 'ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE',
];
const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];

/* Days ahead for work from home: working days from a month ahead of today in India, never a Sunday, each used once. Days back for overtime. */
let ahead = addDays(todayIst(), 30);
const nextDay = () => {
  do ahead = addDays(ahead, 1);
  while (new Date(`${ahead}T12:00:00Z`).getUTCDay() === 0);
  return ahead;
};
let behind = addDays(todayIst(), -1);
const prevDay = () => {
  do behind = addDays(behind, -1);
  while (new Date(`${behind}T12:00:00Z`).getUTCDay() === 0);
  return behind;
};
const normalise = (t: string) => t.replace(/\d{1,2} [A-Z][a-z]{2} \d{4}/g, 'DATE').replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');

let hr: Ctx;
let kavya: Ctx;
let meena: Ctx;
let ravi: Ctx;
let priya: Ctx;
let tara: Ctx;
let om: Ctx;
let lone: Ctx;
const E: Record<string, any> = {};
const app_: Record<string, string> = {};
type Actor = { name: string; web?: Ctx; app?: string };
let ACTORS: Actor[] = [];
let names = new Map<string, string>();

const inTenant = <X>(fn: () => Promise<X>) => runInTenant(hr.orgId, fn);
const setSwitch = (on: boolean) => inTenant(() => peoplePrisma.peopleSetting.upsert({ where: { orgId: hr.orgId }, create: { accountId: hr.accountId, orgId: hr.orgId, attendanceOnEngine: on }, update: { attendanceOnEngine: on } }));
const CORRECTION_CHOICE: Record<string, string> = { HR: 'HR_OR_MANAGER', HR_ONLY: 'HR', MANAGER: 'MANAGER', MANAGER_THEN_HR: 'MANAGER_THEN_HR' };
const setCorrectionChain = (chain: string) => inTenant(() => peoplePrisma.peopleSetting.upsert({ where: { orgId: hr.orgId }, create: { accountId: hr.accountId, orgId: hr.orgId, correctionApproval: CORRECTION_CHOICE[chain] }, update: { correctionApproval: CORRECTION_CHOICE[chain] } }));
const setOvertimeChain = (chain: string) => inTenant(() => peoplePrisma.attendanceSettings.update({ where: { orgId: hr.orgId }, data: { overtimeApproval: chain } }));
const engineOf = (kind: string, id: string) => inTenant(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: hr.orgId, sourceKind: kind, sourceId: id }, include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } } }));

beforeAll(async () => {
  hr = await owner();
  kavya = await colleague(hr, 'Kavya', TIME_HR);
  meena = await colleague(hr, 'Meena', TIME_HR, true);
  ravi = await colleague(hr, 'Ravi', TIME_HR, true);
  priya = await colleague(hr, 'Priya', MY);
  tara = await colleague(hr, 'Tara', MY);
  om = await colleague(hr, 'Om', MY);
  lone = await colleague(hr, 'Lone', MY);
  const emp = async (body: Record<string, unknown>) => (await people(hr).post('/employees', { dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
  E.kavya = await emp({ name: 'Kavya Rao', code: 'A-1' });
  E.meena = await emp({ name: 'Meena Iyer', code: 'A-2' });
  E.ravi = await emp({ name: 'Ravi Kumar', code: 'A-3', reportingManagerId: E.meena.id });
  E.tara = await emp({ name: 'Tara Singh', code: 'A-4', reportingManagerId: E.ravi.id });
  E.priya = await emp({ name: 'Priya Nair', code: 'A-5' });
  E.nadia = await emp({ name: 'Nadia Khan', code: 'A-6' });
  E.om = await emp({ name: 'Om Prakash', code: 'A-7', reportingManagerId: E.nadia.id });
  E.lone = await emp({ name: 'Lone Wolf', code: 'A-8' });
  await inTenant(async () => {
    for (const [k, c] of Object.entries({ kavya, meena, ravi, priya, tara, om, lone })) await peoplePrisma.employee.update({ where: { id: E[k].id }, data: { userId: c.userId } });
    /* Phone punches from anywhere, recorded as outside a site: a field punch that waits for review. */
    await peoplePrisma.employee.updateMany({ where: { orgId: hr.orgId, id: { in: [E.tara.id, E.om.id, E.lone.id, E.ravi.id] } }, data: { mobilePunch: true, phonePunchMode: 'FIELD' } });
  });
  /* The employee app: Priya (a stand-in with no rights), Nadia (a manager with no CLOR sign-in), Ravi, and the people who ask. */
  const company = (await att(hr).get('/portal-access').expect(200)).body.company.code;
  for (const k of ['priya', 'nadia', 'ravi', 'tara', 'om', 'lone']) {
    const code = (await att(hr).post('/portal-access/codes', { employeeIds: [E[k].id] }).expect(200)).body.codes[0].activationCode;
    app_[k] = (await request(app).post('/api/portal/activate').send({ company, employeeCode: E[k].code, activationCode: code, password: 'app pass 123' }).expect(200)).body.token;
  }
  /* Under TEST_TODAY the clock moves but PostgreSQL's now() does not: the app sessions start at the test's own "now". */
  await inTenant(() => peoplePrisma.portalSession.updateMany({ where: { orgId: hr.orgId }, data: { createdAt: new Date(), lastSeenAt: new Date() } }));
  /* Work from home on, with no monthly limit, so every scenario can ask as often as it needs. */
  await inTenant(() => peoplePrisma.attendanceSettings.upsert({
    where: { orgId: hr.orgId },
    create: { accountId: hr.accountId, orgId: hr.orgId, requestRules: { WFH: { on: true, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 366, approval: null } } as any, updatedByUserId: hr.userId },
    update: { requestRules: { WFH: { on: true, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 366, approval: null } } as any },
  }));
  ACTORS = [
    { name: 'Asha (owner)', web: hr },
    { name: 'Kavya (HR)', web: kavya },
    { name: 'Meena (team)', web: meena },
    { name: 'Ravi (manager)', web: ravi, app: app_.ravi },
    { name: 'Priya (stand-in)', web: priya, app: app_.priya },
    { name: 'Nadia (app manager)', app: app_.nadia },
    { name: 'Tara', web: tara, app: app_.tara },
    { name: 'Om', web: om, app: app_.om },
  ];
  names = new Map([[hr.userId, 'Asha'], [kavya.userId, 'Kavya'], [meena.userId, 'Meena'], [ravi.userId, 'Ravi'], [priya.userId, 'Priya'], [tara.userId, 'Tara'], [om.userId, 'Om'], [lone.userId, 'Lone'], [`portal:${E.nadia.id}`, 'Nadia']]);
}, 240_000);

const ctxOf: Record<string, () => Ctx> = { tara: () => tara, om: () => om, lone: () => lone, ravi: () => ravi };

type Scenario = { name: string; subject: string; byHr?: boolean; before?: () => Promise<void>; after?: () => Promise<void> };
const standIn = { id: '' };
const SCENARIOS: Scenario[] = [
  { name: 'with a manager', subject: 'tara' },
  { name: 'no manager', subject: 'lone' },
  { name: 'manager in the employee app only', subject: 'om' },
  { name: 'entered by HR', subject: 'tara', byHr: true },
  { name: 'own request of an approver', subject: 'ravi' },
  {
    name: 'manager with a stand-in', subject: 'tara',
    before: async () => {
      standIn.id = (await att(hr).post('/leave/stand-ins', { managerEmployeeId: E.ravi.id, standInEmployeeId: E.priya.id, fromDate: todayIst(), toDate: addDays(todayIst(), 1) }).expect(201)).body.standIn.id;
    },
    after: async () => {
      await att(hr).del(`/leave/stand-ins/${standIn.id}`).expect(200);
    },
  },
];

async function noticesFor(prefix: string, id: string) {
  await deliverOutbox(new Date(), 5000);
  const rows = await inTenant(() => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, OR: [{ dedupeKey: { contains: id } }, { subjectKey: `${prefix}:${id}` }] }, orderBy: { createdAt: 'asc' } }));
  return rows.map((n) => `${names.get(n.userId) || n.userId} · ${n.kind} · ${normalise(n.title)}`).sort();
}

/** Who may approve now, measured: each person tries on a fresh request (`fresh` makes one and takes it as far as it should be). */
async function mayDecide(fresh: () => Promise<string>, tryApprove: (a: Actor, id: string) => Promise<{ ok: boolean; stage: string | null }>, drop: (id: string) => Promise<void>) {
  const may: string[] = [];
  let id = await fresh();
  for (const a of ACTORS) {
    if ((await tryApprove(a, id)).ok) {
      may.push(a.name);
      id = await fresh();
    }
  }
  await drop(id);
  return may;
}

type Kind = {
  source: string;
  notice: string;
  chains: string[];
  scenarios: Scenario[];
  setChain: (chain: string) => Promise<unknown>;
  ask: (sc: Scenario) => Promise<string>;
  tryApprove: (a: Actor, id: string) => Promise<{ ok: boolean; stage: string | null }>;
  status: (id: string) => Promise<{ status: string; managerStep: boolean }>;
  drop: (id: string) => Promise<void>;
  written: (id: string) => Promise<number>;
};

/* ------------------------------------------------------------------ the three kinds */

const ATTENDANCE: Kind = {
  source: 'ATTENDANCE', notice: 'attendance', chains: ['HR', 'HR_ONLY', 'MANAGER', 'MANAGER_THEN_HR'], scenarios: SCENARIOS,
  setChain: setCorrectionChain,
  ask: async (sc) => {
    const day = nextDay();
    const body = { kind: 'WFH', date: day, reason: 'Plumber at home' };
    const r = sc.byHr ? await att(kavya).post('/requests', { ...body, employeeId: E[sc.subject].id }) : await att(ctxOf[sc.subject]()).post('/me/requests', body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body.request || r.body).id as string;
  },
  tryApprove: async (a, id) => {
    if (a.web) {
      const r = await att(a.web).post(`/requests/${id}/approve`, {});
      if (r.status === 200) return { ok: true, stage: r.body.stage || null };
    }
    if (a.app) {
      const r = await portal(a.app).post(`/approvals/request/${id}`, { decision: 'approve' });
      if (r.status === 200) return { ok: true, stage: r.body.stage || null };
    }
    return { ok: false, stage: null };
  },
  status: async (id) => {
    const r = await inTenant(() => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id } }));
    return { status: r.status, managerStep: Boolean(r.managerApprovedAt) };
  },
  drop: async (id) => {
    const r = await inTenant(() => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id } }));
    if (r.status === 'PENDING' || r.status === 'APPROVED') await att(kavya).post(`/requests/${id}/cancel`, {}).expect(200);
  },
  written: (id) => inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, attendanceRequestId: id } })),
};

/** A past day with overtime recorded, then asked for in the employee app. */
async function askOvertimeFor(subject: string) {
  const day = prevDay();
  await inTenant(async () => {
    await peoplePrisma.attendanceRecord.deleteMany({ where: { orgId: hr.orgId, employeeId: E[subject].id, date: day } });
    await peoplePrisma.attendanceRecord.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: E[subject].id, date: day, status: 'PRESENT', source: 'MANUAL', workedMinutes: 600, overtimeMinutes: 90, createdByUserId: hr.userId } });
  });
  const r = await portal(app_[subject]).post('/overtime', { date: day, kind: 'OVERTIME', reason: 'Month-end stock count' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.request.id as string;
}

const OVERTIME: Kind = {
  source: 'OVERTIME', notice: 'overtime', chains: ['HR', 'MANAGER', 'MANAGER_THEN_HR'],
  scenarios: SCENARIOS.filter((s) => !s.byHr),
  setChain: setOvertimeChain,
  ask: (sc) => askOvertimeFor(sc.subject),
  tryApprove: async (a, id) => {
    if (a.web) {
      const one = await att(a.web).post(`/overtime/requests/${id}/approve`, {});
      if (one.status === 200) return { ok: true, stage: one.body.request?.status === 'PENDING' ? 'HR' : null };
      /* Several at once: here a manager with the right takes the manager's step. */
      const bulk = await att(a.web).post('/overtime/requests/bulk-review', { ids: [id], approve: true });
      if (bulk.status === 200 && bulk.body.done === 1) return { ok: true, stage: bulk.body.handedOn ? 'HR' : null };
    }
    if (a.app) {
      const r = await portal(a.app).post(`/approvals/overtime/${id}`, { decision: 'approve' });
      if (r.status === 200) return { ok: true, stage: r.body.stage || null };
    }
    return { ok: false, stage: null };
  },
  status: async (id) => {
    const r = await inTenant(() => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id } }));
    return { status: r.status, managerStep: Boolean(r.managerApprovedAt) };
  },
  drop: async (id) => {
    const r = await inTenant(() => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id } }));
    const subject = Object.keys(E).find((k) => E[k].id === r.employeeId)!;
    if (r.status === 'PENDING') await portal(app_[subject]).post(`/overtime/${id}/cancel`).expect(200);
  },
  written: async (id) => {
    const r = await inTenant(() => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id } }));
    return inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, employeeId: r.employeeId, date: r.date, overtimeApproved: true } }));
  },
};

/** A phone punch from outside every site: it waits for review. Punches a minute apart, so the earlier ones are moved back. */
async function fieldPunch(subject: string) {
  await inTenant(() => peoplePrisma.$executeRaw`UPDATE "DevicePunch" SET "at" = "at" - interval '5 minutes' WHERE "orgId" = ${hr.orgId} AND "employeeId" = ${E[subject].id}`);
  const r = await portal(app_[subject]).post('/punch', { latitude: 12.9716, longitude: 77.5946, accuracy: 20 });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const p = await inTenant(() => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: hr.orgId, employeeId: E[subject].id }, orderBy: { createdAt: 'desc' } }));
  return p.id;
}

const PUNCH: Kind = {
  source: 'FIELD_PUNCH', notice: 'punch', chains: ['HR'],
  scenarios: SCENARIOS.filter((s) => !s.byHr),
  setChain: async () => undefined,
  ask: (sc) => fieldPunch(sc.subject),
  tryApprove: async (a, id) => {
    if (a.web) {
      const r = await att(a.web).post(`/phone-punches/${id}/review`, { approve: true });
      if (r.status === 200) return { ok: true, stage: null };
    }
    if (a.app) {
      const r = await portal(a.app).post(`/approvals/punch/${id}`, { decision: 'approve' });
      if (r.status === 200) return { ok: true, stage: null };
    }
    return { ok: false, stage: null };
  },
  status: async (id) => {
    const r = await inTenant(() => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id } }));
    return { status: String(r.reviewStatus), managerStep: false };
  },
  /* A punch is never withdrawn: one left waiting is refused, as HR would. */
  drop: async (id) => {
    const r = await inTenant(() => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id } }));
    if (r.reviewStatus === 'PENDING') await att(kavya).post(`/phone-punches/${id}/review`, { approve: false }).expect(200);
  },
  written: async (id) => {
    const r = await inTenant(() => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id } }));
    return r.reviewStatus === 'APPROVED' ? 1 : 0;
  },
};

/** One chain × scenario on one path: who decides first, what the first decision leaves, who decides next, and how it ends. */
async function story(k: Kind, chain: string, sc: Scenario, engine: boolean) {
  await k.setChain(chain);
  await setSwitch(engine);
  try {
    const first = await mayDecide(() => k.ask(sc), k.tryApprove, k.drop);
    const firstActor = ACTORS.find((a) => a.name === first[0]);
    const out: Record<string, unknown> = { first };
    if (!firstActor) return out;
    const probe = await k.ask(sc);
    const took = await k.tryApprove(firstActor, probe);
    const row = await k.status(probe);
    out.afterFirst = { ...row, stage: took.stage };
    if (row.status === 'PENDING') {
      await k.drop(probe);
      out.next = await mayDecide(async () => {
        const x = await k.ask(sc);
        expect((await k.tryApprove(firstActor, x)).ok).toBe(true);
        return x;
      }, k.tryApprove, k.drop);
    }
    const nextActor = ACTORS.find((a) => a.name === ((out.next as string[] | undefined) || [])[0]);
    const id = await k.ask(sc);
    await k.tryApprove(firstActor, id);
    if (nextActor) await k.tryApprove(nextActor, id);
    out.end = { ...(await k.status(id)), written: await k.written(id) };
    out.notices = await noticesFor(k.notice, id);
    if (engine) {
      const r = await engineOf(k.source, id);
      out.engine = r ? { status: r.status, steps: r.steps.map((s) => `${s.order}:${s.status}`) } : null;
    }
    return out;
  } finally {
    await setSwitch(false);
  }
}

describe('attendance on the approval engine: parity with the old path', () => {
  const results: Record<string, { old: any; eng: any }> = {};
  /* ATTENDANCE_PARITY_OUT=<path>: the whole table, both paths side by side, for the PR. */
  afterAll(() => {
    if (process.env.ATTENDANCE_PARITY_OUT) writeFileSync(process.env.ATTENDANCE_PARITY_OUT, `${JSON.stringify(results, null, 1)}\n`);
  });

  for (const k of [ATTENDANCE, OVERTIME, PUNCH]) {
    for (const chain of k.chains) {
      for (const sc of k.scenarios) {
        it(`${k.source} / ${chain} / ${sc.name}`, async () => {
          await sc.before?.();
          try {
            const old = await story(k, chain, sc, false);
            const eng = await story(k, chain, sc, true);
            results[`${k.source} / ${chain} / ${sc.name}`] = { old, eng };
            const { engine: e, ...same } = eng;
            expect(same).toEqual(old);
            /* Each new one went on the engine, and ended as the row did. */
            expect(e).toBeTruthy();
            expect((e as any).status).toBe(({ APPROVED: 'APPROVED', PENDING: 'WAITING', REJECTED: 'REJECTED' } as Record<string, string>)[(eng.end as any)?.status] || (e as any).status);
            /* Nobody approves their own. */
            if (sc.subject === 'ravi') for (const s of [old, eng]) expect((s.first as string[]).includes('Ravi (manager)')).toBe(false);
          } finally {
            await sc.after?.();
          }
        }, 300_000);
      }
    }
  }
});

describe('attendance on the approval engine: what the old path refuses, the engine refuses the same way', () => {
  const sc = SCENARIOS[0];

  it('the manager, then HR: HR may reject but not approve while the manager decides; after the manager, HR’s step is not the manager’s nor a team-scoped approver’s', async () => {
    await setCorrectionChain('MANAGER_THEN_HR');
    for (const engine of [false, true]) {
      await setSwitch(engine);
      const b = await ATTENDANCE.ask(sc);
      const refused = await att(kavya).post(`/requests/${b}/approve`, {});
      expect([refused.status, refused.body.code]).toEqual([409, 'MANAGER_FIRST']);
      expect((await att(kavya).post(`/requests/${b}/reject`, { note: 'Not this week' })).status).toBe(200);
      expect((await ATTENDANCE.status(b)).status).toBe('REJECTED');
      if (engine) expect((await engineOf('ATTENDANCE', b))?.status).toBe('REJECTED');
      const c = await ATTENDANCE.ask(sc);
      expect((await att(ravi).post(`/requests/${c}/approve`, {})).body.stage).toBe('HR');
      for (const who of [ravi, meena]) {
        const r = await att(who).post(`/requests/${c}/approve`, {});
        expect([r.status, r.body.code]).toEqual([403, 'HR_STEP']);
        const x = await att(who).post(`/requests/${c}/reject`, { note: 'No' });
        expect([x.status, x.body.code]).toEqual([403, 'HR_STEP']);
      }
      expect((await att(kavya).post(`/requests/${c}/approve`, {})).status).toBe(200);
      expect((await ATTENDANCE.status(c)).status).toBe('APPROVED');
      if (engine) expect((await engineOf('ATTENDANCE', c))?.steps.map((s) => `${s.order}:${s.status}:${s.decidedByUserId === ravi.userId ? 'ravi' : s.decidedByUserId === kavya.userId ? 'kavya' : ''}`)).toEqual(['1:APPROVED:ravi', '2:APPROVED:kavya']);
      await setSwitch(false);
    }
  }, 180_000);

  it('HR only: a team-scoped approver and the manager in the app see it but cannot decide it; HR can', async () => {
    await setCorrectionChain('HR_ONLY');
    for (const engine of [false, true]) {
      await setSwitch(engine);
      const id = await ATTENDANCE.ask(sc);
      const m = await att(meena).post(`/requests/${id}/approve`, {});
      expect([m.status, m.body.code]).toEqual([403, 'HR_ONLY']);
      expect((await portal(app_.ravi).post(`/approvals/request/${id}`, { decision: 'approve' })).status).toBe(403);
      expect((await att(kavya).post(`/requests/${id}/approve`, {})).status).toBe(200);
      await setSwitch(false);
    }
  }, 120_000);

  it('overtime under the manager: HR may reject (the manager decides), not approve; the rejection closes its engine request', async () => {
    await setOvertimeChain('MANAGER');
    for (const engine of [false, true]) {
      await setSwitch(engine);
      const id = await askOvertimeFor('tara');
      const r = await att(kavya).post(`/overtime/requests/${id}/approve`, {});
      expect(r.status).toBe(409);
      expect((await att(kavya).post(`/overtime/requests/${id}/reject`, { note: 'Not agreed' })).status).toBe(200);
      expect((await OVERTIME.status(id)).status).toBe('REJECTED');
      if (engine) expect((await engineOf('OVERTIME', id))?.status).toBe('REJECTED');
      await setSwitch(false);
    }
  }, 120_000);

  it('a rejection without a reason is refused on both, and the request keeps waiting', async () => {
    await setCorrectionChain('HR');
    for (const engine of [false, true]) {
      await setSwitch(engine);
      const id = await ATTENDANCE.ask(sc);
      expect((await att(kavya).post(`/requests/${id}/reject`, {})).status).toBe(400);
      expect((await ATTENDANCE.status(id)).status).toBe('PENDING');
      if (engine) expect((await engineOf('ATTENDANCE', id))?.status).toBe('WAITING');
      await ATTENDANCE.drop(id);
      await setSwitch(false);
    }
  }, 120_000);
});

describe('attendance on the approval engine: switch, old requests, changes and races', () => {
  const sc = SCENARIOS[0];

  it('switch off: nothing is written to the engine; requests asked before the switch went on finish on the old path', async () => {
    await setCorrectionChain('MANAGER_THEN_HR');
    await setSwitch(false);
    const before = await ATTENDANCE.ask(sc);
    const ot = await askOvertimeFor('tara');
    const punch = await fieldPunch('tara');
    for (const [k, id] of [['ATTENDANCE', before], ['OVERTIME', ot], ['FIELD_PUNCH', punch]]) expect(await engineOf(k, id)).toBeNull();
    await setSwitch(true);
    expect((await att(ravi).post(`/requests/${before}/approve`, {})).body.stage).toBe('HR');
    expect((await att(kavya).post(`/requests/${before}/approve`, {})).status).toBe(200);
    expect((await ATTENDANCE.status(before)).status).toBe('APPROVED');
    expect(await engineOf('ATTENDANCE', before)).toBeNull();
    expect((await att(kavya).post(`/phone-punches/${punch}/review`, { approve: true })).status).toBe(200);
    expect(await engineOf('FIELD_PUNCH', punch)).toBeNull();
    await OVERTIME.drop(ot);
    await setSwitch(false);
  }, 120_000);

  it('withdrawn by the person, cancelled by HR, or overtime withdrawn in the app: the engine request closes to match', async () => {
    await setCorrectionChain('HR');
    await setOvertimeChain('HR');
    await setSwitch(true);
    const a = await ATTENDANCE.ask(sc);
    await att(tara).post(`/me/requests/${a}/cancel`, {}).expect(200);
    expect((await engineOf('ATTENDANCE', a))?.status).toBe('WITHDRAWN');
    const b = await ATTENDANCE.ask(sc);
    await att(kavya).post(`/requests/${b}/cancel`, {}).expect(200);
    expect((await engineOf('ATTENDANCE', b))?.status).toBe('WITHDRAWN');
    const o = await askOvertimeFor('tara');
    await portal(app_.tara).post(`/overtime/${o}/cancel`).expect(200);
    expect((await engineOf('OVERTIME', o))?.status).toBe('WITHDRAWN');
    await setSwitch(false);
  }, 120_000);

  it('changed while it waited: asked again from the first step under the manager, then HR; only the reason changed: nothing moves', async () => {
    await setCorrectionChain('MANAGER_THEN_HR');
    await setSwitch(true);
    const id = await ATTENDANCE.ask(sc);
    expect((await att(ravi).post(`/requests/${id}/approve`, {})).body.stage).toBe('HR');
    await att(tara).put(`/me/requests/${id}`, { kind: 'WFH', date: nextDay(), reason: 'Plumber at home' }).expect(200);
    const r = await engineOf('ATTENDANCE', id);
    expect(r?.currentStep).toBe(1);
    expect(r?.steps.filter((s) => s.status === 'WAITING').map((s) => s.order)).toEqual([1]);
    expect((await ATTENDANCE.status(id)).managerStep).toBe(false);
    const steps = r?.steps.length;
    const row = await inTenant(() => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id } }));
    await att(tara).put(`/me/requests/${id}`, { kind: 'WFH', date: row.date, reason: 'Plumber at home, all day' }).expect(200);
    expect((await engineOf('ATTENDANCE', id))?.steps.length).toBe(steps);
    await ATTENDANCE.drop(id);
    await setSwitch(false);
  }, 120_000);

  it('a rollback: an older API decides the request (engine request closes when next read), or writes the manager’s step (caught up: HR decides)', async () => {
    await setCorrectionChain('MANAGER_THEN_HR');
    await setSwitch(true);
    const a = await ATTENDANCE.ask(sc);
    await inTenant(() => peoplePrisma.attendanceRequest.update({ where: { id: a }, data: { status: 'APPROVED', reviewedByUserId: kavya.userId, reviewedAt: new Date() } }));
    await att(kavya).get(`/requests/${a}`).expect(200);
    expect((await engineOf('ATTENDANCE', a))?.status).toBe('APPROVED');
    const b = await ATTENDANCE.ask(sc);
    await inTenant(() => peoplePrisma.attendanceRequest.update({ where: { id: b }, data: { managerApprovedAt: new Date(), managerApprovedById: E.ravi.id } }));
    for (const who of [ravi, meena]) expect((await att(who).post(`/requests/${b}/approve`, {})).status).toBe(403);
    expect((await att(kavya).post(`/requests/${b}/approve`, {})).status).toBe(200);
    expect((await engineOf('ATTENDANCE', b))?.steps.map((s) => `${s.order}:${s.status}`)).toEqual(['1:APPROVED', '2:APPROVED']);
    const c = await ATTENDANCE.ask(sc);
    await inTenant(() => peoplePrisma.attendanceRequest.update({ where: { id: c }, data: { managerApprovedAt: new Date(), managerApprovedById: E.ravi.id } }));
    expect((await att(kavya).post(`/requests/${c}/reject`, { note: 'Busy week' })).status).toBe(200);
    expect((await ATTENDANCE.status(c)).status).toBe('REJECTED');
    expect((await engineOf('ATTENDANCE', c))?.status).toBe('REJECTED');
    await setSwitch(false);
  }, 120_000);

  it('two approvers at once: one decision, the day written once, one approved engine request', async () => {
    await setCorrectionChain('HR');
    await setSwitch(true);
    const id = await ATTENDANCE.ask(sc);
    const [x, y] = await Promise.all([att(kavya).post(`/requests/${id}/approve`, {}), att(hr).post(`/requests/${id}/approve`, {})]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await ATTENDANCE.written(id)).toBe(1);
    const r = await engineOf('ATTENDANCE', id);
    expect(r?.status).toBe('APPROVED');
    expect(r?.steps.filter((s) => s.status === 'APPROVED')).toHaveLength(1);
    await setSwitch(false);
  }, 120_000);

  it('the drawer shows the steps in plain words; the Approvals inbox and the app queue read the chain the request was asked under', async () => {
    await setCorrectionChain('MANAGER_THEN_HR');
    await setSwitch(true);
    const id = await ATTENDANCE.ask(sc);
    /* The company changes its choice while it waits: the request keeps "the manager, then HR". */
    await setCorrectionChain('HR_ONLY');
    expect((await portal(app_.ravi).get('/approvals').expect(200)).body.requests.map((r: any) => r.id)).toContain(id);
    expect((await att(ravi).post(`/requests/${id}/approve`, {})).body.stage).toBe('HR');
    const d = (await att(kavya).get(`/requests/${id}`).expect(200)).body;
    expect(d.chain).toBe('MANAGER_THEN_HR');
    expect(d.step.timeline.map((t: any) => `${t.order}:${t.status}`)).toEqual(['1:APPROVED', '2:WAITING']);
    expect(d.step.timeline[0].text).toBe('Ravi (manager) approved');
    expect(d.step.timeline[1].text).toMatch(/^Waiting for .*Kavya.* \(HR\)$/);
    expect(d.step.rule).toBe('Standard: the manager, then HR');
    expect((await att(kavya).post(`/requests/${id}/approve`, {})).status).toBe(200);
    await setSwitch(false);
  }, 120_000);

  it('presets: made once when several ask at once, one per company and type, never the main rule', async () => {
    const who = { accountId: hr.accountId, orgId: hr.orgId };
    await inTenant(() => Promise.all([timePresetRule(who, 'ATTENDANCE:WFH', 'MANAGER'), timePresetRule(who, 'ATTENDANCE:WFH', 'MANAGER'), timePresetRule(who, 'ATTENDANCE:WFH', 'MANAGER')]));
    const rows = await inTenant(() => peoplePrisma.approvalRule.findMany({ where: { orgId: hr.orgId, requestType: 'ATTENDANCE:WFH', active: true } }));
    expect(rows.filter((r) => r.variantKey === 'preset:MANAGER')).toHaveLength(1);
    expect(rows.every((r) => r.variantKey.startsWith('preset:'))).toBe(true);
    const other = await owner();
    expect(await runInTenant(other.orgId, () => peoplePrisma.approvalRule.count({ where: { orgId: other.orgId, requestType: 'ATTENDANCE:WFH' } }))).toBe(0);
  }, 60_000);
});

describe('attendance on the approval engine: a one-person company', () => {
  it('the owner’s own work from home and field punch: the old path waits for the owner to approve it; the engine records it at once, SELF_APPROVED (SPEC 5.6); STRICT refuses the request and leaves the punch waiting', async () => {
    const c = await owner();
    const inC = <X>(fn: () => Promise<X>) => runInTenant(c.orgId, fn);
    const me = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await inC(async () => {
      await peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId, mobilePunch: true, phonePunchMode: 'FIELD' } });
      await peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, requestRules: { WFH: { on: true, quotaPerMonth: null, backDays: 366 } } as any, updatedByUserId: c.userId }, update: { requestRules: { WFH: { on: true, quotaPerMonth: null, backDays: 366 } } as any } });
    });
    const askOwn = () => request(app).post(`/api/orgs/${c.orgId}/attendance/me/requests`).set(at(c)).send({ kind: 'WFH', date: nextDay(), reason: 'Working from home' });
    const punchOwn = async () => {
      await inC(() => peoplePrisma.$executeRaw`UPDATE "DevicePunch" SET "at" = "at" - interval '5 minutes' WHERE "orgId" = ${c.orgId}`);
      return request(app).post(`/api/orgs/${c.orgId}/attendance/me/punch`).set(at(c)).send({ latitude: 12.97, longitude: 77.59, accuracy: 20 });
    };
    const old = (await askOwn()).body.request;
    expect(old.status).toBe('PENDING');
    await request(app).post(`/api/orgs/${c.orgId}/attendance/requests/${old.id}/approve`).set(at(c)).send({}).expect(200);
    expect((await punchOwn()).body.review).toBe('PENDING');
    await inC(() => peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, attendanceOnEngine: true }, update: { attendanceOnEngine: true } }));
    const now = (await askOwn()).body.request;
    expect(now.status).toBe('APPROVED');
    const r = await inC(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: c.orgId, sourceKind: 'ATTENDANCE', sourceId: now.id }, include: { steps: true } }));
    expect(r?.status).toBe('APPROVED');
    expect(r?.steps.map((s) => s.resolvedHow)).toEqual(['SELF_APPROVED']);
    expect(await inC(() => peoplePrisma.attendanceRecord.count({ where: { orgId: c.orgId, attendanceRequestId: now.id } }))).toBe(1);
    const punched = await punchOwn();
    expect(punched.body.review).toBe('APPROVED');
    await platformPrisma.authPolicy.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, makerChecker: 'STRICT', updatedByUserId: c.userId }, update: { makerChecker: 'STRICT' } });
    const strict = await askOwn();
    expect([strict.status, strict.body.code]).toEqual([409, 'NO_APPROVER']);
    expect(await inC(() => peoplePrisma.attendanceRequest.count({ where: { orgId: c.orgId } }))).toBe(2);
    /* A punch is never refused for want of an approver: it waits, as on the old path. */
    expect((await punchOwn()).body.review).toBe('PENDING');
  }, 90_000);

  it('the owner’s own overtime on a closed month: the approval at once is refused by the month, and nothing of it stays (review of PR #105, blocker 2)', async () => {
    const c = await owner();
    const inC = <X>(fn: () => Promise<X>) => runInTenant(c.orgId, fn);
    const me = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await inC(() => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: c.userId } }));
    const company = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
    const code = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [me.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company, employeeCode: 'O-1', activationCode: code, password: 'app pass 123' }).expect(200)).body.token;
    await inC(() => peoplePrisma.portalSession.updateMany({ where: { orgId: c.orgId }, data: { createdAt: new Date(), lastSeenAt: new Date() } }));
    const day = addDays(todayIst(), -40);
    await inC(async () => {
      await peoplePrisma.attendanceRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: me.id, date: day, status: 'PRESENT', source: 'MANUAL', workedMinutes: 600, overtimeMinutes: 90, createdByUserId: c.userId } });
      await peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month: day.slice(0, 7), lockedByUserId: c.userId } });
      await peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, attendanceOnEngine: true }, update: { attendanceOnEngine: true } });
    });
    const asked = await request(app).post('/api/portal/overtime').set('Authorization', `Bearer ${token}`).send({ date: day, kind: 'OVERTIME', reason: 'Year-end count' });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    const row = await inC(() => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id: asked.body.request.id } }));
    /* It waits on the old path, as it would have: not approved, the day not marked, no engine request half made. */
    expect([row.status, row.reviewedByUserId]).toEqual(['PENDING', null]);
    expect((await inC(() => peoplePrisma.attendanceRecord.findFirstOrThrow({ where: { orgId: c.orgId, employeeId: me.id, date: day } }))).overtimeApproved).toBe(false);
    expect(await inC(() => peoplePrisma.approvalRequest.count({ where: { orgId: c.orgId } }))).toBe(0);
  }, 90_000);

  it('the manager, then HR, where the only one who could take HR’s step is the manager: the old path waits for ever; the engine skips HR’s step and approves on one decision, and the history says so (SPEC section 9, item 5)', async () => {
    const c = await owner();
    const inC = <X>(fn: () => Promise<X>) => runInTenant(c.orgId, fn);
    const boss = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Owner', code: 'O-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const bo = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Bo Das', code: 'O-2', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
    await inC(async () => {
      await peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: c.userId } });
      await peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, requestRules: { WFH: { on: true, quotaPerMonth: null, backDays: 366 } } as any, updatedByUserId: c.userId }, update: { requestRules: { WFH: { on: true, quotaPerMonth: null, backDays: 366 } } as any } });
      await peoplePrisma.peopleSetting.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, correctionApproval: 'MANAGER_THEN_HR' }, update: { correctionApproval: 'MANAGER_THEN_HR' } });
    });
    const story = async (on: boolean) => {
      await inC(() => peoplePrisma.peopleSetting.update({ where: { orgId: c.orgId }, data: { attendanceOnEngine: on } }));
      const id = (await request(app).post(`/api/orgs/${c.orgId}/attendance/requests`).set(at(c)).send({ employeeId: bo.id, kind: 'WFH', date: nextDay(), reason: 'Plumber' }).expect(201)).body.request.id;
      const first = await request(app).post(`/api/orgs/${c.orgId}/attendance/requests/${id}/approve`).set(at(c)).send({});
      const second = await request(app).post(`/api/orgs/${c.orgId}/attendance/requests/${id}/approve`).set(at(c)).send({});
      const row = await inC(() => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id } }));
      const eng = await inC(() => peoplePrisma.approvalRequest.findFirst({ where: { orgId: c.orgId, sourceKind: 'ATTENDANCE', sourceId: id }, include: { steps: { orderBy: [{ order: 'asc' }] } } }));
      return { first: [first.status, first.body.stage || null], second: [second.status, second.body.code || null], end: row.status, steps: eng?.steps.map((s) => `${s.order}:${s.status}`) || null, history: (row.history as any[]).map((h) => h.note).filter(Boolean) };
    };
    const old = await story(false);
    expect(old).toMatchObject({ first: [200, 'HR'], second: [403, 'HR_STEP'], end: 'PENDING', steps: null });
    const eng = await story(true);
    expect(eng).toMatchObject({ first: [200, null], second: [409, null], end: 'APPROVED', steps: ['1:APPROVED', '2:SKIPPED'] });
    expect(eng.history).toContain('HR step skipped: nobody else can approve');
  }, 90_000);
});

describe('attendance on the approval engine: review of PR #105', () => {
  const sc = SCENARIOS[0];

  it('a team-scoped holder decides overtime and field punches only for their team, and the steps name only real deciders (blocker 1)', async () => {
    await setOvertimeChain('HR');
    await setSwitch(true);
    const ot = await askOvertimeFor('om');
    const punch = await fieldPunch('om');
    for (const [kind, id, tryIt] of [
      ['OVERTIME', ot, (who: Ctx) => att(who).post(`/overtime/requests/${ot}/approve`, {})],
      ['FIELD_PUNCH', punch, (who: Ctx) => att(who).post(`/phone-punches/${punch}/review`, { approve: true })],
    ] as const) {
      const step = (await engineOf(kind, id))!.steps.find((s) => s.status === 'WAITING')!;
      const people = (step.candidateUserIds as string[]).map((u) => names.get(u) || u);
      /* Om is in neither Meena's nor Ravi's team: they are not his deciders, and cannot decide it. */
      expect(people).not.toContain('Meena');
      expect(people).not.toContain('Ravi');
      expect(people).toEqual(expect.arrayContaining(['Asha', 'Kavya']));
      for (const who of [meena, ravi]) expect((await tryIt(who)).status).toBe(404);
      expect((await tryIt(kavya)).status).toBe(200);
    }
    await setSwitch(false);
  }, 120_000);

  it('maker-checker ALLOW: someone may approve their own request, as today, on both paths (kept for parity; owner question in the PR)', async () => {
    await setCorrectionChain('HR');
    await platformPrisma.authPolicy.upsert({ where: { orgId: hr.orgId }, create: { accountId: hr.accountId, orgId: hr.orgId, makerChecker: 'ALLOW', updatedByUserId: hr.userId }, update: { makerChecker: 'ALLOW' } });
    try {
      for (const engine of [false, true]) {
        await setSwitch(engine);
        const id = await ATTENDANCE.ask({ name: 'own', subject: 'ravi' });
        expect((await att(ravi).post(`/requests/${id}/approve`, {})).status).toBe(200);
        expect((await ATTENDANCE.status(id)).status).toBe('APPROVED');
        if (engine) expect((await engineOf('ATTENDANCE', id))?.status).toBe('APPROVED');
        await setSwitch(false);
      }
    } finally {
      await platformPrisma.authPolicy.update({ where: { orgId: hr.orgId }, data: { makerChecker: 'AUTO' } });
    }
    expect(sc.subject).toBe('tara');
  }, 120_000);
});
