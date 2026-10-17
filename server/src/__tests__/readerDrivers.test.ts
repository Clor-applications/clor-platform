import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Readers of any vendor: punches read through a field mapping from whatever
 * shape a device or software sends (HTTP push to a per-reader URL, or a CSV
 * file), times read in the source's zone, and all landing on the same days
 * as a reader's own punches.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { pick, readTime, recordsOf, toAttlog, mappingSchema } = await import('../services/attendance/punchMapping.js');
const { parseCsv } = await import('../services/attendance/csv.js');
const { can, driverOf } = await import('../services/attendance/drivers.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const IST = 'Asia/Kolkata';
const M = (over: Record<string, unknown> = {}) => mappingSchema.parse({ employeeCode: 'code', timestamp: 'time', ...over });

describe('reading what another system sends', () => {
  it('finds fields by path, including inside arrays', () => {
    const body = { data: { events: [{ user: { id: '104' }, ts: '2026-10-17 09:05:12' }] } };
    expect(pick(body, 'data.events[0].user.id')).toBe('104');
    expect(pick({ 'a.b': 1 }, 'a.b')).toBe(1);
    expect(recordsOf(body, { records: 'data.events' })).toHaveLength(1);
    expect(recordsOf({ punches: [{}, {}] }, { records: '' })).toHaveLength(2);
    expect(recordsOf({ code: '1' }, { records: '' })).toHaveLength(1);
  });

  it('reads times in the source zone, ISO offsets, epochs and day-first dates', () => {
    expect(readTime('2026-10-17 09:05:12', 'auto', IST)).toBe('2026-10-17 09:05:12');
    /* A reader in Dubai: 09:00 there is 10:30 here. */
    expect(readTime('2026-10-17 09:00:00', 'auto', 'Asia/Dubai')).toBe('2026-10-17 10:30:00');
    expect(readTime('2026-10-17T03:35:12Z', 'auto', IST)).toBe('2026-10-17 09:05:12');
    expect(readTime('2026-10-17T09:05:12+05:30', 'auto', 'Asia/Dubai')).toBe('2026-10-17 09:05:12');
    expect(readTime(1_776_396_312, 'auto', IST)).toBe('2026-04-17 08:55:12');
    expect(readTime(1_776_396_312_000, 'epoch_ms', IST)).toBe('2026-04-17 08:55:12');
    expect(readTime('17/10/2026 9:05 am', 'DMY', IST)).toBe('2026-10-17 09:05:00');
    expect(readTime('10/17/2026 14:05', 'MDY', IST)).toBe('2026-10-17 14:05:00');
    expect(readTime('yesterday', 'auto', IST)).toBeNull();
    expect(readTime('2026-13-01 00:00', 'auto', IST)).toBeNull();
  });

  it('maps direction words, verify modes, and filters by event type', () => {
    const mapping = M({ direction: 'dir', inValues: ['entry'], outValues: ['exit'], verifyMode: 'how', filterField: 'event', filterValues: ['granted'] });
    const out = toAttlog(
      [
        { code: '7', time: '2026-10-17 09:00', dir: 'Entry', how: 'face', event: 'granted' },
        { code: '7', time: '2026-10-17 18:00', dir: 'exit', how: 'card', event: 'granted' },
        { code: '7', time: '2026-10-17 18:01', dir: 'exit', event: 'denied' },
        { time: '2026-10-17 18:02', dir: 'exit', event: 'granted' },
      ],
      mapping,
      IST
    );
    expect(out.lines).toEqual(['7\t2026-10-17 09:00:00\t0\t15', '7\t2026-10-17 18:00:00\t1\t4']);
    expect(out.skipped).toBe(1);
    expect(out.errors).toEqual(['Record 4: No employee code at "code".']);
  });

  it('parses CSV with quotes, separators Excel uses, and a BOM', () => {
    const csv = parseCsv('﻿Emp Code;Date;Time;Name\n"104";17-10-2026;09:05;"Rao, Asha"\n105;17-10-2026;09:07;Kumar\n\n');
    expect(csv.headers).toEqual(['Emp Code', 'Date', 'Time', 'Name']);
    expect(csv.rows).toEqual([
      { 'Emp Code': '104', Date: '17-10-2026', Time: '09:05', Name: 'Rao, Asha' },
      { 'Emp Code': '105', Date: '17-10-2026', Time: '09:07', Name: 'Kumar' },
    ]);
    const out = toAttlog(csv.rows, M({ employeeCode: 'Emp Code', timestamp: '', date: 'Date', time: 'Time', timeFormat: 'DMY' }), IST);
    expect(out.lines[0]).toBe('104\t2026-10-17 09:05:00\t255\t0');
  });

  it('knows what each driver can do', () => {
    expect(can('ADMS', 'users')).toBe(true);
    expect(can('HTTP_PUSH', 'users')).toBe(false);
    expect(can('HTTP_PUSH', 'mapping')).toBe(true);
    expect(driverOf('nonsense').vendor).toBe('ADMS');
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
  const email = `drv.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Driver Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code: '104', dateOfJoining: '2026-01-01' }).expect(201);
  return c;
}

describe('a reader that pushes to its own URL', () => {
  it('keeps the first payload for mapping, then reads punches, and its token can be rotated', async () => {
    const c = await makeOwner();
    const list = await api(c).get('/devices').expect(200);
    expect(list.body.drivers.map((d: any) => d.vendor)).toEqual(expect.arrayContaining(['ADMS', 'HTTP_PUSH', 'FILE']));

    const made = await api(c).post('/devices', { vendor: 'HTTP_PUSH', name: 'Hikvision gate', sourceTimezone: 'Asia/Kolkata' }).expect(201);
    const token: string = made.body.pushToken;
    expect(token).toMatch(/^clorp_/);
    expect(made.body.device).toMatchObject({ vendor: 'HTTP_PUSH', capabilities: ['push', 'mapping'], mapping: null });
    expect(JSON.stringify(made.body.device)).not.toContain('pushTokenHash');

    /* No mapping yet: accepted and kept, nothing read. */
    const body = { AccessControllerEvent: [{ employeeNoString: '104', dateTime: '2026-10-17T09:05:12+05:30', attendanceStatus: 'checkIn', eventType: 'granted' }] };
    const first = await request(app).post(`/ingest/${token}`).send(body).expect(202);
    expect(first.body.stored).toBe(0);
    expect((await api(c).get(`/devices/${made.body.device.id}/last-payload`).expect(200)).body.payload).toContain('employeeNoString');

    const mapping = { records: 'AccessControllerEvent', employeeCode: 'employeeNoString', timestamp: 'dateTime', direction: 'attendanceStatus', inValues: ['checkIn'], outValues: ['checkOut'] };
    const preview = await api(c).post(`/devices/${made.body.device.id}/preview`, { mapping }).expect(200);
    expect(preview.body).toMatchObject({ records: 1, readable: 1, sample: [{ code: '104', localTime: '2026-10-17 09:05:12', direction: 'in' }] });
    await api(c).put(`/devices/${made.body.device.id}`, { name: 'Hikvision gate', direction: 'both', mapping }).expect(200);

    const second = await request(app).post(`/ingest/${token}`).send(body).expect(200);
    expect(second.body).toMatchObject({ received: 1, accepted: 1, added: 1 });
    expect((await request(app).post(`/ingest/${token}`).send(body).expect(200)).body.duplicates).toBe(1);
    const punch = await peoplePrisma.devicePunch.findFirst({ where: { orgId: c.orgId, pin: '104' } });
    expect(punch).toMatchObject({ localTime: '2026-10-17 09:05:12', kind: 'IN' });
    expect(punch!.employeeId).toBeTruthy();

    /* A form post, as some middleware sends. */
    await request(app).post(`/ingest/${token}`).type('form').send({ AccessControllerEvent: 'not json' }).expect(200);

    const rotated = (await api(c).post(`/devices/${made.body.device.id}/rotate-token`).expect(200)).body.pushToken;
    await request(app).post(`/ingest/${token}`).send(body).expect(404);
    await request(app).post(`/ingest/${rotated}`).send(body).expect(200);
    await request(app).post('/ingest/clorp_notatoken_notatoken_x').send(body).expect(404);
  });
});

describe('a file from any reader software', () => {
  it('is previewed with its own column names, then imported once', async () => {
    const c = await makeOwner();
    const made = await api(c).post('/devices', { vendor: 'FILE', name: 'Monthly export' }).expect(201);
    expect(made.body.pushToken).toBeNull();
    const id = made.body.device.id;
    const csv = 'EmpCode,PunchDate,PunchTime,InOut\n104,17/10/2026,09:05,IN\n104,17/10/2026,18:10,OUT\n999,17/10/2026,09:00,IN\nbad,,,\n';
    const mapping = { employeeCode: 'EmpCode', date: 'PunchDate', time: 'PunchTime', timeFormat: 'DMY', direction: 'InOut' };

    const preview = await api(c).post(`/devices/${id}/preview`, { mapping, sample: csv }).expect(200);
    expect(preview.body.headers).toEqual(['EmpCode', 'PunchDate', 'PunchTime', 'InOut']);
    expect(preview.body).toMatchObject({ records: 4, readable: 3 });
    expect(preview.body.errors[0]).toContain('Record 4');
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId } })).toBe(0);

    const saved = await api(c).post(`/devices/${id}/preview`, { mapping, sample: csv, save: true }).expect(200);
    expect(saved.body).toMatchObject({ added: 3, duplicates: 0 });
    /* 999 is nobody we know: kept as an unmatched punch, not dropped. */
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, employeeId: null } })).toBe(1);
    expect((await api(c).post(`/devices/${id}/preview`, { mapping, sample: csv, save: true }).expect(200)).body).toMatchObject({ added: 0, duplicates: 3 });
    /* The mapping that worked is kept for next month. */
    expect((await api(c).get('/devices').expect(200)).body.devices.find((d: any) => d.id === id).mapping.employeeCode).toBe('EmpCode');

    await api(c).post('/devices', { vendor: 'FILE', name: 'Bad zone', sourceTimezone: 'Mars/Olympus' }).expect(400);
  });
});
