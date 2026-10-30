import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Shift swaps (FEATURE-UI-AUDIT gap 24): a person asks a named colleague on
 * another shift to swap days; the colleague accepts or declines; the manager
 * approves in the one Approvals inbox; both schedules change. Refused when a
 * day is not a working day for either, the shifts are the same, the rest rule
 * breaks, or another swap is open on those days; withdrawn before approval;
 * one of two racing swaps wins.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { shiftFor } = await import('../services/attendance/days.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `swap.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Swap Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/* A Tuesday a few weeks ahead, so the days are to come and working days on a Sunday-off shift. */
const tuesday = (() => {
  let d = plus(istToday(), 21);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 2) d = plus(d, 1);
  return d;
})();

async function portalOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
  const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal/people${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal/people${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
}
const shiftOn = (c: Ctx, employeeId: string, date: string) => runInTenant(c.orgId, async () => (await shiftFor(c.orgId, employeeId, date)).shiftId);

describe('shift swaps', () => {
  let c: Ctx;
  let mgr: Ctx;
  let mgrEmp: any;
  let asha: any, ravi: any, sunil: any, priya: any;
  let A: Awaited<ReturnType<typeof portalOf>>, R: Awaited<ReturnType<typeof portalOf>>, S: Awaited<ReturnType<typeof portalOf>>, P: Awaited<ReturnType<typeof portalOf>>;
  let morning: any, evening: any, night: any;

  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Meera Lead');
    mgrEmp = await person(c, { name: 'Meera Lead', code: 'M1', workEmail: mgr.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: mgrEmp.id }, data: { userId: mgr.userId } }));
    asha = await person(c, { name: 'Asha Rao', code: 'E1', reportingManagerId: mgrEmp.id });
    ravi = await person(c, { name: 'Ravi Kumar', code: 'E2', reportingManagerId: mgrEmp.id });
    sunil = await person(c, { name: 'Sunil Das', code: 'E3', reportingManagerId: mgrEmp.id });
    priya = await person(c, { name: 'Priya Nair', code: 'E4', reportingManagerId: mgrEmp.id });
    morning = (await att(c, 'post', '/shifts', { name: `Morning ${rnd()}`, startTime: '06:00', endTime: '14:00' }).expect(201)).body.shift;
    evening = (await att(c, 'post', '/shifts', { name: `Evening ${rnd()}`, startTime: '14:00', endTime: '22:00' }).expect(201)).body.shift;
    night = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00' }).expect(201)).body.shift;
    await att(c, 'post', '/shift-assignments', { employeeIds: [asha.id, priya.id], shiftId: morning.id, effectiveFrom: '2026-01-01' }).expect(200);
    await att(c, 'post', '/shift-assignments', { employeeIds: [ravi.id], shiftId: evening.id, effectiveFrom: '2026-01-01' }).expect(200);
    await att(c, 'post', '/shift-assignments', { employeeIds: [sunil.id], shiftId: night.id, effectiveFrom: '2026-01-01' }).expect(200);
    [A, R, S, P] = await Promise.all([portalOf(c, asha), portalOf(c, ravi), portalOf(c, sunil), portalOf(c, priya)]);
  }, 120_000);

  it('offers only colleagues on another shift, inside the rest rule', async () => {
    const list = (await A.get(`/swaps/colleagues?from=${tuesday}&to=${plus(tuesday, 1)}`).expect(200)).body.colleagues;
    const ids = list.map((x: any) => x.employeeId);
    expect(ids).toContain(ravi.id);
    /* Priya works the same shift; Sunil's night ends at six, when Asha's morning starts: no rest at all. */
    expect(ids).not.toContain(priya.id);
    expect(ids).not.toContain(sunil.id);
    expect(list.find((x: any) => x.employeeId === ravi.id).days).toHaveLength(2);
    /* Nothing about anyone beyond their name and those shifts. */
    expect(Object.keys(list[0]).sort()).toEqual(['code', 'days', 'employeeId', 'name']);
  });

  it('refuses what cannot be swapped, in plain words', async () => {
    expect((await A.post('/swaps', { colleagueEmployeeId: priya.id, fromDate: tuesday }).expect(409)).body.code).toBe('SAME_SHIFT');
    expect((await A.post('/swaps', { colleagueEmployeeId: sunil.id, fromDate: tuesday }).expect(409)).body.code).toBe('REST_RULE');
    expect((await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: istToday() }).expect(400)).body.error).toMatch(/still to come/);
    expect((await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: tuesday, toDate: plus(tuesday, 9) }).expect(400)).body.error).toMatch(/7 days/);
    expect((await A.post('/swaps', { colleagueEmployeeId: asha.id, fromDate: tuesday }).expect(400)).body.error).toMatch(/someone else/);
    /* A Sunday is a weekly off on these shifts. */
    let sunday = tuesday;
    while (new Date(`${sunday}T00:00:00Z`).getUTCDay() !== 0) sunday = plus(sunday, 1);
    expect((await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: sunday }).expect(409)).body.code).toBe('NOT_WORKING');
  });

  it('asked, accepted, approved by the manager in Approvals: both schedules change', async () => {
    const day = plus(tuesday, 7);
    const asked = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day, toDate: plus(day, 1), reason: 'Exam on Wednesday morning' }).expect(201)).body.swap;
    expect(asked.status).toBe('ASKED');
    expect(asked.days[0].requesterShift.id).toBe(morning.id);
    /* Only the colleague answers. */
    await P.post(`/swaps/${asked.id}/accept`).expect(404);
    await A.post(`/swaps/${asked.id}/accept`).expect(404);
    const mineR = (await R.get('/swaps').expect(200)).body;
    expect(mineR.askedOfMe.map((s: any) => s.id)).toContain(asked.id);
    const accepted = (await R.post(`/swaps/${asked.id}/accept`, { note: 'Fine by me' }).expect(200)).body.swap;
    expect(accepted.status).toBe('WAITING');
    /* Answered once only. */
    expect((await R.post(`/swaps/${asked.id}/decline`, { note: 'changed my mind' }).expect(409)).body.code).toBe('NOT_ASKED');
    /* In the manager's one inbox, with its dates. */
    const inbox = (await ppl(mgr, 'get', '/inbox').expect(200)).body.items;
    const item = inbox.find((i: any) => i.kind === 'APPROVAL' && i.subKind === 'SHIFT_SWAP');
    expect(item).toBeTruthy();
    expect(item.fromDate).toBe(day);
    expect(item.toDate).toBe(plus(day, 1));
    /* HR's list and the manager's both show it; another role without Requests is refused. */
    expect((await ppl(mgr, 'get', '/shift-swaps').expect(200)).body.swaps.map((s: any) => s.id)).toContain(asked.id);
    const viewer = await withRole(c, 'Employee (self-service)', 'Vinay Staff');
    expect([403, 404]).toContain((await ppl(viewer, 'get', '/shift-swaps')).status);
    await ppl(mgr, 'post', `/requests/${item.id}/approve`, {}).expect(200);
    expect((await R.get('/swaps').expect(200)).body.askedOfMe.find((s: any) => s.id === asked.id).status).toBe('APPROVED');
    expect(await shiftOn(c, asha.id, day)).toBe(evening.id);
    expect(await shiftOn(c, ravi.id, day)).toBe(morning.id);
    expect(await shiftOn(c, asha.id, plus(day, 1))).toBe(evening.id);
    expect(await shiftOn(c, asha.id, plus(day, 2))).toBe(morning.id);
    /* HR cancels it before it starts: the usual shifts are back. */
    await ppl(mgr, 'post', `/shift-swaps/${asked.id}/cancel`, {}).expect(403);
    await ppl(c, 'post', `/shift-swaps/${asked.id}/cancel`, { note: 'Exam moved' }).expect(200);
    expect(await shiftOn(c, asha.id, day)).toBe(morning.id);
    expect(await shiftOn(c, ravi.id, day)).toBe(evening.id);
  });

  it('declined, it closes; withdrawn before approval, it closes and the inbox drops it', async () => {
    const day = plus(tuesday, 14);
    const one = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }).expect(201)).body.swap;
    expect((await R.post(`/swaps/${one.id}/decline`, { note: 'Cannot that day' }).expect(200)).body.swap.status).toBe('DECLINED');
    const two = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }).expect(201)).body.swap;
    await R.post(`/swaps/${two.id}/accept`).expect(200);
    const req = (await A.get('/swaps').expect(200)).body.mine.find((s: any) => s.id === two.id).approvalRequestId;
    expect((await A.post(`/swaps/${two.id}/withdraw`).expect(200)).body.swap.status).toBe('WITHDRAWN');
    expect((await ppl(mgr, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).not.toContain(req);
    /* Withdrawn while still asked of the colleague. */
    const three = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }).expect(201)).body.swap;
    expect((await A.post(`/swaps/${three.id}/withdraw`).expect(200)).body.swap.status).toBe('WITHDRAWN');
    await R.post(`/swaps/${three.id}/accept`).expect(409);
  });

  it('rejected by the manager, the swap says so and nothing changes', async () => {
    const day = plus(tuesday, 15);
    const s = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }).expect(201)).body.swap;
    await R.post(`/swaps/${s.id}/accept`).expect(200);
    const reqId = (await A.get('/swaps').expect(200)).body.mine.find((x: any) => x.id === s.id).approvalRequestId;
    await ppl(mgr, 'post', `/requests/${reqId}/reject`, { comment: 'Short on mornings that week' }).expect(200);
    const after = (await A.get('/swaps').expect(200)).body.mine.find((x: any) => x.id === s.id);
    expect(after.status).toBe('REJECTED');
    expect(await shiftOn(c, asha.id, day)).toBe(morning.id);
  });

  it('a schedule that moved since it was asked is refused at approval', async () => {
    const day = plus(tuesday, 21);
    const s = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }).expect(201)).body.swap;
    await R.post(`/swaps/${s.id}/accept`).expect(200);
    await att(c, 'post', '/temporary-schedules', { employeeIds: [ravi.id], shiftId: night.id, fromDate: day, toDate: day, reason: 'Cover' }).expect(201);
    const reqId = (await A.get('/swaps').expect(200)).body.mine.find((x: any) => x.id === s.id).approvalRequestId;
    const refused = await ppl(mgr, 'post', `/requests/${reqId}/approve`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/changed|between shifts/i);
    expect(await shiftOn(c, asha.id, day)).toBe(morning.id);
  });

  it('two swaps on the same day at once: one is asked, the other refused', async () => {
    const day = plus(tuesday, 28);
    const [x, y] = await Promise.all([
      A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }),
      R.post('/swaps', { colleagueEmployeeId: priya.id, fromDate: day }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect([x.body.code, y.body.code]).toContain('SWAP_OPEN');
    /* Two accepts of one swap at once: one goes for approval, once. */
    const day2 = plus(tuesday, 29);
    const s = (await P.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day2 })).body.swap;
    if (s) {
      const [a, b] = await Promise.all([R.post(`/swaps/${s.id}/accept`), R.post(`/swaps/${s.id}/accept`)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const n = await runInTenant(c.orgId, () => peoplePrisma.approvalRequest.count({ where: { orgId: c.orgId, requestType: 'SHIFT_SWAP', payload: { path: ['swapId'], equals: s.id } } }));
      expect(n).toBe(1);
    }
  });

  it('a temporary schedule already on those days is cut around the swap, and comes back whole when it is cancelled', async () => {
    const day = plus(tuesday, 42);
    /* Asha covers a week on a late-morning shift. */
    const late = (await att(c, 'post', '/shifts', { name: `Late morning ${rnd()}`, startTime: '07:00', endTime: '15:00' }).expect(201)).body.shift;
    await att(c, 'post', '/temporary-schedules', { employeeIds: [asha.id], shiftId: late.id, fromDate: plus(day, -2), toDate: plus(day, 2), reason: 'Cover week' }).expect(201);
    const s = (await A.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: day }).expect(201)).body.swap;
    expect(s.days[0].requesterShift.id).toBe(late.id);
    await R.post(`/swaps/${s.id}/accept`).expect(200);
    const reqId = (await A.get('/swaps').expect(200)).body.mine.find((x: any) => x.id === s.id).approvalRequestId;
    await ppl(mgr, 'post', `/requests/${reqId}/approve`, {}).expect(200);
    /* The swap takes the day; the cover stays on the days around it. */
    expect(await shiftOn(c, asha.id, day)).toBe(evening.id);
    expect(await shiftOn(c, ravi.id, day)).toBe(late.id);
    expect(await shiftOn(c, asha.id, plus(day, -1))).toBe(late.id);
    expect(await shiftOn(c, asha.id, plus(day, 2))).toBe(late.id);
    expect(await runInTenant(c.orgId, () => peoplePrisma.temporarySchedule.count({ where: { orgId: c.orgId, employeeId: asha.id, fromDate: { lte: day }, toDate: { gte: day } } }))).toBe(1);
    await ppl(c, 'post', `/shift-swaps/${s.id}/cancel`, {}).expect(200);
    expect(await shiftOn(c, asha.id, day)).toBe(late.id);
    expect(await shiftOn(c, ravi.id, day)).toBe(evening.id);
    const back = await runInTenant(c.orgId, () => peoplePrisma.temporarySchedule.findMany({ where: { orgId: c.orgId, employeeId: asha.id, shiftId: late.id } }));
    expect(back.map((t) => [t.fromDate, t.toDate])).toEqual([[plus(day, -2), plus(day, 2)]]);
  });

  it('when the colleague has another manager, that manager approves too; neither party decides', async () => {
    const kiran = await withRole(c, 'Team Manager', 'Kiran Lead');
    const kiranEmp = await person(c, { name: 'Kiran Lead', code: 'M2', workEmail: kiran.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: kiranEmp.id }, data: { userId: kiran.userId } }));
    const dev = await person(c, { name: 'Dev Shah', code: 'E5', reportingManagerId: kiranEmp.id });
    await att(c, 'post', '/shift-assignments', { employeeIds: [dev.id], shiftId: evening.id, effectiveFrom: '2026-01-01' }).expect(200);
    const D = await portalOf(c, dev);
    const day = plus(tuesday, 49);
    const s = (await A.post('/swaps', { colleagueEmployeeId: dev.id, fromDate: day }).expect(201)).body.swap;
    await D.post(`/swaps/${s.id}/accept`).expect(200);
    const reqId = (await A.get('/swaps').expect(200)).body.mine.find((x: any) => x.id === s.id).approvalRequestId;
    /* Step 1 is Asha's manager; Kiran waits for it. */
    await ppl(kiran, 'post', `/requests/${reqId}/approve`, {}).expect(403);
    await ppl(mgr, 'post', `/requests/${reqId}/approve`, {}).expect(200);
    expect(await shiftOn(c, asha.id, day)).toBe(morning.id);
    expect((await ppl(kiran, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).toContain(reqId);
    await ppl(kiran, 'post', `/requests/${reqId}/approve`, {}).expect(200);
    expect(await shiftOn(c, asha.id, day)).toBe(evening.id);
    expect(await shiftOn(c, dev.id, day)).toBe(morning.id);
  });

  it('a manager asked to swap with their own report does not approve it: HR does', async () => {
    const lata = await withRole(c, 'Team Manager', 'Lata Lead');
    const lataEmp = await person(c, { name: 'Lata Lead', code: 'M3', workEmail: lata.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: lataEmp.id }, data: { userId: lata.userId } }));
    await att(c, 'post', '/shift-assignments', { employeeIds: [lataEmp.id], shiftId: evening.id, effectiveFrom: '2026-01-01' }).expect(200);
    const nina = await person(c, { name: 'Nina Iyer', code: 'E6', reportingManagerId: lataEmp.id });
    await att(c, 'post', '/shift-assignments', { employeeIds: [nina.id], shiftId: morning.id, effectiveFrom: '2026-01-01' }).expect(200);
    const N = await portalOf(c, nina);
    const L = await portalOf(c, lataEmp);
    const day = plus(tuesday, 56);
    const s = (await N.post('/swaps', { colleagueEmployeeId: lataEmp.id, fromDate: day }).expect(201)).body.swap;
    await L.post(`/swaps/${s.id}/accept`).expect(200);
    const reqId = (await N.get('/swaps').expect(200)).body.mine.find((x: any) => x.id === s.id).approvalRequestId;
    expect((await ppl(lata, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).not.toContain(reqId);
    expect((await ppl(lata, 'post', `/requests/${reqId}/approve`, {})).status).toBe(403);
    /* HR (the owner) decides once: the colleague's-manager step is not asked of them again. */
    await ppl(c, 'post', `/requests/${reqId}/approve`, {}).expect(200);
    expect(await shiftOn(c, nina.id, day)).toBe(evening.id);
    const steps = await runInTenant(c.orgId, () => peoplePrisma.approvalStep.findMany({ where: { requestId: reqId }, orderBy: { order: 'asc' } }));
    expect(steps.map((x) => x.status)).toEqual(['APPROVED', 'SKIPPED']);
  });

  it('another company sees none of it', async () => {
    const other = await company();
    const stranger = await person(other, { name: 'Out Sider', code: 'X1' });
    const O = await portalOf(other, stranger);
    const theirs = (await A.get('/swaps').expect(200)).body.mine[0];
    await O.post(`/swaps/${theirs.id}/accept`).expect(404);
    await O.post(`/swaps/${theirs.id}/withdraw`).expect(404);
    expect((await O.post('/swaps', { colleagueEmployeeId: ravi.id, fromDate: plus(tuesday, 35) }).expect(400)).body.code).toBe('NOT_FOUND');
    expect((await ppl(other, 'get', '/shift-swaps').expect(200)).body.swaps).toEqual([]);
    await ppl(other, 'post', `/shift-swaps/${theirs.id}/cancel`, {}).expect(404);
  });

  it('cannot be sent through the generic requests route', async () => {
    expect((await ppl(c, 'post', '/requests', { requestType: 'SHIFT_SWAP', title: 'x', payload: { swapId: 'nope' } }).expect(400)).body.error).toMatch(/employee app/);
  });
});
