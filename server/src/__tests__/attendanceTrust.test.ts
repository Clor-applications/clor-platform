import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Attendance you can trust: every change to a day is kept with its before and
 * after; a day explains itself from the same rules that scored it; the
 * Exception Center gathers what is unsettled; changes to schedules and rules
 * can be previewed; bulk changes preview first and leave a history; imports
 * can be checked without saving; and a reader's batches carry a trace.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});

async function makeOwner(): Promise<Ctx> {
  const email = `trust.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Trust Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const person = async (c: Ctx, code: string) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;

describe('a day’s history', () => {
  it('keeps every change with what it was before, and skips a write that changes nothing', async () => {
    const c = await makeOwner();
    const p = await person(c, '501');
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:30', checkOut: '18:00', note: 'Gate B was down' }).expect(200);
    const rows = await peoplePrisma.attendanceRecordHistory.findMany({ where: { orgId: c.orgId, employeeId: p.id, date: '2026-09-02' }, orderBy: { at: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['WRITE', 'WRITE']);
    expect(rows[0].beforeJson).toBeNull();
    expect(JSON.parse(rows[1].beforeJson!).in).toBe('09:00');
    expect(JSON.parse(rows[1].afterJson!).in).toBe('09:30');
    expect(rows[1].reason).toBe('Gate B was down');

    const record = await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: p.id, date: '2026-09-02' } } });
    await att(c).post('/records/validate', { ids: [record.id] }).expect(200);
    expect(await peoplePrisma.attendanceRecordHistory.count({ where: { orgId: c.orgId, employeeId: p.id, action: 'VALIDATE' } })).toBe(1);
  });
});

describe('explaining a day', () => {
  it('narrates the shift, grace, lateness and the result from the rules that scored it', async () => {
    const c = await makeOwner();
    const p = await person(c, '502');
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:25', checkOut: '18:30' }).expect(200);
    const x = await att(c).get(`/days/explain?employeeId=${p.id}&date=2026-09-02`).expect(200);
    expect(x.body.shift.startTime).toBe('09:00');
    const text = x.body.steps.map((s: any) => s.text).join(' ');
    expect(text).toMatch(/25 min after the start/);
    expect(text).toMatch(/Grace is 10 min/);
    expect(x.body.matchesRules).toBe(true);
    expect(x.body.history.length).toBe(1);
    expect(x.body.record.status).toBe('PRESENT');

    const empty = await att(c).get(`/days/explain?employeeId=${p.id}&date=2026-09-03`).expect(200);
    expect(empty.body.record).toBeNull();
    expect(empty.body.steps.at(-1).text).toMatch(/counts as absent/);
  });
});

describe('corrections', () => {
  it('remember the day as it stood, take a reason category, and can be approved together', async () => {
    const c = await makeOwner();
    const a = await person(c, '503');
    const b = await person(c, '504');
    await att(c).put('/records', { employeeId: a.id, date: '2026-09-02', checkIn: '09:40' }).expect(200);
    const r1 = await att(c).post('/requests', { employeeId: a.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00', reason: 'Forgot to punch out', reasonCode: 'FORGOT_PUNCH' }).expect(201);
    expect(r1.body.request.beforeStatus).toBe('PRESENT');
    expect(r1.body.request.beforeCheckIn).toBeTruthy();
    expect(r1.body.request.reasonCode).toBe('FORGOT_PUNCH');
    const r2 = await att(c).post('/requests', { employeeId: b.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00', reason: 'Reader down' }).expect(201);
    const done = await att(c).post('/requests/bulk-review', { ids: [r1.body.request.id, r2.body.request.id], approve: true }).expect(200);
    expect(done.body.done).toBe(2);
    const day = await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: a.id, date: '2026-09-02' } } });
    expect(day.source).toBe('REQUEST');
    const h = await peoplePrisma.attendanceRecordHistory.findFirst({ where: { orgId: c.orgId, employeeId: a.id, date: '2026-09-02', source: 'REQUEST' } });
    expect(h?.reason).toMatch(/Correction approved: Forgot to punch out/);
  });
});

describe('bulk changes', () => {
  it('preview first, then apply through the day engine with a history', async () => {
    const c = await makeOwner();
    const p = await person(c, '505');
    const q = await person(c, '506');
    const open = await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00' }).expect(200);
    const closedDay = await att(c).put('/records', { employeeId: q.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const ids = [open.body.record.id, closedDay.body.record.id];
    const preview = await att(c).post('/records/bulk', { ids, operation: 'SET_OUT_SHIFT_END', reason: 'Reader at gate B lost exits', preview: true }).expect(200);
    expect(preview.body.ready).toBe(1);
    expect(preview.body.skipped).toBe(1);
    expect(preview.body.rows.find((r: any) => r.id === open.body.record.id).changes.find((x: any) => x.field === 'out').after).toBe('18:00');
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: open.body.record.id } })).checkOut).toBeNull();

    const applied = await att(c).post('/records/bulk', { ids, operation: 'SET_OUT_SHIFT_END', reason: 'Reader at gate B lost exits', preview: false }).expect(200);
    expect(applied.body.applied).toBe(1);
    const day = await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: open.body.record.id } });
    expect(day.checkOut).toBeTruthy();
    expect(day.status).toBe('PRESENT');
    expect(await peoplePrisma.attendanceRecordHistory.count({ where: { orgId: c.orgId, employeeId: p.id, action: 'BULK' } })).toBe(1);
  });
});

describe('the Exception Center', () => {
  it('lists unsettled days and queues, and keeps who owns one and whether it is settled', async () => {
    const c = await makeOwner();
    const p = await person(c, '507');
    const d = new Date(Date.now() + 330 * 60_000 - 3 * 86_400_000).toISOString().slice(0, 10);
    const rec = await att(c).put('/records', { employeeId: p.id, date: d, checkIn: '09:00' }).expect(200);
    const list = await att(c).get(`/exceptions?from=${d}&to=${d}`).expect(200);
    const missing = list.body.exceptions.find((x: any) => x.key === `MISSING_OUT:${rec.body.record.id}`);
    expect(missing).toBeTruthy();
    expect(missing.screen).toBe('records');
    await att(c).post('/exceptions/state', { key: missing.key, assignee: 'me', status: 'IN_PROGRESS' }).expect(200);
    const mine = await att(c).get(`/exceptions?from=${d}&to=${d}`).expect(200);
    expect(mine.body.exceptions.find((x: any) => x.key === missing.key).status).toBe('IN_PROGRESS');
    expect(mine.body.exceptions.find((x: any) => x.key === missing.key).assignee).toBeTruthy();
    await att(c).post('/exceptions/state', { key: missing.key, status: 'RESOLVED', note: 'Asked the supervisor' }).expect(200);
    const after = await att(c).get(`/exceptions?from=${d}&to=${d}`).expect(200);
    expect(after.body.exceptions.some((x: any) => x.key === missing.key)).toBe(false);
    const all = await att(c).get(`/exceptions?from=${d}&to=${d}&show=all`).expect(200);
    expect(all.body.exceptions.find((x: any) => x.key === missing.key).status).toBe('RESOLVED');
  });
});

describe('month readiness', () => {
  it('lists what is open, person by person', async () => {
    const c = await makeOwner();
    const p = await person(c, '508');
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00' }).expect(200);
    const r = await att(c).get('/months/2026-09/readiness').expect(200);
    expect(r.body.ready).toBe(false);
    expect(r.body.checks.find((x: any) => x.key === 'missingOut').count).toBe(1);
    expect(r.body.people.find((x: any) => x.employeeId === p.id).missingOut).toBe(1);
  });
});

describe('schedules, checked before saving', () => {
  it('flags two temporary schedules with different shifts on the same days', async () => {
    const c = await makeOwner();
    const p = await person(c, '509');
    const day = (await att(c).post('/shifts', { name: 'Day', startTime: '09:00', endTime: '18:00' }).expect(201)).body.shift;
    const night = (await att(c).post('/shifts', { name: 'Night', startTime: '22:00', endTime: '06:00' }).expect(201)).body.shift;
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: day.id, fromDate: '2026-11-01', toDate: '2026-11-10' }).expect(201);
    const check = await att(c).post('/schedule/check', { kind: 'TEMPORARY', employeeIds: [p.id], shiftId: night.id, from: '2026-11-05', to: '2026-11-15' }).expect(200);
    expect(check.body.conflicts).toBe(1);
    expect(check.body.shift.crossesMidnight).toBe(true);
    expect(check.body.people[0].findings[0]).toMatchObject({ level: 'CONFLICT', shift: 'Day', from: '2026-11-05', to: '2026-11-10' });
  });
});

describe('rules', () => {
  it('previews a shift change against recorded days, and keeps a version when one is saved', async () => {
    const c = await makeOwner();
    const p = await person(c, '510');
    const shift = (await att(c).post('/shifts', { name: 'General', startTime: '09:00', endTime: '18:00', graceMinutes: 10 }).expect(201)).body.shift;
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: shift.id, effectiveFrom: '2026-01-01' }).expect((r) => expect([200, 201]).toContain(r.status));
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:12', checkOut: '18:00' }).expect(200);
    const sim = await att(c).post('/rules/simulate', { shiftId: shift.id, changes: { graceMinutes: 15 }, from: '2026-09-01', to: '2026-09-30' }).expect(200);
    expect(sim.body.changedDays).toBe(1);
    expect(sim.body.days[0].lateMinutes).toEqual([12, 0]);
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: p.id, date: '2026-09-02' } } })).lateMinutes).toBe(12);

    await att(c).put(`/shifts/${shift.id}`, { ...shift, graceMinutes: 15, code: null, color: null }).expect(200);
    const v = await att(c).get('/rules/versions').expect(200);
    expect(v.body.versions[0]).toMatchObject({ kind: 'SHIFT', name: 'General' });
    expect(v.body.versions[0].before.graceMinutes).toBe(10);
    expect(v.body.versions[0].after.graceMinutes).toBe(15);
  });
});

describe('imports', () => {
  it('check every row without saving when asked to', async () => {
    const c = await makeOwner();
    await person(c, '511');
    const dry = await att(c).post('/records/import', { dryRun: true, rows: [{ employeeCode: '511', date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }, { employeeCode: 'nobody', date: '2026-09-02' }] }).expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, imported: 1, failed: 1 });
    expect(await peoplePrisma.attendanceRecord.count({ where: { orgId: c.orgId } })).toBe(0);
  });
});

describe('a reader’s batches', () => {
  it('are each recorded with a trace, new and repeated punches counted', async () => {
    const c = await makeOwner();
    await person(c, '512');
    const sn = `TRC${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    const dev = (await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201)).body.device;
    const send = (body: string) => request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send(body);
    await send('512\t2026-09-05 09:00:00\t0\t1\n512\t2026-09-05 18:00:00\t1\t1').expect(200);
    await send('512\t2026-09-05 09:00:00\t0\t1\nnot a punch line').expect(200);
    const runs = await peoplePrisma.ingestRun.findMany({ where: { orgId: c.orgId, deviceId: dev.id }, orderBy: { at: 'asc' } });
    expect(runs.length).toBe(2);
    expect(runs[0]).toMatchObject({ accepted: 2, duplicates: 0 });
    expect(runs[1]).toMatchObject({ accepted: 0, duplicates: 1, rejected: 1 });
    expect(runs[1].traceId).toMatch(/^[0-9a-f-]{36}$/);
    const t = await att(c).get(`/devices/${dev.id}/timeline`).expect(200);
    expect(t.body.events.some((e: any) => e.kind === 'batch' && e.title.includes('2 new punches'))).toBe(true);
  });
});

describe('evidence', () => {
  it('bundles a person’s days, history and corrections for a period', async () => {
    const c = await makeOwner();
    const p = await person(c, '513');
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    await att(c).post('/requests', { employeeId: p.id, date: '2026-09-02', checkIn: '08:55', checkOut: '18:00', reason: 'Came early' }).expect(201);
    const e = await att(c).get(`/evidence?employeeId=${p.id}&from=2026-09-01&to=2026-09-30`).expect(200);
    expect(e.body.days.length).toBe(1);
    expect(e.body.history.length).toBe(1);
    expect(e.body.corrections[0].before.in).toBe('09:00');
    expect(e.body.employee.code).toBe('513');
  });
});

describe('phone punches', () => {
  it('a refused attempt is kept, and listed with the punches', async () => {
    const c = await makeOwner();
    const p = await person(c, '514');
    const { recordPhonePunch } = await import('../services/attendance/phonePunch.js');
    const emp = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id } });
    const out = await recordPhonePunch({ ...emp, mobilePunch: false } as any, { latitude: 12.97, longitude: 77.59, accuracy: 20 });
    expect(out.status).toBe(403);
    const attempts = await peoplePrisma.phonePunchAttempt.findMany({ where: { orgId: c.orgId, employeeId: p.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ code: 'PHONE_OFF', latitude: 12.97, accuracyM: 20 });
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const list = await att(c).get(`/phone-punches?from=${t}&to=${t}`).expect(200);
    expect(list.body.summary.refused).toBe(1);
    expect(list.body.refused[0]).toMatchObject({ code: 'PHONE_OFF', name: 'Person 514' });
  });
});

describe('leave, explained', () => {
  it('lays out the entitlement, what was taken, and the rules', async () => {
    const c = await makeOwner();
    const p = await person(c, '515');
    const type = (await att(c).post('/leave/types', { name: 'Casual', isPaid: true, annualDays: 12, accrual: 'MONTHLY' }).expect(201)).body.type;
    const year = Number(new Date().toISOString().slice(0, 4));
    const x = await att(c).get(`/leave/explain?employeeId=${p.id}&leaveTypeId=${type.id}&year=${year}`).expect(200);
    expect(x.body.type.name).toBe('Casual');
    expect(x.body.lines.some((l: any) => l.kind === 'earned')).toBe(true);
    expect(x.body.months.length).toBeGreaterThan(0);
    expect(x.body.rules[0]).toMatch(/12 days a year, earned a twelfth/);
  });
});

describe('reader ID mapping', () => {
  it('names people with no reader ID', async () => {
    const c = await makeOwner();
    const p = await person(c, '516');
    await peoplePrisma.employee.update({ where: { id: p.id }, data: { devicePin: null } });
    const a = await att(c).get('/mapping-audit').expect(200);
    expect(a.body.noPin.some((x: any) => x.employeeId === p.id)).toBe(true);
  });
});
