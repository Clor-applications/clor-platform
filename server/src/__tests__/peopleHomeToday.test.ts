import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People → Home's "today" (owner, 22 Nov 2026): arrivals in 15-minute steps,
 * how many are in and late, and the day's events newest first.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { bucketArrivals, istClock } = await import('../services/people/homeToday.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/* A moment today at an IST clock time. */
const istAt = (hhmm: string) => new Date(new Date(`${today}T${hhmm}:00Z`).getTime() - 330 * 60_000);

describe('bucketArrivals', () => {
  it('keeps every 15-minute step from first to last, names up to three in order', () => {
    const b = bucketArrivals([
      { clock: '09:02', name: 'Asha', late: false },
      { clock: '09:44', name: 'Ravi', late: true },
      { clock: '09:01', name: 'Meera', late: false },
      { clock: '09:10', name: 'Joseph', late: false },
      { clock: '09:14', name: 'Kiran', late: false },
    ]);
    expect(b.map((x) => x.at)).toEqual(['09:00', '09:15', '09:30']);
    expect(b[0]).toEqual({ at: '09:00', count: 4, late: 0, names: ['Meera', 'Asha', 'Joseph'] });
    expect(b[1]).toEqual({ at: '09:15', count: 0, late: 0, names: [] });
    expect(b[2]).toEqual({ at: '09:30', count: 1, late: 1, names: ['Ravi'] });
  });

  it('is empty with no arrivals, and reads clocks in IST', () => {
    expect(bucketArrivals([])).toEqual([]);
    expect(istClock(new Date('2026-11-22T03:45:00Z'))).toBe('09:15');
  });
});

describe('People home today', () => {
  it('counts arrivals and lateness and lists the day newest first', async () => {
    const email = `today.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Today Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    const people = (m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

    /* Attendance off: no "today" at all. */
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: false } }).expect(200);
    const a = (await people('post', '/employees', { name: 'Asha', code: 'T1', dateOfJoining: '2025-01-06' }).expect(201)).body.employee;
    const r = (await people('post', '/employees', { name: 'Ravi', code: 'T2', dateOfJoining: '2025-01-06' }).expect(201)).body.employee;
    const n = (await people('post', '/employees', { name: 'Nisha', code: 'T3', dateOfJoining: today }).expect(201)).body.employee;
    expect((await people('get', '/home').expect(200)).body.today ?? null).toBeNull();

    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
    const row = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: a.id }, select: { accountId: true } });
    const base = { accountId: row.accountId, orgId: c.orgId, date: today, status: 'PRESENT', source: 'CLOCK', createdByUserId: 'test' };
    await peoplePrisma.attendanceRecord.create({ data: { ...base, employeeId: a.id, checkIn: istAt('09:05') } });
    await peoplePrisma.attendanceRecord.create({ data: { ...base, employeeId: r.id, checkIn: istAt('09:50'), lateMinutes: 20 } });

    const t = (await people('get', '/home').expect(200)).body.today;
    expect(t).toMatchObject({ date: today, expected: 3, inCount: 2, late: 1 });
    expect(t.arrivals.map((b: any) => [b.at, b.count])).toEqual([['09:00', 1], ['09:15', 0], ['09:30', 0], ['09:45', 1]]);
    expect(t.arrivals[3].names).toEqual(['Ravi']);
    expect(t.feed[0]).toMatchObject({ kind: 'late', name: 'Ravi', at: '09:50', minutes: 20 });
    expect(t.feed.find((e: any) => e.kind === 'joined')).toMatchObject({ employeeId: n.id, name: 'Nisha' });
  });
});
