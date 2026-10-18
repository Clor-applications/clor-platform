import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';

/**
 * Two more reader drivers: a Hikvision terminal pushing events to its CLOR
 * URL (multipart with a picture, as the terminal's HTTP listening sends), and
 * Anviz CrossChex Cloud pulled with an API key — against a fake cloud here.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { pullPunches } = await import('../services/attendance/pull/index.js');
const { _resetAnviz } = await import('../services/attendance/pull/anviz.js');
const { encryptSecret } = await import('../services/mailer.js');
const { textParts, punchOf } = await import('../routes/hikvisionPush.js');

const app = buildApp().listen(0);
let prevAllow: string | undefined;
beforeAll(() => {
  prevAllow = process.env.INTEGRATIONS_ALLOW_PRIVATE;
  process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
});
afterAll(async () => {
  process.env.INTEGRATIONS_ALLOW_PRIVATE = prevAllow;
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `hk.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Hik Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
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

const event = (over: Record<string, unknown> = {}, ace: Record<string, unknown> = {}) => ({
  ipAddress: '192.168.1.64',
  macAddress: 'a4:14:37:00:00:01',
  channelID: 1,
  dateTime: '2026-09-01T09:04:30+05:30',
  activePostCount: 1,
  eventType: 'AccessControllerEvent',
  eventState: 'active',
  eventDescription: 'Access Controller Event',
  AccessControllerEvent: { deviceName: 'DS-K1T343 front', majorEventType: 5, subEventType: 75, name: 'Face User', employeeNoString: '3001', cardNo: '', doorNo: 1, serialNo: 4411, currentVerifyMode: 'face', attendanceStatus: 'checkIn', ...ace },
  ...over,
});

describe('a Hikvision terminal pushing to CLOR', () => {
  it('is added with a URL, and its multipart events become punches', async () => {
    const c = await makeOwner();
    const made = (await api(c).post('/devices', { vendor: 'HIKVISION_PUSH', name: 'Front terminal', direction: 'both', sourceTimezone: 'Asia/Kolkata' }).expect(201)).body;
    expect(made.pushToken).toMatch(/^clorp_/);
    expect(made.device.serialNumber).toMatch(/^HIK-/);
    expect((await api(c).get('/devices').expect(200)).body.hikvisionBase).toMatch(/\/hikvision\/$/);
    const p = await person(c, { name: 'Face User', code: '3001' });
    const url = `/hikvision/${made.pushToken}`;

    const r1 = await request(app).post(url).field('event_log', JSON.stringify(event())).attach('Picture', Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x0d, 0x0a]), { filename: 'face.jpg', contentType: 'image/jpeg' }).expect(200);
    expect(r1.body).toEqual({ ok: true, added: 1 });
    /* Plain JSON, an exit by fingerprint. */
    await request(app).post(url).set('Content-Type', 'application/json').send(event({ dateTime: '2026-09-01T18:20:05+05:30' }, { subEventType: 38, currentVerifyMode: 'fingerPrint', attendanceStatus: 'checkOut' })).expect(200);
    const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId: c.orgId, employeeId: p.id }, orderBy: { at: 'asc' } });
    expect(punches.map((x) => [x.localTime, x.kind, x.verifyMode])).toEqual([
      ['2026-09-01 09:04:30', 'IN', 15],
      ['2026-09-01 18:20:05', 'OUT', 1],
    ]);
    const day = (await api(c).get(`/records?from=2026-09-01&to=2026-09-01&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(day).toMatchObject({ checkInTime: '09:04', checkOutTime: '18:20', status: 'PRESENT' });

    /* A replay (activePostCount 2) adds nothing and does not set the clock. */
    const again = await request(app).post(url).field('event_log', JSON.stringify(event({ activePostCount: 2 }))).expect(200);
    expect(again.body.added).toBe(0);

    /* What the terminal said about itself is kept; the last event can be seen. */
    const d = await peoplePrisma.attendanceDevice.findUnique({ where: { id: made.device.id } });
    expect(d?.model).toBe('DS-K1T343 front');
    expect(d?.ip).toBe('192.168.1.64');
    expect(d?.lastSeenAt).toBeTruthy();
    const last = (await api(c).get(`/devices/${made.device.id}/last-payload`).expect(200)).body;
    expect(JSON.parse(last.payload).AccessControllerEvent.employeeNoString).toBe('3001');

    /* A failed face and a door event go to the reader log; a heartbeat only says hello. */
    await request(app).post(url).field('event_log', JSON.stringify(event({ eventDescription: 'Face Authentication Failed' }, { subEventType: 76, employeeNoString: '', attendanceStatus: '' }))).expect(200);
    await request(app).post(url).field('event_log', JSON.stringify(event({ eventDescription: 'Door Open' }, { majorEventType: 5, subEventType: 21, employeeNoString: '', attendanceStatus: '' }))).expect(200);
    await request(app).post(url).set('Content-Type', 'application/json').send({ eventType: 'heartBeat', dateTime: '2026-09-01T18:25:00+05:30' }).expect(200);
    const logs = await peoplePrisma.deviceLog.findMany({ where: { deviceId: made.device.id }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => [l.kind, l.code])).toEqual([
      ['ERROR', '5-76'],
      ['OPERATION', '5-21'],
    ]);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: made.device.id } })).toBe(2);
  });

  it('refuses a wrong or foreign token, and a switched-off terminal', async () => {
    const c = await makeOwner();
    const made = (await api(c).post('/devices', { vendor: 'HIKVISION_PUSH', name: 'Back', direction: 'both' }).expect(201)).body;
    await request(app).post(`/hikvision/clorp_${'y'.repeat(30)}`).send({}).expect(404);
    const push = (await api(c).post('/devices', { vendor: 'HTTP_PUSH', name: 'Middleware', direction: 'both' }).expect(201)).body;
    await request(app).post(`/hikvision/${push.pushToken}`).send({}).expect(404);
    await request(app).put(`/api/orgs/${c.orgId}/attendance/devices/${made.device.id}`).set(at(c)).send({ name: 'Back', direction: 'both', isActive: false }).expect(200);
    await request(app).post(`/hikvision/${made.pushToken}`).send({}).expect(403);
  });

  it('reads multipart text parts and skips the picture', () => {
    const b = 'xyzBoundary';
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="event_log"\r\nContent-Type: application/json\r\n\r\n{"a":1}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="Picture"; filename="1.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      Buffer.from([0xff, 0xd8, 0x0d, 0x0a, 0x0d, 0x0a, 0x00]),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    expect(textParts(body, `multipart/form-data; boundary=${b}`)).toEqual({ event_log: '{"a":1}' });
    expect(punchOf(event(), 'Asia/Kolkata')).toMatchObject({ line: '3001\t2026-09-01 09:04:30\t0\t15' });
    expect(punchOf(event({}, { employeeNoString: '' }), 'Asia/Kolkata')).toEqual({ skip: 'no employee number' });
    expect(punchOf(event({}, { subEventType: 76, attendanceStatus: '' }), 'Asia/Kolkata')).toEqual({ skip: 'sub-event 76 is not a pass' });
    /* A terminal in Dubai: its offset is honoured, not the zone setting. */
    expect(punchOf(event({ dateTime: '2026-09-01T07:00:00+04:00' }), 'Asia/Kolkata')).toMatchObject({ line: '3001\t2026-09-01 08:30:00\t0\t15' });
  });
});

/** A fake CrossChex Cloud: one endpoint, dispatch on header.nameSpace. */
function fakeCloud(opts: { key?: string; secret?: string; records?: any[]; expireFirst?: boolean } = {}) {
  const { key = 'k1', secret = 's1', records = [] } = opts;
  const calls: any[] = [];
  let issued = 0;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data);
      calls.push(body);
      const reply = (o: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
      const ns = `${body.header?.nameSpace}/${body.header?.nameAction}`;
      if (ns === 'authorize.token/token') {
        if (body.payload?.api_key !== key || body.payload?.api_secret !== secret) return reply({ header: { nameSpace: 'System', name: 'Exception' }, payload: { type: 'AUTH_ERROR', message: 'AUTH_ERROR' } });
        issued += 1;
        return reply({ header: { nameSpace: 'authorize.token', name: 'token' }, payload: { token: `tok${issued}`, expires: new Date(Date.now() + 3_600_000).toISOString() } });
      }
      if (ns === 'attendance.record/getrecord') {
        if (body.authorize?.token === 'tok1' && opts.expireFirst) return reply({ header: { nameSpace: 'System', name: 'Exception' }, payload: { type: 'TOKEN_EXPIRES', message: 'TOKEN_EXPIRES' } });
        if (!/^tok\d+$/.test(String(body.authorize?.token))) return reply({ header: { nameSpace: 'System', name: 'Exception' }, payload: { type: 'AUTH_ERROR', message: 'AUTH_ERROR' } });
        const page = Number(body.payload.page);
        const list = records.slice((page - 1) * 100, page * 100);
        return reply({ header: { nameSpace: 'attendance.record', name: 'getrecord' }, payload: { list, pageCount: Math.ceil(records.length / 100), count: records.length } });
      }
      reply({ header: { nameSpace: 'System', name: 'Exception' }, payload: { type: 'UNKNOWN', message: 'no such action' } });
    });
  });
  return {
    calls,
    start: () => new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}`))),
    stop: () => new Promise((ok) => server.close(ok)),
  };
}
const rec = (workno: string, checktime: string, sn = 'CX1') => ({ uuid: rnd(), checktype: 1, checktime, device: { serial_number: sn, name: 'Gate' }, employee: { workno, first_name: 'A', last_name: 'B' } });
const device = (apiUrl: string, over: Record<string, unknown> = {}) => ({ id: 'test', vendor: 'ANVIZ_CLOUD', apiUrl, apiCorporateId: null, apiUsername: 'k1', apiSecret: encryptSecret('s1'), sourceTimezone: 'Asia/Kolkata', configJson: JSON.stringify({ gapMs: 0 }), mappingJson: null, ...over });
const window_ = { from: new Date('2026-09-01T00:00:00+05:30'), to: new Date('2026-09-01T23:59:59+05:30') };

describe('Anviz CrossChex Cloud', () => {
  it('gets a token, pulls pages of records, and reuses the token', async () => {
    _resetAnviz();
    const records = [...Array(130)].map((_, i) => rec(String(1000 + i), `2026-09-01T0${(i % 9) + 1}:15:00+05:30`));
    const cloud = fakeCloud({ records });
    const base = await cloud.start();
    try {
      const r = await pullPunches(device(base) as any, window_.from, window_.to);
      expect(r.ok).toBe(true);
      expect(r.received).toBe(130);
      expect(r.lines[0]).toBe('1000\t2026-09-01 01:15:00\t255\t0');
      expect(cloud.calls.map((c) => c.header.nameSpace)).toEqual(['authorize.token', 'attendance.record', 'attendance.record']);
      expect(cloud.calls[1].payload).toMatchObject({ begin_time: expect.stringMatching(/\+00:00$/), page: 1, per_page: 100, order: 'asc' });
      expect(cloud.calls[1].authorize).toEqual({ type: 'token', token: 'tok1' });
      /* Second pull: no new token. */
      await pullPunches(device(base) as any, window_.from, window_.to);
      expect(cloud.calls.filter((c) => c.header.nameSpace === 'authorize.token')).toHaveLength(1);
    } finally {
      await cloud.stop();
    }
  });

  it('renews an expired token once, and says when the key is wrong', async () => {
    _resetAnviz();
    const cloud = fakeCloud({ records: [rec('7', '2026-09-01T09:00:00+05:30')], expireFirst: true });
    const base = await cloud.start();
    try {
      const r = await pullPunches(device(base) as any, window_.from, window_.to);
      expect(r.ok).toBe(true);
      expect(r.lines).toEqual(['7\t2026-09-01 09:00:00\t255\t0']);
      expect(cloud.calls.map((c) => `${c.header.nameSpace}:${c.authorize?.token || ''}`)).toEqual(['authorize.token:', 'attendance.record:tok1', 'authorize.token:', 'attendance.record:tok2']);
      _resetAnviz();
      const wrong = await pullPunches(device(base, { apiSecret: encryptSecret('bad') }) as any, window_.from, window_.to);
      expect(wrong.ok).toBe(false);
      expect(wrong.message).toMatch(/refused the API key/);
    } finally {
      await cloud.stop();
    }
  });

  it('is added from the Readers screen with a region and a key', async () => {
    const c = await makeOwner();
    const drivers = (await api(c).get('/devices').expect(200)).body.drivers;
    expect(drivers.find((d: any) => d.vendor === 'ANVIZ_CLOUD')).toMatchObject({ capabilities: ['pull'], unverified: true });
    const bad = await api(c).post('/devices', { vendor: 'ANVIZ_CLOUD', name: 'Anviz', direction: 'both', baseUrl: 'https://example.com/', username: 'k', password: 's' }).expect(400);
    expect(bad.body.error).toMatch(/crosschexcloud/);
    const made = await api(c).post('/devices', { vendor: 'ANVIZ_CLOUD', name: 'Anviz', direction: 'both', baseUrl: 'https://api.ap.crosschexcloud.com/', username: 'k', password: 's' }).expect(201);
    expect(made.body.device).toMatchObject({ vendor: 'ANVIZ_CLOUD', apiUrl: 'https://api.ap.crosschexcloud.com/', hasSecret: true });
  });
});
