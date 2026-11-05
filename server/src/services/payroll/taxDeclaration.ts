import { z } from 'zod';

import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';

/**
 * Income tax declarations: what somebody says they will invest or spend this
 * financial year, and what HR later verifies from their proofs. Only the old
 * regime allows these deductions; under the new regime the declaration only
 * records the choice of regime.
 *
 * The limits below are the ones in force for FY 2025-26 and 2026-27 as this
 * was written. They are kept in one place so a Budget change is one edit, and
 * every figure on a payslip explains which limit bound it.
 *
 * Until HR verifies a declaration, tax is withheld on what was declared; once
 * verified, on what was proved. That is the usual practice: declare in April,
 * prove in January, and the last months' TDS absorbs the difference.
 */

export type DeclarationItem = { code: string; declared: number; verified?: number | null; note?: string | null };

export const SECTIONS = [
  { code: '80C', label: 'Section 80C', hint: 'PPF, ELSS, life insurance premium, tuition fees, home loan principal, NSC, 5-year FD. Your PF from salary is counted for you.', cap: 150_000 },
  { code: '80CCD1B', label: 'Section 80CCD(1B) — NPS', hint: 'Your own NPS contribution, over and above 80C.', cap: 50_000 },
  { code: '80D_SELF', label: 'Section 80D — health insurance, self and family', hint: 'Premiums and preventive check-ups for you, spouse and children.', cap: 25_000, seniorCap: 50_000 },
  { code: '80D_PARENTS', label: 'Section 80D — health insurance, parents', hint: 'Premiums for your parents.', cap: 25_000, seniorCap: 50_000 },
  { code: '24B', label: 'Home loan interest (section 24(b))', hint: 'Interest on a loan for a house you live in.', cap: 200_000 },
  { code: '80E', label: 'Section 80E — education loan interest', hint: 'Interest only; no limit.', cap: null },
  { code: '80G', label: 'Section 80G — donations', hint: 'Enter the deductible amount from the receipt.', cap: null },
  { code: '80TTA', label: 'Section 80TTA — savings bank interest', hint: 'Interest on savings accounts.', cap: 10_000 },
] as const;

export type SectionCode = (typeof SECTIONS)[number]['code'];
export const SECTION_CODES = SECTIONS.map((s) => s.code) as string[];

/** "2026-27" for any date from 1 April 2026 to 31 March 2027. */
export const financialYearOf = (isoDate: string) => {
  const y = Number(isoDate.slice(0, 4));
  const start = Number(isoDate.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export const parseItems = (json: string | null | undefined): DeclarationItem[] => {
  try {
    const rows = JSON.parse(json || '[]');
    return Array.isArray(rows) ? rows.filter((r) => SECTION_CODES.includes(r?.code)) : [];
  } catch {
    return [];
  }
};

type Decl = { status: string; regime: string; itemsJson: string; monthlyRent: unknown; metroCity: boolean; seniorSelf: boolean; seniorParents: boolean };

/**
 * The year's deductions from a declaration, under the old regime.
 *
 * `annual` is this person's pay for the year as payroll projects it: Basic
 * (with DA) and HRA for the HRA exemption, and their own PF, which counts
 * towards 80C without anybody declaring it.
 */
export function deductionsFor(decl: Decl | null, annual: { basic: number; hra: number; employeePf: number }) {
  const lines: Array<{ code: string; label: string; claimed: number; allowed: number }> = [];
  if (!decl || decl.regime !== 'OLD') return { total: 0, lines, basis: null as null | 'DECLARED' | 'VERIFIED' };

  const basis = decl.status === 'VERIFIED' ? 'VERIFIED' : 'DECLARED';
  const items = new Map(parseItems(decl.itemsJson).map((i) => [i.code, i]));
  const amountOf = (code: string) => {
    const i = items.get(code);
    if (!i) return 0;
    const v = basis === 'VERIFIED' ? Number(i.verified ?? 0) : Number(i.declared ?? 0);
    return Math.max(0, Number.isFinite(v) ? v : 0);
  };

  for (const s of SECTIONS) {
    let claimed = amountOf(s.code);
    if (s.code === '80C') claimed += Math.max(0, annual.employeePf);
    if (!claimed) continue;
    const senior = (s.code === '80D_SELF' && decl.seniorSelf) || (s.code === '80D_PARENTS' && decl.seniorParents);
    const cap = 'seniorCap' in s && senior ? s.seniorCap : s.cap;
    lines.push({ code: s.code, label: s.label, claimed: round2(claimed), allowed: round2(cap == null ? claimed : Math.min(claimed, cap)) });
  }

  /* HRA: the least of HRA received, rent paid less 10% of Basic, and half of
     Basic in a metro (40% elsewhere). */
  const rent = Number(decl.monthlyRent) * 12;
  if (rent > 0 && annual.hra > 0) {
    const allowed = Math.max(0, Math.min(annual.hra, rent - 0.1 * annual.basic, (decl.metroCity ? 0.5 : 0.4) * annual.basic));
    lines.push({ code: 'HRA', label: 'HRA exemption', claimed: round2(rent), allowed: round2(allowed) });
  }

  return { total: round2(lines.reduce((t, l) => t + l.allowed, 0)), lines, basis };
}

/**
 * Form 12B, where somebody joined from another employer this year: the salary
 * that employer paid (taxable, after its own exemptions), the professional tax
 * and the TDS it took. Null when there is none.
 */
export function previousEmployerOf(row: { previousEmployerName?: string | null; previousEmployerIncome?: unknown; previousEmployerPt?: unknown; previousEmployerTds?: unknown } | null) {
  const income = Number(row?.previousEmployerIncome ?? 0) || 0;
  const professionalTax = Number(row?.previousEmployerPt ?? 0) || 0;
  const tds = Number(row?.previousEmployerTds ?? 0) || 0;
  if (!income && !professionalTax && !tds) return null;
  return { name: row?.previousEmployerName || null, income, professionalTax, tds };
}

const money = z.coerce.number().min(0, 'Amounts cannot be negative.').max(100_000_000);
export const declarationSchema = z.object({
  regime: z.enum(['NEW', 'OLD']),
  items: z
    .array(z.object({ code: z.string(), declared: money.default(0), verified: money.nullable().optional(), note: z.string().trim().max(300).nullable().optional() }))
    .max(SECTIONS.length)
    .default([]),
  monthlyRent: money.default(0),
  metroCity: z.boolean().default(false),
  landlordPan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'That is not a PAN.').nullable().optional().or(z.literal('')),
  seniorSelf: z.boolean().default(false),
  seniorParents: z.boolean().default(false),
  /* Form 12B: an earlier employer this year. Counts under either regime. */
  previousEmployer: z
    .object({
      name: z.string().trim().max(200).nullable().optional(),
      income: money.default(0),
      professionalTax: money.max(2500, 'Professional tax is at most ₹2,500 a year.').default(0),
      tds: money.default(0),
    })
    .nullable()
    .optional(),
});

export class DeclarationError extends Error {
  constructor(message: string, public status = 400, public code = 'DECLARATION') {
    super(message);
  }
}

/**
 * Save a declaration. An employee (from the portal) saves what they declare
 * and it goes to HR as SUBMITTED; they cannot touch verified amounts, nor a
 * declaration HR has verified. HR may change anything until it is verified.
 * Rent over ₹1 lakh a year needs the landlord's PAN, as the rules require.
 */
export async function saveDeclaration(
  t: { accountId: string; orgId: string },
  employeeId: string,
  financialYear: string,
  input: unknown,
  by: { userId: string; asEmployee: boolean }
) {
  const parsed = declarationSchema.safeParse(input);
  if (!parsed.success) throw new DeclarationError(parsed.error.issues[0]?.message || 'Check the amounts.');
  const d = parsed.data;
  const existing = await payrollPrisma.taxDeclaration.findUnique({ where: { orgId_employeeId_financialYear: { orgId: t.orgId, employeeId, financialYear } } });
  if (existing?.status === 'VERIFIED') throw new DeclarationError('This year’s declaration has been verified. Ask HR to reopen it.', 409, 'VERIFIED');
  if (d.monthlyRent * 12 > 100_000 && !d.landlordPan) throw new DeclarationError('Rent over ₹1,00,000 a year needs your landlord’s PAN.', 400, 'LANDLORD_PAN');

  const before = new Map(parseItems(existing?.itemsJson).map((i) => [i.code, i]));
  const items = d.items
    .filter((i) => SECTION_CODES.includes(i.code))
    .map((i) => ({
      code: i.code,
      declared: round2(i.declared),
      /* Verified amounts are HR's to set. */
      verified: by.asEmployee ? (before.get(i.code)?.verified ?? null) : i.verified == null ? null : round2(i.verified),
      note: by.asEmployee ? (before.get(i.code)?.note ?? null) : i.note || null,
    }));
  const data = {
    regime: d.regime,
    itemsJson: JSON.stringify(items),
    monthlyRent: d.monthlyRent,
    metroCity: d.metroCity,
    landlordPan: d.landlordPan || null,
    seniorSelf: d.seniorSelf,
    seniorParents: d.seniorParents,
    ...(d.previousEmployer !== undefined
      ? {
          previousEmployerName: d.previousEmployer?.name || null,
          previousEmployerIncome: round2(d.previousEmployer?.income || 0),
          previousEmployerPt: round2(d.previousEmployer?.professionalTax || 0),
          previousEmployerTds: round2(d.previousEmployer?.tds || 0),
        }
      : {}),
    updatedByUserId: by.userId,
    ...(by.asEmployee ? { status: 'SUBMITTED', submittedAt: new Date() } : {}),
  };
  const row = await payrollPrisma.taxDeclaration.upsert({
    where: { orgId_employeeId_financialYear: { orgId: t.orgId, employeeId, financialYear } },
    create: { accountId: t.accountId, orgId: t.orgId, employeeId, financialYear, ...data },
    update: data,
  });
  /* The profile shows the regime on the employee screen; keep it the same. */
  await payrollPrisma.employeePayrollProfile.updateMany({ where: { orgId: t.orgId, employeeId }, data: { taxRegime: d.regime } });
  return row;
}

export function shapeDeclaration(row: any | null, employeeId: string, financialYear: string) {
  const items = new Map(parseItems(row?.itemsJson).map((i) => [i.code, i]));
  return {
    id: row?.id || null,
    employeeId,
    financialYear,
    regime: row?.regime || 'NEW',
    status: row?.status || 'NONE',
    items: SECTIONS.map((s) => ({
      code: s.code,
      label: s.label,
      hint: s.hint,
      cap: s.cap,
      seniorCap: 'seniorCap' in s ? s.seniorCap : null,
      declared: Number(items.get(s.code)?.declared ?? 0),
      verified: items.get(s.code)?.verified ?? null,
      note: items.get(s.code)?.note ?? null,
    })),
    monthlyRent: Number(row?.monthlyRent ?? 0),
    metroCity: !!row?.metroCity,
    landlordPan: row?.landlordPan || '',
    seniorSelf: !!row?.seniorSelf,
    seniorParents: !!row?.seniorParents,
    previousEmployer: previousEmployerOf(row),
    submittedAt: row?.submittedAt || null,
    verifiedAt: row?.verifiedAt || null,
    updatedAt: row?.updatedAt || null,
  };
}
