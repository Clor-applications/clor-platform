import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';

/**
 * Opening year-to-date figures (audit 7 Nov 2026, #2).
 *
 * A company that starts its payroll on CLOR in October has already paid its
 * people for April to September somewhere else. Income tax for the rest of the
 * year is the year's tax less what was deducted so far, spread over the months
 * left (statutory/engine.ts). Without those six months, CLOR projects the year
 * as six months of pay and deducts too little every month, and Form 16 shows
 * half a year. These rows are those months, one per person per financial year.
 *
 * Only this company's pay: a previous employer's goes in Form 12B on the
 * declaration (taxDeclaration.ts), and is added there.
 *
 * A company that only began paying salaries this year has nothing to bring
 * in; the owner says so once for the year (PayrollSetting.firstPayrollYear).
 */

export type Opening = {
  grossPay: number;
  taxablePay: number;
  tds: number;
  professionalTax: number;
  employeePf: number;
  /** Basic and DA: HRA exemption and the employer NPS limit (review of #146, 4). */
  basicDa: number;
  hraReceived: number;
  /** Inside taxable pay, as on a payslip (taxablePay.ts); deducted again under 80CCD(2). */
  employerNps: number;
  throughMonth: string | null;
  note: string | null;
};

export const OPENING_FIELDS = ['grossPay', 'taxablePay', 'tds', 'professionalTax', 'employeePf', 'basicDa', 'hraReceived', 'employerNps'] as const;

export class OpeningError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const num = (v: unknown) => round2(Number(v) || 0);

/** A removed row (deletedAt) reads as none. */
export const shapeOpening = (row: any): Opening | null =>
  row && !row.deletedAt
    ? {
        grossPay: num(row.grossPay),
        taxablePay: num(row.taxablePay),
        tds: num(row.tds),
        professionalTax: num(row.professionalTax),
        employeePf: num(row.employeePf),
        basicDa: num(row.basicDa),
        hraReceived: num(row.hraReceived),
        employerNps: num(row.employerNps),
        throughMonth: row.throughMonth || null,
        note: row.note || null,
      }
    : null;

/** Each person's opening figures for a financial year ("2026-27"). */
export async function openingFor(orgId: string, financialYear: string, employeeIds: string[]) {
  const out = new Map<string, Opening>();
  if (!employeeIds.length) return out;
  const rows = await payrollPrisma.payrollOpeningYtd.findMany({ where: { orgId, financialYear, employeeId: { in: employeeIds }, deletedAt: null } });
  for (const r of rows) out.set(r.employeeId, shapeOpening(r)!);
  return out;
}

/** The owner's "first year of paying salaries", if it is this financial year. */
export async function firstPayrollYearOf(orgId: string) {
  const row = await payrollPrisma.payrollSetting.findUnique({
    where: { orgId },
    select: { firstPayrollYear: true, firstPayrollYearReason: true, firstPayrollYearBy: true, firstPayrollYearAt: true },
  });
  return row?.firstPayrollYear
    ? { financialYear: row.firstPayrollYear, reason: row.firstPayrollYearReason || '', userId: row.firstPayrollYearBy || null, at: row.firstPayrollYearAt || null }
    : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The month the figures run to, however a spreadsheet wrote it back: "2026-09",
 * "Sep 2026", "September 2026", "Sep-26", "09/2026", "9/2026". A spreadsheet
 * turns a typed 2026-09 into a date and saves it as one of the others.
 */
export function parseThroughMonth(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/^'/, '');
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = /^([A-Za-z]{3,9})[\s\-/.,]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  return 'BAD';
}

/** "2026-09" as the template writes it: words, which a spreadsheet leaves alone more often than digits. */
export const throughWords = (ym: string | null | undefined) => (ym && /^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} ${ym.slice(0, 4)}` : '');

/**
 * Checks one set of figures. Plain words for whoever typed them: tax cannot
 * exceed the pay it came out of; taxable pay cannot exceed gross plus employer
 * NPS (which is taxable pay without being paid to the person).
 */
export function checkOpening(input: Record<string, unknown>, financialYear: string): Opening {
  const out: any = {};
  for (const f of OPENING_FIELDS) {
    const raw = input[f];
    const v = raw === '' || raw === null || raw === undefined ? 0 : Number(String(raw).replace(/[,₹\s]/g, ''));
    if (!Number.isFinite(v) || v < 0) throw new OpeningError(400, 'BAD_AMOUNT', `${LABEL[f]} must be an amount of zero or more.`);
    if (v > 1e9) throw new OpeningError(400, 'BAD_AMOUNT', `${LABEL[f]} is more than anyone is paid in a year.`);
    out[f] = round2(v);
  }
  /* Left blank, taxable pay is the gross (and employer NPS): most salary is taxable, and a blank must not read as "none of it was". */
  const blankTaxable = input.taxablePay === '' || input.taxablePay === null || input.taxablePay === undefined;
  if (blankTaxable) out.taxablePay = round2(out.grossPay + out.employerNps);
  if (out.taxablePay > round2(out.grossPay + out.employerNps)) {
    throw new OpeningError(400, 'TAXABLE_OVER_GROSS', out.employerNps ? 'Taxable pay cannot be more than the gross pay and employer NPS together.' : 'Taxable pay cannot be more than the gross pay it is part of (plus employer NPS, if any was paid).');
  }
  if (out.tds > out.grossPay) throw new OpeningError(400, 'TDS_OVER_GROSS', 'Income tax deducted cannot be more than the gross pay it came out of.');
  if (round2(out.basicDa + out.hraReceived) > out.grossPay) throw new OpeningError(400, 'PARTS_OVER_GROSS', 'Basic and DA, with HRA, cannot be more than the gross pay they are part of.');
  const through = parseThroughMonth(input.throughMonth);
  if (through) {
    const start = Number(financialYear.slice(0, 4));
    const ok = through !== 'BAD' && through >= `${start}-04` && through <= `${start + 1}-03`;
    if (!ok) throw new OpeningError(400, 'BAD_MONTH', `The month the figures run to must be inside ${financialYear}, such as Sep ${start} or ${start}-09.`);
  }
  out.throughMonth = through || null;
  out.note = String(input.note || '').trim().slice(0, 300) || null;
  return out;
}

const LABEL: Record<(typeof OPENING_FIELDS)[number], string> = {
  grossPay: 'Gross pay',
  taxablePay: 'Taxable pay',
  tds: 'Income tax deducted',
  professionalTax: 'Professional tax',
  employeePf: 'Employee PF',
  basicDa: 'Basic and DA',
  hraReceived: 'HRA received',
  employerNps: 'Employer NPS',
};

/** RFC 4180: commas, quotes ("" inside quotes) and line breaks inside quoted cells. */
export function csvRecords(text: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  const s = String(text || '').replace(/^﻿/, '');
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(cur.trim());
    if (row.some((c) => c !== '')) out.push({ cells: row, line: rowLine });
    row = [];
    cur = '';
  };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line += 1;
        cur += ch;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur.trim());
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else cur += ch;
  }
  if (cur !== '' || row.length) endRow();
  return out;
}

/**
 * A CSV of opening figures: a header row, then one row per person. The person
 * is found by employee code (any case). Columns, in any order and case:
 * code, gross, taxable, tds, pt, pf, basic, hra, nps, through (optional), note (optional).
 * Every row is checked before any is saved; one bad row saves nothing.
 */
export function parseOpeningCsv(text: string) {
  const records = csvRecords(text);
  if (records.length < 2) throw new OpeningError(400, 'EMPTY_CSV', 'The file has no rows under its header.');
  if (records.length > 2001) throw new OpeningError(400, 'TOO_MANY_ROWS', 'Up to 2,000 people at a time.');
  const ALIASES: Record<string, string> = {
    code: 'code', 'employee code': 'code', employee: 'code',
    gross: 'grossPay', 'gross pay': 'grossPay',
    taxable: 'taxablePay', 'taxable pay': 'taxablePay',
    tds: 'tds', 'income tax': 'tds',
    pt: 'professionalTax', 'professional tax': 'professionalTax',
    pf: 'employeePf', 'employee pf': 'employeePf',
    basic: 'basicDa', 'basic and da': 'basicDa', 'basic da': 'basicDa', 'basic+da': 'basicDa',
    hra: 'hraReceived', 'hra received': 'hraReceived',
    nps: 'employerNps', 'employer nps': 'employerNps',
    through: 'throughMonth', 'through month': 'throughMonth',
    note: 'note',
  };
  const header = records[0].cells.map((h) => ALIASES[h.toLowerCase().replace(/\s+/g, ' ')] || '');
  if (!header.includes('code')) throw new OpeningError(400, 'NO_CODE_COLUMN', 'The header needs a "code" column with each person’s employee code.');
  if (!header.includes('grossPay')) throw new OpeningError(400, 'NO_GROSS_COLUMN', 'The header needs a "gross" column.');
  return records.slice(1).map((r) => {
    const row: Record<string, string> = {};
    r.cells.forEach((v, j) => {
      if (header[j]) row[header[j]] = v;
    });
    return { line: r.line, ...row };
  });
}
