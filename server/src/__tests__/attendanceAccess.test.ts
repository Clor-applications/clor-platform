import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
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
const { remember, UNCLAIMED_PER_BLOCK, UNCLAIMED_MAX } = await import('../routes/iclock.js');
const { READER_KNOWN, READER_LIMITS, readerAddressKey } = await import('../middleware/rateLimit.js');
const { attentionFor } = await import('../services/attendance/selfService.js');
const { HELD_BULK_PAIRS, decideHeldPunches } = await import('../services/attendance/punches.js');
const { flushWebhooks } = await import('../services/attendance/webhooks.js');
const { peopleWrite } = await import('../utils/peoplePrisma.js');
const { KNOWN_SERIALS_MAX, knownSerialCache } = await import('../routes/iclock.js');
const { blockOf } = await import('../services/attendance/network.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { monthReview } = await import('../services/attendance/selfService.js');
const { outcomes } = await import('../services/payroll/provisionalDays.js');
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
    const later = await outsideTenant('test: the new grants', () => platformPrisma.permission.findMany({ where: { module: 'ATTENDANCE', subModule: { in: ['Attendance Records', 'Shifts'] } }, select: { id: true, subModule: true, action: true } }));
    const key = new Map(later.map((p) => [p.id, `${p.subModule}::${p.action}`]));
    const someOther = await outsideTenant('test: a permission', () => platformPrisma.permission.findFirstOrThrow({ where: { module: 'PEOPLE', subModule: 'Employees', action: 'DELETE' } }));
    /* Roles exactly as the templates made them before this migration (its own old_template), not as today's
       templates make them: later template changes (20261116090000_people_role_templates_erpnext) moved on. */
    const before = new Map<string, string[]>();
    for (const m of sql.matchAll(/\('(hr manager|team manager)', '([^']+)', '([^']+)', '([^']+)'\)/g)) before.set(m[1], [...(before.get(m[1]) || []), `${m[2]}::${m[3]}::${m[4]}`]);
    const setGrants = (roleId: string, keys: string[]) => outsideTenant('test: old grants', async () => {
      const role = await platformPrisma.role.findUniqueOrThrow({ where: { id: roleId } });
      await platformPrisma.rolePermission.deleteMany({ where: { roleId } });
      for (const k of keys) {
        const [module, subModule, action] = k.split('::');
        const p = await platformPrisma.permission.upsert({ where: { module_subModule_action: { module, subModule, action } }, create: { module, subModule, action }, update: {} });
        await platformPrisma.rolePermission.create({ data: { accountId: role.accountId, orgId: role.orgId, roleId, permissionId: p.id, allowed: true, permLevel: 0 } });
      }
    });
    for (const id of [hrMgr.id, hrChanged.id]) await setGrants(id, before.get('hr manager')!);
    for (const id of [teamMgr.id, wideMgr.id]) await setGrants(id, before.get('team manager')!);
    await outsideTenant('test: roles as made before the change, and as administrators changed some', async () => {
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
    await att(c).post('/months/2026-09/close', { acknowledge: true, ...after.noRecordConfirm }).expect(200);
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
  it('are kept up to a cap a block (/24, /64), the longest silent giving way, and up to a ceiling in all', async () => {
    const [a, b] = [10 + Math.floor(Math.random() * 200), Math.floor(Math.random() * 250)];
    const prefix = `100.${a}.${b}.`;
    const inBlock = { network: { startsWith: prefix } };
    /* Twenty-five addresses of one /24 count as one block. */
    const serials = Array.from({ length: UNCLAIMED_PER_BLOCK + 5 }, () => serial());
    for (const [i, sn] of serials.entries()) await remember(sn, null, null, `${prefix}${i + 1}`);
    const kept = await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.findMany({ where: inBlock, select: { serialNumber: true } }));
    expect(kept).toHaveLength(UNCLAIMED_PER_BLOCK);
    /* The newest is always heard: adding it shows it was seen. */
    expect(kept.map((k) => k.serialNumber)).toContain(serials[serials.length - 1]);
    /* One already kept is only touched. */
    await remember(serials[serials.length - 1], '10.0.0.9', 'ZK', `${prefix}200`);
    expect(await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.count({ where: inBlock }))).toBe(UNCLAIMED_PER_BLOCK);
    /* Another block is not touched by this one's cap. */
    const other = serial();
    await remember(other, null, null, `100.${a}.${(b + 1) % 250}.7`);
    expect(await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.count({ where: { serialNumber: other } }))).toBe(1);
    /* IPv6: one /64 is one block. */
    const v6 = `2001:0db8:${rnd().slice(0, 4).padStart(4, '0').replace(/[^0-9a-f]/g, 'a')}:0001:`;
    for (let i = 0; i < UNCLAIMED_PER_BLOCK + 2; i += 1) await remember(serial(), null, null, `${v6}0000:0000:0000:${String(i).padStart(4, '0')}`);
    expect(await outsideTenant('test: unclaimed readers', () => peoplePrisma.unclaimedReader.count({ where: { network: { startsWith: v6 } } }))).toBe(UNCLAIMED_PER_BLOCK);
    await outsideTenant('test: tidy', () => peoplePrisma.unclaimedReader.deleteMany({ where: { OR: [inBlock, { serialNumber: other }, { network: { startsWith: v6 } }] } }));
  });

  it('never number more than the ceiling in all', async () => {
    const tag = `100.250.${Math.floor(Math.random() * 250)}`;
    /* Already full, from many blocks (a row each), all quieter than the next one. */
    await outsideTenant('test: fill', () => peoplePrisma.unclaimedReader.createMany({ data: Array.from({ length: UNCLAIMED_MAX }, (_, i) => ({ serialNumber: `FILL${tag.replace(/\./g, '')}X${i}`, network: `${tag}.${i % 250}-${i}`, lastSeenAt: new Date(Date.now() - 86_400_000) })), skipDuplicates: true }));
    const fresh = serial();
    await remember(fresh, null, null, '100.251.1.1');
    expect(await outsideTenant('test: count', () => peoplePrisma.unclaimedReader.count())).toBeLessThanOrEqual(UNCLAIMED_MAX);
    expect(await outsideTenant('test: count', () => peoplePrisma.unclaimedReader.count({ where: { serialNumber: fresh } }))).toBe(1);
    await outsideTenant('test: tidy', () => peoplePrisma.unclaimedReader.deleteMany({ where: { OR: [{ serialNumber: { startsWith: `FILL${tag.replace(/\./g, '')}X` } }, { serialNumber: fresh }] } }));
  });

  it('a block is a /24 or a /64, whatever the address looks like', () => {
    expect(blockOf('49.205.10.4')).toBe('49.205.10.0/24');
    expect(blockOf('::ffff:49.205.10.250')).toBe('49.205.10.0/24');
    expect(blockOf('2401:4900:1c2a:5b00::1')).toBe('2401:4900:1c2a:5b00::/64');
    expect(blockOf('2401:4900:1c2a:5b00:ffff::9')).toBe(blockOf('2401:4900:1c2a:5b00::1'));
    expect(blockOf('2401:4900:1c2a:5b01::1')).not.toBe(blockOf('2401:4900:1c2a:5b00::1'));
    expect(blockOf('not an address')).toBeNull();
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


describe('review of #144', () => {
  /** A company with a team role (records view and approve) leading one report, and an outsider. */
  async function withTeam() {
    const boss = await owner();
    const lead = await teamLead(boss, ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::APPROVE']);
    const me = await person(boss, { name: 'Lead Self', code: 'RV-0' });
    const report = await person(boss, { name: 'In The Team', code: 'RV-1' });
    const outsider = await person(boss, { name: 'Outside Team', code: 'RV-2' });
    await runInTenant(boss.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: lead.userId } });
      await peoplePrisma.employee.update({ where: { id: report.id }, data: { reportingManagerId: me.id } });
    });
    return { boss, lead, report, outsider };
  }
  /** A reader punch held for a look, its time moved into September as if the reader had sent it then. */
  async function heldIn(c: Ctx, code: string, sn: string, when: string) {
    const ahead = istLocal(Date.now() + 2 * 86_400_000 + Math.floor(Math.random() * 3_600_000));
    await punchFrom(sn)([`${code}\t${ahead}\t0\t1`]).expect(200);
    const p = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, serialNumber: sn, localTime: ahead } }));
    await runInTenant(c.orgId, () => peoplePrisma.devicePunch.update({ where: { id: p.id }, data: { localTime: when, at: new Date(Date.parse(`${when.replace(' ', 'T')}+05:30`)) } }));
    return p.id;
  }

  it('a team role asking for one person’s days outside its team gets none', async () => {
    const { boss, lead, report, outsider } = await withTeam();
    for (const id of [report.id, outsider.id]) await att(boss).put('/records', { employeeId: id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    expect((await att(lead).get(`/records?from=2026-09-01&to=2026-09-30&employeeId=${outsider.id}`).expect(200)).body.records).toEqual([]);
    expect((await att(lead).get(`/records?from=2026-09-01&to=2026-09-30&employeeId=${report.id}`).expect(200)).body.records.map((r: any) => r.employeeId)).toEqual([report.id]);
    expect((await att(boss).get(`/records?from=2026-09-01&to=2026-09-30&employeeId=${outsider.id}`).expect(200)).body.records).toHaveLength(1);
  });

  it('a held punch in the month blocks the close; whoever closes months counts or discards it, a team role only its team’s', async () => {
    const { boss, lead, report } = await withTeam();
    const sn = serial();
    await att(boss).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    const mine = await heldIn(boss, 'RV-1', sn, '2026-09-10 09:05:00');
    const theirs = await heldIn(boss, 'RV-2', sn, '2026-09-11 09:05:00');

    const r = (await att(boss).get('/months/2026-09/readiness').expect(200)).body;
    expect(r.checks.find((x: any) => x.key === 'held')).toMatchObject({ count: 2, severity: 'block' });
    expect(r.ready).toBe(false);
    const refused = await att(boss).post('/months/2026-09/close', { acknowledge: true, ...r.noRecordConfirm }).expect(409);
    expect(refused.body.code).toBe('HELD_PUNCHES');
    /* The team's readiness counts the team's held punch only. */
    expect((await att(lead).get('/months/2026-09/readiness').expect(200)).body.checks.find((x: any) => x.key === 'held').count).toBe(1);

    /* Records approve, no reader rights: the list and the decision, for the team only. */
    expect((await att(lead).get('/held-punches').expect(200)).body.held.map((h: any) => h.id)).toEqual([mine]);
    await att(lead).post(`/held-punches/${theirs}/discard`).expect(404);
    await att(lead).post(`/held-punches/${mine}/release`).expect(200);
    expect(await runInTenant(boss.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: report.id, date: '2026-09-10' } }))).toBe(1);
    await att(boss).post(`/held-punches/${theirs}/discard`).expect(200);

    const after = (await att(boss).get('/months/2026-09/readiness').expect(200)).body;
    expect(after.checks.find((x: any) => x.key === 'held').count).toBe(0);
    await att(boss).post('/months/2026-09/close', { acknowledge: true, ...after.noRecordConfirm }).expect(200);
  });

  it('the start date cannot move across a month a final payroll run took from Attendance; a run of typed-in numbers does not block it', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Paid Already', code: 'RV-3' });
    const accountId = (await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id } }))).accountId;
    const run = await runInTenant(c.orgId, async () => {
      const period = await payrollPrisma.payrollPeriod.create({ data: { accountId, orgId: c.orgId, name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', createdByUserId: c.userId } });
      const r = await payrollPrisma.payrollRun.create({ data: { accountId, orgId: c.orgId, number: `PR-${rnd()}`, periodId: period.id, payrollDate: '2026-09-30', status: 'APPROVED', createdByUserId: c.userId } });
      await payrollPrisma.payrollInput.create({ data: { accountId, orgId: c.orgId, runId: r.id, employeeId: p.id, source: 'MANUAL', payableDays: 30, workingDays: 30, createdByUserId: c.userId } });
      return r;
    });
    /* Typed-in days only: the run never read Attendance, so the start date may move. */
    await att(c).put('/start-date', { date: '2026-09-15' }).expect(200);
    await att(c).put('/start-date', { date: null }).expect(200);

    /* One input pulled from Attendance: refused. */
    await runInTenant(c.orgId, () => payrollPrisma.payrollInput.updateMany({ where: { runId: run.id }, data: { source: 'ATTENDANCE' } }));
    expect((await att(c).put('/start-date', { date: '2026-09-15' }).expect(409)).body.code).toBe('PAYROLL_TAKEN');
    /* From nothing to a later date moves every day before it, September's too. */
    expect((await att(c).put('/start-date', { date: '2026-10-05' }).expect(409)).body.code).toBe('PAYROLL_TAKEN');

    /* A pulled Attendance snapshot counts too, whatever the inputs say. */
    await runInTenant(c.orgId, () => payrollPrisma.payrollInput.updateMany({ where: { runId: run.id }, data: { source: 'MANUAL' } }));
    await runInTenant(c.orgId, () => payrollPrisma.payrollRun.update({ where: { id: run.id }, data: { attendanceSnapshots: [{ month: '2026-09', version: 1, closed: true }] } }));
    expect((await att(c).put('/start-date', { date: '2026-09-15' }).expect(409)).body.code).toBe('PAYROLL_TAKEN');

    /* A cancelled run took nothing. */
    await runInTenant(c.orgId, () => payrollPrisma.payrollRun.updateMany({ where: { orgId: c.orgId }, data: { status: 'CANCELLED' } }));
    await att(c).put('/start-date', { date: '2026-09-15' }).expect(200);
  });

  it('the start date holds on the muster roll, the employee’s month and the provisional-days outcomes', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Muster Person', code: 'RV-4' });
    const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id } }));
    const before = await runInTenant(c.orgId, () => monthReview(e as any, '2026-09'));
    await att(c).put('/start-date', { date: '2026-09-15' }).expect(200);

    const m = (await request(app).get(`/api/orgs/${c.orgId}/people/compliance/registers/muster?month=2026-09`).set(at(c)).expect(200)).body;
    const row = m.rows.find((r: string[]) => r[1] === 'Muster Person');
    /* 1 Sept (Tuesday), before the start: blank. 16 Sept (Wednesday), after: absent. */
    expect(row[3 + 0]).toBe('');
    expect(row[3 + 15]).toBe('A');

    const after = await runInTenant(c.orgId, () => monthReview(e as any, '2026-09'));
    expect(after.summary.lossOfPayDays).toBeLessThan(before.summary.lossOfPayDays);
    expect(after.summary.payableDays - before.summary.payableDays).toBe(before.summary.lossOfPayDays - after.summary.lossOfPayDays);

    const out = await runInTenant(c.orgId, () => outcomes(e.accountId, c.orgId, '2026-09-01', '2026-09-30'));
    const days = out.get(p.id)!;
    expect(days.get('2026-09-01')).toMatchObject({ absent: 0, paid: 1 });
    expect(days.get('2026-09-16')).toMatchObject({ absent: 1, paid: 0 });
  });

  it('a day the browser clock opened is closed by it, whatever the rules say now', async () => {
    const c = await owner();
    await person(c, { name: 'Owner', code: 'RV-5', workEmail: c.email });
    expect((await att(c).post('/clock', { kind: 'IN' }).expect(200)).body.kind).toBe('IN');
    await att(c).put('/clock/settings', { allowed: false, addresses: [] }).expect(200);
    expect((await att(c).get('/me').expect(200)).body.webClock).toMatchObject({ allowed: true, outOnly: true, code: 'WEB_CLOCK_OFF' });
    /* In again is refused; out is not. */
    expect((await att(c).post('/clock', { kind: 'IN' }).expect(403)).body.code).toBe('WEB_CLOCK_OFF');
    expect((await att(c).post('/clock', {}).expect(200)).body.kind).toBe('OUT');
    expect((await att(c).get('/me').expect(200)).body.webClock).toMatchObject({ allowed: false, code: 'WEB_CLOCK_OFF' });
  });

  it('the public API lists only punches that count', async () => {
    const c = await owner();
    await person(c, { name: 'Api Person', code: 'RV-6' });
    const sn = serial();
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    await punchFrom(sn)(['RV-6\t2026-09-09 09:00:00\t0\t1']).expect(200);
    await heldIn(c, 'RV-6', sn, '2026-09-09 18:00:00');
    const counted = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, serialNumber: sn, localTime: '2026-09-09 09:00:00' } }));
    /* A second counted punch, then marked rejected (as a refused field punch is). */
    await punchFrom(sn)(['RV-6\t2026-09-09 13:00:00\t1\t1']).expect(200);
    await runInTenant(c.orgId, () => peoplePrisma.devicePunch.updateMany({ where: { orgId: c.orgId, serialNumber: sn, localTime: '2026-09-09 13:00:00' }, data: { reviewStatus: 'REJECTED' } }));
    const key = (await att(c).post('/integrations/keys', { name: `Key ${rnd()}`, scopes: ['attendance:read'] }).expect(201)).body.token;
    const punches = (await request(app).get('/v1/attendance/punches?from=2026-09-09&to=2026-09-09').set('Authorization', `Bearer ${key}`).expect(200)).body.punches;
    expect(punches.map((p: any) => p.time)).toEqual([counted.localTime]);
  });
});

describe('re-review of #144', () => {
  /** A reader the company added, by its id. */
  async function addGate(c: Ctx, name = 'Gate') {
    const sn = serial();
    const body = (await att(c).post('/devices', { serialNumber: sn, name, direction: 'both' }).expect(201)).body;
    return { sn, id: (body.device || body).id as string };
  }
  /** Held punches written straight in, as a reader with its clock weeks ahead would have left them. */
  async function heldRows(c: Ctx, gate: { sn: string; id: string }, rows: Array<{ employeeId: string | null; pin: string; localTime: string; aheadMin?: number; out?: boolean }>) {
    const accountId = (await runInTenant(c.orgId, () => peoplePrisma.attendanceDevice.findUniqueOrThrow({ where: { id: gate.id } }))).accountId;
    await runInTenant(c.orgId, () =>
      peoplePrisma.devicePunch.createMany({
        data: rows.map((r) => {
          const at = new Date(Date.parse(`${r.localTime.replace(' ', 'T')}+05:30`));
          /* aheadMin: the reader's clock was that far ahead, so the punch arrived that long before its time. */
          return { accountId, orgId: c.orgId, deviceId: gate.id, serialNumber: gate.sn, pin: r.pin, employeeId: r.employeeId, localTime: r.localTime, at, state: r.out ? '1' : '0', kind: r.out ? 'OUT' : 'IN', reviewStatus: 'HELD', heldReason: 'FUTURE', ...(r.aheadMin ? { createdAt: new Date(at.getTime() - r.aheadMin * 60_000) } : {}) };
        }),
      }),
    );
  }
  const pad = (n: number) => String(n).padStart(2, '0');

  it('1,600 held punches from one reader: the month close lists that month, and Count all takes every one', async () => {
    const c = await owner();
    const a = await person(c, { name: 'Bulk One', code: 'BK-1' });
    const b = await person(c, { name: 'Bulk Two', code: 'BK-2' });
    const gate = await addGate(c, 'Front gate');
    const side = await addGate(c, 'Side door');
    /* October: 2 people x 20 days x 40 punches a day, 13:00 onwards, a minute apart. */
    const october: Array<{ employeeId: string | null; pin: string; localTime: string }> = [];
    for (const [who, pin] of [[a.id, 'BK-1'], [b.id, 'BK-2']] as const) {
      for (let d = 1; d <= 20; d += 1) for (let m = 0; m < 40; m += 1) october.push({ employeeId: who, pin, localTime: `2026-10-${pad(d)} ${pad(13 + Math.floor(m / 60))}:${pad(m % 60)}:00` });
    }
    await heldRows(c, gate, october);
    /* Not October, and still ahead of today: never taken by October's Count all. */
    const ahead = istLocal(Date.now() + 5 * 86_400_000).slice(0, 10);
    await heldRows(c, gate, [{ employeeId: a.id, pin: 'BK-1', localTime: `${ahead} 14:00:00` }]);
    /* Another reader's October punch, and one nobody's ID matches. */
    await heldRows(c, side, [{ employeeId: a.id, pin: 'BK-1', localTime: '2026-10-21 14:00:00' }, { employeeId: null, pin: '999', localTime: '2026-10-21 15:00:00' }]);

    /* The checklist counts matched punches only: the unmatched one is under `unmatched`. */
    const r = (await att(c).get('/months/2026-10/readiness').expect(200)).body;
    expect(r.checks.find((x: any) => x.key === 'held').count).toBe(1601);

    const list = (await att(c).get('/held-punches?month=2026-10').expect(200)).body;
    expect(list.total).toBe(1602);
    expect(list.held).toHaveLength(1000);
    expect(list.held.every((h: any) => h.time.startsWith('2026-10'))).toBe(true);
    expect(list.readers.find((x: any) => x.deviceId === gate.id)).toMatchObject({ reader: 'Front gate', count: 1600, countable: 1600 });
    expect(list.readers.find((x: any) => x.deviceId === side.id)).toMatchObject({ count: 2, countable: 1 });

    const started = Date.now();
    const out = (await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-10' }).expect(200)).body;
    expect(Date.now() - started).toBeLessThan(120_000);
    expect(out).toMatchObject({ counted: 1600, notYet: 0, notMatched: 0, closedDays: 0, left: 0 });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: { in: [a.id, b.id] }, date: { gte: '2026-10-01', lte: '2026-10-20' } } }))).toBe(40);
    /* The punch ahead of today, from the same reader but not October, is still held. */
    expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id, reviewStatus: 'HELD' } }))).toBe(1);
    /* Run again: nothing left to take. */
    expect((await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-10' }).expect(200)).body.counted).toBe(0);

    /* One audit line for the batch, with the counts. */
    const audit = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'DEVICE_PUNCH', entityId: gate.id } }));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'APPROVE' });
    expect(audit[0].message).toMatch(/1600 held reader punches were counted from Front gate for 2026-10/);

    /* Discard all from the side door: the unmatched one too. */
    expect((await att(c).post('/held-punches/bulk', { action: 'discard', deviceId: side.id, month: '2026-10' }).expect(200)).body).toMatchObject({ discarded: 2, left: 0 });
    const after = (await att(c).get('/months/2026-10/readiness').expect(200)).body;
    expect(after.checks.find((x: any) => x.key === 'held').count).toBe(0);
  }, 300_000);

  it('200 people x 30 days x 2 punches: counted a chunk at a time, other writes go through between chunks', async () => {
    const c = await owner();
    const people: Array<{ id: string; code: string }> = [];
    for (let i = 0; i < 200; i += 1) {
      const code = `SC-${String(i).padStart(3, '0')}`;
      people.push({ id: (await person(c, { name: `Scale ${i}`, code })).id, code });
    }
    const bystander = await person(c, { name: 'Bystander', code: 'SC-X' });
    const gate = await addGate(c, 'Main gate');
    const rows: Array<{ employeeId: string; pin: string; localTime: string }> = [];
    for (const p of people) for (let d = 1; d <= 30; d += 1) for (const t of ['13:00:00', '18:00:00']) rows.push({ employeeId: p.id, pin: p.code, localTime: `2026-10-${pad(d)} ${t}` });
    await heldRows(c, gate, rows);
    expect(rows).toHaveLength(12_000);

    let calls = 0;
    let counted = 0;
    let writeMs = 0;
    for (;;) {
      const out = (await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-10' }).expect(200)).body;
      calls += 1;
      counted += out.counted;
      /* At most HELD_BULK_PAIRS (person, day) pairs per call: 2 punches each. */
      expect(out.counted).toBeLessThanOrEqual(HELD_BULK_PAIRS * 2);
      if (calls === 1) {
        expect(out.left).toBeGreaterThan(0);
        /* Between chunks, someone else's write is not waiting on the whole run. */
        const started = Date.now();
        await att(c).put('/records', { employeeId: bystander.id, date: '2026-10-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
        writeMs = Date.now() - started;
      }
      if (!out.left) break;
    }
    expect(counted).toBe(12_000);
    expect(calls).toBe(30);
    expect(writeMs).toBeLessThan(10_000);
    expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id, reviewStatus: 'HELD' } }))).toBe(0);
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { orgId: c.orgId, employeeId: { in: people.map((p) => p.id) }, date: { gte: '2026-10-01', lte: '2026-10-30' } } }))).toBe(6_000);
  }, 900_000);

  it('a reader whose clock ran 30 min ahead: Count moved back makes no late mark, and the reader’s own time is kept', async () => {
    const c = await owner();
    const moved = await person(c, { name: 'Moved Back', code: 'OF-1' });
    const asIs = await person(c, { name: 'As Recorded', code: 'OF-2' });
    const gate = await addGate(c, 'Fast clock');
    const other = await addGate(c, 'Fast clock two');
    /* Tuesday 6 Oct: the reader said 09:30 and 18:30; it was 09:00 and 18:00. */
    await heldRows(c, gate, [
      { employeeId: moved.id, pin: 'OF-1', localTime: '2026-10-06 09:30:00', aheadMin: 30 },
      { employeeId: moved.id, pin: 'OF-1', localTime: '2026-10-06 18:30:00', aheadMin: 30 },
      { employeeId: moved.id, pin: 'OF-1', localTime: '2026-10-07 09:31:00', aheadMin: 31 },
    ]);
    await heldRows(c, other, [{ employeeId: asIs.id, pin: 'OF-2', localTime: '2026-10-06 09:30:00', aheadMin: 30 }]);
    const list = (await att(c).get('/held-punches?month=2026-10').expect(200)).body;
    expect(list.readers.find((r: any) => r.deviceId === gate.id).aheadMinutes).toBe(30);

    const out = (await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-10', shiftMinutes: 30 }).expect(200)).body;
    expect(out).toMatchObject({ counted: 3, shiftMinutes: 30, left: 0 });
    const day = await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: moved.id, date: '2026-10-06' } } }));
    expect(day.lateMinutes).toBe(0);
    const punch = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, deviceId: gate.id, recordedLocalTime: '2026-10-06 09:30:00' } }));
    expect(punch).toMatchObject({ localTime: '2026-10-06 09:00:00', clockShiftMinutes: 30, reviewStatus: null, shiftDate: '2026-10-06' });
    const audit = await runInTenant(c.orgId, () => platformPrisma.auditLog.findFirstOrThrow({ where: { orgId: c.orgId, entity: 'DEVICE_PUNCH', entityId: gate.id } }));
    expect(audit.message).toMatch(/moved back 30 min/);

    /* The same time counted as recorded is late. */
    await att(c).post('/held-punches/bulk', { action: 'release', deviceId: other.id, month: '2026-10' }).expect(200);
    const late = await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: asIs.id, date: '2026-10-06' } } }));
    expect(late.lateMinutes).toBeGreaterThan(0);
    expect((await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, deviceId: other.id } }))).clockShiftMinutes).toBeNull();

    await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, shiftMinutes: -5 }).expect(400);
    await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, shiftMinutes: 2.5 }).expect(400);
  });

  it('moved back, a resend of the reader’s log is a repeat; counted punches go to the webhooks and the HR tool with their corrected times', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Resent Log', code: '8801' });
    const q = await person(c, { name: 'One At A Time', code: '8802' });
    const gate = await addGate(c, 'Fast clock');
    const accountId = (await runInTenant(c.orgId, () => peoplePrisma.attendanceDevice.findUniqueOrThrow({ where: { id: gate.id } }))).accountId;
    /* A connected HR tool that takes punches (no network here: they wait in its outbox). */
    const conn = await runInTenant(c.orgId, () => peoplePrisma.hrConnection.create({ data: { accountId, orgId: c.orgId, adapter: 'GREYTHR', name: 'HR', enabled: true, pushPunches: true, createdByUserId: c.userId } }));
    await heldRows(c, gate, [
      { employeeId: p.id, pin: '8801', localTime: '2026-10-06 09:30:00', aheadMin: 30 },
      { employeeId: p.id, pin: '8801', localTime: '2026-10-06 18:30:00', aheadMin: 30, out: true },
    ]);
    expect((await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-10', shiftMinutes: 30 }).expect(200)).body).toMatchObject({ counted: 2, left: 0, resends: 0 });
    const day = () => runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: p.id, date: '2026-10-06' } } }));
    const before = await day();
    expect(before.lateMinutes).toBe(0);
    expect(before.workedMinutes).toBeGreaterThan(0);
    const moved = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, deviceId: gate.id, localTime: '2026-10-06 09:00:00' } }));
    expect(moved.recordedAt?.toISOString()).toBe(new Date('2026-10-06T09:30:00+05:30').toISOString());

    /* S2: the HR tool gets them as counted, at 09:00 and 18:00 — not at the reader's 09:30. */
    const outbox = await runInTenant(c.orgId, () => peoplePrisma.hrOutbox.findMany({ where: { connectionId: conn.id }, orderBy: { key: 'asc' } }));
    expect(outbox.map((r) => JSON.parse(r.payload).time)).toEqual(['2026-10-06 09:00:00', '2026-10-06 18:00:00']);

    /* S1: the reader sends its whole log again (upload position reset): every line is a repeat. */
    const count = () => runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id } }));
    expect(await count()).toBe(2);
    await punchFrom(gate.sn)(['8801\t2026-10-06 09:30:00\t0\t1', '8801\t2026-10-06 18:30:00\t1\t1']).expect(200);
    expect(await count()).toBe(2);
    const after = await day();
    expect(after).toMatchObject({ workedMinutes: before.workedMinutes, overtimeMinutes: before.overtimeMinutes, lateMinutes: 0 });
    expect(await runInTenant(c.orgId, () => peoplePrisma.hrOutbox.count({ where: { connectionId: conn.id } }))).toBe(2);

    /* A held punch moved back onto a time the reader already sent is a repeat: it stays held, and the answer says so. */
    await runInTenant(c.orgId, () =>
      peoplePrisma.devicePunch.create({ data: { accountId, orgId: c.orgId, deviceId: gate.id, serialNumber: gate.sn, pin: '8801', employeeId: p.id, localTime: '2026-10-06 09:30:00', at: new Date('2026-10-06T09:30:00+05:30'), state: '0', kind: 'IN', reviewStatus: 'HELD', heldReason: 'FUTURE' } }),
    );
    expect((await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-10', shiftMinutes: 30 }).expect(200)).body).toMatchObject({ counted: 0, left: 0, resends: 1 });

    /* One held punch counted on its own goes out too. */
    await heldRows(c, gate, [{ employeeId: q.id, pin: '8802', localTime: '2026-10-07 09:05:00' }]);
    const one = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, deviceId: gate.id, pin: '8802' } }));
    await att(c).post(`/held-punches/${one.id}/release`).expect(200);
    const sent = await runInTenant(c.orgId, () => peoplePrisma.hrOutbox.findMany({ where: { connectionId: conn.id } }));
    expect(sent.map((r) => JSON.parse(r.payload)).find((x) => x.code === '8802')).toMatchObject({ time: '2026-10-07 09:05:00' });
  });

  it('a Count’s punch webhook leaves once the Count is committed, and never from a Count rolled back', async () => {
    const got: string[] = [];
    const receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        got.push(body);
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', () => done()));
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
    try {
      const c = await owner();
      const p = await person(c, { name: 'Hooked Count', code: '8811' });
      const gate = await addGate(c, 'Hooked gate');
      await att(c).post(`/integrations/webhooks`, { name: 'HRMS', url: `http://127.0.0.1:${(receiver.address() as any).port}/clor`, events: ['punch'] }).expect(201);
      await heldRows(c, gate, [
        { employeeId: p.id, pin: '8811', localTime: '2026-10-08 09:20:00', aheadMin: 20 },
        { employeeId: p.id, pin: '8811', localTime: '2026-10-08 18:20:00', aheadMin: 20, out: true },
      ]);
      const punchEvents = () => got.map((b) => JSON.parse(b)).filter((e) => e.event === 'punch');

      /* Rolled back after the Count: nothing is sent, and the punches are still held. */
      await expect(runInTenant(c.orgId, () => peopleWrite(c.orgId, async () => {
        expect((await decideHeldPunches(c.orgId, { deviceId: gate.id }, 'release', { shiftMinutes: 20 })).counted).toBe(2);
        /* Anything sent from inside the transaction would have gone by now. */
        await flushWebhooks();
        throw new Error('roll back');
      }))).rejects.toThrow('roll back');
      await flushWebhooks();
      expect(punchEvents()).toEqual([]);
      expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id, reviewStatus: 'HELD' } }))).toBe(2);

      /* Committed: one punch event, with the corrected times. */
      await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, shiftMinutes: 20 }).expect(200);
      await flushWebhooks();
      expect(punchEvents()).toHaveLength(1);
      expect(punchEvents()[0].data.punches.map((x: any) => x.time)).toEqual(['2026-10-08 09:00:00', '2026-10-08 18:00:00']);
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE = 'false';
      await new Promise((done) => receiver.close(done));
    }
  });

  it('00:30 on 1 Nov from a clock an hour ahead, counted from November, goes on 31 Oct', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Month Edge', code: '8812' });
    const gate = await addGate(c, 'Edge gate');
    /* November's list and close check hold it, by the reader's time; Count puts it where it was really made. */
    await heldRows(c, gate, [{ employeeId: p.id, pin: '8812', localTime: '2026-11-01 00:30:00', aheadMin: 60 }]);
    expect((await att(c).get('/held-punches?month=2026-11').expect(200)).body.total).toBe(1);
    expect((await att(c).get('/held-punches?month=2026-10').expect(200)).body.total).toBe(0);
    const out = (await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-11', shiftMinutes: 60 }).expect(200)).body;
    expect(out).toMatchObject({ counted: 1, left: 0 });
    const punch = await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, deviceId: gate.id } }));
    expect(punch).toMatchObject({ localTime: '2026-10-31 23:30:00', recordedLocalTime: '2026-11-01 00:30:00', shiftDate: '2026-10-31', dayPending: false });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-10-31' } }))).toBe(1);
  });

  it('punches counted while their month was closed have their days worked out when it reopens', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Reopen Me', code: 'RO-1' });
    const r = (await att(c).get('/months/2026-09/readiness').expect(200)).body;
    await att(c).post('/months/2026-09/close', { acknowledge: true, ...r.noRecordConfirm }).expect(200);
    const gate = await addGate(c);
    await heldRows(c, gate, [
      { employeeId: p.id, pin: 'RO-1', localTime: '2026-09-14 13:00:00' },
      { employeeId: p.id, pin: 'RO-1', localTime: '2026-09-14 18:00:00' },
    ]);
    expect((await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id }).expect(200)).body).toMatchObject({ counted: 2, closedDays: 1 });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-09-14' } }))).toBe(0);
    expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id, dayPending: true } }))).toBe(2);

    const reopened = (await att(c).post('/months/2026-09/reopen', { reason: 'Reader clock fixed late' }).expect(200)).body;
    expect(reopened.pendingDays).toBe(1);
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-09-14' } }))).toBe(1);
    expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id, dayPending: true } }))).toBe(0);
  });

  it('days left marked by a reopen that never got to them are worked out before the month closes again', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Stranded Day', code: 'SD-1' });
    const r = (await att(c).get('/months/2026-09/readiness').expect(200)).body;
    await att(c).post('/months/2026-09/close', { acknowledge: true, ...r.noRecordConfirm }).expect(200);
    const gate = await addGate(c);
    await heldRows(c, gate, [{ employeeId: p.id, pin: 'SD-1', localTime: '2026-09-15 09:00:00' }, { employeeId: p.id, pin: 'SD-1', localTime: '2026-09-15 18:00:00' }]);
    expect((await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id }).expect(200)).body).toMatchObject({ counted: 2, closedDays: 1 });
    /* The lock goes but the days are not worked out (a reopen that failed half way, before this fix). */
    await runInTenant(c.orgId, () => peoplePrisma.attendanceMonthLock.deleteMany({ where: { orgId: c.orgId, month: '2026-09' } }));
    const again = (await att(c).get('/months/2026-09/readiness').expect(200)).body;
    await att(c).post('/months/2026-09/close', { acknowledge: true, ...again.noRecordConfirm });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-09-15' } }))).toBe(1);
    expect(await runInTenant(c.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: gate.id, dayPending: true } }))).toBe(0);
  });

  it('a flood of invented serials from one block is turned away before any lookup; the serial cache is a bounded LRU', async () => {
    const saved = { ...READER_LIMITS };
    process.env.DISABLE_RATE_LIMIT = 'false';
    try {
      READER_LIMITS.perBlock = 3;
      READER_LIMITS.perAddress = 10_000;
      const sent = Array.from({ length: 6 }, () => serial());
      const statuses: number[] = [];
      for (const sn of sent) statuses.push((await request(app).get(`/iclock/cdata?SN=${sn}&options=all`)).status);
      expect(statuses.filter((x) => x === 503).length).toBeGreaterThan(0);
      /* A refused request never reached the lookup. */
      const refused = sent.filter((_, i) => statuses[i] === 503);
      for (const sn of refused) expect(knownSerialCache.has(sn)).toBe(false);
    } finally {
      Object.assign(READER_LIMITS, saved);
      process.env.DISABLE_RATE_LIMIT = 'true';
    }

    const c = await owner();
    const gate = await addGate(c);
    expect(await knownSerialCache.check(gate.sn)).toBe(true);
    for (let i = 0; i < KNOWN_SERIALS_MAX + 10; i += 1) {
      await knownSerialCache.check(`LRU${rnd()}${i}`);
      /* The company's reader keeps heartbeating, so it stays among the most recently used. */
      if (i % 1000 === 0) await knownSerialCache.check(gate.sn);
    }
    expect(knownSerialCache.size()).toBeLessThanOrEqual(KNOWN_SERIALS_MAX);
    expect(knownSerialCache.has(gate.sn)).toBe(true);
  }, 300_000);

  it('bulk decisions: a team role takes only its team’s; bad input and other companies’ readers are refused', async () => {
    const boss = await owner();
    const lead = await teamLead(boss, ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::APPROVE']);
    const me = await person(boss, { name: 'Lead Self', code: 'TB-0' });
    const report = await person(boss, { name: 'In Team', code: 'TB-1' });
    const outsider = await person(boss, { name: 'Out Team', code: 'TB-2' });
    await runInTenant(boss.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: lead.userId } });
      await peoplePrisma.employee.update({ where: { id: report.id }, data: { reportingManagerId: me.id } });
    });
    const gate = await addGate(boss);
    await heldRows(boss, gate, [
      { employeeId: report.id, pin: 'TB-1', localTime: '2026-10-05 14:00:00' },
      { employeeId: outsider.id, pin: 'TB-2', localTime: '2026-10-05 14:05:00' },
      { employeeId: null, pin: '888', localTime: '2026-10-05 14:10:00' },
    ]);
    const seen = (await att(lead).get('/held-punches?month=2026-10').expect(200)).body;
    expect(seen.total).toBe(1);
    expect(seen.readers).toEqual([expect.objectContaining({ deviceId: gate.id, count: 1, countable: 1 })]);
    expect((await att(lead).post('/held-punches/bulk', { action: 'discard', deviceId: gate.id, month: '2026-10' }).expect(200)).body).toMatchObject({ discarded: 1, notMatched: 0 });
    const left = await runInTenant(boss.orgId, () => peoplePrisma.devicePunch.findMany({ where: { orgId: boss.orgId, deviceId: gate.id, reviewStatus: 'HELD' }, select: { employeeId: true } }));
    expect(left.map((x) => x.employeeId).sort()).toEqual([null, outsider.id].sort());

    await att(boss).post('/held-punches/bulk', { action: 'count', deviceId: gate.id }).expect(400);
    await att(boss).post('/held-punches/bulk', { action: 'release' }).expect(400);
    await att(boss).post('/held-punches/bulk', { action: 'release', deviceId: gate.id, month: '2026-13' }).expect(400);
    const other = await owner();
    await att(other).post('/held-punches/bulk', { action: 'discard', deviceId: gate.id }).expect(404);
    expect(await runInTenant(boss.orgId, () => peoplePrisma.devicePunch.count({ where: { orgId: boss.orgId, deviceId: gate.id, reviewStatus: 'HELD' } }))).toBe(2);
  });

  it('Count on a punch whose day is in a closed month says so, and leaves the day alone', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Closed Month', code: 'CM-1' });
    const r = (await att(c).get('/months/2026-09/readiness').expect(200)).body;
    await att(c).post('/months/2026-09/close', { acknowledge: true, ...r.noRecordConfirm }).expect(200);
    const gate = await addGate(c);
    await heldRows(c, gate, [{ employeeId: p.id, pin: 'CM-1', localTime: '2026-09-10 14:00:00' }]);
    const id = (await runInTenant(c.orgId, () => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: c.orgId, deviceId: gate.id } }))).id;
    const out = (await att(c).post(`/held-punches/${id}/release`).expect(200)).body;
    expect(out).toMatchObject({ closedMonth: true, message: 'Counted. The day is in a closed month, so it was not changed — adjust in payroll.' });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-09-10' } }))).toBe(0);
    /* In bulk too. */
    await heldRows(c, gate, [{ employeeId: p.id, pin: 'CM-1', localTime: '2026-09-11 14:00:00' }]);
    expect((await att(c).post('/held-punches/bulk', { action: 'release', deviceId: gate.id }).expect(200)).body).toMatchObject({ counted: 1, closedDays: 1 });
  });

  it('the address limit: a company’s reader per address, a serial nobody added per block', () => {
    const known = (ip: string) => ({ ip, [READER_KNOWN]: true });
    const unknown = (ip: string) => ({ ip, [READER_KNOWN]: false });
    expect(readerAddressKey(known('49.205.10.4'))).not.toBe(readerAddressKey(known('49.205.10.5')));
    expect(readerAddressKey(unknown('49.205.10.4'))).toBe(readerAddressKey(unknown('49.205.10.200')));
    expect(readerAddressKey(unknown('2401:4900:1c2a:5b00::1'))).toBe(readerAddressKey(unknown('2401:4900:1c2a:5b00::9')));
    expect(readerAddressKey(known('49.205.10.4'))).not.toBe(readerAddressKey(unknown('49.205.10.4')));
  });

  it('unknown serials flooding from one line do not slow a company’s reader on it', async () => {
    const c = await owner();
    const gate = await addGate(c);
    const saved = { ...READER_LIMITS };
    process.env.DISABLE_RATE_LIMIT = 'false';
    try {
      READER_LIMITS.perAddress = 5;
      READER_LIMITS.perSerial = 1000;
      let busy = 0;
      for (let i = 0; i < 8; i += 1) if ((await request(app).get(`/iclock/cdata?SN=${serial()}&options=all`)).status === 503) busy += 1;
      expect(busy).toBeGreaterThan(0);
      /* Same address, the company's reader: its own bucket. */
      expect((await request(app).get(`/iclock/cdata?SN=${gate.sn}&options=all`)).status).toBe(200);
    } finally {
      Object.assign(READER_LIMITS, saved);
      process.env.DISABLE_RATE_LIMIT = 'true';
    }
  });

  it('remembering an unknown reader is best effort: with the table busy, it is skipped, not queued', async () => {
    const sn = serial();
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    let locked!: () => void;
    const isLocked = new Promise<void>((done) => (locked = done));
    const holder = outsideTenant('test: hold the unclaimed-reader lock', () =>
      peoplePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('unclaimed-reader'))`;
        locked();
        await held;
      }, { timeout: 30_000 }),
    );
    await isLocked;
    const started = Date.now();
    const kept = await outsideTenant('test: remember', () => remember(sn, null, null, '100.77.1.1'));
    expect(kept).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    release();
    await holder;
    expect(await outsideTenant('test: count', () => peoplePrisma.unclaimedReader.count({ where: { serialNumber: sn } }))).toBe(0);
    /* Free again: remembered. */
    expect(await outsideTenant('test: remember', () => remember(sn, null, null, '100.77.1.1'))).toBe(true);
    expect(await outsideTenant('test: count', () => peoplePrisma.unclaimedReader.count({ where: { serialNumber: sn } }))).toBe(1);
  });

  it('days before the start date are not raised as needing a fix', async () => {
    const c = await owner();
    const p = await person(c, { name: 'Attention Start', code: 'AS-1' });
    const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id } }));
    const before = await runInTenant(c.orgId, () => attentionFor(e as any, '2026-09-01', '2026-09-30'));
    expect(before.some((x) => x.kind === 'NO_PUNCHES' && x.date < '2026-09-15')).toBe(true);
    await att(c).put('/start-date', { date: '2026-09-15' }).expect(200);
    const after = await runInTenant(c.orgId, () => attentionFor(e as any, '2026-09-01', '2026-09-30'));
    expect(after.some((x) => x.kind === 'NO_PUNCHES' && x.date < '2026-09-15')).toBe(false);
    expect(after.some((x) => x.kind === 'NO_PUNCHES' && x.date >= '2026-09-15')).toBe(true);
  });
});
