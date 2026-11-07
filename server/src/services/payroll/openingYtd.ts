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
 * A company that only began paying salaries this year has nothing to bring
 * in; the owner says so once for the year (PayrollSetting.firstPayrollYear).
 */

export type Opening = { grossPay: number; taxablePay: number; tds: number; professionalTax: number; employeePf: number; throughMonth: string | null; note: string | null };

export const OPENING_FIELDS = ['grossPay', 'taxablePay', 'tds', 'professionalTax', 'employeePf'] as const;

export class OpeningError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const num = (v: unknown) => round2(Number(v) || 0);

export const shapeOpening = (row: any): Opening | null =>
  row
    ? {
        grossPay: num(row.grossPay),
        taxablePay: num(row.taxablePay),
        tds: num(row.tds),
        professionalTax: num(row.professionalTax),
        employeePf: num(row.employeePf),
        throughMonth: row.throughMonth || null,
        note: row.note || null,
      }
    : null;

/** Each person's opening figures for a financial year ("2026-27"). */
export async function openingFor(orgId: string, financialYear: string, employeeIds: string[]) {
  const out = new Map<string, Opening>();
  if (!employeeIds.length) return out;
  const rows = await payrollPrisma.payrollOpeningYtd.findMany({ where: { orgId, financialYear, employeeId: { in: employeeIds } } });
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

/**
 * Checks one set of figures. Plain words for whoever typed them: tax cannot
 * exceed the pay it came out of, taxable pay cannot exceed gross.
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
  /* Left blank, taxable pay is the gross: most salary is taxable, and a blank must not read as "none of it was". */
  const blankTaxable = input.taxablePay === '' || input.taxablePay === null || input.taxablePay === undefined;
  if (blankTaxable) out.taxablePay = out.grossPay;
  if (out.taxablePay > out.grossPay) throw new OpeningError(400, 'TAXABLE_OVER_GROSS', 'Taxable pay cannot be more than the gross pay it is part of.');
  if (out.tds > out.grossPay) throw new OpeningError(400, 'TDS_OVER_GROSS', 'Income tax deducted cannot be more than the gross pay it came out of.');
  const through = String(input.throughMonth || '').trim();
  if (through) {
    const start = Number(financialYear.slice(0, 4));
    const ok = /^\d{4}-\d{2}$/.test(through) && through >= `${start}-04` && through <= `${start + 1}-03`;
    if (!ok) throw new OpeningError(400, 'BAD_MONTH', `The month the figures run to must be inside ${financialYear}, such as ${start}-09.`);
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
};

/**
 * A CSV of opening figures: a header row, then one row per person. The person
 * is found by employee code. Columns, in any order and case:
 * code, gross, taxable, tds, pt, pf, through (optional), note (optional).
 * Every row is checked before any is saved; one bad row saves nothing.
 */
export function parseOpeningCsv(text: string) {
  const lines = String(text || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new OpeningError(400, 'EMPTY_CSV', 'The file has no rows under its header.');
  if (lines.length > 2001) throw new OpeningError(400, 'TOO_MANY_ROWS', 'Up to 2,000 people at a time.');
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const ALIASES: Record<string, string> = {
    code: 'code', 'employee code': 'code', employee: 'code',
    gross: 'grossPay', 'gross pay': 'grossPay',
    taxable: 'taxablePay', 'taxable pay': 'taxablePay',
    tds: 'tds', 'income tax': 'tds',
    pt: 'professionalTax', 'professional tax': 'professionalTax',
    pf: 'employeePf', 'employee pf': 'employeePf',
    through: 'throughMonth', 'through month': 'throughMonth',
    note: 'note',
  };
  const header = cells(lines[0]).map((h) => ALIASES[h.toLowerCase()] || '');
  if (!header.includes('code')) throw new OpeningError(400, 'NO_CODE_COLUMN', 'The header needs a "code" column with each person’s employee code.');
  if (!header.includes('grossPay')) throw new OpeningError(400, 'NO_GROSS_COLUMN', 'The header needs a "gross" column.');
  return lines.slice(1).map((line, i) => {
    const row: Record<string, string> = {};
    cells(line).forEach((v, j) => {
      if (header[j]) row[header[j]] = v;
    });
    return { line: i + 2, ...row };
  });
}
