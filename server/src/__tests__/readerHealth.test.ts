import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/**
 * Running readers: health (offline, clock, capacity, failing and stuck
 * commands), the "no punches anywhere today" outcome check, alerts that open
 * once and close once, retries for commands a reader never answered, who is on
 * which reader and closing the gaps, and readers that serve one area.
 */

const sent: Array<{ templateKey: string; to: string; data: any }> = [];
vi.mock('../services/mailer.js', async (orig) => ({
  ...(await orig<typeof import('../services/mailer.js')>()),
  sendTemplate: vi.fn(async (o: any) => {
    sent.push({ templateKey: o.templateKey, to: o.to, data: o.data });
    return {};
  }),
}));

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const adms = await import('../services/attendance/adms.js');
const health = await import('../services/attendance/readerHealth.js');
const { clockOffsetOf } = await import('../routes/iclock.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `rh.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Fleet owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Fleet Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { attendance: true } }).expect(200);
  /* Reader sync copies fingerprints between readers, which a company switches on (DPDP; off by default, see dpdp.test.ts). */
  await request(app).put(`/api/orgs/${ctx.orgId}/attendance/data-protection`).set(at(ctx)).send({ biometricCopy: true, attest: true }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const reader = (sn: string) => ({
  heartbeat: () => request(app).get(`/iclock/getrequest?SN=${sn}`),
  push: (lines: string[], table = 'ATTLOG') => request(app).post(`/iclock/cdata?SN=${sn}&table=${table}`).set('Content-Type', 'text/plain').send(lines.join('\n')),
  result: (body: string) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('Content-Type', 'text/plain').send(body),
});
const serial = () => `RH${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const addReader = async (c: Ctx, name = 'Gate') => {
  const sn = serial();
  const { device } = (await api(c).post('/devices', { serialNumber: sn, name, direction: 'both' }).expect(201)).body;
  return { sn, device, r: reader(sn) };
};
/** Answer every command waiting for a reader with this return code; returns what it was sent. */
async function drain(r: ReturnType<typeof reader>, code = 0, extra = '') {
  const got: string[] = [];
  for (let i = 0; i < 200; i++) {
    const t = (await r.heartbeat().expect(200)).text;
    if (t === 'OK') break;
    const [, id, ...rest] = t.split(':');
    const cmd = rest.join(':');
    got.push(cmd);
    await r.result(`ID=${id}&Return=${cmd === 'INFO' ? 0 : code}&CMD=${cmd.split(' ')[0]}${cmd === 'INFO' ? extra : ''}`).expect(200);
  }
  return got;
}
const FINGER_TMP = Buffer.from('finger-template-'.repeat(12)).toString('base64');
const istNow = (offsetMs = 0) => new Date(Date.now() + offsetMs + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

describe('the rules, pure', () => {
  const base: health.ReaderFacts = {
    id: 'r1', name: 'Main gate', isActive: true, lastSeenAt: new Date('2026-10-15T05:00:00Z'), clockOffsetSec: 3,
    userCount: 100, fingerCount: 150, faceCount: 80, punchCount: 2000, maxUsers: 3000, maxFingers: 3000, maxFaces: 1500, maxPunches: 100000,
    failed24h: 0, oldestPendingAt: null,
  };
  const now = new Date('2026-10-15T05:01:00Z');
  const kinds = (f: Partial<health.ReaderFacts>, t = now) => health.assessReader({ ...base, ...f }, t, { offlineMinutes: 30 }).map((i) => i.kind);

  it('finds nothing wrong with a healthy reader', () => {
    expect(kinds({})).toEqual([]);
    expect(health.readerStatus([])).toBe('ok');
  });

  it('flags offline, never-connected, clock, full, refused and stuck', () => {
    expect(kinds({}, new Date('2026-10-15T06:00:00Z'))).toEqual(['offline']);
    expect(kinds({ lastSeenAt: null })).toEqual(['never']);
    expect(kinds({ clockOffsetSec: 300 })).toEqual(['clock']);
    expect(kinds({ clockOffsetSec: 60 })).toEqual([]);
    const reset = health.assessReader({ ...base, clockOffsetSec: -26 * 365 * 86_400 }, now, { offlineMinutes: 30 })[0];
    expect(reset).toMatchObject({ kind: 'clock', severity: 'high' });
    expect(reset.title).toMatch(/reset/);
    expect(kinds({ userCount: 2900 })).toEqual(['full']);
    expect(health.assessReader({ ...base, punchCount: 99_500 }, now, { offlineMinutes: 30 })[0].severity).toBe('high');
    expect(kinds({ failed24h: 2 })).toEqual(['commands']);
    expect(kinds({ oldestPendingAt: new Date('2026-10-15T04:00:00Z') })).toEqual(['stuck']);
    expect(kinds({ isActive: false, lastSeenAt: null })).toEqual([]);
    expect(health.readerStatus(health.assessReader({ ...base, clockOffsetSec: 3600 }, now, { offlineMinutes: 30 }))).toBe('bad');
  });

  it('only says "no punches today" on a working day after the morning, for a company that collects', () => {
    const f = { localHour: 12, sunday: false, holiday: false, afterHour: 11, punchesToday: 0, everPunched: true, lastPunchAt: new Date('2026-10-14T12:30:00Z') };
    expect(health.assessCollection(f, now)?.[0]).toMatchObject({ kind: 'no-punches', severity: 'critical' });
    expect(health.assessCollection({ ...f, punchesToday: 4 }, now)).toEqual([]);
    expect(health.assessCollection({ ...f, localHour: 9 }, now)).toBeNull();
    expect(health.assessCollection({ ...f, sunday: true }, now)).toBeNull();
    expect(health.assessCollection({ ...f, holiday: true }, now)).toBeNull();
    expect(health.assessCollection({ ...f, everPunched: false }, now)).toBeNull();
  });

  it('reads INFO answers, refusals and what a command changes on a reader', () => {
    const res = adms.parseCommandResults('ID=7&Return=0&CMD=INFO\n~DeviceName=SpeedFace\nMAC=00:17:61:aa\nUserCount=120\nMaxUserCount=3000\nFPCount=230\nMaxFingerCount=6000\nFaceCount=90\nMaxFaceCount=1500\nTransactionCount=4500\nMaxAttLogCount=200000\nID=8&Return=-1004&CMD=DATA');
    expect(res.map((r) => [r.id, r.returnCode])).toEqual([[7, 0], [8, -1004]]);
    expect(adms.parseReaderInfo(res[0].info)).toMatchObject({ userCount: 120, maxUsers: 3000, fingerCount: 230, faceCount: 90, punchCount: 4500, maxPunches: 200000, mac: '00:17:61:aa' });
    expect(adms.refusalReason(-1004)).toMatch(/does not accept/);
    expect(adms.commandEffect(adms.userInfoCommand('104', 'Ravi'))).toEqual({ pin: '104', what: 'user' });
    expect(adms.commandEffect('DATA UPDATE FINGERTMP PIN=104\tFID=6\tSize=3\tValid=1\tTMP=AAA')).toEqual({ pin: '104', what: 'finger', no: 6 });
    expect(adms.commandEffect('DATA UPDATE BIODATA Pin=104\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=AAA')).toEqual({ pin: '104', what: 'face' });
    expect(adms.removalCommands('104').map((c) => adms.commandEffect(c)?.what)).toEqual(['removeFingers', 'removeFace', 'removeUser']);
    expect(adms.commandEffect('DATA QUERY ATTLOG')).toBeNull();
    expect(adms.addFinger('6,0', 3)).toBe('0,3,6');
  });

  it('reads limits stated in units, firmware names, and ignores faces on a fingerprint-only reader', () => {
    // A real eSSL INFO answer: MaxUserCount=50, MaxFingerCount=30, MaxAttLogCount=3.
    expect(adms.parseReaderInfo({ UserCount: '6', MaxUserCount: '50', FPCount: '6', MaxFingerCount: '30', TransactionCount: '980', MaxAttLogCount: '3', MaxFaceCount: '400', FWVersion: 'Ver 8.0.4.3-20240116' })).toMatchObject({
      maxUsers: 5000, maxFingers: 3000, maxPunches: 30000, maxFaces: 400, firmware: '8.0.4.3',
    });
    expect(adms.scaleLimit('users', 3000)).toBe(3000);
    expect(adms.scaleLimit('punches', 3)).toBe(30000);
    expect(adms.scaleLimit('faces', 400)).toBe(400);
    expect(adms.normaliseFirmware('ZAM70-NF24HA-Ver3.3.12')).toBe('3.3.12');
    expect(adms.normaliseFirmware('6.60')).toBe('6.60');
    const essl = { ...base, userCount: 6, maxUsers: 5000, fingerCount: 6, maxFingers: 3000, faceCount: 0, maxFaces: 400, punchCount: 980, maxPunches: 30000, faceSupported: false };
    expect(kinds(essl)).toEqual([]);
  });

  it('measures the clock only from punches sent the moment they were made', () => {
    const now2 = new Date();
    const justSeen = new Date(now2.getTime() - 30_000);
    const ahead = clockOffsetOf(`1\t${istNow(5 * 60_000)}\t0\t1`, justSeen, now2)!;
    expect(ahead).toBeGreaterThan(290);
    expect(ahead).toBeLessThan(310);
    expect(clockOffsetOf(`1\t${istNow()}\t0\t1`, new Date(now2.getTime() - 3_600_000), now2)).toBeNull(); // was offline: a catch-up
    expect(clockOffsetOf([1, 2, 3, 4].map((i) => `${i}\t${istNow()}\t0\t1`).join('\n'), justSeen, now2)).toBeNull(); // a batch
  });
});

describe('a fleet of readers', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await makeOwner();
  }, 60_000);

  it('asks each reader for its counts and limits, and shows how full it is', async () => {
    const { device, r } = await addReader(c, 'Main gate');
    const got = await drain(r, 0, '\nUserCount=2850\nMaxUserCount=3000\nFPCount=10\nMaxFingerCount=6000\nTransactionCount=100\nMaxAttLogCount=100000');
    expect(got).toContain('INFO');
    const h = (await api(c).get('/reader-health').expect(200)).body;
    const me = h.readers.find((x: any) => x.id === device.id);
    expect(me.capacity.users).toEqual({ n: 2850, max: 3000, pct: 95 });
    expect(me.issues.map((i: any) => i.kind)).toEqual(['full']);
    expect(me.status).toBe('warn');
    // Not asked again within six hours.
    expect(await drain(r)).toEqual([]);
  });

  it('retries a command the reader never answered, then fails it, and lets HR retry or cancel', async () => {
    const { device, r } = await addReader(c, 'Back door');
    await drain(r);
    await api(c).post(`/devices/${device.id}/commands`, { action: 'FETCH_USERS' }).expect(200);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const t = (await r.heartbeat().expect(200)).text;
      expect(t).toMatch(/^C:\d+:DATA QUERY USERINFO$/);
      // No answer: ten minutes pass.
      await peoplePrisma.deviceCommand.updateMany({ where: { deviceId: device.id, status: 'SENT' }, data: { sentAt: new Date(Date.now() - 11 * 60_000) } });
    }
    expect((await r.heartbeat().expect(200)).text).toBe('OK');
    const q = (await api(c).get(`/devices/${device.id}/commands?status=FAILED`).expect(200)).body;
    expect(q.commands[0]).toMatchObject({ status: 'FAILED', attempts: 3, what: 'Send its users' });
    expect(q.commands[0].lastError).toMatch(/did not answer/);

    // Refused outright.
    await api(c).post(`/devices/${device.id}/commands`, { action: 'REBOOT' }).expect(200);
    const t = (await r.heartbeat().expect(200)).text;
    await r.result(`ID=${t.split(':')[1]}&Return=-1004&CMD=REBOOT`).expect(200);
    const failed = (await api(c).get(`/devices/${device.id}/commands?status=FAILED`).expect(200)).body.commands;
    expect(failed.map((x: any) => x.lastError)).toContain('The reader does not accept this command (-1004).');
    expect((await api(c).get('/reader-health').expect(200)).body.readers.find((x: any) => x.id === device.id).issues.map((i: any) => i.kind)).toContain('commands');

    expect((await api(c).post(`/devices/${device.id}/commands/retry`).expect(200)).body.retried).toBe(2);
    expect((await api(c).post(`/devices/${device.id}/commands/cancel`).expect(200)).body.cancelled).toBe(2);
    expect((await r.heartbeat().expect(200)).text).toBe('OK');
  });

  it('notices a reader whose clock is wrong from a punch it just made', async () => {
    const { device, r } = await addReader(c, 'Canteen');
    await drain(r);
    await r.push([`77\t${istNow(7 * 60_000)}\t0\t1`]).expect(200);
    const me = (await api(c).get('/reader-health').expect(200)).body.readers.find((x: any) => x.id === device.id);
    expect(me.clockOffsetSec).toBeGreaterThan(400);
    expect(me.issues[0]).toMatchObject({ kind: 'clock' });
    expect(me.issues[0].title).toMatch(/7 min ahead/);
  });

  it('opens an alert once, mails it once, and closes it (mailed) when the reader is back', async () => {
    const o = await makeOwner();
    await api(o).put('/reader-alerts/settings', { alertEmails: 'ops@example.com, hr@example.com', offlineAlertMinutes: 15, noPunchAfterHour: 11 }).expect(200);
    await api(o).put('/reader-alerts/settings', { alertEmails: 'not-an-email', offlineAlertMinutes: 15, noPunchAfterHour: 11 }).expect(400);
    const { device, r } = await addReader(o, 'Dock');
    await drain(r);
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(Date.now() - 40 * 60_000) } });
    sent.length = 0;
    await health.runReaderChecks();
    await health.runReaderChecks();
    const open = await peoplePrisma.readerAlert.findMany({ where: { orgId: o.orgId, resolvedAt: null } });
    expect(open.map((a) => a.kind)).toEqual(['offline']);
    expect(open[0].notifiedAt).toBeTruthy();
    expect(sent.filter((s) => s.templateKey === 'attendance.reader_alert').map((s) => s.to).sort()).toEqual(['hr@example.com', 'ops@example.com']);

    await r.heartbeat().expect(200);
    await health.runReaderChecks();
    const closed = await peoplePrisma.readerAlert.findFirst({ where: { orgId: o.orgId, kind: 'offline' } });
    expect(closed!.resolvedAt).toBeTruthy();
    expect(sent.filter((s) => s.templateKey === 'attendance.reader_alert_cleared')).toHaveLength(2);
    const h = (await api(o).get('/reader-health').expect(200)).body;
    expect(h.alerts[0]).toMatchObject({ kind: 'offline' });
    expect(h.settings.alertEmails).toBe('ops@example.com, hr@example.com');
  });
});

describe('who is on which reader', () => {
  it('knows from what readers confirm, closes gaps with one call, and removes people who left', async () => {
    const c = await makeOwner();
    const a = await addReader(c, 'Gate A');
    const b = await addReader(c, 'Gate B');
    await drain(a.r);
    await drain(b.r);
    const p = await person(c, { name: 'Ravi Kumar', code: '501' });
    // Queued to both readers at creation.
    let grid = (await api(c).get('/reader-sync').expect(200)).body;
    let row = grid.rows.find((x: any) => x.employeeId === p.id);
    expect(row.cells.map((x: any) => x.state)).toEqual(['QUEUED', 'QUEUED']);
    await drain(a.r); // A confirms
    await drain(b.r, -1004); // B refuses
    grid = (await api(c).get('/reader-sync').expect(200)).body;
    row = grid.rows.find((x: any) => x.employeeId === p.id);
    expect(Object.fromEntries(row.cells.map((x: any) => [x.deviceId, x.state]))).toEqual({ [a.device.id]: 'OK', [b.device.id]: 'MISSING' });

    // Enrolled a finger on A: copied to B, which is still missing the user.
    await a.r.push([`FP PIN=501\tFID=6\tSize=4\tValid=1\tTMP=${FINGER_TMP}`], 'OPERLOG').expect(200);
    await peoplePrisma.deviceCommand.deleteMany({ where: { deviceId: b.device.id, status: 'PENDING' } });
    const fixed = (await api(c).post('/reader-sync/fix', { deviceId: b.device.id }).expect(200)).body;
    expect(fixed.people).toBe(1);
    const toB = await drain(b.r);
    expect(toB.map((x) => x.split('\t')[0])).toEqual(['DATA UPDATE USERINFO PIN=501', 'DATA UPDATE FINGERTMP PIN=501']);
    grid = (await api(c).get('/reader-sync').expect(200)).body;
    row = grid.rows.find((x: any) => x.employeeId === p.id);
    expect(row.cells.map((x: any) => x.state)).toEqual(['OK', 'OK']);
    expect(row.cells[1]).toMatchObject({ fingers: 1 });

    // Someone set up on a reader by hand, who has left: an extra; removed.
    const gone = await person(c, { name: 'Gone Away', code: '502' });
    await drain(a.r);
    await peoplePrisma.employee.update({ where: { id: gone.id }, data: { status: 'LEFT' } });
    grid = (await api(c).get('/reader-sync').expect(200)).body;
    expect(grid.rows.find((x: any) => x.employeeId === gone.id).cells.find((x: any) => x.deviceId === a.device.id).state).toBe('EXTRA');
    expect((await api(c).post('/reader-sync/remove-extras', { deviceId: a.device.id }).expect(200)).body.removed).toBe(1);
    expect((await drain(a.r)).map((x) => x.split(' ').slice(0, 3).join(' '))).toEqual(['DATA DELETE FINGERTMP', 'DATA DELETE FACE', 'DATA DELETE USERINFO']);
    grid = (await api(c).get('/reader-sync').expect(200)).body;
    expect(grid.rows.find((x: any) => x.employeeId === gone.id)).toBeUndefined();
  });

  it('sends a site’s staff only to that site’s readers, and moves them with a transfer', async () => {
    const c = await makeOwner();
    const north = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/areas`).set(at(c)).send({ name: 'North' }).expect(201)).body.item;
    const south = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/areas`).set(at(c)).send({ name: 'South' }).expect(201)).body.item;
    const hq = await addReader(c, 'HQ');
    const n = await addReader(c, 'North gate');
    const s = await addReader(c, 'South gate');
    await api(c).put(`/devices/${n.device.id}`, { name: 'North gate', direction: 'both', areaId: north.id }).expect(200);
    await api(c).put(`/devices/${s.device.id}`, { name: 'South gate', direction: 'both', areaId: south.id }).expect(200);
    for (const x of [hq, n, s]) await drain(x.r);

    const p = await person(c, { name: 'Meera', code: '601', areaId: north.id });
    expect((await drain(hq.r)).length).toBe(1);
    expect((await drain(n.r)).length).toBe(1);
    expect(await drain(s.r)).toEqual([]);
    await n.r.push([`FP PIN=601\tFID=1\tSize=4\tValid=1\tTMP=${FINGER_TMP}`], 'OPERLOG').expect(200);
    expect((await drain(hq.r)).map((x) => x.split('\t')[0])).toEqual(['DATA UPDATE USERINFO PIN=601', 'DATA UPDATE FINGERTMP PIN=601']);
    expect(await drain(s.r)).toEqual([]);

    // Transferred south: off the north gate, onto the south gate with the fingerprint.
    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${p.id}`).set(at(c)).send({ ...p, areaId: south.id }).expect(200);
    expect((await drain(n.r)).map((x) => x.split(' ').slice(0, 3).join(' '))).toEqual(['DATA DELETE FINGERTMP', 'DATA DELETE FACE', 'DATA DELETE USERINFO']);
    expect((await drain(s.r)).map((x) => x.split('\t')[0])).toEqual(['DATA UPDATE USERINFO PIN=601', 'DATA UPDATE FINGERTMP PIN=601']);
    // HQ serves everyone: it just gets the user record again.
    expect((await drain(hq.r)).map((x) => x.split('\t')[0])).toEqual(['DATA UPDATE USERINFO PIN=601']);
    const grid = (await api(c).get('/reader-sync').expect(200)).body;
    const cells = Object.fromEntries(grid.rows.find((x: any) => x.employeeId === p.id).cells.map((x: any) => [x.deviceId, x.state]));
    expect(cells).toEqual({ [hq.device.id]: 'OK', [n.device.id]: 'NA', [s.device.id]: 'OK' });
  });
});

describe('sync from the reader into CLOR', () => {
  it('reads a new reader’s users, makes unknown ones employees with their punches, and sends them to the other readers', async () => {
    const c = await makeOwner();
    const a = await addReader(c, 'Gate A');
    const b = await addReader(c, 'Gate B');
    // Punches from ID 4 before CLOR knows who that is.
    await drain(a.r);
    await drain(b.r);
    await a.r.push([`4\t${istNow(-3_600_000)}\t0\t1`]).expect(200);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, pin: '4', employeeId: null } })).toBe(1);

    // The reader answers "who is on you".
    await a.r.push(['USER PIN=4\tName=Suresh K\tPri=14\tPasswd=\tCard=55667788'], 'USERINFO').expect(200);
    const emp = await peoplePrisma.employee.findFirst({ where: { orgId: c.orgId, code: '4' } });
    expect(emp).toMatchObject({ name: 'Suresh K', status: 'ACTIVE', cardNumber: '55667788' });
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, pin: '4', employeeId: emp!.id } })).toBe(1);
    // On to the other reader; nothing sent back to the one it came from.
    expect((await drain(b.r)).map((x) => x.split('\t')[0])).toEqual(['DATA UPDATE USERINFO PIN=4']);
    expect(await peoplePrisma.deviceCommand.count({ where: { deviceId: a.device.id, status: 'PENDING', command: { contains: 'USERINFO PIN=4' } } })).toBe(0);

    // Someone CLOR knows keeps CLOR's name; a placeholder takes the reader's.
    await a.r.push(['USER PIN=4\tName=SURESH\tPri=0'], 'USERINFO').expect(200);
    expect((await peoplePrisma.employee.findUnique({ where: { id: emp!.id } }))!.name).toBe('Suresh K');
    await a.r.push(['USER PIN=9\tName=\tPri=0'], 'USERINFO').expect(200);
    const nine = await peoplePrisma.employee.findFirst({ where: { orgId: c.orgId, code: '9' } });
    expect(nine!.name).toBe('Reader user 9');
    await a.r.push(['USER PIN=9\tName=Meena\tPri=0'], 'USERINFO').expect(200);
    expect((await peoplePrisma.employee.findUnique({ where: { id: nine!.id } }))!.name).toBe('Meena');
  });

  it('reads again soon after someone uses the reader, and can be switched off', async () => {
    const c = await makeOwner();
    const a = await addReader(c, 'Gate');
    await drain(a.r);
    await peoplePrisma.deviceCommand.updateMany({ where: { deviceId: a.device.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await a.r.push([`OPLOG 6\t0\t${istNow()}\t12\t0\t0\t0`], 'OPERLOG').expect(200);
    expect((await drain(a.r)).slice(0, 1)).toEqual(['DATA QUERY USERINFO']);

    await api(c).put('/rules', { defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0, photoRetentionDays: 90, readerUsersBecomeEmployees: false }).expect(200);
    await a.r.push(['USER PIN=77\tName=Visitor\tPri=0'], 'USERINFO').expect(200);
    expect(await peoplePrisma.employee.count({ where: { orgId: c.orgId, code: '77' } })).toBe(0);
    expect(await peoplePrisma.deviceUser.count({ where: { deviceId: a.device.id, pin: '77' } })).toBe(1);
  });
});
