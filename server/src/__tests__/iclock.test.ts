import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
  /* These tests are about copying fingerprints between readers, which a company switches on (DPDP; off by default, see dpdp.test.ts). */
  if (features.attendance) await request(app).put(`/api/orgs/${ctx.orgId}/attendance/data-protection`).set(at(ctx)).send({ biometricCopy: true, attest: true }).expect(200);
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
    // Then its counts and limits, once every few hours.
    const info = (await r.heartbeat().expect(200)).text.match(/^C:(\d+):INFO$/);
    expect(info).toBeTruthy();
    await r.result(`ID=${info![1]}&Return=0&CMD=INFO\nUserCount=2\nMaxUserCount=3000`).expect(200);
    // Then who is on it — users, fingerprints, faces (sync from the reader).
    const asked: string[] = [];
    for (let t = (await r.heartbeat().expect(200)).text; t !== 'OK'; t = (await r.heartbeat().expect(200)).text) {
      asked.push(t.split(':').slice(2).join(':'));
      await r.result(`ID=${t.split(':')[1]}&Return=0&CMD=DATA`).expect(200);
    }
    expect(asked).toEqual(['DATA QUERY USERINFO', 'DATA QUERY FINGERTMP', 'DATA QUERY FACE', 'DATA QUERY BIODATA']);

    const list = (await api(c).get('/devices').expect(200)).body.devices.find((d: any) => d.id === device.id);
    expect(list).toMatchObject({ model: 'ZAM70-NF24HA', firmware: '3.3.12', online: true });

    // A new employee goes to the readers at once.
    await person(c, { name: 'On Reader', code: '104' });
    await person(c, { name: 'New Hire', code: '105' });
    expect((await peoplePrisma.deviceCommand.findMany({ where: { deviceId: device.id, status: 'PENDING' }, orderBy: { id: 'asc' } })).map((x) => x.command.split('\t')[0])).toEqual([
      'DATA UPDATE USERINFO PIN=104',
      'DATA UPDATE USERINFO PIN=105',
    ]);
    await peoplePrisma.deviceCommand.deleteMany({ where: { deviceId: device.id, status: 'PENDING' } });
    // "Send new staff" skips users the reader already has.
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

/* Template data as readers send it: long base64, never "AAAAA…" (a blank). */
const tmpl = (seed: string) => Buffer.from(`${seed}-`.repeat(60)).toString('base64');

describe('fingerprints and faces between readers', () => {
  it('copies a fingerprint enrolled on one reader to the others, with the user first and the card kept', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    await person(c, { name: 'Ravi Kumar', code: '104' });
    const finger = tmpl('finger-104');
    await reader(a)
      .push([`USER PIN=104\tName=Ravi Kumar\tPri=0\tPasswd=1234\tCard=998877`, `FP PIN=104\tFID=6\tSize=1200\tValid=1\tTMP=${finger}`], 'OPERLOG')
      .expect(200);

    const first = (await reader(b).heartbeat().expect(200)).text;
    // The card goes with them; a door PIN a reader reports does not (only CLOR's employee file sets one).
    expect(first).toMatch(/^C:\d+:DATA UPDATE USERINFO PIN=104\tName=Ravi Kumar\tPri=0\tPasswd=\tCard=998877\t/);
    const second = (await reader(b).heartbeat().expect(200)).text;
    expect(second).toMatch(new RegExp(`^C:\\d+:DATA UPDATE FINGERTMP PIN=104\\tFID=6\\tSize=\\d+\\tValid=1\\tTMP=${finger.replace(/[+/=]/g, '.')}$`));
    // Nothing goes back to the reader it came from.
    const own = await peoplePrisma.deviceCommand.findMany({ where: { serialNumber: a, command: { contains: 'FINGERTMP' } } });
    expect(own).toHaveLength(0);
  });

  it('never spreads administrator rights or a door PIN that only a reader reports', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    // Anything that knows reader A's serial can claim to be it.
    await reader(a)
      .push([`USER PIN=999\tName=Intruder\tPri=14\tPasswd=4321\tCard=`, `FP PIN=999\tFID=1\tSize=1200\tValid=1\tTMP=${tmpl('finger-999')}`], 'OPERLOG')
      .expect(200);
    const toB = await peoplePrisma.deviceCommand.findMany({ where: { serialNumber: b, command: { startsWith: 'DATA UPDATE USERINFO PIN=999\t' } } });
    expect(toB.length).toBeGreaterThan(0);
    for (const cmd of toB) {
      expect(cmd.command).toContain('\tPri=0\t');
      expect(cmd.command).toContain('\tPasswd=\t');
    }

    // Set in CLOR, they do go to the readers.
    const emp = await peoplePrisma.employee.findFirst({ where: { orgId: c.orgId, code: '999' } });
    expect(emp).toBeTruthy();
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: b } });
    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${emp!.id}`).set(at(c)).send({ devicePrivilege: 14, devicePassword: '2468' }).expect(200);
    const set = await peoplePrisma.deviceCommand.findFirst({ where: { serialNumber: b, command: { startsWith: 'DATA UPDATE USERINFO PIN=999\t' } } });
    expect(set?.command).toContain('\tPri=14\tPasswd=2468\t');
  });

  it('sends a face with the target reader’s own face algorithm version, deleting the old face first', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    // Reader B says it runs face algorithm 58.
    await reader(b).heartbeat('SpeedFace-V5L-Ver6.6.1,1,1,0,10.0.0.9,10,58,12').expect(200);
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: b } });

    const face = tmpl('face-201');
    await reader(a)
      .push([`BIODATA Pin=201\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=${face}`], 'BIODATA')
      .expect(200);
    const cmds = (await peoplePrisma.deviceCommand.findMany({ where: { serialNumber: b }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] })).map((x) => x.command.split('\t')[0] + (x.command.includes('MajorVer=') ? ` ${x.command.match(/MajorVer=\d+/)![0]}` : ''));
    expect(cmds).toEqual(['DATA UPDATE USERINFO PIN=201', 'DATA DELETE FACE PIN=201', 'DATA UPDATE BIODATA Pin=201 MajorVer=58']);
    // Reader A's own version is learnt from what it sent.
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber: a } }))!.faceMajorVer).toBe(40);
  });

  it('does not bounce unchanged templates round, and skips faces for a reader without face', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    const fingerOnly = serial();
    await addReader(c, a);
    await addReader(c, b);
    await addReader(c, fingerOnly);
    await reader(fingerOnly).heartbeat('Ver 8.0.4.3-20240116,6,6,980,10.0.0.7,10,-1,0').expect(200); // eSSL fingerprint-only: face algorithm -1
    const face = `BIODATA Pin=301\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=${tmpl('face-301')}`;
    await reader(a).push([face], 'BIODATA').expect(200);
    const before = await peoplePrisma.deviceCommand.count({ where: { orgId: c.orgId, command: { contains: 'PIN=301' } } });
    // Reader B, asked for its templates, sends the same face back.
    await reader(b).push([face], 'BIODATA').expect(200);
    expect(await peoplePrisma.deviceCommand.count({ where: { orgId: c.orgId, command: { contains: 'PIN=301' } } })).toBe(before);
    expect(await peoplePrisma.deviceCommand.count({ where: { serialNumber: fingerOnly, command: { contains: 'UPDATE BIODATA' } } })).toBe(0);
  });

  it('copies everything stored onto a new reader on request, and shows counts — never template data', async () => {
    const c = await makeOwner();
    const a = serial();
    await addReader(c, a);
    await person(c, { name: 'Copied', code: '401' });
    await reader(a).push([`FP PIN=401\tFID=1\tSize=1\tValid=1\tTMP=${tmpl('f401a')}`, `FP PIN=401\tFID=2\tSize=1\tValid=1\tTMP=${tmpl('f401b')}`], 'FINGERTMP').expect(200);

    const fresh = serial();
    const { device } = await addReader(c, fresh);
    const r = (await api(c).post(`/devices/${device.id}/commands`, { action: 'COPY_TEMPLATES' }).expect(200)).body;
    expect(r).toMatchObject({ people: 1, queued: 3 });

    const list = (await api(c).get('/biometrics').expect(200)).body.people;
    expect(list.find((p: any) => p.pin === '401')).toMatchObject({ employeeName: 'Copied', fingers: 2, faces: 0 });
    expect(JSON.stringify(list)).not.toContain(tmpl('f401a'));
  });

  it('someone who leaves is taken off every reader and their templates are deleted', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    const p = await person(c, { name: 'Leaver', code: '501' });
    await reader(a).push([`FP PIN=501\tFID=1\tSize=1\tValid=1\tTMP=${tmpl('f501')}`], 'FINGERTMP').expect(200);
    await peoplePrisma.deviceCommand.deleteMany({ where: { orgId: c.orgId } });

    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${p.id}`).set(at(c)).send({ status: 'LEFT', dateOfLeaving: '2026-10-01' }).expect(200);
    for (const sn of [a, b]) {
      const cmds = (await peoplePrisma.deviceCommand.findMany({ where: { serialNumber: sn }, orderBy: { id: 'asc' } })).map((x) => x.command);
      expect(cmds).toEqual(['DATA DELETE FINGERTMP PIN=501', 'DATA DELETE FACE PIN=501', 'DATA DELETE USERINFO PIN=501']);
    }
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId, pin: '501' } })).toBe(0);
  });
});

describe('request limit', () => {
  it('slows a serial that floods the endpoint, without losing its data', async () => {
    process.env.DISABLE_RATE_LIMIT = 'false';
    try {
      const sn = serial();
      const { READER_LIMITS } = await import('../middleware/rateLimit.js');
      let busy = 0;
      for (let i = 0; i < READER_LIMITS.perSerial + 5; i++) {
        const r = await reader(sn).heartbeat();
        if (r.status === 503) busy += 1;
      }
      expect(busy).toBeGreaterThan(0);
      // Another reader is not affected.
      expect((await reader(serial()).heartbeat()).status).toBe(200);
    } finally {
      process.env.DISABLE_RATE_LIMIT = 'true';
    }
  }, 120_000);
});

describe('transactions and reader logs', () => {
  it('lists punches as the readers sent them, matched or not, and keeps the readers’ operation and error logs', async () => {
    const c = await makeOwner();
    const sn = serial();
    const { device } = await addReader(c, sn);
    const p = await person(c, { name: 'Tx Person', code: '601' });
    await reader(sn).push(['601\t2026-09-10 09:01:00\t0\t15', '777\t2026-09-10 09:02:00\t0\t1', '601\t2026-09-10 18:00:00\t1\t1']).expect(200);
    await reader(sn).push(['OPLOG 6\t1\t2026-09-10 08:00:00\t104\t0\t0\t0', 'FP PIN=1\tFID=0\tTMP=short'], 'OPERLOG').expect(200);
    await reader(sn).push(['OP_ERR_LOG 3\t0\t2026-09-10 08:05:00\tdisk'], 'ERRORLOG').expect(200);

    const all = (await api(c).get('/transactions?from=2026-09-10&to=2026-09-10').expect(200)).body;
    expect(all.total).toBe(3);
    expect(all.transactions[0]).toMatchObject({ localTime: '2026-09-10 18:00:00', kind: 'OUT', employeeName: 'Tx Person', deviceName: device.name });
    expect(all.transactions.find((t: any) => t.pin === '601' && t.localTime.endsWith('09:01:00')).verify).toBe('Face');
    expect((await api(c).get(`/transactions?from=2026-09-10&to=2026-09-10&employeeId=${p.id}`).expect(200)).body.total).toBe(2);
    expect((await api(c).get('/transactions?from=2026-09-10&to=2026-09-10&unmatched=true').expect(200)).body.transactions.map((t: any) => t.pin)).toEqual(['777']);

    const ops = (await api(c).get('/device-logs?from=2026-09-10&to=2026-09-10').expect(200)).body.logs;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'OPERATION', code: '6', operator: '1', localTime: '2026-09-10 08:00:00', deviceName: device.name });
    const errs = (await api(c).get('/device-logs?kind=ERROR&from=2026-09-10&to=2026-09-10').expect(200)).body.logs;
    expect(errs[0]).toMatchObject({ code: '3', details: 'disk' });
  });
});

describe('e-Time Office (vendor cloud, pulled)', () => {

  it('formats dates and reads punch times the way the API uses them', async () => {
    const { etoDate, etoPunchTime, etoAuthHeader } = await import('../services/attendance/etimeoffice.js');
    expect(etoDate(new Date('2026-10-14T03:35:00Z'))).toBe('14/10/2026_09:05');
    expect(etoPunchTime('14/10/2026 09:05:12')).toBe('2026-10-14 09:05:12');
    expect(etoPunchTime('nonsense')).toBeNull();
    expect(Buffer.from(etoAuthHeader({ username: 'u', password: 'p' }).slice(6), 'base64').toString()).toBe('u:p');
    expect(Buffer.from(etoAuthHeader({ corporateId: 'acme', username: 'u', password: 'p' }).slice(6), 'base64').toString()).toBe('acme:u:p:true');
  });

  it('connects, pulls punches into days, keeps the password out of every answer, and records failures', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Cloud Punch', code: '701' });
    const calls: string[] = [];
    let reply: any = { Error: false, Msg: 'Success', PunchData: [] };
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push(`${url} ${init?.headers?.Authorization}`);
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    try {
      const test = (await api(c).post('/devices/test-etimeoffice', { corporateId: 'acme', username: 'api', password: 's3cret' }).expect(200)).body;
      expect(test).toMatchObject({ ok: true, punchesToday: 0 });
      expect(calls[0]).toContain('DownloadPunchData?Empcode=ALL&FromDate=');

      const { device } = (await api(c).post('/devices', { vendor: 'ETIMEOFFICE', name: 'eSSL cloud', corporateId: 'acme', username: 'api', password: 's3cret' }).expect(201)).body;
      expect(device).toMatchObject({ vendor: 'ETIMEOFFICE', serialNumber: 'ETO-acme', hasSecret: true });
      expect(JSON.stringify(device)).not.toContain('s3cret');
      expect(device.apiSecret).toBeUndefined();

      /* A recent weekday (backfill goes back at most 31 days). */
      const d = new Date(Date.now() + 330 * 60_000 - 3 * 86_400_000);
      if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
      const iso = d.toISOString().slice(0, 10);
      const dmy = `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
      reply = { Error: false, Msg: 'Success', PunchData: [
        { Empcode: '701', Name: 'Cloud Punch', PunchDate: `${dmy} 18:10:00` },
        { Empcode: '701', Name: 'Cloud Punch', PunchDate: `${dmy} 09:20:00` },
      ] };
      const sync = (await api(c).post(`/devices/${device.id}/sync`, { from: iso }).expect(200)).body;
      expect(sync).toMatchObject({ ok: true, received: 2, added: 2 });
      expect(await day(c, p.id, iso)).toMatchObject({ source: 'DEVICE', checkInTime: '09:20', checkOutTime: '18:10', lateMinutes: 20 });
      // Pulled again: nothing doubles.
      expect((await api(c).post(`/devices/${device.id}/sync`, { from: iso }).expect(200)).body.added).toBe(0);
      await api(c).post(`/devices/${device.id}/sync`, { from: '2026-01-01' }).expect(400);

      const list = (await api(c).get('/devices').expect(200)).body.devices;
      expect(JSON.stringify(list)).not.toContain('s3cret');
      expect(JSON.stringify(list)).not.toContain('apiSecret');

      reply = { Error: true, Msg: 'Invalid credentials' };
      expect((await api(c).post(`/devices/${device.id}/sync`, {}).expect(502)).body.error).toBe('Invalid credentials');
      expect((await api(c).get('/devices').expect(200)).body.devices[0].lastError).toBe('Invalid credentials');

      // Its "serial" is not a reader: /iclock ignores it, and commands are refused.
      await reader('ETO-acme').push(['701\t2026-09-12 09:00:00\t0\t1']).expect(200);
      expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, localTime: { startsWith: '2026-09-12' } } })).toBe(0);
      await api(c).post(`/devices/${device.id}/commands`, { action: 'REBOOT' }).expect(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('readers after someone leaves or is deleted', () => {
  /** Hand out the reader's queue, answering each command, and return what it was sent. */
  const drain = async (sn: string) => {
    const sent: string[] = [];
    for (let i = 0; i < 60; i++) {
      const t = (await reader(sn).heartbeat().expect(200)).text;
      if (t === 'OK') break;
      sent.push(t.split(':').slice(2).join(':'));
      await reader(sn).result(`ID=${t.split(':')[1]}&Return=0&CMD=DATA`).expect(200);
    }
    return sent;
  };

  it('does not put a leaver’s fingerprint back after taking them off', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    const p = await person(c, { name: 'Leaver', code: '601' });
    await reader(a).push([`FP PIN=601\tFID=1\tSize=1200\tValid=1\tTMP=${tmpl('finger-601')}`], 'FINGERTMP').expect(200);
    // The copy to B is still waiting when they leave.
    expect(await peoplePrisma.deviceCommand.count({ where: { serialNumber: b, status: 'PENDING', command: { startsWith: 'DATA UPDATE FINGERTMP PIN=601\t' } } })).toBe(1);
    await request(app).put(`/api/orgs/${c.orgId}/people/employees/${p.id}`).set(at(c)).send({ status: 'LEFT', dateOfLeaving: '2026-10-01' }).expect(200);

    const toB = (await drain(b)).filter((x) => /PIN=601\b/.test(x));
    expect(toB.some((x) => x.startsWith('DATA DELETE USERINFO PIN=601'))).toBe(true);
    expect(toB.filter((x) => x.startsWith('DATA UPDATE'))).toEqual([]);
  });

  it('takes someone deleted in Payroll off the readers, so a reader read does not bring them back', async () => {
    const c = await makeOwner({ people: true, attendance: true, payroll: true });
    const a = serial();
    await addReader(c, a);
    const p = await person(c, { name: 'Gone', code: '701' });
    await reader(a).push(['USER PIN=701\tName=Gone\tPri=0'], 'OPERLOG').expect(200);
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: a } });

    await request(app).delete(`/api/orgs/${c.orgId}/payroll/employees/${p.id}`).set(at(c)).expect(200);
    expect(await peoplePrisma.deviceCommand.count({ where: { serialNumber: a, command: 'DATA DELETE USERINFO PIN=701' } })).toBe(1);
    // CLOR no longer believes the reader holds them, so its next read of the reader is all it goes on.
    expect(await peoplePrisma.deviceUser.count({ where: { orgId: c.orgId, pin: '701' } })).toBe(0);
  });

  it('takes someone marked as left in Payroll off the readers', async () => {
    const c = await makeOwner({ people: true, attendance: true, payroll: true });
    const a = serial();
    await addReader(c, a);
    const p = await person(c, { name: 'Leaving', code: '702' });
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: a } });
    await request(app)
      .put(`/api/orgs/${c.orgId}/payroll/employees/${p.id}`)
      .set(at(c))
      .send({ name: 'Leaving', code: '702', status: 'LEFT', dateOfJoining: '2026-01-01', dateOfLeaving: '2026-10-01' })
      .expect(200);
    expect(await peoplePrisma.deviceCommand.count({ where: { serialNumber: a, command: 'DATA DELETE USERINFO PIN=702' } })).toBe(1);
  });
});

describe('the day a punch belongs to', () => {
  const sched = (c: Ctx) => ({ post: (p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any) });

  it('puts the end of a night shift on the night, even when the next day is a day shift', async () => {
    const c = await makeOwner();
    const sn = serial();
    await addReader(c, sn);
    const p = await person(c, { name: 'Nights', code: '801' });
    const night = (await sched(c).post('/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 0 }).expect(201)).body.shift;
    // Nights on the 14th only; the default 09:00–18:00 from the 15th.
    await sched(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: night.id, fromDate: '2026-10-14', toDate: '2026-10-14', reason: 'Cover' }).expect(201);
    await reader(sn)
      .push(['801\t2026-10-14 21:58:00\t0\t1', '801\t2026-10-15 06:03:00\t1\t1', '801\t2026-10-15 09:01:00\t0\t1', '801\t2026-10-15 18:00:00\t1\t1'])
      .expect(200);
    expect(await day(c, p.id, '2026-10-14')).toMatchObject({ checkInTime: '21:58', checkOutTime: '06:03' });
    expect(await day(c, p.id, '2026-10-15')).toMatchObject({ checkInTime: '09:01', checkOutTime: '18:00', overtimeMinutes: 0 });
  });
});

describe('holidays for one branch', () => {
  it('count as a holiday in the month summary, not an absence', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Branch staff', code: '901', branchId: c.branchId });
    await api(c).post('/holidays', { date: '2026-09-15', name: 'Branch day', branchId: c.branchId }).expect(201);
    const row = (await api(c).get('/summary?month=2026-09').expect(200)).body.rows.find((r: any) => r.employeeId === p.id);
    expect(row.holidays).toBe(1);
  });
});

describe('the network lock', () => {
  /** A reader (or someone pretending to be it) calling from a given internet address. */
  const from = (sn: string, ip: string) => ({
    heartbeat: () => request(app).get(`/iclock/getrequest?SN=${sn}`).set('X-Forwarded-For', ip),
    push: (lines: string[], table = 'ATTLOG') =>
      request(app).post(`/iclock/cdata?SN=${sn}&table=${table}&Stamp=9999`).set('X-Forwarded-For', ip).set('Content-Type', 'text/plain').send(lines.join('\n')),
    result: (body: string) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('X-Forwarded-For', ip).set('Content-Type', 'text/plain').send(body),
  });
  const devices = (c: Ctx, ip?: string) => {
    const r = request(app).get(`/api/orgs/${c.orgId}/attendance/devices`).set(at(c));
    return ip ? r.set('X-Forwarded-For', ip) : r;
  };

  it('gives someone who only knows the serial nothing, and takes nothing from them', async () => {
    const c = await makeOwner();
    const sn = serial();
    await addReader(c, sn);
    const p = await person(c, { name: 'Real Person', code: '311' });
    // The real reader, from the office (the network it was added from), is taken.
    expect((await reader(sn).push(['311\t2026-09-01 09:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
    const queued = await peoplePrisma.deviceCommand.count({ where: { serialNumber: sn, status: 'PENDING' } });
    expect(queued).toBeGreaterThan(0);

    const intruder = from(sn, '203.0.113.9');
    // Punches: refused, not acknowledged (a real reader would keep them).
    const r = await intruder.push(['311\t2026-09-01 10:00:00\t0\t1']);
    expect(r.status).toBe(503);
    expect(await peoplePrisma.devicePunch.count({ where: { serialNumber: sn } })).toBe(1);
    // Users and fingerprints: nothing stored, nothing spread.
    await intruder.push([`USER PIN=666\tName=Ghost\tPri=14\tPasswd=1111`, `FP PIN=311\tFID=2\tSize=1200\tValid=1\tTMP=${tmpl('fake')}`], 'OPERLOG').expect(503);
    expect(await peoplePrisma.deviceUser.count({ where: { orgId: c.orgId, pin: '666' } })).toBe(0);
    expect(await peoplePrisma.biometricTemplate.count({ where: { orgId: c.orgId, pin: '311', no: 2 } })).toBe(0);
    expect(await peoplePrisma.employee.count({ where: { orgId: c.orgId, code: '666' } })).toBe(0);
    // Commands (names, cards, templates): none handed out, none marked done.
    expect((await intruder.heartbeat().expect(200)).text).toBe('OK');
    const one = await peoplePrisma.deviceCommand.findFirst({ where: { serialNumber: sn, status: 'PENDING' } });
    await intruder.result(`ID=${one!.id}&Return=0&CMD=DATA`).expect(200);
    expect((await peoplePrisma.deviceCommand.findUnique({ where: { id: one!.id } }))!.status).toBe('PENDING');
    expect(await peoplePrisma.deviceCommand.count({ where: { serialNumber: sn, status: 'PENDING' } })).toBe(queued);
    // The company sees an address waiting, but only from that address can it be approved.
    const d = (await devices(c).expect(200)).body.devices[0];
    expect(d.awaitingNetwork).toBe('203.0.113.9');
    await request(app).post(`/api/orgs/${c.orgId}/attendance/devices/${d.id}/approve-network`).set(at(c)).expect(409);
    expect(p.id).toBeTruthy();
  });

  it('lets a company add a reader from home and approve it from the office', async () => {
    const c = await makeOwner();
    const sn = serial();
    const added = await addReader(c, sn); // from 127.0.0.1
    expect(added.device.networkVerified).toBe(false);
    const office = from(sn, '198.51.100.7');
    expect((await office.push(['1\t2026-09-01 09:00:00\t0\t1'])).status).toBe(503);

    // At the office, on its Wi-Fi.
    await request(app).post(`/api/orgs/${c.orgId}/attendance/devices/${added.device.id}/approve-network`).set(at(c)).set('X-Forwarded-For', '198.51.100.7').expect(200);
    expect((await office.push(['1\t2026-09-01 09:00:00\t0\t1']).expect(200)).text).toBe('OK: 1');
    // The office line's dynamic address moving within its block is fine; another city is not.
    expect((await from(sn, '198.51.100.42').push(['1\t2026-09-01 18:00:00\t1\t1']).expect(200)).text).toBe('OK: 1');
    expect((await from(sn, '192.0.2.10').push(['1\t2026-09-02 09:00:00\t0\t1'])).status).toBe(503);
    const d = (await devices(c).expect(200)).body.devices[0];
    expect(d.allowedNetworks).toEqual(['198.51.100.7', '198.51.100.42']);
  });

  it('does not let another company that claimed the serial first receive the reader', async () => {
    const sn = serial();
    const squatter = await makeOwner();
    await addReader(squatter, sn); // claimed from 127.0.0.1, far from the reader
    const real = from(sn, '198.51.100.70');
    expect((await real.push(['501\t2026-09-01 09:00:00\t0\t1'])).status).toBe(503);
    expect((await real.heartbeat().expect(200)).text).toBe('OK');
    expect(await peoplePrisma.devicePunch.count({ where: { serialNumber: sn } })).toBe(0);
    const d = (await devices(squatter).expect(200)).body.devices[0];
    await request(app).post(`/api/orgs/${squatter.orgId}/attendance/devices/${d.id}/approve-network`).set(at(squatter)).expect(409);
  });
});

describe('reading who is on a reader', () => {
  const reads = (sn: string) =>
    peoplePrisma.deviceCommand.findMany({ where: { serialNumber: sn, status: { in: ['PENDING', 'SENT'] }, command: { startsWith: 'DATA QUERY' } }, select: { command: true } }).then((r) => r.map((x) => x.command).filter((x) => !x.startsWith('DATA QUERY ATTLOG')).sort());
  const settle = async (sn: string, minutesAgo: number, command?: string) =>
    peoplePrisma.deviceCommand.updateMany({
      where: { serialNumber: sn, command: command ?? { startsWith: 'DATA QUERY' } },
      data: { status: 'DONE', createdAt: new Date(Date.now() - minutesAgo * 60_000) },
    });

  it('reads again soon after someone is enrolled at the reader, and hourly without fingerprints', async () => {
    const c = await makeOwner();
    const sn = serial();
    await addReader(c, sn);
    await reader(sn).heartbeat('Ver 8.0.4.3-20240116,6,6,980,10.0.0.5').expect(200);
    const first = await reads(sn);
    expect(first).toContain('DATA QUERY USERINFO');
    expect(first.length).toBeGreaterThan(1); // fingerprints and faces too, the first time
    await settle(sn, 5);

    // Same counts: nothing new to read.
    await reader(sn).heartbeat('Ver 8.0.4.3-20240116,6,6,980,10.0.0.5').expect(200);
    expect(await reads(sn)).toEqual([]);

    // One more user on the reader: read users and templates again.
    await reader(sn).heartbeat('Ver 8.0.4.3-20240116,7,7,981,10.0.0.5').expect(200);
    expect(await reads(sn)).toEqual(first);
    await settle(sn, 61);
    await settle(sn, 120, 'DATA QUERY FINGERTMP');

    // An hour on, no change: the user list only.
    await reader(sn).heartbeat('Ver 8.0.4.3-20240116,7,7,990,10.0.0.5').expect(200);
    expect(await reads(sn)).toEqual(['DATA QUERY USERINFO']);
  });
});
