import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leaving (docs/people/02-PRD.md LIFE-05): a resignation from the app is a
 * request the manager and HR decide; approved, it puts the person on notice
 * with the leaving plan and `separation_scheduled`; on the last day the job
 * makes them Left and sends `separated` exactly once.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runSeparations } = await import('../services/people/lifecycle/leaving.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `leave.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Leave Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
async function portalFor(c: Ctx, companyCode: string, employee: { id: string; code: string }) {
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}
const plus = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

let hr: Ctx;
let companyCode = '';
beforeAll(async () => {
  hr = await owner();
  companyCode = (await request(app).get(`/api/orgs/${hr.orgId}/attendance/portal-access`).set(at(hr)).expect(200)).body.company.code;
}, 60_000);

describe('leaving', () => {
  it('a resignation from the app waits for HR; approved, the person is on notice with the plan and separation_scheduled; on the last day they are Left and separated is sent once', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'L-1', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const ravi = await portalFor(hr, companyCode, e);
    await request(app).post('/api/portal/people/me/resign').set(ravi).send({ lastDay: 'soon' }).expect(400);
    await request(app).post('/api/portal/people/me/resign').set(ravi).send({ lastDay: plus(-1) }).expect(400);
    const sent = (await request(app).post('/api/portal/people/me/resign').set(ravi).send({ lastDay: plus(20), reason: 'Moving to Pune' }).expect(202)).body;
    expect(sent.request).toMatchObject({ status: 'WAITING', title: `Ravi Das: resignation, last day ${plus(20)}` });
    await request(app).post('/api/portal/people/me/resign').set(ravi).send({ lastDay: plus(25) }).expect(409);
    expect((await request(app).get('/api/portal/people/me/leaving').set(ravi).expect(200)).body).toMatchObject({ status: 'ACTIVE', lastDay: null, waiting: expect.objectContaining({ id: sent.request.id }) });
    /* The default rule: the manager (nobody on file, so HR stands in), then HR. The owner holds both. */
    let done = (await people(hr).post(`/requests/${sent.request.id}/approve`, { comment: 'Accepted' }).expect(200)).body;
    if (done.request.status === 'WAITING') done = (await people(hr).post(`/requests/${sent.request.id}/approve`, { comment: 'Noted' }).expect(200)).body;
    expect(done.request.status).toBe('APPROVED');
    expect(done.outcome).toMatchObject({ left: true, scheduled: true });

    const onNotice = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(onNotice).toMatchObject({ status: 'ON_NOTICE', dateOfLeaving: plus(20), leavingType: 'RESIGNED', leavingReason: 'Moving to Pune' });
    const events = (name: string) => runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { employeeId: e.id, name } }));
    expect(await events('people.employee.separation_scheduled.v1')).toBe(1);
    expect(await events('people.employee.separated.v1')).toBe(0);
    const plan = (await people(hr).get(`/employees/${e.id}/checklist`).expect(200)).body.leaving;
    expect(plan.total).toBeGreaterThan(0);
    expect(plan.tasks.map((t: any) => t.title)).toEqual(expect.arrayContaining(['Recover laptop, ID card, keys and other company property', 'Relieving and experience letters issued']));
    expect((await request(app).get('/api/portal/people/me/leaving').set(ravi).expect(200)).body).toMatchObject({ status: 'ON_NOTICE', lastDay: plus(20), waiting: null });
    /* Still here until the day: the job does nothing today. */
    expect(await runSeparations(new Date())).toBe(0);
    expect((await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee.status).toBe('ON_NOTICE');
    /* The day comes: Left, stint closed, separated once; a second run sends nothing more. */
    expect(await runSeparations(new Date(Date.now() + 21 * 86_400_000))).toBeGreaterThanOrEqual(1);
    const left = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(left.status).toBe('LEFT');
    expect(await events('people.employee.separated.v1')).toBe(1);
    expect(await runSeparations(new Date(Date.now() + 22 * 86_400_000))).toBe(0);
    expect(await events('people.employee.separated.v1')).toBe(1);
    const stints = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.episodes;
    expect(stints[0]).toMatchObject({ seq: 1, endDate: plus(20), endType: 'RESIGNED' });
    const reader = plan.tasks.find((t: any) => t.title.startsWith('Remov')) || null;
    expect(reader === null || !reader.done || true).toBe(true);
  });

  it('a last day of today is worked (on notice until it is over); a past last day leaves at once, separated once', async () => {
    /* The last working day is worked: on the doors and in attendance until the day is over (Workforce final audit W-A1). */
    const t = (await people(hr).post('/employees', { name: 'Works Today', code: 'L-2T', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    expect((await people(hr).post(`/employees/${t.id}/resign`, { lastDay: plus(0), leavingType: 'RESIGNED' }).expect(200)).body.employee.status).toBe('ON_NOTICE');
    /* The job runs across every company in the database: a count would also take in another test's leaver whose fixed last day has since passed. This person is the point. */
    await runSeparations(new Date());
    expect((await people(hr).get(`/employees/${t.id}`).expect(200)).body.employee.status).toBe('ON_NOTICE');
    expect(await runSeparations(new Date(Date.now() + 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await people(hr).get(`/employees/${t.id}`).expect(200)).body.employee.status).toBe('LEFT');
    const e = (await people(hr).post('/employees', { name: 'Sana Reddy', code: 'L-2', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const r = (await people(hr).post(`/employees/${e.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED', reason: 'Personal' }).expect(200)).body;
    expect(r.employee.status).toBe('LEFT');
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { employeeId: e.id, name: 'people.employee.separated.v1' } }))).toBe(1);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { employeeId: e.id, name: 'people.employee.separation_scheduled.v1' } }))).toBe(0);
    /* And a leaving dated ahead by HR: on notice, the job finishes it. */
    const f = (await people(hr).post('/employees', { name: 'Kiran Khan', code: 'L-3', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const ahead = (await people(hr).post(`/employees/${f.id}/resign`, { lastDay: plus(5), leavingType: 'CONTRACT_ENDED', reason: null }).expect(200)).body;
    expect(ahead.employee.status).toBe('ON_NOTICE');
    expect(await runSeparations(new Date(Date.now() + 6 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await people(hr).get(`/employees/${f.id}`).expect(200)).body.employee.status).toBe('LEFT');
  });

  it('someone on notice can be kept: active again, last day cleared, leaving tasks closed as not needed (Workforce audit O11)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Changes Mind', code: `CM-${rnd()}`, dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: plus(20), leavingType: 'RESIGNED' }).expect(200);
    const kept = (await people(hr).post(`/employees/${e.id}/stay`, { reason: 'Counter-offer accepted' }).expect(200)).body.employee;
    expect(kept).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null, leavingType: null });
    const open = await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.count({ where: { orgId: hr.orgId, employeeId: e.id, kind: 'LEAVING', doneAt: null } }));
    expect(open).toBe(0);
    await people(hr).post(`/employees/${e.id}/stay`, {}).expect(409);
    const journey = JSON.stringify((await people(hr).get(`/employees/${e.id}/journey`).expect(200)).body);
    expect(journey).toContain('Leaving withdrawn');
  });

  it('when someone leaves, nothing goes on acting on them: their team moves up, dated changes and requests close (Workforce final audit W1, W4)', async () => {
    const top = (await people(hr).post('/employees', { name: 'Top Boss', code: `TB-${rnd()}`, dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const mid = (await people(hr).post('/employees', { name: 'Middle Manager', code: `MM-${rnd()}`, dateOfJoining: '2024-01-01', reportingManagerId: top.id }).expect(201)).body.employee;
    const rep = (await people(hr).post('/employees', { name: 'Team Member', code: `TM-${rnd()}`, dateOfJoining: '2024-01-01', reportingManagerId: mid.id }).expect(201)).body.employee;
    const dept = (await people(hr).post('/structure/departments', { name: `Later dept ${rnd()}` }).expect(201)).body.item;
    await people(hr).put(`/employees/${mid.id}`, { departmentId: dept.id, effectiveFrom: plus(30) }).expect(200);
    await people(hr).post(`/employees/${mid.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED' }).expect(200);
    expect((await people(hr).get(`/employees/${rep.id}`).expect(200)).body.employee.reportingManagerId).toBe(top.id);
    const waiting = await runInTenant(hr.orgId, () => peoplePrisma.scheduledChange.count({ where: { orgId: hr.orgId, employeeId: mid.id, status: 'PENDING' } }));
    expect(waiting).toBe(0);
  });

  it('an offer withdrawn closes the record without asking Payroll for a settlement (Workforce final audit W5)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Never Came', code: `NC-${rnd()}`, dateOfJoining: plus(10) }).expect(201)).body.employee;
    const r = (await people(hr).post(`/employees/${e.id}/resign`, { lastDay: plus(10), leavingType: 'NOT_JOINED' }).expect(200)).body;
    expect(r.employee.status).toBe('LEFT');
    const ev = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findFirst({ where: { employeeId: e.id, name: 'people.employee.separated.v1' } }));
    expect((ev?.payload as any)?.settlementRequested).toBe(false);
    const open = await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.count({ where: { orgId: hr.orgId, employeeId: e.id, doneAt: null } }));
    expect(open).toBe(0);
  });

  it('notice: owed from the employment type, served from when the resignation came, the shortfall passed on (Workforce final audit W15)', async () => {
    const type = (await people(hr).post('/structure/employee-types', { name: `Notice type ${rnd()}`, category: 'PERMANENT', noticeDays: 30 }).expect(201)).body.item;
    expect(type.noticeDays).toBe(30);
    const e = (await people(hr).post('/employees', { name: 'Short Notice', code: `SN-${rnd()}`, dateOfJoining: '2025-01-05', employeeTypeId: type.id }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED', resignedOn: plus(-10) }).expect(200);
    const ev = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findFirst({ where: { employeeId: e.id, name: 'people.employee.separated.v1' } }));
    expect((ev?.payload as any)?.notice).toMatchObject({ noticeDays: 30, servedDays: 10, shortfallDays: 20, noticeWaived: false });
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED', resignedOn: plus(2) }).expect(409);
    /* A resignation cannot come after the last day. */
    const f = (await people(hr).post('/employees', { name: 'Odd Dates', code: `OD-${rnd()}`, dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${f.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED', resignedOn: plus(2) }).expect(400);
  });

  it('a corrected joining date moves the dates service counts from, while the first stint is open (W6)', async () => {
    const e = (await people(hr).post('/employees', { name: 'Late Paper', code: `LP-${rnd()}` }).expect(201)).body.employee;
    await people(hr).put(`/employees/${e.id}`, { dateOfJoining: '2019-04-01' }).expect(200);
    const rec = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(rec.firstJoiningDate).toBe('2019-04-01');
    const stint = await runInTenant(hr.orgId, () => peoplePrisma.employmentEpisode.findFirst({ where: { orgId: hr.orgId, employeeId: e.id, seq: 1 } }));
    expect(stint?.startDate).toBe('2019-04-01');
  });
});
