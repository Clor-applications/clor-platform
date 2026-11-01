import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * India's day, from one place (server/src/utils/istDate.ts, dedup batch 5).
 *
 * Three places took "today" as the UTC date, which is still yesterday from
 * 00:00 to 05:30 IST: the payroll overview's current month, a settlement's
 * "overdue" and the length of a running employment stint. Each is checked here
 * at 02:00 IST on 1 January 2027, when UTC still says 31 December 2026.
 */
const { addDays, addMonths, daysBetween, eachDay, istDate, todayIst } = await import('../utils/istDate.js');
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  vi.useRealTimers();
});

const NEW_YEAR_2AM_IST = new Date('2027-01-01T02:00:00+05:30');
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `ist.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `IST Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}
const payroll = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
});

describe('the helpers', () => {
  it('take the IST day of an instant, also between midnight and 05:30', () => {
    expect(istDate(NEW_YEAR_2AM_IST)).toBe('2027-01-01');
    expect(NEW_YEAR_2AM_IST.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(istDate(new Date('2027-01-01T05:29:00+05:30'))).toBe('2027-01-01');
    expect(istDate(new Date('2026-12-31T23:59:00+05:30'))).toBe('2026-12-31');
    expect(todayIst(NEW_YEAR_2AM_IST)).toBe('2027-01-01');
  });

  it('read the clock when not handed one', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NEW_YEAR_2AM_IST });
    expect(todayIst()).toBe('2027-01-01');
  });

  it('count days and months on calendar dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2027-03-31', -1)).toBe('2027-02-28');
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(eachDay('2027-01-02', '2027-01-01')).toEqual([]);
    expect(daysBetween('2027-04-01', '2027-04-30')).toBe(30);
    expect(daysBetween('2027-04-30', '2027-04-01')).toBe(0);
    expect(daysBetween('', '2027-04-01')).toBe(0);
  });
});

describe('at 02:00 IST on 1 January 2027', () => {
  it('the payroll overview is on January, not December', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NEW_YEAR_2AM_IST });
    const c = await owner();
    await payroll(c).post('/periods', { name: 'December 2026', startDate: '2026-12-01', endDate: '2026-12-31', paymentDate: '2026-12-31' }).expect(201);
    await payroll(c).post('/periods', { name: 'January 2027', startDate: '2027-01-01', endDate: '2027-01-31', paymentDate: '2027-01-31' }).expect(201);
    const overview = (await payroll(c).get('/overview').expect(200)).body.overview;
    expect(overview.currentPeriod).toMatchObject({ name: 'January 2027' });
  });

  it('a settlement due on 31 December is overdue', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NEW_YEAR_2AM_IST });
    const c = await owner();
    const person = await payroll(c).post('/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2020-03-01', status: 'ACTIVE' }).expect(201);
    const employeeId = person.body.employee.id;
    /* Left on Tuesday 29 December: due two working days later, on Thursday 31 December. */
    await payroll(c).put(`/employees/${employeeId}`, { name: 'Ravi Kumar', dateOfJoining: '2020-03-01', dateOfLeaving: '2026-12-29', status: 'LEFT' }).expect(200);
    const s = (await payroll(c).post('/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.dueDate).toBe('2026-12-31');
    const listed = (await payroll(c).get('/settlements').expect(200)).body.settlements.find((r: { id: string }) => r.id === s.id);
    expect(listed.overdue).toBe(true);
  });

  it('a stint that began on 31 December has run one day', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NEW_YEAR_2AM_IST });
    const c = await owner();
    const people = (path: string) => `/api/orgs/${c.orgId}/people${path}`;
    const e = (await request(app).post(people('/employees')).set(at(c)).send({ name: 'Meera Shah', code: `S-${rnd()}`, dateOfJoining: '2026-12-31' }).expect(201)).body.employee;
    const stints = (await request(app).get(people(`/employees/${e.id}/history`)).set(at(c)).expect(200)).body.episodes;
    expect(stints).toEqual([expect.objectContaining({ seq: 1, startDate: '2026-12-31', current: true, days: 1 })]);
  });
});
