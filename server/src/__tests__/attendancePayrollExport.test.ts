import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { inflateRawSync } from 'node:zlib';

/**
 * Payroll export for a company that pays salaries outside CLOR (platform
 * audit, 11 Nov 2026): a closed month as one row per employee, in CLOR's own
 * layout and in the import layouts of greytHR, Keka and Tally. The figures
 * are the closed month's snapshot, the ones CLOR Payroll would take.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { crc32, xlsxBuffer, cellRef } = await import('../services/xlsx.js');
const { PAYROLL_EXPORT_LAYOUTS, payrollExportCsv, payrollExportFile, payrollExportRows, payrollExportTable, payrollExportLayout, tallyAttendanceXml } = await import('../services/attendance/payrollExport.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

/** The files inside a zip, read back by its central directory: what Excel does to open a workbook. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(local + 26);
    const localExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + localNameLen + localExtra;
    const data = inflateRawSync(buf.subarray(start, start + packed));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString('utf8');
    at += 46 + nameLen;
  }
  return out;
}

/* Two people as a closed month keeps them (days.ts › periodRows). */
const SNAPSHOT = [
  { employeeId: 'e2', code: '0102', name: 'Bala & Sons <Ravi>', department: 'Stores', totalDays: 30, payableDays: 27.5, lossOfPayDays: 2.5, present: 20, halfDays: 1, absent: 1, leave: 3, unpaidLeaveDays: 1, holidays: 1, weeklyOffs: 4, incompleteDays: 0, lateCount: 4, approvedOvertimeMinutes: 150 },
  { employeeId: 'e1', code: '0007', name: '=Asha Rao', department: null, totalDays: 16, payableDays: 16, lossOfPayDays: 0, present: 12, halfDays: 0, absent: 0, leave: 0, unpaidLeaveDays: 0, holidays: 1, weeklyOffs: 3, incompleteDays: 0, lateCount: 0, approvedOvertimeMinutes: 0 },
];

describe('the rows', () => {
  const rows = payrollExportRows('2026-09', SNAPSHOT);

  it('are one per employee, by employee code, with the snapshot’s own figures', () => {
    expect(rows.map((r) => r.code)).toEqual(['0007', '0102']);
    expect(rows[1]).toMatchObject({
      name: 'Bala & Sons <Ravi>', department: 'Stores', month: '2026-09', daysInMonth: 30, daysEmployed: 30,
      payableDays: 27.5, lossOfPayDays: 2.5, paidLeaveDays: 2, unpaidLeaveDays: 1, weeklyOffs: 4, holidays: 1,
      presentDays: 20, halfDays: 1, absentDays: 1, overtimeHours: 2.5, lateMarks: 4, periodStart: '01-09-2026', periodEnd: '30-09-2026',
    });
  });

  it('keep the days employed apart from the days in the month for someone who joined in it', () => {
    expect(rows[0]).toMatchObject({ daysInMonth: 30, daysEmployed: 16, payableDays: 16, lossOfPayDays: 0 });
  });
});

describe('the layouts', () => {
  const rows = payrollExportRows('2026-09', SNAPSHOT);
  const headers = (id: string) => payrollExportTable(payrollExportLayout(id)!, rows).headers;

  it('Generic carries every figure asked for', () => {
    expect(headers('generic')).toEqual([
      'Employee code', 'Employee name', 'Department', 'Month', 'Days in month', 'Days employed', 'Payable days', 'Loss of pay days', 'Paid leave days',
      'Unpaid leave days', 'Weekly offs', 'Holidays', 'Present days', 'Half days', 'Absent days', 'Days with no check-out', 'Overtime hours', 'Late marks',
    ]);
  });

  it('greytHR and Keka are keyed on the employee number, with loss of pay, paid days and overtime', () => {
    expect(headers('greythr')).toEqual(['Employee No', 'Name', 'LOP Days', 'Paid Days', 'OT Hours']);
    expect(headers('keka')).toEqual(['Employee Number', 'Employee Name', 'Total Days', 'Loss Of Pay Days', 'Payable Days', 'Overtime Hours']);
    expect(payrollExportTable(payrollExportLayout('greythr')!, rows).rows[1]).toEqual(['0102', 'Bala & Sons <Ravi>', 2.5, 27.5, 2.5]);
  });

  it('Tally is an attendance voucher: a line per employee and type, none for nought', () => {
    const t = payrollExportTable(payrollExportLayout('tally')!, rows);
    expect(t.headers).toEqual(['Voucher Date', 'Voucher Type Name', 'Employee Name', 'Attendance/Production Type', 'Value', 'Unit']);
    expect(t.rows).toEqual([
      ['30-09-2026', 'Attendance', '=Asha Rao', 'Present', 16, 'Days'],
      ['30-09-2026', 'Attendance', 'Bala & Sons <Ravi>', 'Present', 27.5, 'Days'],
      ['30-09-2026', 'Attendance', 'Bala & Sons <Ravi>', 'Absent', 2.5, 'Days'],
      ['30-09-2026', 'Attendance', 'Bala & Sons <Ravi>', 'Overtime', 2.5, 'Hrs'],
    ]);
  });

  it('Tally’s own file is one Attendance voucher dated the month’s last day, with names escaped', () => {
    const xml = tallyAttendanceXml(payrollExportLayout('tally')!, rows, '2026-09');
    expect(xml).toContain('<VOUCHER VCHTYPE="Attendance" ACTION="Create">');
    expect(xml).toContain('<DATE>20260930</DATE>');
    expect(xml.match(/<ATTENDANCEENTRIES\.LIST>/g)).toHaveLength(4);
    expect(xml).toContain('<NAME>Bala &amp; Sons &lt;Ravi&gt;</NAME>');
    expect(xml).toContain('<ATTDTYPEVALUE>27.5 Days</ATTDTYPEVALUE>');
    expect(xml).toContain('<ATTDTYPEVALUE>2.5 Hrs</ATTDTYPEVALUE>');
  });

  it('every layout names its formats, and only Tally has a file of its own kind', () => {
    for (const l of PAYROLL_EXPORT_LAYOUTS) expect(l.formats.length).toBeGreaterThan(0);
    expect(PAYROLL_EXPORT_LAYOUTS.filter((l) => l.formats.includes('xml')).map((l) => l.id)).toEqual(['tally']);
    expect(() => payrollExportFile({ month: '2026-09', layoutId: 'keka', format: 'xml', snapshotRows: SNAPSHOT })).toThrow();
    expect(() => payrollExportFile({ month: '2026-09', layoutId: 'zoho', format: 'csv', snapshotRows: SNAPSHOT })).toThrow();
  });
});

describe('the files', () => {
  const rows = payrollExportRows('2026-09', SNAPSHOT);

  it('CSV keeps leading zeros, quotes what needs it and never lets a name run as a formula', () => {
    const csv = payrollExportCsv(payrollExportTable(payrollExportLayout('greythr')!, rows));
    expect(csv.split('\r\n')).toEqual(['Employee No,Name,LOP Days,Paid Days,OT Hours', "0007,'=Asha Rao,0,16,0", '0102,Bala & Sons <Ravi>,2.5,27.5,2.5']);
    expect(payrollExportCsv({ headers: ['A'], rows: [['He said "hi", twice']] })).toBe('A\r\n"He said ""hi"", twice"');
  });

  it('Excel is a real workbook: text stays text, numbers stay numbers', () => {
    const file = payrollExportFile({ month: '2026-09', layoutId: 'generic', format: 'xlsx', snapshotRows: SNAPSHOT });
    expect(file.fileName).toBe('CLOR attendance 2026-09 Generic.xlsx');
    expect(file.body.subarray(0, 2).toString()).toBe('PK');
    const parts = unzip(file.body);
    expect(Object.keys(parts).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = parts['xl/worksheets/sheet1.xml'];
    /* The code keeps its zeros as text; payable days is a number. */
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">0102</t></is></c>');
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">Bala &amp; Sons &lt;Ravi&gt;</t></is></c>');
    expect(sheet).toContain('<c r="G3"><v>27.5</v></c>');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Employee code</t></is></c>');
    expect(parts['xl/workbook.xml']).toContain('name="Generic 2026-09"');
  });

  it('the workbook writer handles wide sheets and empty cells', () => {
    expect([cellRef(0, 0), cellRef(25, 0), cellRef(26, 4), cellRef(701, 0), cellRef(702, 0)]).toEqual(['A1', 'Z1', 'AA5', 'ZZ1', 'AAA1']);
    const parts = unzip(xlsxBuffer({ sheet: 'A/B: [x]', headers: ['One', 'Two'], rows: [[null, 3], ['', undefined]] }));
    expect(parts['xl/worksheets/sheet1.xml']).toContain('<row r="2"><c r="B2"><v>3</v></c></row><row r="3"></row>');
    expect(parts['xl/workbook.xml']).toContain('name="A B   x"');
  });
});

/* The route, on a real closed month. */
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function makeOwner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `payexp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Pay Export Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

describe('the export of a month', () => {
  it('is refused until the month is closed, then gives the snapshot in every layout', async () => {
    const c = await makeOwner({ people: true, attendance: true });
    const p = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Meena Iyer', code: '0042', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);

    const layouts = await att(c).get('/payroll-export/layouts').expect(200);
    expect(layouts.body.layouts.map((l: any) => l.id)).toEqual(['generic', 'greythr', 'keka', 'tally']);

    const early = await att(c).get('/months/2026-09/payroll-export?layout=generic&format=csv').expect(409);
    expect(early.body.code).toBe('MONTH_NOT_CLOSED');

    const refused = await att(c).post('/months/2026-09/close').expect(409);
    const { noRecordDays, noRecordToken } = refused.body.readiness;
    await att(c).post('/months/2026-09/close', { acknowledge: true, confirmNoRecordDays: noRecordDays, confirmNoRecordToken: noRecordToken }).expect(200);
    const snap = (await att(c).get('/months/2026-09/snapshots/1').expect(200)).body.rows.find((r: any) => r.employeeId === p.id);

    const csv = await att(c).get('/months/2026-09/payroll-export?layout=generic&format=csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="CLOR attendance 2026-09 Generic.csv"');
    expect(csv.headers['x-clor-snapshot']).toBe('1');
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    const head = lines[0].split(',');
    const row = lines.find((l) => l.startsWith('0042,'))!.split(',');
    const cell = (h: string) => row[head.indexOf(h)];
    expect(cell('Employee name')).toBe('Meena Iyer');
    expect(cell('Days in month')).toBe('30');
    /* The very figures the snapshot holds: nothing is worked out a second time. */
    expect(Number(cell('Payable days'))).toBe(snap.payableDays);
    expect(Number(cell('Loss of pay days'))).toBe(snap.lossOfPayDays);
    expect(Number(cell('Payable days')) + Number(cell('Loss of pay days'))).toBe(30);
    expect(Number(cell('Present days'))).toBe(1);

    const xlsx = await att(c).get('/months/2026-09/payroll-export?layout=keka').buffer(true).parse(binary).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(unzip(xlsx.body as Buffer)['xl/worksheets/sheet1.xml']).toContain('>0042<');

    const grey = await att(c).get('/months/2026-09/payroll-export?layout=greythr&format=csv').expect(200);
    expect(grey.text.replace(/^﻿/, '').split('\r\n')[0]).toBe('Employee No,Name,LOP Days,Paid Days,OT Hours');

    const tally = await att(c).get('/months/2026-09/payroll-export?layout=tally&format=xml').buffer(true).parse(binary).expect(200);
    expect(tally.headers['content-type']).toContain('application/xml');
    expect((tally.body as Buffer).toString('utf8')).toContain('<NAME>Meena Iyer</NAME>');

    expect((await att(c).get('/months/2026-09/payroll-export?layout=zoho').expect(400)).body.code).toBe('NO_SUCH_LAYOUT');
    expect((await att(c).get('/months/2026-09/payroll-export?layout=keka&format=xml').expect(400)).body.code).toBe('NO_SUCH_FORMAT');
    await att(c).get('/months/2026-13/payroll-export').expect(400);

    /* Reopened: its days can change again, so the old snapshot is not handed out as the month. */
    await att(c).post('/months/2026-09/reopen', { reason: 'Correct a missed holiday' }).expect(200);
    expect((await att(c).get('/months/2026-09/payroll-export').expect(409)).body.code).toBe('MONTH_NOT_CLOSED');
  });

  it('is not for a company without Attendance, nor without a sign-in', async () => {
    /* People switches Attendance on with it, so this company has neither. */
    const c = await makeOwner({ attendance: false });
    const off = await att(c).get('/months/2026-09/payroll-export');
    expect([402, 403]).toContain(off.status);
    await request(app).get(`/api/orgs/${c.orgId}/attendance/months/2026-09/payroll-export`).expect(401);
  });
});
