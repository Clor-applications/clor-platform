import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/** The attendance reports: ClorTime's catalogue and statutory registers on CLOR's data. */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `rep.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Report owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Report Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/* September 2026: Tuesday the 1st; Sundays 6, 13, 20, 27. */
let c: Ctx;
let asha: any;
let ravi: any;
beforeAll(async () => {
  c = await makeOwner();
  asha = await person(c, { name: 'Asha', code: 'E1' });
  ravi = await person(c, { name: 'Ravi', code: 'E2' });
  await api(c).post('/holidays', { date: '2026-09-15', name: 'Test holiday' }).expect(201);
  await api(c).put('/records', { employeeId: asha.id, date: '2026-09-01', checkIn: '09:30', checkOut: '19:30' }).expect(200); // 30 late, 1:00 OT
  await api(c).put('/records', { employeeId: ravi.id, date: '2026-09-01', checkIn: '09:00', checkOut: '17:00' }).expect(200); // 60 early out, 7h
  await api(c).put('/records', { employeeId: ravi.id, date: '2026-09-02', status: 'ABSENT' }).expect(200);
  const t = (await api(c).post('/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
  const r = (await api(c).post('/leave/requests', { employeeId: asha.id, leaveTypeId: t.id, fromDate: '2026-09-03', toDate: '2026-09-04', reason: 'Away' }).expect(201)).body.request;
  await api(c).post(`/leave/requests/${r.id}/approve`).expect(200);
}, 60_000);

const report = async (id: string, q: string) => (await api(c).get(`/reports/${id}?${q}`).expect(200)).body;
const row = (rep: any, name: string) => rep.rows.find((r: any) => r.name === name);

describe('the catalogue', () => {
  it('lists the reports', async () => {
    const ids = (await api(c).get('/reports').expect(200)).body.reports.map((r: any) => r.id);
    expect(ids).toEqual(['daily', 'monthly', 'muster', 'late-early', 'absent', 'overtime', 'leave', 'department', 'readers', 'biometrics']);
  });

  it('refuses an unknown report and too long a range', async () => {
    await api(c).get('/reports/nope').expect(404);
    await api(c).get('/reports/absent?from=2026-01-01&to=2026-12-31').expect(400);
  });
});

describe('reports', () => {
  it('daily: everyone, marked or not', async () => {
    const r = await report('daily', 'date=2026-09-01');
    expect(row(r, 'Asha')).toMatchObject({ in: '09:30', out: '19:30', late: 30, status: 'Present' });
    expect(row(r, 'Ravi')).toMatchObject({ earlyOut: 60 });
    const next = await report('daily', 'date=2026-09-07');
    expect(row(next, 'Asha').status).toBe('Absent (not marked)');
  });

  it('muster roll: a mark per day, matching the month summary', async () => {
    const r = await report('muster', 'month=2026-09');
    const a = row(r, 'Asha');
    expect([a['01'], a['03'], a['06'], a['15']]).toEqual(['P', 'L', 'W', 'H']);
    const summary = (await api(c).get('/summary?month=2026-09').expect(200)).body.rows.find((x: any) => x.name === 'Asha');
    expect(a.absent).toBe(summary.absent);
    expect(r.notes.join(' ')).toContain('P present');
  });

  it('late and early, absent, overtime, leave registers', async () => {
    const le = await report('late-early', 'from=2026-09-01&to=2026-09-02');
    expect(le.rows.map((x: any) => [x.name, x.late, x.earlyOut])).toEqual([
      ['Asha', 30, ''],
      ['Ravi', '', 60],
    ]);
    const ab = await report('absent', 'from=2026-09-02&to=2026-09-02');
    expect(ab.rows.map((x: any) => [x.name, x.how])).toEqual([
      ['Asha', 'No attendance'],
      ['Ravi', 'Marked absent'],
    ]);
    const ot = await report('overtime', 'from=2026-09-01&to=2026-09-30');
    expect(ot.rows).toEqual([expect.objectContaining({ name: 'Asha', overtime: '1:00', approved: 'No' })]);
    const lv = await report('leave', 'from=2026-09-01&to=2026-09-30');
    expect(lv.rows).toEqual([expect.objectContaining({ name: 'Asha', type: 'Casual', days: 2, paid: 'Yes' })]);
  });

  it('calendar: a day carries its counts, a holiday its name, a day to come no absences', async () => {
    const cal = (await api(c).get('/calendar?month=2026-09').expect(200)).body;
    expect(cal.month).toBe('2026-09');
    expect(cal.days).toHaveLength(30);
    const first = cal.days.find((d: any) => d.date === '2026-09-01');
    expect(first).toMatchObject({ present: 1, halfDay: 1, absent: 0, leave: 0, employed: 2, late: 1, off: false, holiday: null });
    expect(cal.days.find((d: any) => d.date === '2026-09-02')).toMatchObject({ present: 0, absent: 2 });
    expect(cal.days.find((d: any) => d.date === '2026-09-03')).toMatchObject({ leave: 1, absent: 1 });
    expect(cal.days.find((d: any) => d.date === '2026-09-15')).toMatchObject({ holiday: 'Test holiday', off: true });
    expect(cal.days.find((d: any) => d.date === '2026-09-06')).toMatchObject({ weeklyOff: 2, off: true });
    const ahead = (await api(c).get('/calendar?month=2027-01').expect(200)).body;
    expect(ahead.days.every((d: any) => d.future && d.absent === 0)).toBe(true);
  });

  it('flags working days nobody has any attendance for', async () => {
    const r = await report('absent', 'from=2026-09-07&to=2026-09-08');
    expect(r.notes.join(' ')).toContain('Nobody has any attendance');
  });

  it('department monthly, readers and biometric enrolment', async () => {
    const d = await report('department', 'month=2026-09');
    expect(d.rows[0]).toMatchObject({ department: 'No department', headcount: 2 });
    expect((await report('readers', '')).rows).toEqual([]);
    const b = await report('biometrics', '');
    expect(row(b, 'Asha')).toMatchObject({ readerId: 'E1', fingers: 0, enrolled: 'Not enrolled' });
  });
});
