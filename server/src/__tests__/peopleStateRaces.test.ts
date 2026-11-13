import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People state machines under races (docs/state-machines.md): two things
 * happening to one record at the same moment leave one outcome, and a write
 * never lands over a state it did not read. Each case drives the two
 * operations with the second one held at the point the race opens: a lock
 * the test holds, or an approval effect the test keeps running. Each fails
 * on the code before the fix.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant, outsideTenant } = await import('../utils/tenantScope.js');
const engine = await import('../services/people/approvals/engine.js');
const { closeOutFor } = await import('../services/people/lifecycle/closeOut.js');
const { leaveEmployee } = await import('../services/people/lifecycle/leaving.js');
const { applyDueChanges } = await import('../services/people/effectiveDating.js');
const { rejectStatutory } = await import('../services/people/lifecycle/joiningStatutory.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.parse(`${todayIst()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `race.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Race Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, payroll: false, peopleHiring: true } }).expect(200);
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
  put: (path: string, body: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];
const inOrg = <T,>(fn: () => Promise<T>) => runInTenant(hr.orgId, fn);
const actor = () => ({ accountId: hr.accountId, orgId: hr.orgId, userId: hr.userId, source: 'FORM' as const, correlationId: `race_${rnd()}` });

/** Wait until another session is blocked on a lock whose waiting query mentions `text`. */
async function blockedOn(text: string, ms = 10_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows = await outsideTenant('test: who waits', () => peoplePrisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE ${`%${text}%`}`);
    if (rows[0]?.n) return;
    await sleep(50);
  }
  throw new Error(`nobody blocked on ${text}`);
}
/** Hold a transaction open until `release` is called; `run` does its work inside first. */
function holding(run: (tx: any) => Promise<void>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let ready!: () => void;
  const started = new Promise<void>((r) => { ready = r; });
  const done = inOrg(() => peoplePrisma.$transaction(async (tx) => {
    await run(tx);
    ready();
    await gate;
  }, { timeout: 60_000 }));
  return { started, release, done };
}

let hr: Ctx;
let ravi: Ctx;
let meena: Ctx;
let priya: Ctx;
let raviEmp: any;
const newPerson = async (name: string) => (await people(hr).post('/employees', { name, code: `R-${rnd()}`, reportingManagerId: raviEmp.id, dateOfJoining: '2025-01-06' }).expect(201)).body.employee;
const ask = async (c: Ctx, requestType: string, subject: any) =>
  (await people(c).post('/requests', { requestType, subjectEmployeeId: subject.id, title: `${requestType} ${rnd()}`, payload: { employeeId: subject.id } }).expect(201)).body.request;
const statusOf = (id: string) => inOrg(() => peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id }, include: { steps: true } }));
const withdrawnLines = (id: string) => inOrg(() => peoplePrisma.changeLog.count({ where: { entityId: id, field: 'status', after: 'WITHDRAWN' } as any }));

beforeAll(async () => {
  hr = await owner();
  ravi = await colleague(hr, 'Ravi', APPROVER);
  meena = await colleague(hr, 'Meena', APPROVER);
  priya = await colleague(hr, 'Priya', APPROVER);
  raviEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'R-1' }).expect(201)).body.employee;
  await inOrg(() => peoplePrisma.employee.update({ where: { id: raviEmp.id }, data: { userId: ravi.userId } }));
  await people(hr).post('/approval-rules', { name: 'Meena decides', requestType: 'DESK_ESCALATION', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }], due: { workingDays: 2 } }] }).expect(201);
  await people(hr).post('/approval-rules', { name: 'Meena decides', requestType: 'SEAT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }], due: { workingDays: 2 } }] }).expect(201);
  await people(hr).post('/approval-rules', { name: 'Both, then HR', requestType: 'DOCUMENT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'USER', id: priya.userId }], mode: 'ALL', due: { workingDays: 2 } }, { approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }] }).expect(201);
}, 180_000);

/* An approval effect the test keeps running until it lets go: the window in which the request is approved but not yet closed. */
let effectRuns = 0;
let effectGate: Promise<void> = Promise.resolve();
let effectEntered: () => void = () => {};
function holdNextEffect() {
  let release!: () => void;
  effectGate = new Promise<void>((r) => { release = r; });
  const entered = new Promise<void>((r) => { effectEntered = r; });
  return { entered, release };
}
beforeAll(() => {
  engine.onApproved('DESK_ESCALATION', async () => {
    effectRuns += 1;
    effectEntered();
    await effectGate;
    return { done: true };
  });
});

describe('approvals: one outcome', () => {
  it('a withdrawal while the final approval is being applied is refused; the request stays approved', async () => {
    const tara = await newPerson('Tara Singh');
    const r = await ask(ravi, 'DESK_ESCALATION', tara);
    const held = holdNextEffect();
    const runsBefore = effectRuns;
    const approving = people(meena).post(`/requests/${r.id}/approve`, {}).then((x) => x);
    await held.entered;
    const withdrawing = people(ravi).post(`/requests/${r.id}/withdraw`, {}).then((x) => x);
    await sleep(400);
    held.release();
    const [approved, withdrawn] = await Promise.all([approving, withdrawing]);
    expect(approved.status).toBe(200);
    expect(approved.body.request.status).toBe('APPROVED');
    /* Before: the withdrawal answered 200 "withdrawn" and the approval then wrote APPROVED over it. */
    expect(withdrawn.status).toBe(409);
    expect((await statusOf(r.id)).status).toBe('APPROVED');
    expect(await withdrawnLines(r.id)).toBe(0);
    expect(effectRuns - runsBefore).toBe(1);
  });

  it('a request whose every step is approved, not yet closed, cannot be withdrawn; it finishes as approved', async () => {
    const tara = await newPerson('Tina Rao');
    const r = await ask(ravi, 'DESK_ESCALATION', tara);
    /* The last approval committed and the process stopped before closing it. */
    await inOrg(() => peoplePrisma.approvalStep.updateMany({ where: { requestId: r.id, status: 'WAITING' }, data: { status: 'APPROVED', decidedByUserId: meena.userId, decidedAt: new Date(), approverUserId: meena.userId } }));
    await people(ravi).post(`/requests/${r.id}/withdraw`, {}).expect(409);
    effectGate = Promise.resolve();
    /* The recovery (read paths, the dues job) finishes it. */
    await inOrg(async () => engine.finishStalled([await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id }, include: { steps: true } }) as any]));
    expect((await statusOf(r.id)).status).toBe('APPROVED');
  });

  it('ALL step: an approval held behind an "ask for more" on the other part does not complete the step', async () => {
    const tara = await newPerson('Tanvi Das');
    const r = await ask(ravi, 'DOCUMENT_REQUEST', tara);
    const key = `approval-decide:${r.id}`;
    const meenaSlot = r.steps.find((s: any) => s.candidates.includes('Meena'));
    expect(meenaSlot).toBeTruthy();
    /* The test takes the decision lock and, while it holds it, asks for more on Meena's part, as Meena's request would. */
    const lock = holding(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    });
    await lock.started;
    const approving = people(priya).post(`/requests/${r.id}/approve`, {}).then((x) => x);
    await blockedOn('pg_advisory_xact_lock');
    await inOrg(async () => {
      await peoplePrisma.approvalStep.update({ where: { id: meenaSlot.id }, data: { status: 'MORE_INFO', decidedByUserId: meena.userId, decidedAt: new Date(), comment: 'Which document?' } });
      await peoplePrisma.approvalRequest.update({ where: { id: r.id }, data: { status: 'MORE_INFO' } });
    });
    lock.release();
    await lock.done;
    const res = await approving;
    /* Before: the approval claimed Priya's part, saw nothing waiting and opened HR's step under a request asking for more. */
    expect(res.status).toBe(409);
    const now = await statusOf(r.id);
    expect(now.status).toBe('MORE_INFO');
    expect(now.currentStep).toBe(1);
    expect(now.steps.filter((s) => s.order === 2)).toHaveLength(0);
    expect(now.steps.filter((s) => s.status === 'APPROVED')).toHaveLength(0);
  });
});

describe('a leaver closes what was open about them', () => {
  it('runs the module close hook for each request it withdraws', async () => {
    const closed: Array<{ id: string; status: string }> = [];
    engine.onClosed('SEAT_REQUEST', async (request, status) => { closed.push({ id: request.id, status }); });
    const tara = await newPerson('Tara Leaves');
    const r = await ask(ravi, 'SEAT_REQUEST', tara);
    const out = await inOrg(() => closeOutFor(actor(), tara.id));
    expect(out.withdrawn).toBe(1);
    expect((await statusOf(r.id)).status).toBe('WITHDRAWN');
    /* Before: the request was written WITHDRAWN by id and the module never heard (a shift swap stayed waiting). */
    expect(closed).toEqual([{ id: r.id, status: 'WITHDRAWN' }]);
  });

  it('leaves alone a request whose final approval is being applied', async () => {
    const tara = await newPerson('Tara Approved');
    const r = await ask(ravi, 'DESK_ESCALATION', tara);
    const held = holdNextEffect();
    const approving = people(meena).post(`/requests/${r.id}/approve`, {}).then((x) => x);
    await held.entered;
    const out = await inOrg(() => closeOutFor(actor(), tara.id));
    held.release();
    expect((await approving).body.request.status).toBe('APPROVED');
    expect(out.withdrawn).toBe(0);
    expect((await statusOf(r.id)).status).toBe('APPROVED');
    /* Before: the close-out wrote WITHDRAWN (and logged it) and the approval wrote APPROVED over it. */
    expect(await withdrawnLines(r.id)).toBe(0);
  });
});

describe('leaving', () => {
  it('a leaving decided on "on notice" is not written over a stay recorded since', async () => {
    const tara = await newPerson('Tara Stays');
    await people(hr).post(`/employees/${tara.id}/resign`, { lastDay: plus(10), leavingType: 'RESIGNED', reason: 'Moving' }).expect(200);
    const onNotice = await inOrg(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id: tara.id } }));
    expect(onNotice.status).toBe('ON_NOTICE');
    /* HR keeps her on; the separations job read her as on notice a moment before. */
    await people(hr).post(`/employees/${tara.id}/stay`, { reason: 'Stays after all' }).expect(200);
    const left = inOrg(() => leaveEmployee({ accountId: hr.accountId, orgId: hr.orgId, userId: null }, onNotice as any, { lastDay: plus(-1), leavingType: 'RESIGNED', reason: 'Moving' }));
    await expect(left).rejects.toMatchObject({ status: 409 });
    const now = await inOrg(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id: tara.id } }));
    expect(now.status).toBe('ACTIVE');
    expect(now.dateOfLeaving).toBeNull();
    expect(now.version).toBeGreaterThan(onNotice.version);
  });
});

describe('hiring', () => {
  const linkFor = async (to: string) => {
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: hr.orgId, templateKey: 'people.offer', toEmail: to }, orderBy: { createdAt: 'desc' } });
    return /\/api\/people\/offer\/([a-f0-9]{64})/.exec(mail?.bodyText || '')?.[1] || '';
  };
  let job: any;
  beforeAll(async () => {
    job = (await people(hr).post('/talent/openings', { title: 'Accountant', status: 'OPEN' }).expect(201)).body.opening;
  });

  it('rejecting a candidate withdraws their open offer; its link no longer accepts', async () => {
    const email = `meera.${rnd()}@example.com`;
    const cand = (await people(hr).post('/talent/candidates', { openingId: job.id, name: 'Meera K', email }).expect(201)).body.candidate;
    await people(hr).post('/offers', { candidateId: cand.id, designation: 'Accountant', annualCtc: 360000, signatory: 'Owner', lines: [] }).expect(201);
    const token = await linkFor(email);
    await people(hr).post(`/talent/candidates/${cand.id}/stage`, { stage: 'REJECTED', reason: 'Went with someone else' }).expect(200);
    expect((await people(hr).get(`/offers?candidateId=${cand.id}`).expect(200)).body.offers.map((o: any) => o.status)).toEqual(['WITHDRAWN']);
    await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(410);
    expect((await people(hr).get(`/talent/candidates/${cand.id}`).expect(200)).body.candidate.stage).toBe('REJECTED');
  });

  it('a candidate no longer in the running cannot accept an offer left open; the stage stays', async () => {
    const email = `arun.${rnd()}@example.com`;
    const cand = (await people(hr).post('/talent/candidates', { openingId: job.id, name: 'Arun P', email }).expect(201)).body.candidate;
    await people(hr).post('/offers', { candidateId: cand.id, designation: 'Accountant', annualCtc: 360000, signatory: 'Owner', lines: [] }).expect(201);
    const token = await linkFor(email);
    /* Withdrawn while the offer stayed open (a record from before offers closed with the candidate). */
    await inOrg(() => peoplePrisma.candidate.update({ where: { id: cand.id }, data: { stage: 'WITHDRAWN', closedReason: 'Took another job' } }));
    const res = await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(410);
    expect(res.body.error).toMatch(/no longer open/);
    expect((await people(hr).get(`/talent/candidates/${cand.id}`).expect(200)).body.candidate.stage).toBe('WITHDRAWN');
    expect((await people(hr).get(`/offers?candidateId=${cand.id}`).expect(200)).body.offers.map((o: any) => o.status)).toEqual(['WITHDRAWN']);
  });
});

describe('dated changes', () => {
  it('a claimed change is not marked applied until it is; an abandoned claim is taken again', async () => {
    const design = (await people(hr).post('/structure/departments', { name: `Design ${rnd()}` }).expect(201)).body.item;
    const security = (await people(hr).post('/structure/departments', { name: `Security ${rnd()}` }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Dev Shah', code: `D-${rnd()}`, departmentId: design.id, dateOfJoining: '2025-01-06' }).expect(201)).body.employee;
    await people(hr).put(`/employees/${e.id}`, { departmentId: security.id, effectiveFrom: '2099-12-01' }).expect(200);
    const change = await inOrg(() => peoplePrisma.scheduledChange.findFirstOrThrow({ where: { employeeId: e.id, status: 'PENDING' } }));

    /* The run is held at the employee write (a lock the test holds), as if it stopped there. */
    const lock = holding(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${e.id} FOR UPDATE`;
    });
    await lock.started;
    const run = applyDueChanges('2099-12-01', `run_race_${rnd()}`);
    await blockedOn('FOR UPDATE');
    const mid = await inOrg(() => peoplePrisma.scheduledChange.findUniqueOrThrow({ where: { id: change.id } }));
    const midEmployee = await inOrg(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }));
    lock.release();
    await lock.done;
    await run;
    expect(midEmployee.departmentId).toBe(design.id);
    /* Before: the row already said APPLIED while nothing was applied; a crash here lost the change. */
    expect(mid.status).not.toBe('APPLIED');
    const after = await inOrg(() => peoplePrisma.scheduledChange.findUniqueOrThrow({ where: { id: change.id } }));
    expect(after.status).toBe('APPLIED');
    expect((await inOrg(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }))).departmentId).toBe(security.id);

    /* A claim a stopped run left behind, half an hour old: the next run applies it. */
    await people(hr).put(`/employees/${e.id}`, { departmentId: design.id, effectiveFrom: '2099-12-02' }).expect(200);
    const second = await inOrg(() => peoplePrisma.scheduledChange.findFirstOrThrow({ where: { employeeId: e.id, status: 'PENDING' } }));
    await inOrg(() => peoplePrisma.scheduledChange.update({ where: { id: second.id }, data: { status: 'APPLYING', appliedAt: new Date(Date.now() - 60 * 60_000), appliedRunId: 'run_dead' } }));
    await applyDueChanges('2099-12-02', `run_race_${rnd()}`);
    expect((await inOrg(() => peoplePrisma.scheduledChange.findUniqueOrThrow({ where: { id: second.id } }))).status).toBe('APPLIED');
    expect((await inOrg(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }))).departmentId).toBe(design.id);
  });
});

describe('statutory details at joining', () => {
  it('a rejection held behind an approval that sent them to Payroll does not land', async () => {
    const e = await newPerson('Joiner One');
    const row = await inOrg(() => peoplePrisma.joinStatutory.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: e.id, inviteId: `inv_${rnd()}`, data: { pan: 'ABCDE1234F', nominees: [] } } }));
    /* The approval: claimed and applied under the row lock, committed after the rejection read it as SENT. */
    const approve = holding(async (tx) => {
      await tx.joinStatutory.update({ where: { id: row.id }, data: { status: 'APPLIED', decidedByUserId: hr.userId, decidedAt: new Date(), appliedAt: new Date() } });
    });
    await approve.started;
    const rejecting = inOrg(() => rejectStatutory(actor(), row.inviteId, 'Wrong PAN')).then(() => 'rejected', (err) => err);
    await blockedOn('JoinStatutory');
    approve.release();
    await approve.done;
    const out = await rejecting;
    /* Before: the rejection wrote REJECTED over details Payroll already had. */
    expect(out).toMatchObject({ status: 409 });
    expect((await inOrg(() => peoplePrisma.joinStatutory.findUniqueOrThrow({ where: { id: row.id } }))).status).toBe('APPLIED');
  });
});
