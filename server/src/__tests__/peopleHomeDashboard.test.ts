import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People Home's dashboard (owner's suite spec, 5–6 Nov 2026): who is in and who is out today by kind, the
 * decisions that wait (probation check-ins, statutory gaps, clearance sign-offs), the workforce by department,
 * kind and month, hiring, the links into the other apps, kudos and the one-question pulse. Every figure from
 * the records; another company sees none of it; the pulse shows no result until enough people answered.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { isSickLeave } = await import('../services/people/homeDashboard.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId?: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `homedash.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Dash Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: false } }).expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } });
  c.accountId = org!.accountId;
  c.userId = signup.body.user?.id;
  return c;
}
const ppl = (c: Ctx, m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const inTenant = <T>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.parse(`${istToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('sick leave is told by its name or code', () => {
  it('reads Sick, Medical and SL as sick; Casual and Earned as planned', () => {
    expect(isSickLeave({ name: 'Sick Leave' })).toBe(true);
    expect(isSickLeave({ name: 'Medical leave' })).toBe(true);
    expect(isSickLeave({ name: 'Leave', code: 'SL' })).toBe(true);
    expect(isSickLeave({ name: 'Casual Leave', code: 'CL' })).toBe(false);
    expect(isSickLeave({ name: 'Earned Leave' })).toBe(false);
    expect(isSickLeave(undefined)).toBe(false);
  });
});

describe('People Home dashboard', () => {
  let c: Ctx;
  let other: Ctx;
  let asha: any;
  let ravi: any;
  let meera: any;
  let leaver: any;
  beforeAll(async () => {
    c = await company();
    other = await company();
    const dept = (await ppl(c, 'post', '/structure/departments', { name: 'Sales' })).body;
    const departmentId = dept?.department?.id || dept?.item?.id || dept?.id;
    /* Joined 30 days ago, on probation for six months: the 30-day check-in is today. */
    asha = (await ppl(c, 'post', '/employees', { name: 'Asha Rao', code: `A-${rnd()}`, dateOfJoining: plus(-30), probationEndDate: plus(150), ...(departmentId ? { departmentId } : {}) }).expect(201)).body.employee;
    ravi = (await ppl(c, 'post', '/employees', { name: 'Ravi Kumar', code: `R-${rnd()}`, dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    meera = (await ppl(c, 'post', '/employees', { name: 'Meera Iyer', code: `M-${rnd()}`, dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    leaver = (await ppl(c, 'post', '/employees', { name: 'Kiran Das', code: `K-${rnd()}`, dateOfJoining: '2023-01-01' }).expect(201)).body.employee;
    await ppl(c, 'post', `/employees/${leaver.id}/resign`, { lastDay: plus(10), leavingType: 'RESIGNED' }).expect(200);
    await ppl(c, 'get', `/leaving/${leaver.id}`).expect(200);
    /* Today: Ravi off sick, Meera working from home. Written as decided, so the day of the week does not matter. */
    const sick = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Sick Leave', annualDays: 6 }).expect(201)).body.type;
    const by = { accountId: c.accountId!, orgId: c.orgId };
    await inTenant(c, async () => {
      await peoplePrisma.leaveRequest.create({ data: { ...by, employeeId: ravi.id, leaveTypeId: sick.id, fromDate: istToday(), toDate: plus(1), days: 2, reason: 'Fever', status: 'APPROVED', requestedByUserId: c.userId! } });
      await peoplePrisma.attendanceRequest.create({ data: { ...by, employeeId: meera.id, date: istToday(), kind: 'WFH', status: 'APPROVED', reason: 'Plumber', requestedByUserId: c.userId! } });
      await peoplePrisma.attendanceRecord.create({ data: { ...by, employeeId: asha.id, date: istToday(), status: 'PRESENT', checkIn: new Date(), lateMinutes: 12, createdByUserId: c.userId! } });
    });
    const job = (await ppl(c, 'post', '/talent/openings', { title: 'Accountant', status: 'OPEN', places: 2 }).expect(201)).body.opening;
    await ppl(c, 'post', '/talent/candidates', { openingId: job.id, name: 'Neha S', email: 'neha@example.com' }).expect(201);
  }, 180_000);

  it('today: who clocked in, and who is out by kind', async () => {
    const d = (await ppl(c, 'get', '/home/dashboard').expect(200)).body;
    expect(d.today.clock).toMatchObject({ clockedIn: 1, inNow: 1, late: 1 });
    expect(d.today.clock.expected).toBeGreaterThanOrEqual(3);
    expect(d.today.away.sick.map((x: any) => x.name)).toEqual(['Ravi Kumar']);
    expect(d.today.away.planned).toEqual([]);
    expect(d.today.away.wfh.map((x: any) => x.name)).toEqual(['Meera Iyer']);
    expect(d.today.away.field).toEqual([]);
  });

  it('decisions: the 30-day probation check-in, Aadhaar missing, and the leaver’s clearance lines', async () => {
    const d = (await ppl(c, 'get', '/home/dashboard').expect(200)).body.decisions;
    expect(d.probation).toEqual([expect.objectContaining({ employeeId: asha.id, mark: 30, on: istToday(), late: false })]);
    expect(d.statutory.fields.find((f: any) => f.key === 'aadhaar').count).toBeGreaterThanOrEqual(3);
    const k = d.clearance.find((x: any) => x.employeeId === leaver.id);
    expect(k.lastDay).toBe(plus(10));
    expect(k.lines.length).toBeGreaterThan(0);
  });

  it('a probation review written since takes the check-in off the list', async () => {
    await inTenant(c, () => peoplePrisma.probationReview.create({ data: { accountId: c.accountId!, orgId: c.orgId, employeeId: asha.id, periodEnd: plus(150), observations: 'Settling in well' } }));
    expect((await ppl(c, 'get', '/home/dashboard').expect(200)).body.decisions.probation).toEqual([]);
  });

  it('workforce, months and hiring are counted from the records', async () => {
    const d = (await ppl(c, 'get', '/home/dashboard').expect(200)).body;
    expect(d.workforce.headcount).toBe(4);
    expect(d.workforce.byKind).toEqual([{ key: 'FULL_TIME', name: 'Full time', count: 4 }]);
    expect(d.workforce.months).toHaveLength(12);
    expect(d.workforce.months.at(-1).month).toBe(istToday().slice(0, 7));
    expect(d.workforce.months.reduce((n: number, m: any) => n + m.joiners, 0)).toBeGreaterThanOrEqual(1);
    expect(d.hiring).toMatchObject({ open: 1, places: 2 });
    expect(d.hiring.pipeline.find((s: any) => s.stage === 'APPLIED').count).toBe(1);
    /* Attendance is on, so the exceptions link is there; Payroll is not, so no loss-of-pay link. */
    expect(d.links.map((l: any) => l.key)).toContain('shiftExceptions');
    expect(d.links.map((l: any) => l.key)).not.toContain('lossOfPay');
    /* With Payroll on and no run locked, this month's loss of pay is there, as Payroll will take it (working days with no attendance count). */
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true } }).expect(200);
    const on = (await ppl(c, 'get', '/home/dashboard').expect(200)).body.links;
    const lop = on.find((l: any) => l.key === 'lossOfPay');
    expect(lop).toMatchObject({ app: 'payroll', screen: 'runs' });
    expect(lop.count).toBeGreaterThanOrEqual(0);
    expect(on.find((l: any) => l.key === 'reimbursements')).toMatchObject({ count: 0, screen: 'expenses' });
  });

  it('another company sees none of it', async () => {
    const d = (await ppl(other, 'get', '/home/dashboard').expect(200)).body;
    expect(d.workforce.headcount).toBe(0);
    expect(d.decisions.clearance).toEqual([]);
    expect(d.hiring.open).toBe(0);
    expect((await ppl(other, 'get', '/kudos').expect(200)).body.kudos).toEqual([]);
  });

  it('kudos: given to someone working here, listed newest first, taken down by the giver', async () => {
    await ppl(c, 'post', '/kudos', { toEmployeeId: ravi.id, message: '  ' }).expect(400);
    await ppl(c, 'post', '/kudos', { toEmployeeId: 'nobody', message: 'Thanks' }).expect(400);
    await ppl(other, 'post', '/kudos', { toEmployeeId: ravi.id, message: 'From outside' }).expect(400);
    await ppl(c, 'post', '/kudos', { toEmployeeId: ravi.id, message: 'Closed the Pune order' }).expect(201);
    const list = (await ppl(c, 'post', '/kudos', { toEmployeeId: asha.id, message: 'Great first month' }).expect(201)).body.kudos;
    expect(list.map((k: any) => k.to.name)).toEqual(['Asha Rao', 'Ravi Kumar']);
    expect(list[0]).toMatchObject({ fromName: 'Owner', canRemove: true });
    await ppl(other, 'delete', `/kudos/${list[0].id}`).expect(404);
    const after = (await ppl(c, 'delete', `/kudos/${list[0].id}`).expect(200)).body.kudos;
    expect(after.map((k: any) => k.to.name)).toEqual(['Ravi Kumar']);
  });

  it('pulse: HR asks, anyone answers once (and may change it), results held back until three answered', async () => {
    expect((await ppl(c, 'get', '/pulse').expect(200)).body).toMatchObject({ question: null, canAsk: true });
    await ppl(c, 'post', '/pulse', { text: ' ' }).expect(400);
    const q = (await ppl(c, 'post', '/pulse', { text: 'How was your week at work?' }).expect(201)).body;
    expect(q).toMatchObject({ answered: 0, mine: null, results: null, showsAt: 3 });
    await ppl(c, 'post', '/pulse/answer', { questionId: q.question.id, score: 9 }).expect(400);
    await ppl(c, 'post', '/pulse/answer', { questionId: q.question.id, score: 4 }).expect(200);
    const changed = (await ppl(c, 'post', '/pulse/answer', { questionId: q.question.id, score: 5 }).expect(200)).body;
    expect(changed).toMatchObject({ answered: 1, mine: 5, results: null, average: null });
    /* Two more answers make three: now the counts show, never who gave them. */
    await inTenant(c, () => peoplePrisma.pulseAnswer.createMany({ data: [{ accountId: c.accountId!, orgId: c.orgId, questionId: q.question.id, userId: 'u2', score: 3 }, { accountId: c.accountId!, orgId: c.orgId, questionId: q.question.id, userId: 'u3', score: 4 }] }));
    const shown = (await ppl(c, 'get', '/pulse').expect(200)).body;
    expect(shown).toMatchObject({ answered: 3, results: [0, 0, 1, 1, 1], average: 4 });
    expect(JSON.stringify(shown)).not.toContain('u2');
    /* A question from another company cannot be answered. */
    await ppl(other, 'post', '/pulse/answer', { questionId: q.question.id, score: 3 }).expect(409);
    /* A new question closes the old one. */
    const next = (await ppl(c, 'post', '/pulse', { text: 'Do you have what you need to do your job?' }).expect(201)).body;
    expect(next).toMatchObject({ answered: 0, mine: null });
    await ppl(c, 'post', '/pulse/answer', { questionId: q.question.id, score: 3 }).expect(409);
    expect((await ppl(c, 'post', '/pulse/close').expect(200)).body.question).toBeNull();
  });
});
