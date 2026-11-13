import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';

/**
 * Attendance state changes that raced, or lost a state, before (state machine review, Nov 2026):
 * approved overtime wiped by any rewrite of the day, closed-month checks made before the company's
 * write lock, punches in a closed month never worked out on reopen, reader commands sent after HR
 * cancelled them, a held full day's "paid" mark overwritten, and absence cases resurrected or split
 * from the employee's leaving.
 *
 * The races are made real, not simulated: the test holds the lock (or the row) the other side needs,
 * starts the operation, waits until Postgres shows it blocked on the test's connection, then lets go.
 */

/* Hooks into two People services, so a letter or a leaving can fail at the moment a test chooses. */
const hooks = vi.hoisted(() => ({
  issueLetter: null as null | ((...a: any[]) => Promise<any>),
  leaveEmployee: null as null | ((...a: any[]) => Promise<any>),
}));
vi.mock('../services/people/letters.js', async (orig) => {
  const real: any = await orig();
  return { ...real, issueLetter: (...a: any[]) => (hooks.issueLetter ? hooks.issueLetter(...a) : real.issueLetter(...a)) };
});
vi.mock('../services/people/lifecycle/leaving.js', async (orig) => {
  const real: any = await orig();
  return { ...real, leaveEmployee: (...a: any[]) => (hooks.leaveEmployee ? hooks.leaveEmployee(...a) : real.leaveEmployee(...a)) };
});

const { buildApp } = await import('../app.js');
const { peoplePrisma, peopleWrite } = await import('../utils/peoplePrisma.js');
const { decideOvertime, overtimeFor } = await import('../services/attendance/selfService.js');
const { waive, undo } = await import('../services/attendance/markRules.js');
const { writePunchDecision } = await import('../services/attendance/phonePunch.js');
const { fixFullDays } = await import('../services/attendance/fullDayFix.js');
const { sendAbsenceNotice, recordAbsconded, closeCase } = await import('../services/people/absconding.js');
const { LetterError } = await import('../services/people/letters.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});

async function makeOwner(): Promise<Ctx> {
  const email = `races.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Races Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const person = async (c: Ctx, code: string) => {
  const e = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  c.accountId = (await peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id }, select: { accountId: true } })).accountId;
  return e;
};

/** Wait until some connection is blocked by `pid` (the test's own transaction), or the operation is over without waiting. */
async function blockedBy(pid: number, over: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (over()) return;
    const [r] = await peoplePrisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity a WHERE ${pid}::int = ANY(pg_blocking_pids(a.pid))`;
    if (r.n > 0) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('The operation never reached the lock.');
}
const settle = <T>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (error: any) => ({ ok: false as const, error }));

/**
 * Close `month` under the company's write lock and, while the close is not yet committed, start `op`. The close
 * commits only once `op` is waiting on that lock, so `op` checked the month before the close and writes after it,
 * unless it checks inside the lock.
 */
async function closeDuring<T>(c: Ctx, month: string, op: () => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let ready!: (pid: number) => void;
  const started = new Promise<number>((done) => (ready = done));
  const closing = peopleWrite(c.orgId, async () => {
    const [{ pid }] = await peoplePrisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month, lockedByUserId: 'test' } });
    ready(pid);
    await gate;
  });
  const pid = await started;
  let over = false;
  const result = settle(op()).finally(() => (over = true));
  await blockedBy(pid, () => over);
  release();
  await closing;
  return result;
}

/** Change a row in a transaction held open until `op` is blocked on that row, then commit. */
async function changeDuring<T>(change: (tx: any) => Promise<unknown>, op: () => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let ready!: (pid: number) => void;
  const started = new Promise<number>((done) => (ready = done));
  const holding = peoplePrisma.$transaction(async (tx: any) => {
    const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
    await change(tx);
    ready(pid);
    await gate;
  }, { timeout: 60_000 });
  const pid = await started;
  let over = false;
  const result = settle(op()).finally(() => (over = true));
  await blockedBy(pid, () => over);
  release();
  await holding;
  return result;
}

/* 2026-10-06 is a Tuesday. Standard shift 09:00–18:00. */
describe('approved overtime', () => {
  it('stays approved when the day is written again with no more overtime, and can be asked again when there is more', async () => {
    const c = await makeOwner();
    const p = await person(c, '501');
    const day = (await att(c).put('/records', { employeeId: p.id, date: '2026-10-06', checkIn: '09:00', checkOut: '20:00' }).expect(200)).body.record;
    expect(day.overtimeMinutes).toBeGreaterThan(0);
    const ask = await peoplePrisma.overtimeRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, date: '2026-10-06', kind: 'OVERTIME', minutes: day.overtimeMinutes, reason: 'Month end' } });
    await decideOvertime(c.orgId, ask.id, true, { userId: 'hr-test' }, null);
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: day.id } })).overtimeApproved).toBe(true);

    /* The same day written again (a note, a recalculation): the approval stands. */
    await att(c).put('/records', { employeeId: p.id, date: '2026-10-06', checkIn: '09:00', checkOut: '20:00', note: 'Checked' }).expect(200);
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: day.id } })).overtimeApproved).toBe(true);

    /* More overtime than was approved: not approved, and the employee can ask for it. */
    await att(c).put('/records', { employeeId: p.id, date: '2026-10-06', checkIn: '09:00', checkOut: '21:00' }).expect(200);
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: day.id } })).overtimeApproved).toBe(false);
    const who = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id }, select: { id: true, accountId: true, orgId: true, name: true, code: true, areaId: true, branchId: true } });
    const row = (await overtimeFor(who, '2026-10')).days.find((d: any) => d.date === '2026-10-06');
    expect(row?.canAskOvertime).toBe(true);
  });
});

describe('a month closed while a change waits for the lock', () => {
  it('refuses a late-mark waiver and its undo', async () => {
    const c = await makeOwner();
    const p = await person(c, '502');
    const who = { accountId: c.accountId, orgId: c.orgId, userId: 'hr-test' };
    const w = await closeDuring(c, '2026-08', () => waive(who, p.id, '2026-08', 'First month'));
    expect(w.ok).toBe(false);
    expect((w as any).error.code).toBe('ATTENDANCE_MONTH_CLOSED');

    const c2 = await makeOwner();
    const p2 = await person(c2, '503');
    await peoplePrisma.attendancePenalty.create({ data: { accountId: c2.accountId, orgId: c2.orgId, employeeId: p2.id, month: '2026-08', status: 'WAIVED', days: 1, decidedByUserId: 'hr-test' } });
    const u = await closeDuring(c2, '2026-08', () => undo({ accountId: c2.accountId, orgId: c2.orgId, userId: 'hr-test' }, p2.id, '2026-08'));
    expect(u.ok).toBe(false);
    expect((u as any).error.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect(await peoplePrisma.attendancePenalty.count({ where: { orgId: c2.orgId, employeeId: p2.id } })).toBe(1);
  });

  it('refuses approving the day’s overtime', async () => {
    const c = await makeOwner();
    const p = await person(c, '504');
    const day = (await att(c).put('/records', { employeeId: p.id, date: '2026-10-06', checkIn: '09:00', checkOut: '20:00' }).expect(200)).body.record;
    const r = await closeDuring(c, '2026-10', () => att(c).post(`/records/${day.id}/overtime`, { approved: true }).then((x) => x));
    expect((r as any).value.status).toBe(409);
    expect((r as any).value.body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: day.id } })).overtimeApproved).toBe(false);
  });

  it('refuses validating its days', async () => {
    const c = await makeOwner();
    const p = await person(c, '505');
    const day = (await att(c).put('/records', { employeeId: p.id, date: '2026-10-06', checkIn: '09:00', checkOut: '18:00' }).expect(200)).body.record;
    const r = await closeDuring(c, '2026-10', () => att(c).post('/records/validate', { ids: [day.id] }).then((x) => x));
    expect((r as any).value.status).toBe(409);
    expect((r as any).value.body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect((await peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { id: day.id } })).validated).toBe(false);
  });
});

describe('punches that reach a closed month', () => {
  it('are worked out when the month reopens: reader punches and approved field punches', async () => {
    const c = await makeOwner();
    const p = await person(c, '506');
    const sn = `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    const device = (await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201)).body.device;
    await peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month: '2026-08', lockedByUserId: 'test' } });

    /* A reader's late upload: kept, the day left alone while the month is closed. */
    await request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send('506\t2026-08-04 09:00:00\t0\t1\n506\t2026-08-04 18:00:00\t1\t1').expect(200);
    expect(await peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-08-04' } })).toBe(0);

    /* A field punch approved while the month is closed. */
    const field = await Promise.all(['2026-08-05T09:00:00+05:30', '2026-08-05T18:00:00+05:30'].map((iso, i) =>
      peoplePrisma.devicePunch.create({ data: { accountId: c.accountId, orgId: c.orgId, deviceId: device.id, serialNumber: sn, pin: `F506-${i}`, at: new Date(iso), localTime: `2026-08-05 ${i ? '18' : '09'}:00:00`, state: String(i), kind: i ? 'OUT' : 'IN', employeeId: p.id, shiftDate: '2026-08-05', reviewStatus: 'PENDING' } })));
    for (const f of field) await writePunchDecision(c.orgId, f.id, true);
    expect(await peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-08-05' } })).toBe(0);

    await att(c).post('/months/2026-08/reopen', { reason: 'Count the late punches' }).expect(200);
    expect(await peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-08-04' } })).toBe(1);
    expect(await peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-08-05' } })).toBe(1);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, dayPending: true } })).toBe(0);
  });
});

describe('a reader command HR cancels as the reader asks for it', () => {
  it('is not sent to a ZKTeco/eSSL reader', async () => {
    const c = await makeOwner();
    await person(c, '507');
    const sn = `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    const device = (await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201)).body.device;
    const heartbeat = () => request(app).get(`/iclock/getrequest?SN=${sn}`);
    await heartbeat().expect(200);
    /* Whatever CLOR queued on its own is out of the way. */
    await peoplePrisma.deviceCommand.updateMany({ where: { deviceId: device.id, status: { in: ['PENDING', 'SENT'] } }, data: { status: 'DONE' } });
    const cmd = await peoplePrisma.deviceCommand.create({ data: { accountId: c.accountId, orgId: c.orgId, deviceId: device.id, serialNumber: sn, command: 'DATA DELETE USERINFO PIN=507', sequence: 0 } });
    const r = await changeDuring((tx) => tx.deviceCommand.update({ where: { id: cmd.id }, data: { status: 'CANCELLED' } }), () => heartbeat().then((x) => x));
    expect((r as any).value.text).not.toContain(`C:${cmd.id}:`);
    expect((await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe('CANCELLED');
  });

  it('is not sent to a Matrix controller', async () => {
    const c = await makeOwner();
    await person(c, '508');
    const made = (await att(c).post('/devices', { vendor: 'MATRIX_COSEC', name: 'Main door', direction: 'both', sourceTimezone: 'Asia/Kolkata' }).expect(201)).body;
    const call = (path: string) => request(app).get(`/matrix/${made.pushToken}${path}`).query({ 'device-type': 0, 'serial-no': 'MX12345' });
    await call('/login').expect(200);
    await peoplePrisma.deviceCommand.updateMany({ where: { deviceId: made.device.id, status: { in: ['PENDING', 'SENT'] } }, data: { status: 'DONE' } });
    const cmd = await peoplePrisma.deviceCommand.create({ data: { accountId: c.accountId, orgId: c.orgId, deviceId: made.device.id, serialNumber: made.device.serialNumber, command: 'cmd-id=18', sequence: 0 } });
    const r = await changeDuring((tx) => tx.deviceCommand.update({ where: { id: cmd.id }, data: { status: 'CANCELLED' } }), () => call('/getcmd').then((x) => x));
    expect((r as any).value.text).not.toBe('cmd-id=18');
    expect((await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe('CANCELLED');
  });
});

describe('a held full day HR marks paid as the daily job runs', () => {
  it('keeps the paid mark', async () => {
    const c = await makeOwner();
    const p = await person(c, '509');
    /* Held, and its day since deleted: the job settles it as changed, unless it was paid first. */
    const review = await peoplePrisma.attendanceFullDayReview.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, date: '2026-08-04', recordId: `gone-${rnd()}`, fromStatus: 'HALF_DAY', toStatus: 'PRESENT', workedMinutes: 480, outcome: 'HELD', reason: 'MONTH_CLOSED' } });
    const r = await changeDuring(
      (tx) => tx.attendanceFullDayReview.update({ where: { id: review.id }, data: { settledAs: 'PAID', settledAt: new Date(), settledByUserId: 'hr-test' } }),
      () => fixFullDays({ accountId: c.accountId, orgId: c.orgId }, { releasedAt: new Date('2026-01-01T00:00:00Z') }),
    );
    expect(r.ok).toBe(true);
    expect((await peoplePrisma.attendanceFullDayReview.findUniqueOrThrow({ where: { id: review.id } })).settledAs).toBe('PAID');
  });
});

describe('an absence case', () => {
  it('closed while its notice is being issued stays closed when the letter fails', async () => {
    const c = await makeOwner();
    const p = await person(c, '510');
    const who = { accountId: c.accountId, orgId: c.orgId, userId: 'hr-test', correlationId: `t-${rnd()}` };
    const kase = await peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, fromDate: '2026-10-01', lastAbsentDate: '2026-10-08', days: 6 } });
    hooks.issueLetter = async () => {
      await closeCase(who, kase.id, { outcome: 'RETURNED', note: 'Came back on Monday' });
      throw new LetterError('The letter has a blank field.');
    };
    try {
      await expect(sendAbsenceNotice(who, kase.id, { signatory: 'Meera Shah, HR' })).rejects.toThrow(/blank field/);
    } finally {
      hooks.issueLetter = null;
    }
    expect((await peoplePrisma.absenceCase.findUniqueOrThrow({ where: { id: kase.id } })).status).toBe('RETURNED');
    expect(await peoplePrisma.absenceNotice.count({ where: { caseId: kase.id } })).toBe(0);
  });

  it('stays absconded when the leaving was recorded and a later step of it failed', async () => {
    const c = await makeOwner();
    const p = await person(c, '511');
    const who = { accountId: c.accountId, orgId: c.orgId, userId: 'hr-test', correlationId: `t-${rnd()}` };
    const kase = await peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, fromDate: '2026-09-01', lastAbsentDate: '2026-09-10', days: 8, status: 'NOTICE_2' } });
    hooks.leaveEmployee = async (_who: any, existing: any) => {
      await peoplePrisma.employee.update({ where: { id: existing.id }, data: { status: 'LEFT', leavingType: 'ABSCONDED', dateOfLeaving: '2026-08-31' } });
      throw new Error('A later step of the leaving failed.');
    };
    try {
      await expect(recordAbsconded(who, kase.id, {})).rejects.toThrow(/later step/);
    } finally {
      hooks.leaveEmployee = null;
    }
    expect((await peoplePrisma.absenceCase.findUniqueOrThrow({ where: { id: kase.id } })).status).toBe('ABSCONDED');
  });

  it('goes back to the second notice when the leaving was not recorded', async () => {
    const c = await makeOwner();
    const p = await person(c, '512');
    const who = { accountId: c.accountId, orgId: c.orgId, userId: 'hr-test', correlationId: `t-${rnd()}` };
    const kase = await peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, fromDate: '2026-09-01', lastAbsentDate: '2026-09-10', days: 8, status: 'NOTICE_2' } });
    hooks.leaveEmployee = async () => {
      throw new Error('The leaving could not be recorded.');
    };
    try {
      await expect(recordAbsconded(who, kase.id, {})).rejects.toThrow(/could not be recorded/);
    } finally {
      hooks.leaveEmployee = null;
    }
    expect((await peoplePrisma.absenceCase.findUniqueOrThrow({ where: { id: kase.id } })).status).toBe('NOTICE_2');
  });
});
