import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

/**
 * Attendance audit, 7 Nov 2026: roles (#3, #4), month close and the attendance
 * start date (#5), clock-in from a browser (#6), unknown readers (#10) and
 * reader punch times that cannot be right (#11).
 *
 * September 2026 is a closed past month in every company here; "today" is
 * always worked out in IST, never written down.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant, outsideTenant } = await import('../utils/tenantScope.js');
const { expandPreset } = await import('../constants/permissionCatalog.js');
const { remember, UNCLAIMED_PER_NETWORK } = await import('../routes/iclock.js');
const { purgeExpiredRecords } = await import('../services/retention.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const IST = 330 * 60_000;
/** An IST wall-clock time, "YYYY-MM-DD HH:MM:SS", for an instant. */
const istLocal = (ms: number) => new Date(ms + IST).toISOString().slice(0, 19).replace('T', ' ');
const istToday = () => istLocal(Date.now()).slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function owner(): Promise<Ctx> {
  const email = `att.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Att Access ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', email };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function signIn(boss: Ctx, roleId: string, name: string): Promise<Ctx> {
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
/** A colleague holding one of the company's stock roles, as an owner gives it on Users. */
async function withRole(boss: Ctx, label: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  expect(role, label).toBeTruthy();
  return signIn(boss, role.id, label);
}
async function teamLead(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Lead ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: true }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  return signIn(boss, role.body.role.id, 'Lead');
}
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const serial = () => `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const punchFrom = (sn: string) => (lines: string[]) =>
  request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send(lines.join('\n'));
const keysOf = (preset: string) => expandPreset(preset).map((r) => `${r.module}::${r.subModule}::${r.action}`);

describe('#3 HR Manager runs Attendance', () => {
  it('the template carries records, shifts and the registers', () => {
    const keys = keysOf('HR_MANAGER');
    for (const a of ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT']) expect(keys).toContain(`ATTENDANCE::Attendance Records::${a}`);
    for (const a of ['VIEW', 'CREATE', 'EDIT', 'DELETE']) expect(keys).toContain(`ATTENDANCE::Shifts::${a}`);
  });

  it('opens the days, the shifts and the muster roll; not another company’s', async () => {
    const boss = await owner();
    const other = await owner();
    const p = await person(boss, { name: 'Asha', code: 'HR-1' });
    const hr = await withRole(boss, 'HR Manager');
    await att(hr).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    expect((await att(hr).get('/records?from=2026-09-01&to=2026-09-30').expect(200)).body.records.some((r: any) => r.employeeId === p.id)).toBe(true);
    await att(hr).get('/shifts').expect(200);
    const muster = await att(hr).get('/reports/muster?month=2026-09').expect(200);
    expect(JSON.stringify(muster.body)).toContain('Asha');
    /* Signed in to one company, nothing of another. */
    const elsewhere = await request(app).get(`/api/orgs/${other.orgId}/attendance/records?from=2026-09-01&to=2026-09-30`).set({ ...at(hr), 'x-org-id': other.orgId });
    expect([401, 403, 404]).toContain(elsewhere.status);
  });
});

describe('#4 Team Manager sees their own team’s days', () => {
  it('the template reads records and nothing more of them', () => {
    const keys = keysOf('TEAM_MANAGER').filter((k) => k.startsWith('ATTENDANCE::Attendance Records::'));
    expect(keys).toEqual(['ATTENDANCE::Attendance Records::VIEW']);
    expect(keysOf('TEAM_MANAGER').some((k) => k.startsWith('ATTENDANCE::Shifts::'))).toBe(false);
  });

  it('records, today and the calendar hold the team only; company reports are refused', async () => {
    const boss = await owner();
    const mgr = await withRole(boss, 'Team Manager');
    const lead = await person(boss, { name: 'Rahul Lead', code: 'TM-0' });
    const report = await person(boss, { name: 'Team Member', code: 'TM-1' });
    const outsider = await person(boss, { name: 'Not In Team', code: 'TM-2' });
    await runInTenant(boss.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } });
      await peoplePrisma.employee.update({ where: { id: report.id }, data: { reportingManagerId: lead.id } });
    });
    const day = plusDays(istToday(), -1);
    for (const id of [report.id, outsider.id]) await att(boss).put('/records', { employeeId: id, date: day, checkIn: '09:00', checkOut: '18:00' }).expect(200);

    const days = (await att(mgr).get(`/records?from=${day}&to=${day}`).expect(200)).body.records;
    expect(days.map((r: any) => r.employeeId)).toContain(report.id);
    expect(days.map((r: any) => r.employeeId)).not.toContain(outsider.id);
    const today = (await att(mgr).get(`/overview?date=${day}`).expect(200)).body;
    expect(today.headcount).toBe(2);
    const cal = (await att(mgr).get(`/calendar?month=${day.slice(0, 7)}`).expect(200)).body.days;
    expect(Math.max(...cal.map((d: any) => d.employed))).toBeLessThanOrEqual(2);
    expect(Math.max(...(await att(boss).get(`/calendar?month=${day.slice(0, 7)}`).expect(200)).body.days.map((d: any) => d.employed))).toBe(3);

    /* Reports read everyone: a team-only role is refused them, whatever grant it holds. */
    const lead2 = await teamLead(boss, ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::EXPORT']);
    for (const who of [mgr, lead2]) {
      const r = await att(who).get('/reports/muster?month=2026-09');
      expect(r.status).toBe(403);
    }
    expect((await att(lead2).get('/reports/muster?month=2026-09').expect(403)).body.code).toBe('TEAM_SCOPED');
    expect((await att(lead2).get('/reports').expect(403)).body.code).toBe('TEAM_SCOPED');
    /* No shift grant, no shifts; no change to records. */
    await att(mgr).get('/shifts').expect(403);
    await att(mgr).put('/records', { employeeId: report.id, date: day, checkIn: '10:00', checkOut: '18:00' }).expect(403);
  });

  it('the migration gives the new grants only to roles still exactly the old template, run as the app role', async () => {
    const plain = await owner();
    const changed = await owner();
    for (const c of [plain, changed]) await request(app).get(`/api/orgs/${c.orgId}/roles`).set(at(c)).expect(200);
    const sql = fs.readFileSync(path.resolve('prisma/platform/migrations/20261121090000_attendance_role_grants/migration.sql'), 'utf8');
    const statements = sql.split(/;\s*\n/).map((st) => st.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    const roleOf = (c: Ctx, name: string) => runInTenant(c.orgId, () => platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, name, branchId: null }, select: { id: true } }));
    const hrMgr = await roleOf(plain, 'HR Manager');
    const teamMgr = await roleOf(plain, 'Team Manager');
    const hrChanged = await roleOf(changed, 'HR Manager');
    const wideMgr = await roleOf(changed, 'Team Manager');
    const all = [hrMgr.id, teamMgr.id, hrChanged.id, wideMgr.id];
    const later = await outsideTenant('test: the new grants', () => platformPrisma.permission.findMany({ where: { module: 'ATTENDANCE', subModule: { in: ['Attendance Records', 'Shifts'] } }, select: { id: true, subModule: true, action: true } }));
    const key = new Map(later.map((p) => [p.id, `${p.subModule}::${p.action}`]));
    const someOther = await outsideTenant('test: a permission', () => platformPrisma.permission.findFirstOrThrow({ where: { module: 'PEOPLE', subModule: 'Employees', action: 'DELETE' } }));
    await outsideTenant('test: roles as made before the change, and as administrators changed some', async () => {
      await platformPrisma.rolePermission.deleteMany({ where: { roleId: { in: all }, permissionId: { in: later.map((x) => x.id) } } });
      /* An administrator unticked something on this HR Manager. */
      await platformPrisma.rolePermission.deleteMany({ where: { roleId: hrChanged.id, permissionId: someOther.id } });
      /* Someone made this Team Manager company-wide: records view would show everyone. */
      await platformPrisma.role.update({ where: { id: wideMgr.id }, data: { ownDocumentsOnly: false } });
    });
    const grants = (roleId: string) => outsideTenant('test: read grants', async () => (await platformPrisma.rolePermission.findMany({ where: { roleId, allowed: true, permissionId: { in: later.map((x) => x.id) } }, select: { permissionId: true } })).map((r) => key.get(r.permissionId)).sort());
    const run = () => outsideTenant('test: the attendance role migration', () => platformPrisma.$transaction(async (tx) => {
      for (const st of statements) await tx.$executeRawUnsafe(st);
    }));
    await run();
    expect(await grants(hrMgr.id)).toEqual(['Attendance Records::APPROVE', 'Attendance Records::CREATE', 'Attendance Records::DELETE', 'Attendance Records::EDIT', 'Attendance Records::EXPORT', 'Attendance Records::VIEW', 'Shifts::CREATE', 'Shifts::DELETE', 'Shifts::EDIT', 'Shifts::VIEW']);
    expect(await grants(teamMgr.id)).toEqual(['Attendance Records::VIEW']);
    expect(await grants(hrChanged.id)).toEqual([]);
    expect(await grants(wideMgr.id)).toEqual([]);
    /* Twice, nothing more. */
    await run();
    expect(await grants(teamMgr.id)).toEqual(['Attendance Records::VIEW']);
  });
});

describe('#5 month close and the attendance start date', () => {
  it('days before the start date are not "no record" and not loss of pay', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Started Late', code: 'SD-1' });
    const before = (await att(c).get('/months/2026-09/readiness').expect(200)).body;
    expect(before.noRecordDays).toBeGreaterThan(0);
    expect(before.checks.find((x: any) => x.key === 'noRecord').severity).toBe('confirm');
    const sumBefore = (await att(c).get('/summary?month=2026-09').expect(200)).body.rows.find((r: any) => r.employeeId === p.id);

    await att(c).put('/start-date', { date: '2026-09-15' }).expect(200);
    const after = (await att(c).get('/months/2026-09/readiness').expect(200)).body;
    expect(after.attendanceStartDate).toBe('2026-09-15');
    expect(after.noRecordDays).toBeLessThan(before.noRecordDays);
    const left = after.people.find((x: any) => x.employeeId === p.id).noRecordDates;
    expect(left.every((d: string) => d >= '2026-09-15')).toBe(true);
    const sumAfter = (await att(c).get('/summary?month=2026-09').expect(200)).body.rows.find((r: any) => r.employeeId === p.id);
    const untracked = before.noRecordDays - after.noRecordDays;
    expect(sumAfter.lossOfPayDays).toBe(sumBefore.lossOfPayDays - untracked);
    expect(sumAfter.payableDays).toBe(sumBefore.payableDays + untracked);
    expect(sumAfter.totalDays).toBe(sumBefore.totalDays);

    /* Closing still names the days left and asks for them by count. */
    const refused = await att(c).post('/months/2026-09/close', { acknowledge: true }).expect(409);
    expect(refused.body.code).toBe('NO_RECORD_UNCONFIRMED');
    expect(refused.body.noRecordDays).toBe(after.noRecordDays);
    await att(c).post('/months/2026-09/close', { acknowledge: true, confirmNoRecordDays: after.noRecordDays }).expect(200);
    /* A closed month's days went to Payroll: the start date cannot move across it. */
    expect((await att(c).put('/start-date', { date: '2026-09-20' }).expect(409)).body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect((await att(c).put('/start-date', { date: null }).expect(409)).body.code).toBe('ATTENDANCE_MONTH_CLOSED');
  });

  it('the start date may be today in IST, not tomorrow, and only a whole-company role sets it', async () => {
    const c = await owner();
    const other = await owner();
    await att(c).put('/start-date', { date: istToday() }).expect(200);
    await att(c).put('/start-date', { date: plusDays(istToday(), 1) }).expect(400);
    await att(c).put('/start-date', { date: '2026-02-31' }).expect(400);
    const lead = await teamLead(c, ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::APPROVE']);
    expect((await att(lead).put('/start-date', { date: '2026-09-01' }).expect(403)).body.code).toBe('TEAM_SCOPED');
    /* Another company's owner reaches nothing here. */
    const elsewhere = await request(app).put(`/api/orgs/${c.orgId}/attendance/start-date`).set({ ...at(other), 'x-org-id': c.orgId }).send({ date: '2026-09-01' });
    expect([401, 403, 404]).toContain(elsewhere.status);
    expect((await att(c).get('/months/2026-09/readiness').expect(200)).body.attendanceStartDate).toBe(istToday());
  });
});

describe('#6 clock-in from a browser follows the punch policy', () => {
  it('off, phone-only and outside the office addresses are refused; the office address counts', async () => {
    const c = await owner();
    const me = await person(c, { name: 'Owner', code: 'WC-1', workEmail: c.email });
    const clock = () => att(c).post('/clock', { direction: 'IN' });

    await att(c).put('/clock/settings', { allowed: false, addresses: [] }).expect(200);
    expect((await clock().expect(403)).body.code).toBe('WEB_CLOCK_OFF');
    expect((await att(c).get('/me').expect(200)).body.webClock).toMatchObject({ allowed: false, code: 'WEB_CLOCK_OFF' });

    await att(c).put('/clock/settings', { allowed: true, addresses: ['10.20.0.0/16'] }).expect(200);
    expect((await clock().expect(403)).body.code).toBe('WEB_CLOCK_ADDRESS');

    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { mobilePunch: true } }));
    expect((await clock().expect(403)).body.code).toBe('USE_PHONE_PUNCH');
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { mobilePunch: false } }));

    const settings = (await att(c).get('/clock/settings').expect(200)).body;
    expect(settings.yourAddress).toBe('127.0.0.1');
    await att(c).put('/clock/settings', { allowed: true, addresses: [settings.yourAddress, '10.20.0.0/16'] }).expect(200);
    expect((await att(c).get('/me').expect(200)).body.webClock).toMatchObject({ allowed: true });
    const ok = await clock().expect(200);
    expect(ok.body.kind).toBe('IN');
    /* No list: from anywhere, as before. */
    expect((await att(c).put('/clock/settings', { allowed: true, addresses: [] }).expect(200)).body.addresses).toEqual([]);
  });

  it('settings are checked, company-wide, and another company’s are out of reach', async () => {
    const c = await owner();
    const other = await owner();
    expect((await att(c).put('/clock/settings', { allowed: true, addresses: ['300.1.1.1'] }).expect(400)).body.code).toBe('BAD_ADDRESS');
    expect((await att(c).put('/clock/settings', { allowed: true, addresses: ['10.0.0.0/33'] }).expect(400)).body.code).toBe('BAD_ADDRESS');
    await att(c).put('/clock/settings', { addresses: [] }).expect(400);
    const lead = await teamLead(c, ['ATTENDANCE::Employee Portal::VIEW', 'ATTENDANCE::Employee Portal::EDIT']);
    expect((await att(lead).put('/clock/settings', { allowed: false, addresses: [] }).expect(403)).body.code).toBe('TEAM_SCOPED');
    const elsewhere = await request(app).put(`/api/orgs/${c.orgId}/attendance/clock/settings`).set({ ...at(other), 'x-org-id': c.orgId }).send({ allowed: false, addresses: [] });
    expect([401, 403, 404]).toContain(elsewhere.status);
    expect((await att(c).get('/clock/settings').expect(200)).body.allowed).toBe(true);
  });
});

describe('#11 reader punch times that cannot be right', () => {
  it('a punch ahead of now is held and changes no day; one a few minutes ahead counts', async () => {
    const c = await owner();
    const other = await owner();
    const p = await person(c, { name: 'Clock Ahead', code: '701' });
    const sn = serial();
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    const push = punchFrom(sn);

    const ahead = istLocal(Date.now() + 2 * 86_400_000);
    expect((await push([`701\t${ahead}\t0\t1`]).expect(200)).text).toMatch(/^OK/);
    const held = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, serialNumber: sn, localTime: ahead } }));
    expect(held).toMatchObject({ reviewStatus: 'HELD', heldReason: 'FUTURE', shiftDate: null, employeeId: p.id });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: ahead.slice(0, 10) } }))).toBe(0);

    /* Five minutes ahead is a reader clock a little fast: the day is written, even across IST midnight. */
    const soon = istLocal(Date.now() + 5 * 60_000);
    await push([`701\t${soon}\t0\t1`]).expect(200);
    const counted = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, serialNumber: sn, localTime: soon } }));
    expect(counted.reviewStatus).toBeNull();
    expect(counted.shiftDate).toBeTruthy();
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: counted.shiftDate! } }))).toBe(1);

    const list = (await att(c).get('/held-punches').expect(200)).body;
    expect(list.held.map((h: any) => h.id)).toEqual([held.id]);
    expect(list.held[0]).toMatchObject({ due: false, employeeName: 'Clock Ahead' });
    expect((await att(c).post(`/held-punches/${held.id}/release`).expect(409)).body.code).toBe('STILL_IN_FUTURE');
    /* Another company cannot see or decide it. */
    expect((await att(other).get('/held-punches').expect(200)).body.held).toEqual([]);
    await att(other).post(`/held-punches/${held.id}/discard`).expect(404);
  });

  it('a held punch whose time has come is counted once; another is discarded', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Fixed Clock', code: '702' });
    const sn = serial();
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    const a = istLocal(Date.now() + 3 * 86_400_000);
    const b = istLocal(Date.now() + 3 * 86_400_000 + 3_600_000);
    await punchFrom(sn)([`702\t${a}\t0\t1`, `702\t${b}\t1\t1`]).expect(200);
    const [first, second] = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findMany({ where: { orgId: c.orgId, serialNumber: sn, reviewStatus: 'HELD' }, orderBy: { at: 'asc' } }));
    expect(second).toBeTruthy();
    /* As if the days had passed: the punch is now yesterday's, 09:30 IST. */
    const yesterday = plusDays(istToday(), -1);
    await runInTenant(c.orgId, () => peoplePrisma.devicePunch.update({ where: { id: first.id }, data: { localTime: `${yesterday} 09:30:00`, at: new Date(Date.parse(`${yesterday}T09:30:00+05:30`)) } }));
    const done = (await att(c).post(`/held-punches/${first.id}/release`).expect(200)).body;
    expect(done.punch.shiftDate).toBe(yesterday);
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: yesterday } }))).toBe(1);
    await att(c).post(`/held-punches/${first.id}/release`).expect(404);
    await att(c).post(`/held-punches/${second.id}/discard`).expect(200);
    expect((await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id: second.id } }))).reviewStatus).toBe('REJECTED');
    expect((await att(c).get('/held-punches').expect(200)).body.held).toEqual([]);
  });

  it('a date that does not exist writes no punch and is listed for the reader’s clock to be fixed', async () => {
    const c = await owner();
    await person(c, { name: 'Feb Thirty One', code: '703' });
    const sn = serial();
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    await punchFrom(sn)(['703\t2026-02-31 09:00:00\t0\t1', '703\t2026-02-28 25:10:00\t0\t1']).expect(200);
    expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, serialNumber: sn } }))).toBe(0);
    const list = (await att(c).get('/held-punches').expect(200)).body;
    expect(list.impossible.map((x: any) => x.time)).toContain('2026-02-31 09:00:00');
  });
});

describe('#10 readers nobody has claimed', () => {
  it('are kept up to a cap a network, the longest silent giving way', async () => {
    const network = `198.51.100.${Math.floor(Math.random() * 250)}-${rnd()}`;
    const serials = Array.from({ length: UNCLAIMED_PER_NETWORK + 5 }, () => serial());
    for (const sn of serials) await remember(sn, null, null, network);
    const kept = await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.findMany({ where: { network }, select: { serialNumber: true } }));
    expect(kept).toHaveLength(UNCLAIMED_PER_NETWORK);
    /* The newest is always heard: adding it shows it was seen. */
    expect(kept.map((k) => k.serialNumber)).toContain(serials[serials.length - 1]);
    /* One already kept is only touched. */
    await remember(serials[serials.length - 1], '10.0.0.9', 'ZK', network);
    expect(await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.count({ where: { network } }))).toBe(UNCLAIMED_PER_NETWORK);
    await outsideTenant('test: tidy', () => peoplePrisma.unclaimedReader.deleteMany({ where: { network } }));
  });

  it('are pruned after 30 days silent', async () => {
    const old = serial();
    const fresh = serial();
    await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.createMany({ data: [
      { serialNumber: old, lastSeenAt: new Date(Date.now() - 31 * 86_400_000), network: 'test-prune' },
      { serialNumber: fresh, lastSeenAt: new Date(Date.now() - 29 * 86_400_000), network: 'test-prune' },
    ] }));
    const r = await purgeExpiredRecords();
    expect(r.unclaimedReaders).toBeGreaterThanOrEqual(1);
    const left = await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.findMany({ where: { serialNumber: { in: [old, fresh] } }, select: { serialNumber: true } }));
    expect(left.map((x) => x.serialNumber)).toEqual([fresh]);
    await outsideTenant('test: tidy', () => peoplePrisma.unclaimedReader.deleteMany({ where: { network: 'test-prune' } }));
  });

  it('may send a small body only; a company’s reader may send a big batch', async () => {
    const big = Array.from({ length: 3_000 }, (_, i) => `9${String(i).padStart(4, '0')}\t2026-09-01 09:00:00\t0\t1`);
    expect(big.join('\n').length).toBeGreaterThan(64 * 1024);
    await punchFrom(serial())(big).expect(413);
    const c = await owner();
    const sn = serial();
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    expect((await punchFrom(sn)(big).expect(200)).text).toMatch(/^OK/);
  });
});

