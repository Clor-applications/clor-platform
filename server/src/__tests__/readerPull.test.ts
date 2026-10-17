import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createHash } from 'node:crypto';

/**
 * Pulling punches from devices and servers of other makes: HTTP Digest
 * answered correctly, Hikvision / Dahua / BioStar answers read to the same
 * punch lines, any JSON API polled with a URL template and a field mapping,
 * and the device routes that create, test and sync them — against fake
 * devices on this machine.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { digestAuthorization } = await import('../services/attendance/digest.js');
const { parseDahuaRecords } = await import('../services/attendance/pull/dahua.js');
const { pullPunches } = await import('../services/attendance/pull/index.js');
const { encryptSecret } = await import('../services/mailer.js');

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

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** A fake device: Digest-protected, answering per path. */
function fakeDevice(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void, opts: { user?: string; pass?: string; realm?: string } = {}) {
  const { user = 'admin', pass = 'Secret12', realm = 'DS-K1T' } = opts;
  const nonce = 'abc123';
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const auth = String(req.headers.authorization || '');
      const m = /response="([0-9a-f]+)"/.exec(auth);
      const cn = /cnonce="([^"]+)"/.exec(auth)?.[1] || '';
      const uri = /uri="([^"]+)"/.exec(auth)?.[1] || '';
      const ha1 = md5(`${user}:${realm}:${pass}`);
      const ha2 = md5(`${req.method}:${uri}`);
      const want = md5(`${ha1}:${nonce}:00000001:${cn}:auth:${ha2}`);
      if (!m || m[1] !== want) {
        res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${realm}", qop="auth", nonce="${nonce}", opaque="xyz"` }).end();
        return;
      }
      handler(req, data, res);
    });
  });
  return {
    start: () => new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}`))),
    stop: () => new Promise((ok) => server.close(ok)),
  };
}

const device = (vendor: string, baseUrl: string, extra: Record<string, unknown> = {}) => ({
  id: 'd1', vendor, apiUrl: baseUrl, apiCorporateId: null, apiUsername: 'admin', apiSecret: encryptSecret('Secret12'), sourceTimezone: 'Asia/Kolkata', configJson: null, mappingJson: null, ...extra,
});
const window_ = { from: new Date('2026-10-17T00:00:00+05:30'), to: new Date('2026-10-17T23:59:59+05:30') };

describe('Digest', () => {
  it('computes the RFC 7616 example response', () => {
    const ch = 'Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=MD5, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"';
    const h = digestAuthorization(ch, 'GET', '/dir/index.html', 'Mufasa', 'Circle of Life', 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ');
    expect(h).toContain('response="8ca523f5e9506fed4657c9700eebdbec"');
    expect(h).toContain('qop=auth');
    expect(h).toContain('opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"');
  });
});

describe('Hikvision', () => {
  it('answers the Digest challenge, pages through events, keeps those with an employee', async () => {
    let calls = 0;
    const dev = fakeDevice((req, body, res) => {
      calls += 1;
      expect(req.url).toBe('/ISAPI/AccessControl/AcsEvent?format=json');
      const cond = JSON.parse(body).AcsEventCond;
      expect(cond.startTime).toBe('2026-10-17T00:00:00+05:30');
      const page = cond.searchResultPosition === 0
        ? { responseStatusStrg: 'MORE', InfoList: [{ employeeNoString: '104', time: '2026-10-17T09:05:12+05:30', attendanceStatus: 'checkIn', currentVerifyMode: 'face' }, { time: '2026-10-17T09:06:00+05:30', minor: 9 }] }
        : { responseStatusStrg: 'OK', InfoList: [{ employeeNoString: '104', time: '2026-10-17T18:12:40+05:30', attendanceStatus: 'checkOut', currentVerifyMode: 'cardAndFp' }] };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ AcsEvent: page }));
    });
    const base = await dev.start();
    try {
      const r = await pullPunches(device('HIKVISION', base) as any, window_.from, window_.to);
      expect(r).toMatchObject({ ok: true, received: 3 });
      expect(r.lines).toEqual(['104\t2026-10-17 09:05:12\t0\t15', '104\t2026-10-17 18:12:40\t1\t4']);
      expect(calls).toBe(2); // two pages reached the handler; the challenges before each are answered without it
      const wrong = await pullPunches(device('HIKVISION', base, { apiSecret: encryptSecret('nope') }) as any, window_.from, window_.to);
      expect(wrong).toMatchObject({ ok: false, message: expect.stringContaining('refused') });
    } finally {
      await dev.stop();
    }
  });
});

describe('Dahua', () => {
  it('reads the key=value records and pages by startIndex', () => {
    const text = 'found=2\r\nrecords[0].CardNo=0001\r\nrecords[0].UserID=104\r\nrecords[0].CreateTime=1760672112\r\nrecords[0].Status=1\r\nrecords[0].Type=Entry\r\nrecords[0].Method=15\r\nrecords[1].UserID=105\r\nrecords[1].CreateTime=1760672200\r\nrecords[1].Status=0\r\nrecords[1].Type=Exit\r\n';
    const { found, records } = parseDahuaRecords(text);
    expect(found).toBe(2);
    expect(records[0]).toMatchObject({ UserID: '104', Type: 'Entry', Method: '15' });
  });
  it('pulls through Digest and skips refused records', async () => {
    const dev = fakeDevice((req, _body, res) => {
      expect(req.url).toContain('/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&condition.CreateTime%5B0%5D=');
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('found=2\nrecords[0].UserID=104\nrecords[0].CreateTime=1792208112\nrecords[0].Status=1\nrecords[0].Type=Entry\nrecords[0].Method=1\nrecords[1].UserID=105\nrecords[1].CreateTime=1760672200\nrecords[1].Status=0\nrecords[1].Type=Exit\n');
    });
    const base = await dev.start();
    try {
      const r = await pullPunches(device('DAHUA', base) as any, window_.from, window_.to);
      expect(r).toMatchObject({ ok: true, received: 2 });
      /* 1792208112 = 2026-10-17T03:35:12Z = 09:05:12 IST */
      expect(r.lines).toEqual(['104\t2026-10-17 09:05:12\t0\t1']);
    } finally {
      await dev.stop();
    }
  });
});

describe('BioStar 2', () => {
  it('signs in for a session, then searches events in pages', async () => {
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        if (req.url === '/api/login') {
          expect(JSON.parse(data)).toEqual({ User: { login_id: 'admin', password: 'Secret12' } });
          res.writeHead(200, { 'bs-session-id': 'sess-1', 'Content-Type': 'application/json' }).end('{}');
        } else if (req.url === '/api/events/search') {
          expect(req.headers['bs-session-id']).toBe('sess-1');
          const q = JSON.parse(data).Query;
          const rows = q.offset === 0
            ? [{ datetime: '2026-10-17T03:35:12.00Z', user_id: { user_id: '104' }, event_type_id: { code: '4102' }, tna_key: '1' }, { datetime: '2026-10-17T03:36:00.00Z', event_type_id: { code: '20480' } }]
            : [];
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ EventCollection: { rows } }));
        } else res.writeHead(404).end();
      });
    });
    const base = await new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}`)));
    try {
      const r = await pullPunches(device('BIOSTAR', base) as any, window_.from, window_.to);
      expect(r).toMatchObject({ ok: true, received: 2 });
      expect(r.lines).toEqual(['104\t2026-10-17 09:05:12\t0\t0']);
    } finally {
      await new Promise((ok) => server.close(ok));
    }
  });
});

/* --------------------------------------------------------------------------- */

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
async function makeOwner(): Promise<Ctx> {
  const email = `pull.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Pull Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code: '104', dateOfJoining: '2026-01-01' }).expect(201);
  return c;
}

describe('any software with a JSON API', () => {
  it('is polled with the window in the URL, signed in with a header, read through a mapping, and synced from the Readers screen', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(String(req.url));
      if (req.headers['x-api-key'] !== 'k-123') return res.writeHead(401).end('{"error":"key"}');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: { logs: [{ emp: '104', at: '2026-10-17 09:05', io: 'I' }, { emp: '104', at: '2026-10-17 18:10', io: 'O' }] } }));
    });
    const base = await new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}`)));
    try {
      const c = await makeOwner();
      const body = { vendor: 'HTTP_PULL', name: 'Old software', baseUrl: `${base}/logs?from={from}&to={to}`, username: 'X-API-Key', password: 'k-123', config: { method: 'GET', timeFormat: 'date', auth: 'header' } };
      const tested = await api(c).post('/devices/test-pull', body).expect(200);
      expect(tested.body).toMatchObject({ ok: true, punchesToday: 0, readable: 0 });
      expect(seen[0]).toMatch(/\/logs\?from=2026-\d\d-\d\d&to=2026-\d\d-\d\d$/);
      const bad = await api(c).post('/devices/test-pull', { ...body, password: 'wrong' }).expect(200);
      expect(bad.body).toMatchObject({ ok: false, message: expect.stringContaining('refused') });
      await api(c).post('/devices/test-pull', { ...body, baseUrl: 'ftp://x/{from}' }).expect(400);

      const made = (await api(c).post('/devices', body).expect(201)).body.device;
      expect(made).toMatchObject({ vendor: 'HTTP_PULL', capabilities: ['pull', 'mapping'], apiUsername: 'X-API-Key' });
      expect(JSON.stringify(made)).not.toContain('k-123');

      /* No mapping yet: the answer is kept, nothing read. */
      const first = await api(c).post(`/devices/${made.id}/sync`).expect(200);
      expect(first.body).toMatchObject({ ok: true, added: 0 });
      expect((await api(c).get(`/devices/${made.id}/last-payload`).expect(200)).body.payload).toContain('"logs"');

      const mapping = { records: 'data.logs', employeeCode: 'emp', timestamp: 'at', direction: 'io', inValues: ['I'], outValues: ['O'] };
      const preview = await api(c).post(`/devices/${made.id}/preview`, { mapping }).expect(200);
      expect(preview.body).toMatchObject({ records: 2, readable: 2 });
      await api(c).put(`/devices/${made.id}`, { name: 'Old software', direction: 'both', mapping }).expect(200);
      const second = await api(c).post(`/devices/${made.id}/sync`).expect(200);
      expect(second.body).toMatchObject({ ok: true, received: 2, added: 2 });
      expect((await api(c).post(`/devices/${made.id}/sync`).expect(200)).body.added).toBe(0);
      const punch = await peoplePrisma.devicePunch.findFirst({ where: { orgId: c.orgId, pin: '104', kind: 'OUT' } });
      expect(punch).toMatchObject({ localTime: '2026-10-17 18:10:00' });
      expect(punch!.employeeId).toBeTruthy();

      /* A Hikvision connection from the screen, with a wrong password: told so, not saved blind. */
      const hik = fakeDevice((_r, _b, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"AcsEvent":{"responseStatusStrg":"NO MATCH","InfoList":[]}}'));
      const hbase = await hik.start();
      try {
        expect((await api(c).post('/devices/test-pull', { vendor: 'HIKVISION', baseUrl: hbase, username: 'admin', password: 'wrong' }).expect(200)).body.ok).toBe(false);
        expect((await api(c).post('/devices/test-pull', { vendor: 'HIKVISION', baseUrl: hbase, username: 'admin', password: 'Secret12' }).expect(200)).body).toMatchObject({ ok: true, punchesToday: 0 });
        const h = (await api(c).post('/devices', { vendor: 'HIKVISION', name: 'Gate', baseUrl: hbase, username: 'admin', password: 'Secret12' }).expect(201)).body.device;
        expect(h.serialNumber).toMatch(/^HIKV-/);
        expect((await api(c).get('/devices').expect(200)).body.drivers.find((d: any) => d.vendor === 'HIKVISION').unverified).toBe(true);
        await api(c).put(`/devices/${h.id}`, { name: 'Gate', direction: 'both', baseUrl: 'not a url' }).expect(400);
      } finally {
        await hik.stop();
      }
    } finally {
      await new Promise((ok) => server.close(ok));
    }
  });
});
