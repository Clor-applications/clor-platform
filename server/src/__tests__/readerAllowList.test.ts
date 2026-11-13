import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A reader's own allow-list (AttendanceDevice.ipAllowList): a ZKTeco / eSSL
 * reader is known only by the serial printed on it, so a company may name the
 * network addresses its punches are accepted from. A push from anywhere else
 * is refused and logged; with no list the reader behaves as before.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { inRange, parseAllowList, parseRange, showRange } = await import('../services/attendance/network.js');
const { _forgetRefusals } = await import('../routes/iclock.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});
beforeEach(() => _forgetRefusals());

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `allow.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Allow Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const serial = () => `ALW${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const OFFICE = '198.51.100.7';
/** A reader (or someone pretending to be it) calling from a given internet address. */
const from = (sn: string, ip: string) => ({
  heartbeat: () => request(app).get(`/iclock/getrequest?SN=${sn}`).set('X-Forwarded-For', ip),
  push: (lines: string[], table = 'ATTLOG') => request(app).post(`/iclock/cdata?SN=${sn}&table=${table}&Stamp=9999`).set('X-Forwarded-For', ip).set('Content-Type', 'text/plain').send(lines.join('\n')),
  result: (body: string) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('X-Forwarded-For', ip).set('Content-Type', 'text/plain').send(body),
});
/** A reader added from the office and heard from there, so the network lock has approved the office. */
async function officeReader(c: Ctx) {
  const sn = serial();
  const added = (await request(app).post(`/api/orgs/${c.orgId}/attendance/devices`).set(at(c)).set('X-Forwarded-For', OFFICE).send({ serialNumber: sn, name: 'Main gate', direction: 'both' }).expect(201)).body.device;
  expect((await from(sn, OFFICE).push(['1\t2026-09-01 09:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
  return { sn, id: added.id as string };
}
const save = (c: Ctx, id: string, ipAllowList: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance/devices/${id}`).set(at(c)).send({ name: 'Main gate', direction: 'both', ipAllowList });
const punches = (sn: string) => peoplePrisma.devicePunch.count({ where: { serialNumber: sn } });
const refusals = (id: string) => peoplePrisma.deviceLog.findMany({ where: { deviceId: id, code: 'ADDRESS_REFUSED' }, orderBy: { createdAt: 'asc' } });

describe('addresses and ranges', () => {
  it('reads what a person types into one stored form', () => {
    expect(parseRange('203.0.113.7')).toBe('203.0.113.7/32');
    expect(parseRange(' 203.0.113.77/24 ')).toBe('203.0.113.0/24');
    expect(parseRange('010.001.002.003')).toBe('10.1.2.3/32');
    expect(parseRange('2001:db8::1')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001/128');
    expect(parseRange('2001:DB8:AB::/48')).toBe('2001:0db8:00ab:0000:0000:0000:0000:0000/48');
    expect(showRange('203.0.113.7/32')).toBe('203.0.113.7');
    expect(showRange('203.0.113.0/24')).toBe('203.0.113.0/24');
  });

  it('refuses what is not an address, and a range that is every address', () => {
    for (const bad of ['', 'office', '203.0.113', '203.0.113.300', '203.0.113.7/33', '203.0.113.7/', '0.0.0.0/0', '::/0', '2001:db8::/129', '203.0.113.7 /24', '203.0.113.7/24/8']) expect(parseRange(bad)).toBeNull();
    expect(parseAllowList(['203.0.113.7', '', 'not-an-address'])).toEqual({ bad: 'not-an-address' });
    expect(parseAllowList(['203.0.113.7', '203.0.113.7/32', ' ', '10.0.0.0/8'])).toEqual({ list: ['203.0.113.7/32', '10.0.0.0/8'] });
  });

  it('knows which addresses a range holds', () => {
    expect(inRange('203.0.113.7', '203.0.113.7/32')).toBe(true);
    expect(inRange('203.0.113.8', '203.0.113.7/32')).toBe(false);
    expect(inRange('203.0.113.200', '203.0.113.0/24')).toBe(true);
    expect(inRange('203.0.114.1', '203.0.113.0/24')).toBe(false);
    expect(inRange('::ffff:203.0.113.200', '203.0.113.0/24')).toBe(true);
    expect(inRange('10.200.3.4', '10.128.0.0/9')).toBe(true);
    expect(inRange('10.100.3.4', '10.128.0.0/9')).toBe(false);
    expect(inRange('2001:db8:ab:1::9', '2001:0db8:00ab:0000:0000:0000:0000:0000/48')).toBe(true);
    expect(inRange('2001:db8:ac::9', '2001:0db8:00ab:0000:0000:0000:0000:0000/48')).toBe(false);
    /* An IPv4 address is never inside an IPv6 range, nor the other way. */
    expect(inRange('203.0.113.7', '2001:0db8:00ab:0000:0000:0000:0000:0000/48')).toBe(false);
    expect(inRange(null, '203.0.113.0/24')).toBe(false);
    expect(inRange('203.0.113.7', 'rubbish')).toBe(false);
  });
});

describe('a reader with an allow-list', () => {
  it('takes punches from a listed address and refuses and logs every other', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    const saved = (await save(c, r.id, ['198.51.100.7', '192.0.2.0/24']).expect(200)).body;
    expect(saved.device.ipAllowList).toEqual(['198.51.100.7', '192.0.2.0/24']);
    expect(saved.readerOutsideAllowList).toBeNull();

    /* Listed: the single address, and anywhere in the range. */
    expect((await from(r.sn, OFFICE).push(['1\t2026-09-01 13:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
    expect((await from(r.sn, '192.0.2.250').push(['1\t2026-09-01 14:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
    expect(await punches(r.sn)).toBe(3);

    /* Not listed: the next address on the office's own block, which the network lock alone would have let in. */
    const forged = from(r.sn, '198.51.100.8');
    expect((await forged.push(['1\t2026-09-01 18:00:00\t1\t1'])).status).toBe(503);
    expect(await punches(r.sn)).toBe(3);
    /* No commands for it (they carry names and fingerprints), and it cannot say one was carried out. */
    await request(app).post(`/api/orgs/${c.orgId}/attendance/devices/${r.id}/commands`).set(at(c)).send({ action: 'REBOOT' }).expect((res) => expect(res.status).toBeLessThan(300));
    const waiting = await peoplePrisma.deviceCommand.count({ where: { serialNumber: r.sn, status: 'PENDING' } });
    expect(waiting).toBeGreaterThan(0);
    expect((await forged.heartbeat().expect(200)).text).toBe('OK');
    const one = await peoplePrisma.deviceCommand.findFirst({ where: { serialNumber: r.sn, status: 'PENDING' } });
    await forged.result(`ID=${one!.id}&Return=0&CMD=DATA`).expect(200);
    expect((await peoplePrisma.deviceCommand.findUnique({ where: { id: one!.id } }))!.status).toBe('PENDING');

    /* Logged once for that address, however often it tries; nothing is learnt or left waiting for approval. */
    const logs = await refusals(r.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'ERROR', orgId: c.orgId });
    expect(logs[0].details).toMatch(/198\.51\.100\.8/);
    const d = await peoplePrisma.attendanceDevice.findUniqueOrThrow({ where: { id: r.id } });
    expect(d.allowedNetworks).toEqual([OFFICE]);
    expect(d.pendingNetwork).toBeNull();
    /* The company sees it under Reader logs, Errors. */
    const shown = (await request(app).get(`/api/orgs/${c.orgId}/attendance/device-logs?kind=ERROR&from=2020-01-01&to=2099-12-31`).set(at(c)).expect(200)).body.logs;
    expect(shown.some((l: any) => l.code === 'ADDRESS_REFUSED' && l.deviceName === 'Main gate')).toBe(true);

    /* A second address is a second line. */
    await from(r.sn, '203.0.113.99').push(['1\t2026-09-01 19:00:00\t1\t1']);
    expect(await refusals(r.id)).toHaveLength(2);
  }, 60_000);

  it('does not take the address from a header the caller wrote', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    await save(c, r.id, [OFFICE]).expect(200);
    /* The test client is a trusted proxy (loopback), so the last address in the chain is the caller; one it put in front is ignored. */
    const spoof = await request(app).post(`/iclock/cdata?SN=${r.sn}&table=ATTLOG&Stamp=9999`).set('X-Forwarded-For', `${OFFICE}, 203.0.113.50`).set('Content-Type', 'text/plain').send('1\t2026-09-02 09:00:00\t0\t1');
    expect(spoof.status).toBe(503);
    /* Headers that mean nothing to this server are no way in either. */
    const other = await request(app).post(`/iclock/cdata?SN=${r.sn}&table=ATTLOG&Stamp=9999`).set('X-Forwarded-For', '203.0.113.50').set('X-Real-IP', OFFICE).set('CF-Connecting-IP', OFFICE).set('Content-Type', 'text/plain').send('1\t2026-09-02 09:00:00\t0\t1');
    expect(other.status).toBe(503);
    expect(await punches(r.sn)).toBe(1);
  }, 60_000);

  it('with the list emptied again, behaves as before: the network lock decides', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    await save(c, r.id, ['192.0.2.0/24']).expect(200);
    expect((await from(r.sn, OFFICE).push(['1\t2026-09-01 13:00:00\t0\t1'])).status).toBe(503);
    expect((await save(c, r.id, []).expect(200)).body.device.ipAllowList).toEqual([]);
    expect((await from(r.sn, OFFICE).push(['1\t2026-09-01 13:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
    /* The office line's address moving within its block is still approved by the lock, as today. */
    expect((await from(r.sn, '198.51.100.42').push(['1\t2026-09-01 18:00:00\t1\t1']).expect(200)).text).toBe('OK: 1');
    expect((await from(r.sn, '203.0.113.9').push(['1\t2026-09-02 09:00:00\t0\t1'])).status).toBe(503);
  }, 60_000);

  it('a reader that never had a list is untouched by any of this', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    const d = (await request(app).get(`/api/orgs/${c.orgId}/attendance/devices`).set(at(c)).expect(200)).body.devices[0];
    expect(d.ipAllowList).toEqual([]);
    /* Saving the page without the field leaves it alone. */
    await request(app).put(`/api/orgs/${c.orgId}/attendance/devices/${r.id}`).set(at(c)).send({ name: 'Main gate', direction: 'in' }).expect(200);
    expect((await from(r.sn, OFFICE).push(['1\t2026-09-01 13:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
    expect(await refusals(r.id)).toHaveLength(0);
  }, 60_000);
});

describe('setting the list', () => {
  it('says which entry is not an address, in plain words, and saves nothing', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    const bad = await save(c, r.id, ['198.51.100.7', 'office wifi']).expect(400);
    expect(bad.body).toMatchObject({ code: 'BAD_NETWORK_ADDRESS' });
    expect(bad.body.error).toMatch(/“office wifi” is not a network address/);
    await save(c, r.id, ['0.0.0.0/0']).expect(400);
    await save(c, r.id, Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`)).expect(400);
    expect((await peoplePrisma.attendanceDevice.findUniqueOrThrow({ where: { id: r.id } })).ipAllowList).toEqual([]);
  }, 60_000);

  it('saves a list that leaves out the reader’s own address, and says so', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    const saved = (await save(c, r.id, ['192.0.2.0/24']).expect(200)).body;
    expect(saved.readerOutsideAllowList).toBe(OFFICE);
  }, 60_000);

  it('is the company’s own: another company cannot set it', async () => {
    const c = await makeOwner();
    const r = await officeReader(c);
    const other = await makeOwner();
    await request(app).put(`/api/orgs/${other.orgId}/attendance/devices/${r.id}`).set(at(other)).send({ name: 'Main gate', direction: 'both', ipAllowList: ['203.0.113.9'] }).expect(404);
    expect((await peoplePrisma.attendanceDevice.findUniqueOrThrow({ where: { id: r.id } })).ipAllowList).toEqual([]);
  }, 60_000);
});
