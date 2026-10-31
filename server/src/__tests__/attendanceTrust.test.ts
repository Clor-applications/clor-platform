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

  it('settles or ignores many at once, with one note on each, and can reopen them', async () => {
    const c = await makeOwner();
    const people = [await person(c, '601'), await person(c, '602'), await person(c, '603')];
    const d = new Date(Date.now() + 330 * 60_000 - 3 * 86_400_000).toISOString().slice(0, 10);
    const keys: string[] = [];
    for (const p of people) {
      const rec = await att(c).put('/records', { employeeId: p.id, date: d, checkIn: '09:00' }).expect(200);
      keys.push(`MISSING_OUT:${rec.body.record.id}`);
    }
    const r = await att(c).post('/exceptions/state/bulk', { keys: [...keys, keys[0]], status: 'IGNORED', note: 'Reader was down' }).expect(200);
    expect(r.body.updated).toBe(3);
    const open = await att(c).get(`/exceptions?from=${d}&to=${d}`).expect(200);
    expect(open.body.exceptions.filter((x: any) => keys.includes(x.key))).toEqual([]);
    const all = (await att(c).get(`/exceptions?from=${d}&to=${d}&show=all`).expect(200)).body.exceptions.filter((x: any) => keys.includes(x.key));
    expect(all.map((x: any) => [x.status, x.note])).toEqual(keys.map(() => ['IGNORED', 'Reader was down']));
    await att(c).post('/exceptions/state/bulk', { keys, status: 'OPEN' }).expect(200);
    expect((await att(c).get(`/exceptions?from=${d}&to=${d}`).expect(200)).body.exceptions.filter((x: any) => keys.includes(x.key))).toHaveLength(3);
    await att(c).post('/exceptions/state/bulk', { keys: [], status: 'RESOLVED' }).expect(400);
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
    const year = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4)); // this year in India
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

/*
 * Per-day reader trust (closure audit O-11, TLA-005): an optional feature, off
 * by default. On, each day is Trusted, Check or Manual, says why, and a
 * person's punches can be exported as evidence.
 */
describe('reader trust for each day', () => {
  /* Three days ago in IST: a day that has ended, inside an open month. */
  const ago = (n: number) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);
  const day = ago(3);
  const rules = (extra: Record<string, unknown> = {}) => ({ defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0, ...extra });
  const trustOn = async (c: Ctx, hours = 24 * 31) => {
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, attendanceReaderTrust: true } }).expect(200);
    await att(c).put('/rules', rules({ readerLateUploadHours: hours })).expect(200);
  };
  const reader = async (c: Ctx) => {
    const sn = `RT${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    const device = (await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201)).body.device;
    const send = (lines: string[]) => request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send(lines.join('\n')).expect(200);
    return { device, sn, send };
  };
  const dayOf = (employeeId: string, date = day) => peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId, date } } });
  const codes = (r: { trustReasons: unknown }) => ((r.trustReasons as any[]) || []).map((x) => x.code);

  it('off: days, records, readiness and readers behave exactly as before', async () => {
    const c = await makeOwner();
    const p = await person(c, '701');
    const q = await person(c, '702');
    await att(c).put('/records', { employeeId: p.id, date: day, checkIn: '09:00', checkOut: '18:00' }).expect(200);
    expect(await dayOf(p.id)).toMatchObject({ trust: null, trustReasons: null });

    const list = await att(c).get(`/records?from=${day}&to=${day}&trust=CHECK`).expect(200);
    expect(list.body.readerTrust).toBe(false);
    /* The trust filter is ignored and no trust is on the rows. */
    expect(list.body.records).toHaveLength(1);
    expect('trust' in list.body.records[0]).toBe(false);
    expect((await att(c).get('/rules').expect(200)).body.rules.readerTrust).toBe(false);
    expect((await att(c).get(`/months/${day.slice(0, 7)}/readiness`).expect(200)).body.checks.some((x: any) => x.key === 'trustCheck')).toBe(false);
    expect((await att(c).get(`/days/explain?employeeId=${p.id}&date=${day}`).expect(200)).body.trust).toBeNull();
    await att(c).get(`/evidence/punches?employeeId=${p.id}&from=${day}&to=${day}`).expect(409);
    await att(c).post('/trust/recompute', { from: day, to: day }).expect(409);

    /* A reader punch on the day marked by hand is dropped silently, as today. */
    const { send } = await reader(c);
    await send([`701\t${day} 10:00:00\t0\t1`, `702\t${day} 09:00:00\t0\t1`, `702\t${day} 18:00:00\t1\t1`]);
    const kept = await dayOf(p.id);
    expect(kept.source).toBe('MANUAL');
    expect(kept.trustReasons).toBeNull();
    expect(await dayOf(q.id)).toMatchObject({ source: 'DEVICE', trust: null });
    const ex = await att(c).get(`/exceptions?from=${day}&to=${day}`).expect(200);
    expect(ex.body.exceptions.some((x: any) => x.kind === 'READER_ON_MANUAL')).toBe(false);
  });

  it('switched on in Attendance policy: a day written by hand, imported or corrected is Manual, saying which and who', async () => {
    const c = await makeOwner();
    const [a, b, d] = [await person(c, '711'), await person(c, '712'), await person(c, '713')];
    await att(c).put('/rules', rules({ readerTrust: true })).expect(200);
    expect((await att(c).get('/rules').expect(200)).body.rules).toMatchObject({ readerTrust: true, readerLateUploadHours: 24 });

    await att(c).put('/records', { employeeId: a.id, date: day, checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const hand = await dayOf(a.id);
    expect(hand.trust).toBe('MANUAL');
    expect((hand.trustReasons as any[])[0]).toMatchObject({ code: 'BY_HAND', by: 'Owner', text: 'Written by hand by Owner.' });

    await att(c).post('/records/import', { rows: [{ employeeCode: '712', date: day, checkIn: '09:00', checkOut: '18:00' }] }).expect(200);
    expect(codes(await dayOf(b.id))).toEqual(['IMPORT']);

    await att(c).put('/records', { employeeId: d.id, date: day, checkIn: '09:40', checkOut: '18:00' }).expect(200);
    const asked = await att(c).post('/requests', { employeeId: d.id, date: day, checkIn: '09:00', checkOut: '18:00', reason: 'Gate reader was slow' }).expect(201);
    await att(c).post('/requests/bulk-review', { ids: [asked.body.request.id], approve: true }).expect(200);
    const corrected = await dayOf(d.id);
    expect(corrected).toMatchObject({ source: 'REQUEST', trust: 'MANUAL' });
    expect((corrected.trustReasons as any[])[0]).toMatchObject({ code: 'CORRECTION', by: 'Owner' });

    /* The drawer says why. */
    const x = await att(c).get(`/days/explain?employeeId=${a.id}&date=${day}`).expect(200);
    expect(x.body.trust.level).toBe('MANUAL');
    expect(x.body.trust.reasons[0].text).toMatch(/by hand/);

    /* Off again: the switch is the company's feature. */
    await att(c).put('/rules', rules({ readerTrust: false })).expect(200);
    expect((await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features.attendanceReaderTrust).toBe(false);
  });

  it('a registered reader online, clock right, in time: Trusted; the same punches past the window: Check (late upload)', async () => {
    const c = await makeOwner();
    const p = await person(c, '721');
    await trustOn(c);
    const { send } = await reader(c);
    await send([`721\t${day} 09:00:00\t0\t1`, `721\t${day} 18:00:00\t1\t1`]);
    const trusted = await dayOf(p.id);
    expect(trusted).toMatchObject({ source: 'DEVICE', trust: 'TRUSTED', status: 'PRESENT' });
    expect(codes(trusted)).toEqual(['READERS_OK']);

    /* The filter and column on Attendance records. */
    const list = await att(c).get(`/records?from=${day}&to=${day}&trust=TRUSTED`).expect(200);
    expect(list.body.readerTrust).toBe(true);
    expect(list.body.records.map((r: any) => [r.employeeId, r.trust])).toEqual([[p.id, 'TRUSTED']]);
    expect((await att(c).get(`/records?from=${day}&to=${day}&trust=CHECK`).expect(200)).body.records).toHaveLength(0);

    /* A 24-hour window: punches made three days ago arrived late. */
    await att(c).put('/rules', rules({ readerLateUploadHours: 24 })).expect(200);
    expect((await att(c).post('/trust/recompute', { from: day, to: day }).expect(200)).body.worked).toBe(1);
    const late = await dayOf(p.id);
    expect(late.trust).toBe('CHECK');
    expect(codes(late)).toEqual(['LATE_UPLOAD', 'LATE_UPLOAD']);
    expect((late.trustReasons as any[])[0].text).toMatch(/reached CLOR \d+ days after it was made \(the window is 24 h\)/);
    /* Only the trust changed: the day and its history are as they were. */
    expect(await peoplePrisma.attendanceRecordHistory.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(1);
    expect(late.checkIn).toEqual(trusted.checkIn);
    expect(late.validated).toBe(trusted.validated);

    /* Month close lists Check days as something to look at, not a blocker. */
    const r = await att(c).get(`/months/${day.slice(0, 7)}/readiness`).expect(200);
    expect(r.body.checks.find((x: any) => x.key === 'trustCheck')).toMatchObject({ severity: 'check', count: 1 });
  });

  it('a reader offline that day, or with its clock out, or not registered: Check, saying which', async () => {
    const c = await makeOwner();
    const p = await person(c, '731');
    await trustOn(c);
    const { device, send } = await reader(c);
    await peoplePrisma.readerAlert.create({
      data: { accountId: (await peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id } })).accountId, orgId: c.orgId, key: `offline:${device.id}`, kind: 'offline', deviceId: device.id, severity: 'high', title: 'Gate has stopped reporting', details: '-', openedAt: new Date(Date.now() - 5 * 86_400_000) },
    });
    await send([`731\t${day} 09:00:00\t0\t1`, `731\t${day} 18:00:00\t1\t1`]);
    const offline = await dayOf(p.id);
    expect(offline.trust).toBe('CHECK');
    expect(codes(offline)).toEqual(['READER_OFFLINE']);
    expect((offline.trustReasons as any[])[0]).toMatchObject({ deviceId: device.id, text: 'Gate was offline that day.' });

    /* Back online before the day, but its clock was 20 minutes out that day. */
    await peoplePrisma.readerAlert.updateMany({ where: { orgId: c.orgId }, data: { resolvedAt: new Date(Date.now() - 4 * 86_400_000) } });
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { clockOffsetSec: 1200, clockCheckedAt: new Date(`${day}T10:00:00+05:30`) } });
    await att(c).post('/trust/recompute', { from: day, to: day }).expect(200);
    const drift = await dayOf(p.id);
    expect(codes(drift)).toEqual(['CLOCK_DRIFT']);
    expect((drift.trustReasons as any[])[0].text).toBe('Gate’s clock was out by about 20 min that day.');

    /* A reader taken off the register. */
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { isActive: false, clockOffsetSec: 0 } });
    await att(c).post('/trust/recompute', { from: day, to: day }).expect(200);
    expect(codes(await dayOf(p.id))).toEqual(['UNKNOWN_READER']);
  });

  it('a phone punch outside every work site is Check; inside one it counts like a reader', async () => {
    const { assessTrust } = await import('../services/attendance/trust.js');
    const phone = { id: 'ph', name: 'Phone punches', serialNumber: 'MOBILE-x', vendor: 'MOBILE', isActive: true, clockOffsetSec: null, clockCheckedAt: null };
    const at0 = new Date('2026-09-02T03:30:00Z');
    const base = { source: 'DEVICE', devices: new Map([['ph', phone]]), alerts: [], lateUploadHours: 24, window: { start: new Date('2026-09-01T18:30:00Z'), end: new Date('2026-09-02T18:30:00Z') } };
    const outside = assessTrust({ ...base, punches: [{ at: at0, createdAt: at0, deviceId: 'ph', verifyMode: 100, latitude: 12.9, outsideSite: true, geofenceId: null }] });
    expect(outside.trust).toBe('CHECK');
    expect(outside.reasons.map((r) => r.code)).toEqual(['OUTSIDE_GEOFENCE']);
    expect(outside.reasons[0].text).toBe('Phone punch at 09:00 was made outside every work site.');
    /* A phone has no reader clock to drift and is never "offline". */
    const inside = assessTrust({ ...base, alerts: [{ deviceId: 'ph', kind: 'offline', openedAt: at0, resolvedAt: null }], punches: [{ at: at0, createdAt: at0, deviceId: 'ph', verifyMode: 100, latitude: 12.9, outsideSite: false, geofenceId: 'g1' }] });
    expect(inside.trust).toBe('TRUSTED');
    /* An app clock-in is not a reader. */
    expect(assessTrust({ ...base, source: 'CLOCK', punches: [], clocks: [{ at: at0 }] }).reasons.map((r) => r.code)).toEqual(['NOT_A_READER']);
    /* Leave says so, and who. */
    expect(assessTrust({ ...base, source: 'LEAVE', by: 'Asha', punches: [] })).toEqual({ trust: 'MANUAL', reasons: [expect.objectContaining({ code: 'LEAVE', text: 'Written from approved leave by Asha.' })] });
  });

  it('exports a person’s punches as evidence: reader, serial, made and received, method, work site and the day’s trust', async () => {
    const c = await makeOwner();
    const p = await person(c, '741');
    await trustOn(c, 24);
    const { sn, send } = await reader(c);
    await send([`741\t${day} 09:02:00\t0\t1`, `741\t${day} 18:05:00\t1\t15`]);
    const e = await att(c).get(`/evidence/punches?employeeId=${p.id}&from=${day}&to=${day}`).expect(200);
    expect(e.body.employee.code).toBe('741');
    expect(e.body.summary).toMatchObject({ punches: 2, days: 1, check: 1, trusted: 0, manual: 0 });
    expect(e.body.rows).toHaveLength(2);
    expect(e.body.rows[0]).toMatchObject({ date: day, punched: `${day} 09:02:00`, readerId: '741', serialNumber: sn, reader: 'Gate', method: 'Fingerprint', geofence: 'Not a phone punch', dayTrust: 'CHECK' });
    expect(e.body.rows[1]).toMatchObject({ method: 'Face', punched: `${day} 18:05:00` });
    expect(e.body.rows[0].delayMinutes).toBeGreaterThan(24 * 60);
    expect(new Date(e.body.rows[0].receivedAt).getTime()).toBeGreaterThan(new Date(e.body.rows[0].punchedAt).getTime());
    expect(e.body.rows[0].dayReasons).toMatch(/reached CLOR/);

    const csv = await att(c).get(`/evidence/punches?employeeId=${p.id}&from=${day}&to=${day}&format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/Attendance evidence 741/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Day,Punched (IST),Received (IST),Delay (min),Direction,Reader ID,Reader serial,Reader,Method,Work site,Field punch review,Day trust,Why');
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith(`${day},${day} 09:02:00,`)).toBe(true);
    expect(lines[1]).toContain(`,741,${sn},Gate,Fingerprint,Not a phone punch,,CHECK,`);
  });

  it('a reader punch on a day marked by hand leaves the day alone and raises it for HR', async () => {
    const c = await makeOwner();
    const p = await person(c, '751');
    await trustOn(c);
    await att(c).put('/records', { employeeId: p.id, date: day, status: 'ABSENT' }).expect(200);
    const { send } = await reader(c);
    await send([`751\t${day} 09:00:00\t0\t1`]);
    const rec = await dayOf(p.id);
    expect(rec).toMatchObject({ source: 'MANUAL', status: 'ABSENT', checkIn: null, trust: 'MANUAL' });
    expect(codes(rec)).toEqual(['BY_HAND', 'READER_PUNCH_ON_DECIDED_DAY']);

    const ex = await att(c).get(`/exceptions?from=${day}&to=${day}`).expect(200);
    const item = ex.body.exceptions.find((x: any) => x.key === `READER_ON_MANUAL:${rec.id}`);
    expect(item).toMatchObject({ kind: 'READER_ON_MANUAL', title: 'Reader punch on a day marked by hand', employeeId: p.id, date: day, screen: 'records' });
    expect(item.detail).toMatch(/1 reader punch \(09:00\) arrived after the day was marked by hand/);

    /* Written by hand again, the punch stays raised until HR settles it. */
    await att(c).put('/records', { employeeId: p.id, date: day, status: 'ABSENT', note: 'Was not at work' }).expect(200);
    expect(codes(await dayOf(p.id))).toEqual(['BY_HAND', 'READER_PUNCH_ON_DECIDED_DAY']);
    /* Recalculating does not raise old punches again, nor drop the one raised. */
    await att(c).post('/trust/recompute', { from: day, to: day }).expect(200);
    expect(codes(await dayOf(p.id))).toEqual(['BY_HAND', 'READER_PUNCH_ON_DECIDED_DAY']);
    await att(c).post('/exceptions/state', { key: item.key, status: 'RESOLVED', note: 'Kept absent' }).expect(200);
    expect((await att(c).get(`/exceptions?from=${day}&to=${day}`).expect(200)).body.exceptions.some((x: any) => x.key === item.key)).toBe(false);
  });
});
