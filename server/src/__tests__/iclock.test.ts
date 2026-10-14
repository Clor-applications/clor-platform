import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * A simulated reader talking to /iclock exactly as a ZKTeco / eSSL reader does
 * (the requests are the ones the on-premise ClorTime server receives), and the
 * company's side under Attendance → Readers.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `rdr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Reader Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  if (Object.keys(features).length) await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** What a reader sends. */
const reader = (sn: string) => ({
  handshake: () => request(app).get(`/iclock/cdata?SN=${sn}&options=all&pushver=2.4.1&language=69`),
  heartbeat: (info?: string) => request(app).get(`/iclock/getrequest?SN=${sn}${info ? `&INFO=${encodeURIComponent(info)}` : ''}`),
  push: (lines: string[], table = 'ATTLOG') =>
    request(app).post(`/iclock/cdata?SN=${sn}&table=${table}&Stamp=9999`).set('Content-Type', 'text/plain').send(lines.join('\n')),
  result: (body: string) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('Content-Type', 'text/plain').send(body),
});
const serial = () => `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const addReader = async (c: Ctx, sn: string, direction = 'both') =>
  (await api(c).post('/devices', { serialNumber: sn, name: `Gate ${sn.slice(-4)}`, direction }).expect(201)).body;
const day = async (c: Ctx, employeeId: string, date: string) =>
  (await api(c).get(`/records?from=${date}&to=${date}&employeeId=${employeeId}`).expect(200)).body.records[0];

/* 2026-09-01 is a Tuesday. Standard shift 09:00–18:00, grace 10 minutes. */

describe('a reader nobody has claimed', () => {
  it('gets its options, but its punches are dropped until a company adds it', async () => {
    const sn = serial();
    const r = reader(sn);
    const hs = await r.handshake().expect(200);
    expect(hs.text).toContain('Realtime=1');
    expect(hs.text).toContain('Stamp=0');
    expect((await r.push(['1\t2026-09-01 09:00:00\t0\t1']).expect(200)).text).toBe('OK');
    expect(await peoplePrisma.devicePunch.count({ where: { serialNumber: sn } })).toBe(0);

    const c = await makeOwner();
    const added = await addReader(c, sn);
    expect(added.seenBefore).toBeTruthy();
    expect(added.device.online).toBe(true);
  });

  it('belongs to one company only', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const sn = serial();
    await addReader(a, sn);
    await api(b).post('/devices', { serialNumber: sn, name: 'Mine too' }).expect(409);
  });
});

describe('punches into days', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await makeOwner();
  }, 60_000);

  it('matches the reader ID to the employee code without its leading zeros, and works the day out', async () => {
    const sn = serial();
    await addReader(c, sn);
    const p = await person(c, { name: 'Code Fifty', code: '050' });
    const res = await reader(sn).push(['50\t2026-09-01 09:25:10\t0\t1\t0', '50\t2026-09-01 18:40:00\t1\t1\t0']).expect(200);
    expect(res.text).toBe('OK: 2');
    const d = await day(c, p.id, '2026-09-01');
    expect(d).toMatchObject({ source: 'DEVICE', checkInTime: '09:25', checkOutTime: '18:40', lateMinutes: 25, status: 'PRESENT' });

    // A reader resends after an outage: nothing doubles.
    expect((await reader(sn).push(['50\t2026-09-01 09:25:10\t0\t1\t0']).expect(200)).text).toBe('OK: 0');
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(2);
  });

  it('a forgotten badge-out is not hidden: the day ends at the last real exit', async () => {
    const sn = serial();
    await addReader(c, sn);
    const p = await person(c, { name: 'Came Back', code: `CB${rnd()}` });
    await reader(sn).push([`${p.code}\t2026-09-02 10:30:00\t0\t1`, `${p.code}\t2026-09-02 13:49:00\t1\t1`, `${p.code}\t2026-09-02 14:45:00\t0\t1`]).expect(200);
    expect(await day(c, p.id, '2026-09-02')).toMatchObject({ checkInTime: '10:30', checkOutTime: '13:49' });
  });

  it('an exit-only reader makes every punch an exit, whatever key was pressed', async () => {
    const inGate = serial();
    const outGate = serial();
    await addReader(c, inGate, 'in');
    await addReader(c, outGate, 'out');
    const p = await person(c, { name: 'Two Gates', code: `TG${rnd()}` });
    await reader(inGate).push([`${p.code}\t2026-09-03 09:00:00\t0\t1`]).expect(200);
    await reader(outGate).push([`${p.code}\t2026-09-03 18:05:00\t0\t1`]).expect(200);
    expect(await day(c, p.id, '2026-09-03')).toMatchObject({ checkInTime: '09:00', checkOutTime: '18:05' });
  });

  it('puts a night shift’s morning exit on the evening it started', async () => {
    const sn = serial();
    await addReader(c, sn);
    const p = await person(c, { name: 'Nights', code: `NS${rnd()}` });
    const shift = (await api(c).post('/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 0, weeklyOffDays: '0' }).expect(201)).body.shift;
    await api(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: shift.id, effectiveFrom: '2026-01-01' }).expect(200);
    await reader(sn).push([`${p.code}\t2026-09-04 21:58:00\t0\t1`, `${p.code}\t2026-09-05 06:02:00\t1\t1`]).expect(200);
    expect(await day(c, p.id, '2026-09-04')).toMatchObject({ checkInTime: '21:58', checkOutTime: '06:02', status: 'PRESENT' });
    expect(await day(c, p.id, '2026-09-05')).toBeUndefined();
  });

  it('leaves a day someone corrected by hand alone', async () => {
    const sn = serial();
    await addReader(c, sn);
    const p = await person(c, { name: 'Corrected', code: `CR${rnd()}` });
    await api(c).put('/records', { employeeId: p.id, date: '2026-09-07', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    await reader(sn).push([`${p.code}\t2026-09-07 11:00:00\t0\t1`]).expect(200);
    expect(await day(c, p.id, '2026-09-07')).toMatchObject({ source: 'MANUAL', checkInTime: '09:00' });
  });

  it('keeps punches nobody matches, and works them out once matched', async () => {
    const sn = serial();
    await addReader(c, sn);
    const pin = `9${Date.now() % 100000}`;
    await reader(sn).push([`${pin}\t2026-09-08 09:05:00\t0\t1`, `${pin}\t2026-09-08 18:00:00\t1\t1`]).expect(200);
    const list = (await api(c).get('/punches/unmatched').expect(200)).body.pins;
    expect(list.find((x: any) => x.pin === pin)).toMatchObject({ punches: 2 });

    const p = await person(c, { name: 'Matched Later', code: `ML${rnd()}` });
    expect((await api(c).post('/punches/match', { pin, employeeId: p.id }).expect(200)).body).toMatchObject({ matched: 2, days: 1 });
    expect(await day(c, p.id, '2026-09-08')).toMatchObject({ checkInTime: '09:05', checkOutTime: '18:00' });
    // Their next punch matches on its own.
    await reader(sn).push([`${pin}\t2026-09-09 09:00:00\t0\t1`]).expect(200);
    expect(await day(c, p.id, '2026-09-09')).toMatchObject({ checkInTime: '09:00' });
  });

  it('takes nothing from a company that switched Attendance off', async () => {
    const off = await makeOwner();
    const sn = serial();
    await addReader(off, sn);
    await request(app).put(`/api/orgs/${off.orgId}/features`).set(at(off)).send({ features: { attendance: false } }).expect(200);
    await reader(sn).push(['1\t2026-09-01 09:00:00\t0\t1']).expect(200);
    expect(await peoplePrisma.devicePunch.count({ where: { serialNumber: sn } })).toBe(0);
  });
});

describe('commands through the heartbeat', () => {
  it('asks a new reader for its whole log, then hands out queued commands and records results', async () => {
    const c = await makeOwner();
    const sn = serial();
    const { device } = await addReader(c, sn);
    const r = reader(sn);

    const first = await r.heartbeat('ZAM70-NF24HA-Ver3.3.12,1,1,0,192.168.1.201').expect(200);
    const m = first.text.match(/^C:(\d+):DATA QUERY ATTLOG$/);
    expect(m).toBeTruthy();
    await r.result(`ID=${m![1]}&Return=0&CMD=DATA`).expect(200);
    expect((await r.heartbeat().expect(200)).text).toBe('OK');

    const list = (await api(c).get('/devices').expect(200)).body.devices.find((d: any) => d.id === device.id);
    expect(list).toMatchObject({ model: 'ZAM70-NF24HA', firmware: '3.3.12', online: true });

    // Users the reader already has are not sent again.
    await person(c, { name: 'On Reader', code: '104' });
    await person(c, { name: 'New Hire', code: '105' });
    await r.push(['USER PIN=104\tName=On Reader\tPri=0'], 'OPERLOG').expect(200);
    expect((await api(c).post(`/devices/${device.id}/commands`, { action: 'SEND_STAFF' }).expect(200)).body.queued).toBe(1);
    const cmd = await r.heartbeat().expect(200);
    expect(cmd.text).toMatch(/^C:\d+:DATA UPDATE USERINFO PIN=105\tName=New Hire\t/);
    const id = cmd.text.split(':')[1];
    await r.result(`ID=${id}&Return=-1004&CMD=DATA`).expect(200);
    const commands = (await api(c).get(`/devices/${device.id}/commands`).expect(200)).body.commands;
    expect(commands.find((x: any) => String(x.id) === id)).toMatchObject({ status: 'FAILED', returnCode: -1004 });
  });

  it('a result for another reader’s command changes nothing', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    const cmd = await reader(a).heartbeat().expect(200);
    const id = cmd.text.split(':')[1];
    await reader(b).result(`ID=${id}&Return=0`).expect(200);
    expect((await peoplePrisma.deviceCommand.findUnique({ where: { id: Number(id) } }))!.status).toBe('SENT');
  });
});
