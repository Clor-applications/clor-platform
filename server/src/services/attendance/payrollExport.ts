import { xlsxBuffer, type XlsxCell } from '../xlsx.js';
import { lastOfMonth } from './payableDays.js';

/**
 * A closed month for a payroll run outside CLOR (platform audit, 11 Nov 2026:
 * "payroll export for customers paying salaries elsewhere").
 *
 * One row per employee with the figures CLOR Payroll itself would take: the
 * rows of the month's latest snapshot, written when the month was closed
 * (readiness.ts › snapshotMonth). Nothing is worked out again here, so the
 * file and CLOR's own payable days cannot disagree.
 *
 * THE LAYOUTS ARE DATA. Each one below is a list of column headings and the
 * figure under each. The Generic layout is CLOR's own. The greytHR, Keka and
 * Tally layouts follow those products' import sheets as far as they are
 * publicly described; none was checked against a live account, and each of
 * them lets (or makes) the person importing map columns. If a heading is
 * wrong for a customer's version, correct the heading here: nothing else
 * depends on it.
 */

export type PayrollExportRow = {
  code: string;
  name: string;
  department: string;
  /** YYYY-MM. */
  month: string;
  /** Calendar days in the month. */
  daysInMonth: number;
  /** Days of the month the person was employed (all of it, unless they joined or left in it). */
  daysEmployed: number;
  payableDays: number;
  lossOfPayDays: number;
  /** Whole days of leave that are paid. Half days of leave are counted under half days. */
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  weeklyOffs: number;
  holidays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  /** Days with a check-in and no check-out: not paid until corrected, so they are inside loss of pay. */
  noCheckOutDays: number;
  /** Approved overtime only, in hours. */
  overtimeHours: number;
  lateMarks: number;
  /** Last day of the month, for a layout that wants a date: DD-MM-YYYY. */
  periodEnd: string;
  periodStart: string;
};

type Field = keyof PayrollExportRow;
type Column = { header: string; field: Field };
export type PayrollExportFormat = 'csv' | 'xlsx' | 'xml';

type WideLayout = { id: string; name: string; about: string; formats: PayrollExportFormat[]; columns: Column[] };
/** Tally keeps attendance as a voucher: one line per employee and attendance type, not one row per employee. */
type VoucherLayout = {
  id: string;
  name: string;
  about: string;
  formats: PayrollExportFormat[];
  voucherType: string;
  headers: { date: string; voucherType: string; employee: string; type: string; value: string; unit: string };
  /** Tally's own names for these are the company's (Payroll Info › Attendance/Production Types); these are its usual ones. */
  entries: Array<{ type: string; field: Field; unit: string }>;
};
export type PayrollExportLayout = WideLayout | VoucherLayout;

const isVoucher = (l: PayrollExportLayout): l is VoucherLayout => 'entries' in l;

export const PAYROLL_EXPORT_LAYOUTS: PayrollExportLayout[] = [
  {
    id: 'generic',
    name: 'Generic',
    about: 'Every figure for the month, one row per employee. For any payroll, or a spreadsheet of your own.',
    formats: ['xlsx', 'csv'],
    columns: [
      { header: 'Employee code', field: 'code' },
      { header: 'Employee name', field: 'name' },
      { header: 'Department', field: 'department' },
      { header: 'Month', field: 'month' },
      { header: 'Days in month', field: 'daysInMonth' },
      { header: 'Days employed', field: 'daysEmployed' },
      { header: 'Payable days', field: 'payableDays' },
      { header: 'Loss of pay days', field: 'lossOfPayDays' },
      { header: 'Paid leave days', field: 'paidLeaveDays' },
      { header: 'Unpaid leave days', field: 'unpaidLeaveDays' },
      { header: 'Weekly offs', field: 'weeklyOffs' },
      { header: 'Holidays', field: 'holidays' },
      { header: 'Present days', field: 'presentDays' },
      { header: 'Half days', field: 'halfDays' },
      { header: 'Absent days', field: 'absentDays' },
      { header: 'Days with no check-out', field: 'noCheckOutDays' },
      { header: 'Overtime hours', field: 'overtimeHours' },
      { header: 'Late marks', field: 'lateMarks' },
    ],
  },
  {
    /* greytHR: Payroll › Payroll Inputs › Loss of Pay (and Overtime) › Import from Excel. Keyed on Employee No. */
    id: 'greythr',
    name: 'greytHR',
    about: 'For greytHR’s Excel import of loss of pay days and overtime. Employees are matched on Employee No.',
    formats: ['xlsx', 'csv'],
    columns: [
      { header: 'Employee No', field: 'code' },
      { header: 'Name', field: 'name' },
      { header: 'LOP Days', field: 'lossOfPayDays' },
      { header: 'Paid Days', field: 'payableDays' },
      { header: 'OT Hours', field: 'overtimeHours' },
    ],
  },
  {
    /* Keka: Payroll › Run payroll › Leave, attendance and daily wages › import loss of pay days. Keyed on Employee Number. */
    id: 'keka',
    name: 'Keka',
    about: 'For Keka’s loss of pay import in a payroll run. Employees are matched on Employee Number.',
    formats: ['xlsx', 'csv'],
    columns: [
      { header: 'Employee Number', field: 'code' },
      { header: 'Employee Name', field: 'name' },
      { header: 'Total Days', field: 'daysEmployed' },
      { header: 'Loss Of Pay Days', field: 'lossOfPayDays' },
      { header: 'Payable Days', field: 'payableDays' },
      { header: 'Overtime Hours', field: 'overtimeHours' },
    ],
  },
  {
    /* Tally: Payroll vouchers › Attendance. Employees are matched on the employee master's name. */
    id: 'tally',
    name: 'Tally',
    about: 'An attendance voucher for the month: a line per employee for present days, absent days and overtime hours. Employees are matched on name, and the attendance types must exist in Tally under the same names.',
    formats: ['xml', 'xlsx', 'csv'],
    voucherType: 'Attendance',
    headers: { date: 'Voucher Date', voucherType: 'Voucher Type Name', employee: 'Employee Name', type: 'Attendance/Production Type', value: 'Value', unit: 'Unit' },
    entries: [
      { type: 'Present', field: 'payableDays', unit: 'Days' },
      { type: 'Absent', field: 'lossOfPayDays', unit: 'Days' },
      { type: 'Overtime', field: 'overtimeHours', unit: 'Hrs' },
    ],
  },
];

export const payrollExportLayout = (id: string) => PAYROLL_EXPORT_LAYOUTS.find((l) => l.id === id) || null;

/** What the screen lists: each layout, what it is for and the files it comes as. */
export const payrollExportChoices = () => PAYROLL_EXPORT_LAYOUTS.map((l) => ({ id: l.id, name: l.name, about: l.about, formats: l.formats }));

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/**
 * The month's rows from a snapshot's rows (days.ts › periodRows, frozen at
 * close). Sorted by employee code, then name, so the file reads the same
 * every time it is taken.
 */
export function payrollExportRows(month: string, snapshotRows: any[]): PayrollExportRow[] {
  const end = lastOfMonth(month);
  const daysInMonth = Number(end.slice(8, 10));
  return (snapshotRows || [])
    .map((r) => {
      const unpaid = r2(r.unpaidLeaveDays);
      return {
        code: String(r.code ?? ''),
        name: String(r.name ?? ''),
        department: String(r.department ?? ''),
        month,
        daysInMonth,
        daysEmployed: r2(r.totalDays),
        payableDays: r2(r.payableDays),
        lossOfPayDays: r2(r.lossOfPayDays),
        /* `leave` counts whole days on leave, paid or not; the unpaid ones come off. */
        paidLeaveDays: r2(Math.max(0, (Number(r.leave) || 0) - Math.floor(unpaid))),
        unpaidLeaveDays: unpaid,
        weeklyOffs: r2(r.weeklyOffs),
        holidays: r2(r.holidays),
        presentDays: r2(r.present),
        halfDays: r2(r.halfDays),
        absentDays: r2(r.absent),
        noCheckOutDays: r2(r.incompleteDays),
        overtimeHours: r2((Number(r.approvedOvertimeMinutes) || 0) / 60),
        lateMarks: r2(r.lateCount),
        periodStart: dmy(`${month}-01`),
        periodEnd: dmy(end),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.name.localeCompare(b.name));
}

/** The header row and the cells under it for a layout, numbers as numbers. */
export function payrollExportTable(layout: PayrollExportLayout, rows: PayrollExportRow[]): { headers: string[]; rows: XlsxCell[][] } {
  if (!isVoucher(layout)) {
    return { headers: layout.columns.map((c) => c.header), rows: rows.map((r) => layout.columns.map((c) => r[c.field])) };
  }
  const h = layout.headers;
  const lines: XlsxCell[][] = [];
  for (const r of rows) {
    for (const e of layout.entries) {
      const value = Number(r[e.field]) || 0;
      /* Tally has no use for a line of nought. */
      if (value > 0) lines.push([r.periodEnd, layout.voucherType, r.name, e.type, value, e.unit]);
    }
  }
  return { headers: [h.date, h.voucherType, h.employee, h.type, h.value, h.unit], rows: lines };
}

/* A spreadsheet runs a cell that starts with = + - or @ as a formula; a name that does is written as text. */
const csvCell = (v: XlsxCell) => {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const payrollExportCsv = (table: { headers: string[]; rows: XlsxCell[][] }) =>
  [table.headers.map(csvCell).join(','), ...table.rows.map((r) => r.map(csvCell).join(','))].join('\r\n');

const xmlText = (s: unknown) =>
  String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Tally's own import file: one Attendance voucher dated the last day of the
 * month, with a line per employee and attendance type (Gateway of Tally ›
 * Import › Vouchers). `company` must be the company's name as Tally has it;
 * left out, Tally imports into the company that is open.
 */
export function tallyAttendanceXml(layout: PayrollExportLayout, rows: PayrollExportRow[], month: string, company = ''): string {
  if (!isVoucher(layout)) throw new Error('Not a voucher layout.');
  const date = lastOfMonth(month).replace(/-/g, '');
  const entries = rows
    .flatMap((r) => layout.entries.map((e) => ({ name: r.name, type: e.type, unit: e.unit, value: Number(r[e.field]) || 0 })))
    .filter((e) => e.value > 0)
    .map(
      (e) =>
        `      <ATTENDANCEENTRIES.LIST>\n       <NAME>${xmlText(e.name)}</NAME>\n       <ATTENDANCETYPE>${xmlText(e.type)}</ATTENDANCETYPE>\n       <ATTDTYPETIMEVALUE>${e.value} ${xmlText(e.unit)}</ATTDTYPETIMEVALUE>\n       <ATTDTYPEVALUE>${e.value} ${xmlText(e.unit)}</ATTDTYPEVALUE>\n      </ATTENDANCEENTRIES.LIST>`,
    );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    ' <HEADER>',
    '  <TALLYREQUEST>Import Data</TALLYREQUEST>',
    ' </HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    '   <REQUESTDESC>',
    '    <REPORTNAME>Vouchers</REPORTNAME>',
    ...(company ? ['    <STATICVARIABLES>', `     <SVCURRENTCOMPANY>${xmlText(company)}</SVCURRENTCOMPANY>`, '    </STATICVARIABLES>'] : []),
    '   </REQUESTDESC>',
    '   <REQUESTDATA>',
    '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `     <VOUCHER VCHTYPE="${xmlText(layout.voucherType)}" ACTION="Create">`,
    `      <DATE>${date}</DATE>`,
    `      <VOUCHERTYPENAME>${xmlText(layout.voucherType)}</VOUCHERTYPENAME>`,
    `      <NARRATION>Attendance for ${month}, from CLOR</NARRATION>`,
    ...entries,
    '     </VOUCHER>',
    '    </TALLYMESSAGE>',
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n');
}

const CONTENT_TYPE: Record<PayrollExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml; charset=utf-8',
};

/** The finished file: its name, its type and its bytes. */
export function payrollExportFile(input: { month: string; layoutId: string; format: PayrollExportFormat; snapshotRows: any[] }) {
  const layout = payrollExportLayout(input.layoutId);
  if (!layout) throw Object.assign(new Error('No such layout.'), { status: 400 });
  if (!layout.formats.includes(input.format)) throw Object.assign(new Error(`${layout.name} comes as ${layout.formats.join(', ')}.`), { status: 400 });
  const rows = payrollExportRows(input.month, input.snapshotRows);
  const fileName = `CLOR attendance ${input.month} ${layout.name}.${input.format}`;
  const contentType = CONTENT_TYPE[input.format];
  if (input.format === 'xml') return { fileName, contentType, body: Buffer.from(tallyAttendanceXml(layout, rows, input.month), 'utf8'), people: rows.length };
  const table = payrollExportTable(layout, rows);
  /* The byte-order mark makes Excel read the CSV as UTF-8, so names in Indian scripts survive. */
  if (input.format === 'csv') return { fileName, contentType, body: Buffer.from(`﻿${payrollExportCsv(table)}`, 'utf8'), people: rows.length };
  return { fileName, contentType, body: xlsxBuffer({ sheet: `${layout.name} ${input.month}`, headers: table.headers, rows: table.rows }), people: rows.length };
}
