import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * A simulated Matrix COSEC door controller speaking its PUSH API to
 * /matrix/<token> (requests as the Matrix guide gives them), and the company's
 * side under Attendance → Readers.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { readField3, clockFixDue, clockParts } = await import('../routes/matrix.js');
const { setTimeCommand } = await import('../services/attendance/adms.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `mx.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Matrix owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Matrix Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** What the controller sends: GETs with everything in the query. */
const controller = (token: string, serial = 'MX12345') => {
  const call = (path: string, params: Record<string, string | number> = {}) =>
    request(app).get(`/matrix/${token}${path}`).query({ 'device-type': 0, 'serial-no': serial, ...params });
  return {
    login: () => call('/login'),
    poll: () => call('/poll'),
    getcmd: () => call('/getcmd'),
    updatecmd: (cmdId: number, status: 1 | 0, extra: Record<string, string | number> = {}) => call('/updatecmd', { 'cmd-id': cmdId, status, ...extra }),
    getconfig: () => call('/getconfig'),
    updateconfig: (configId: number, status: 1 | 0) => call('/updateconfig', { 'config-id': configId, status }),
    event: (seq: number, evt: number, when: string, fields: Record<string, string | number> = {}) => {
      const [d, t] = when.split(' ');
      const [yyyy, mm, dd] = d.split('-');
      const [hh, mi, ss] = t.split(':');
      return call('/setevent', { 'seq-no': seq, evt_id: evt, 'date-dd': dd, 'date-mm': mm, 'date-yyyy': yyyy, 'time-hh': hh, 'time-mm': mi, 'time-ss': ss, ...fields });
    },
  };
};
const kv = (text: string) => Object.fromEntries(text.trim().split(/\s+/).map((p) => p.split('=')));

const addMatrix = async (c: Ctx) => (await api(c).post('/devices', { vendor: 'MATRIX_COSEC', name: 'Main door', direction: 'both', sourceTimezone: 'Asia/Kolkata' }).expect(201)).body;

describe('adding a Matrix controller', () => {
  it('is offered as a driver and gives a URL once', async () => {
    const c = await makeOwner();
    const list = await api(c).get('/devices').expect(200);
    expect(list.body.drivers.find((d: any) => d.vendor === 'MATRIX_COSEC')).toMatchObject({ capabilities: expect.arrayContaining(['push', 'commands', 'health']), unverified: true });
    expect(list.body.matrixBase).toMatch(/\/matrix\/$/);
    const made = await addMatrix(c);
    expect(made.pushToken).toMatch(/^clorp_/);
    expect(made.device.serialNumber).toMatch(/^MATRIX-/);
    expect(made.device.pushTokenPrefix).toBe(made.pushToken.slice(0, 12));
    expect(made.device.pushTokenHash).toBeUndefined();
  });
});

describe('a controller talking to CLOR', () => {
  it('logs in, polls, and its punches become attendance', async () => {
    const c = await makeOwner();
    const { pushToken, device } = await addMatrix(c);
    const p = await person(c, { name: 'Door User', code: '7001' });
    const m = controller(pushToken);

    const login = await m.login().expect(200);
    expect(login.type).toBe('text/plain');
    expect(kv(login.text)).toMatchObject({ 'poll-interval': '10', status: '1', format: '0' });
    const seen = await peoplePrisma.attendanceDevice.findUnique({ where: { id: device.id } });
    expect(seen?.lastSeenAt).toBeTruthy();
    expect(seen?.model).toBe('COSEC Door V3 MX12345');

    expect(kv((await m.poll().expect(200)).text)).toEqual({ 'cmd-avlbl': '0', 'cnfg-avlbl': '0', status: '1' });

    /* Entry by finger (field-3 bit 6), then exit by card (bit 5 + bit 0). */
    expect(kv((await m.event(1, 101, '2026-09-01 09:02:10', { 'field-1': '7001', 'field-3': 1 << 6 }).expect(200)).text)).toEqual({ status: '1' });
    expect(kv((await m.event(2, 101, '2026-09-01 18:31:00', { 'field-1': '7001', 'field-3': (1 << 5) | 1 }).expect(200)).text)).toEqual({ status: '1' });
    const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId: c.orgId, employeeId: p.id }, orderBy: { at: 'asc' } });
    expect(punches.map((x) => [x.localTime, x.kind, x.verifyMode])).toEqual([
      ['2026-09-01 09:02:10', 'IN', 1],
      ['2026-09-01 18:31:00', 'OUT', 2],
    ]);
    const day = (await api(c).get(`/records?from=2026-09-01&to=2026-09-01&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(day).toMatchObject({ source: 'DEVICE', checkInTime: '09:02', checkOutTime: '18:31', status: 'PRESENT' });

    /* The controller resends after an outage: nothing doubles. */
    await m.event(1, 101, '2026-09-01 09:02:10', { 'field-1': '7001', 'field-3': 1 << 6 }).expect(200);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(2);

    /* Other events go to the reader log, denials as errors with who was refused. */
    await m.event(3, 157, '2026-09-01 18:35:00', { 'field-1': '7002' }).expect(200);
    await m.event(4, 453, '2026-09-01 18:36:00').expect(200);
    const logs = await peoplePrisma.deviceLog.findMany({ where: { deviceId: device.id }, orderBy: { localTime: 'asc' } });
    expect(logs.map((l) => [l.kind, l.code, l.operator])).toEqual([
      ['ERROR', 'EVT-157', '7002'],
      ['OPERATION', 'EVT-453', null],
    ]);
    expect(logs[0].details).toContain('disabled user');

    /* Times are read in the zone the reader is set to. */
    await request(app).put(`/api/orgs/${c.orgId}/attendance/devices/${device.id}`).set(at(c)).send({ name: 'Main door', direction: 'both', sourceTimezone: 'Asia/Dubai' }).expect(200);
    await m.event(5, 101, '2026-09-02 07:30:00', { 'field-1': '7001', 'field-3': 1 << 6 }).expect(200);
    const dubai = await peoplePrisma.devicePunch.findFirst({ where: { orgId: c.orgId, employeeId: p.id, localTime: { startsWith: '2026-09-02' } } });
    expect(dubai?.localTime).toBe('2026-09-02 09:00:00');

    /* An event with no time is refused, not stored. */
    expect(kv((await request(app).get(`/matrix/${pushToken}/setevent`).query({ 'device-type': 0, 'serial-no': 'MX12345', evt_id: 101 }).expect(200)).text)).toEqual({ status: '0' });
  });

  it('is sent commands from the Readers screen and reports how they went', async () => {
    const c = await makeOwner();
    const { pushToken, device } = await addMatrix(c);
    const m = controller(pushToken);
    await m.login().expect(200);

    await api(c).post(`/devices/${device.id}/commands`, { action: 'INFO' }).expect(200);
    await api(c).post(`/devices/${device.id}/commands`, { action: 'REBOOT' }).expect(200);
    expect((await api(c).post(`/devices/${device.id}/commands`, { action: 'FETCH_USERS' }).expect(400)).body.error).toMatch(/Restart/);

    expect(kv((await m.poll().expect(200)).text)['cmd-avlbl']).toBe('1');
    expect((await m.getcmd().expect(200)).text).toBe('cmd-id=22');
    const after = await m.updatecmd(22, 1, { 'user-count': 143 }).expect(200);
    expect(kv(after.text)).toEqual({ 'cmd-avlbl': '1', status: '1' });
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: device.id } }))?.userCount).toBe(143);

    expect((await m.getcmd().expect(200)).text).toBe('cmd-id=18');
    expect(kv((await m.updatecmd(18, 0).expect(200)).text)).toEqual({ 'cmd-avlbl': '0', status: '1' });
    expect(kv((await m.getcmd().expect(200)).text)).toEqual({ status: '0' });

    const list = (await api(c).get(`/devices/${device.id}/commands`).expect(200)).body;
    expect(list.commands.map((x: any) => [x.what, x.status])).toEqual([
      ['Restart', 'FAILED'],
      ['Report user count', 'DONE'],
    ]);
  });

  it('is given the time when its clock drifts, or when asked', async () => {
    const c = await makeOwner();
    const { pushToken, device } = await addMatrix(c);
    const m = controller(pushToken);
    await m.login().expect(200);
    expect(kv((await m.poll().expect(200)).text)['cnfg-avlbl']).toBe('0');
    expect(kv((await m.getconfig().expect(200)).text)).toEqual({ status: '0' });

    /* Drift measured from a live punch: the controller is four minutes fast. */
    await person(c, { name: 'Fast Clock', code: '7100' });
    const fast = new Date(Date.now() + 4 * 60_000 + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    await m.event(1, 101, fast, { 'field-1': '7100', 'field-3': 1 << 6 }).expect(200);
    const d1 = await peoplePrisma.attendanceDevice.findUnique({ where: { id: device.id } });
    expect(d1?.clockOffsetSec).toBeGreaterThan(200);
    expect(d1?.clockOffsetSec).toBeLessThan(280);

    expect(kv((await m.poll().expect(200)).text)['cnfg-avlbl']).toBe('1');
    const cfg = kv((await m.getconfig().expect(200)).text);
    expect(cfg['config-id']).toBe('1');
    expect(cfg.year).toBe(String(new Date(Date.now() + 330 * 60_000).getUTCFullYear()));
    expect(cfg.hour).toMatch(/^\d\d$/);
    /* Not sent again until the controller answers or ten minutes pass. */
    expect(kv((await m.poll().expect(200)).text)['cnfg-avlbl']).toBe('0');

    expect(kv((await m.updateconfig(1, 1).expect(200)).text)).toEqual({ 'cnfg-avlbl': '0', status: '1' });
    const d2 = await peoplePrisma.attendanceDevice.findUnique({ where: { id: device.id } });
    expect(d2?.clockOffsetSec).toBe(0);
    expect(await peoplePrisma.deviceLog.count({ where: { deviceId: device.id, code: 'CLOCK_SET' } })).toBe(1);

    /* "Set the time" on the screen sends it on the next poll regardless of drift. */
    await api(c).post(`/devices/${device.id}/commands`, { action: 'SET_TIME' }).expect(200);
    expect(kv((await m.poll().expect(200)).text)['cnfg-avlbl']).toBe('1');
    expect(kv((await m.getconfig().expect(200)).text)['config-id']).toBe('1');
  });

  it('refuses a wrong token, a switched-off reader, and the URL of another kind of source', async () => {
    const c = await makeOwner();
    const { pushToken, device } = await addMatrix(c);
    await controller('clorp_' + 'x'.repeat(30)).login().expect(404);
    await request(app).put(`/api/orgs/${c.orgId}/attendance/devices/${device.id}`).set(at(c)).send({ name: 'Main door', direction: 'both', isActive: false }).expect(200);
    await controller(pushToken).poll().expect(403);
    /* An HTTP push source's token does not open the Matrix door. */
    const push = (await api(c).post('/devices', { vendor: 'HTTP_PUSH', name: 'Middleware', direction: 'both' }).expect(201)).body;
    await controller(push.pushToken).login().expect(404);
    /* A new URL for the controller stops the old one. */
    const rotated = (await api(c).post(`/devices/${device.id}/rotate-token`).expect(200)).body;
    expect(rotated.pushToken).not.toBe(pushToken);
    await controller(pushToken).login().expect(404);
  });
});

describe('the bits and the clock', () => {
  it('reads field-3 as direction and credential', () => {
    expect(readField3('64')).toEqual({ exit: false, verifyMode: 1 });
    expect(readField3(String(32 | 1))).toEqual({ exit: true, verifyMode: 2 });
    expect(readField3(String(128))).toEqual({ exit: false, verifyMode: 25 });
    expect(readField3(String(16))).toEqual({ exit: false, verifyMode: 0 });
    expect(readField3('')).toEqual({ exit: false, verifyMode: 0 });
  });
  it('sends the time only when it is worth sending', () => {
    const now = new Date();
    expect(clockFixDue({ clockOffsetSec: null, clockCheckedAt: null }, {}, now)).toBe(false);
    expect(clockFixDue({ clockOffsetSec: 30, clockCheckedAt: now }, {}, now)).toBe(false);
    expect(clockFixDue({ clockOffsetSec: -90, clockCheckedAt: now }, {}, now)).toBe(true);
    expect(clockFixDue({ clockOffsetSec: -90, clockCheckedAt: now }, { clockSentAt: new Date(now.getTime() - 60_000).toISOString() }, now)).toBe(false);
    expect(clockFixDue({ clockOffsetSec: -90, clockCheckedAt: now }, { clockSentAt: new Date(now.getTime() - 11 * 60_000).toISOString() }, now)).toBe(true);
    expect(clockFixDue({ clockOffsetSec: null, clockCheckedAt: null }, { forceClock: true }, now)).toBe(true);
    expect(clockParts(new Date('2026-02-24T07:04:57Z'), 'Asia/Kolkata')).toEqual({ year: '2026', month: '02', date: '24', hour: '12', minute: '34', second: '57' });
  });
  it('packs the ADMS set-time command the way the reader counts days', () => {
    /* 2000-01-01 00:00 IST is zero; 2000-01-02 00:00:05 IST is one day and five seconds. */
    expect(setTimeCommand(new Date('1999-12-31T18:30:00Z'))).toBe('SET OPTIONS DateTime=0');
    expect(setTimeCommand(new Date('2000-01-01T18:30:05Z'))).toBe('SET OPTIONS DateTime=86405');
    /* 2026-02-24 12:34:57 IST: (26*372 + 1*31 + 23) days of 86400, plus the time of day. */
    expect(setTimeCommand(new Date('2026-02-24T07:04:57Z'))).toBe(`SET OPTIONS DateTime=${(26 * 372 + 31 + 23) * 86_400 + 12 * 3600 + 34 * 60 + 57}`);
  });
});
