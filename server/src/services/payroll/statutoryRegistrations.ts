import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { canonicalState, stateLabel, PT_FILINGS } from '../../constants/stateLevies.js';
import { ruleInForce } from './statutory/engine.js';
import { todayIst } from '../../utils/istDate.js';

/**
 * The numbers each statutory return is filed under (roadmap 15, review of
 * 9 Nov 2026).
 *
 * Payroll's first run could work out PF, ESI, professional tax and income tax
 * and still produce nothing a portal would take, because nobody had been asked
 * for the company's registrations: the PF establishment code the ECR is filed
 * under, the ESI employer code, the professional tax registration in each state,
 * the TAN. They lived on the Compliance screen, in a field a first-time user
 * had to go looking for. This service is the one reading and the one set of
 * rules for them, used by the setup step, the Compliance screen and the pay
 * run screen alike, so there is one copy of each number.
 *
 * Where each lives: PF, ESI and TDS numbers on their StatutoryScheme row
 * (`registrationNumber`, which Form 16 already reads for the TAN); professional
 * tax by state, and the Form 24Q deductor details, on PayrollSetting.
 */

/** TAN: four letters, five digits, one letter (BLRA12345B). */
export const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
/**
 * PF establishment code as the EPFO portal shows it, once slashes and spaces
 * are taken out: two letters for the region, three for the office, the
 * establishment number (five to seven digits) and a three-digit extension
 * (KNBNG0012345000).
 */
export const PF_CODE_RE = /^[A-Z]{5}\d{8,10}$/;
/** ESI employer code: 17 digits. */
export const ESI_CODE_RE = /^\d{17}$/;

export const DEDUCTOR_TYPES = [
  { code: 'COMPANY', label: 'Company' },
  { code: 'COMPANY_BRANCH', label: 'Branch or division of a company' },
  { code: 'FIRM', label: 'Partnership firm or LLP' },
  { code: 'INDIVIDUAL_HUF', label: 'Individual or HUF' },
  { code: 'AOP_TRUST', label: 'Association of persons, society or trust' },
  { code: 'GOVERNMENT', label: 'Government or local authority' },
  { code: 'OTHER', label: 'Other' },
] as const;
export type DeductorType = (typeof DEDUCTOR_TYPES)[number]['code'];
export const DEDUCTOR_CODES = DEDUCTOR_TYPES.map((d) => d.code) as [DeductorType, ...DeductorType[]];

/** Upper case, no spaces, slashes or dashes: how a number is kept and compared. */
export const compactNumber = (value: unknown) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[\s/\-.]/g, '');

/**
 * Checks one registration number for the scheme it belongs to. Returns the
 * plain-words problem, or null when the number is fine (or empty: a number
 * that is not known yet is allowed, and the checklist says it is missing).
 */
export function registrationProblem(scheme: string, value: unknown): string | null {
  const v = compactNumber(value);
  if (!v) return null;
  switch (String(scheme).toUpperCase()) {
    case 'TDS':
      return TAN_RE.test(v) ? null : 'A TAN is ten characters: four letters, five numbers and a letter, such as BLRA12345B.';
    case 'PF':
      return PF_CODE_RE.test(v)
        ? null
        : 'A PF establishment code is five letters followed by the numbers, such as KNBNG0012345000 (the slashes can be left out).';
    case 'ESI':
      return ESI_CODE_RE.test(v) ? null : 'An ESI employer code is 17 digits.';
    default:
      return v.length <= 30 ? null : 'A registration number is at most 30 characters.';
  }
}

export type PtRegistration = { state: string; registrationNumber: string };

export const parsePtRegistrations = (json: string | null | undefined): PtRegistration[] => {
  try {
    const rows = JSON.parse(String(json || '[]'));
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => ({ state: canonicalState(r?.state), registrationNumber: String(r?.registrationNumber || '').trim() }))
      .filter((r) => r.state);
  } catch {
    return [];
  }
};

/** The states that levy professional tax, for a picker. */
export const PT_LEVY_STATES = Object.keys(PT_FILINGS)
  .map((s) => ({ state: s, label: stateLabel(s) }))
  .sort((a, b) => a.label.localeCompare(b.label));

export type MissingRegistration = {
  scheme: 'PF' | 'ESI' | 'PT' | 'TDS';
  /** For a checklist line: "PF establishment code". */
  short: string;
  /** For the pay run screen: the return it stops. */
  message: string;
  state?: string;
};

export type RegistrationsShape = {
  pf: { applies: boolean; code: string; contributeOnFullWage: boolean; wageCeiling: number | null };
  esi: { applies: boolean; code: string; eligibilityThreshold: number | null };
  pt: {
    applies: boolean;
    registrations: Array<{ state: string; label: string; registrationNumber: string; people: number }>;
    /** Every state that levies it, for adding one. */
    levyStates: Array<{ state: string; label: string }>;
  };
  tds: { applies: boolean; tan: string; deductorType: DeductorType | null; responsibleName: string; responsibleDesignation: string };
  deductorTypes: typeof DEDUCTOR_TYPES;
  /** When the question was answered; null until somebody saves the step or a number in Compliance. */
  answeredAt: string | null;
  missing: MissingRegistration[];
  /** Answered, and every scheme that applies has its number. */
  done: boolean;
  /** Whether the standard rates exist yet (a scheme cannot be switched on without them). */
  hasSchemes: boolean;
};

/** The states payroll has people in, with how many: where a professional tax registration is needed. */
async function peopleByPtState(orgId: string) {
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({
    where: { orgId, payrollStatus: 'IN_PAYROLL' },
    select: { employeeId: true, professionalTaxState: true },
  });
  if (!profiles.length) return new Map<string, number>();
  /* Only people who still exist: a deleted employee's profile should not demand a registration. */
  const live = new Set(
    (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: profiles.map((p) => p.employeeId) } }, select: { id: true } })).map((e) => e.id)
  );
  const out = new Map<string, number>();
  for (const p of profiles) {
    if (!live.has(p.employeeId)) continue;
    const st = canonicalState(p.professionalTaxState);
    if (st) out.set(st, (out.get(st) || 0) + 1);
  }
  return out;
}

export async function registrationsShape(orgId: string): Promise<RegistrationsShape> {
  const [schemes, setting, people] = await Promise.all([
    payrollPrisma.statutoryScheme.findMany({ where: { orgId }, select: { id: true, code: true, isEnabled: true, registrationNumber: true } }),
    payrollPrisma.payrollSetting.findUnique({
      where: { orgId },
      select: { ptRegistrationsJson: true, tdsDeductorType: true, tdsResponsibleName: true, tdsResponsibleDesignation: true, statutoryRegistrationsAt: true },
    }),
    peopleByPtState(orgId),
  ]);
  const by = (code: string) => schemes.find((s) => s.code.toUpperCase() === code) || null;
  const pf = by('PF');
  const esi = by('ESI');
  const pt = by('PT');
  const tds = by('TDS');

  /* The PF and ESI figures in force today: the ceiling and threshold the step says in words. */
  const rules =
    pf || esi
      ? await payrollPrisma.statutoryRule.findMany({
          where: { orgId, schemeId: { in: [pf?.id, esi?.id].filter(Boolean) as string[] }, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
          select: { schemeId: true, jurisdiction: true, status: true, effectiveFrom: true, effectiveTo: true, wageCeiling: true, eligibilityThreshold: true, configJson: true },
        })
      : [];
  const today = todayIst();
  const pfRule = pf ? ruleInForce(rules.filter((r) => r.schemeId === pf.id), today, 'IN') : null;
  const esiRule = esi ? ruleInForce(rules.filter((r) => r.schemeId === esi.id), today, 'IN') : null;
  const pfConfig = (() => {
    try {
      return JSON.parse(String(pfRule?.configJson || '{}')) || {};
    } catch {
      return {};
    }
  })();

  const saved = parsePtRegistrations(setting?.ptRegistrationsJson);
  const states = new Set<string>([...people.keys(), ...saved.map((r) => r.state)]);
  const registrations = [...states]
    .map((state) => ({
      state,
      label: stateLabel(state),
      registrationNumber: saved.find((r) => r.state === state)?.registrationNumber || '',
      people: people.get(state) || 0,
    }))
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));

  const missing: MissingRegistration[] = [];
  if (pf?.isEnabled && !pf.registrationNumber) {
    missing.push({ scheme: 'PF', short: 'PF establishment code', message: 'PF ECR cannot be filed until the PF establishment code is added.' });
  }
  if (esi?.isEnabled && !esi.registrationNumber) {
    missing.push({ scheme: 'ESI', short: 'ESI employer code', message: 'The ESI return cannot be filed until the ESI employer code is added.' });
  }
  if (pt?.isEnabled) {
    for (const r of registrations) {
      if (r.people > 0 && !r.registrationNumber) {
        missing.push({
          scheme: 'PT',
          state: r.state,
          short: `${r.label} professional tax registration`,
          message: `Professional tax for ${r.label} cannot be filed until its registration number is added.`,
        });
      }
    }
  }
  if (tds?.isEnabled && !tds.registrationNumber) {
    missing.push({ scheme: 'TDS', short: 'TAN', message: 'Form 24Q cannot be filed until the TAN is added.' });
  }

  const answeredAt = setting?.statutoryRegistrationsAt ? setting.statutoryRegistrationsAt.toISOString() : null;
  const deductorType = DEDUCTOR_CODES.includes(setting?.tdsDeductorType as DeductorType) ? (setting!.tdsDeductorType as DeductorType) : null;

  return {
    pf: {
      applies: Boolean(pf?.isEnabled),
      code: pf?.registrationNumber || '',
      contributeOnFullWage: Boolean(pfConfig.contributeOnFullWage),
      wageCeiling: pfRule?.wageCeiling == null ? null : Number(pfRule.wageCeiling),
    },
    esi: {
      applies: Boolean(esi?.isEnabled),
      code: esi?.registrationNumber || '',
      eligibilityThreshold: esiRule?.eligibilityThreshold == null ? null : Number(esiRule.eligibilityThreshold),
    },
    pt: { applies: Boolean(pt?.isEnabled), registrations, levyStates: PT_LEVY_STATES },
    tds: {
      applies: Boolean(tds?.isEnabled),
      tan: tds?.registrationNumber || '',
      deductorType,
      responsibleName: setting?.tdsResponsibleName || '',
      responsibleDesignation: setting?.tdsResponsibleDesignation || '',
    },
    deductorTypes: DEDUCTOR_TYPES,
    answeredAt,
    missing,
    done: Boolean(answeredAt) && missing.length === 0,
    hasSchemes: schemes.length > 0,
  };
}

/** The returns this company cannot file yet, for the pay run screen. */
export async function missingRegistrations(orgId: string): Promise<MissingRegistration[]> {
  return (await registrationsShape(orgId)).missing;
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Whether PF contributions stop at the wage ceiling or follow the full wage.
 *
 * A rate is never edited, so a change here is a new company version of the
 * PF rule from today, copying the figures in force and flipping the one
 * choice; the version before closes yesterday. Payslips already produced keep
 * the version they used. Nothing is written when the choice already stands.
 * Returns the new rule's id, or null when nothing changed.
 */
export async function setPfContributeOnFullWage(orgId: string, accountId: string, userId: string, contributeOnFullWage: boolean): Promise<string | null> {
  const pf = await payrollPrisma.statutoryScheme.findFirst({ where: { orgId, code: 'PF' }, select: { id: true } });
  if (!pf) return null;
  const rules = await payrollPrisma.statutoryRule.findMany({ where: { orgId, schemeId: pf.id, status: { in: ['ACTIVE', 'SUPERSEDED'] } } });
  const today = todayIst();
  const current = ruleInForce(rules, today, 'IN');
  if (!current) return null;
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(String(current.configJson || '{}')) || {};
  } catch {
    config = {};
  }
  if (Boolean(config.contributeOnFullWage) === contributeOnFullWage) return null;

  return payrollPrisma.$transaction(async (tx) => {
    /* A company version that already starts today and has produced no payslip can simply carry the choice. */
    if (current.effectiveFrom === today && current.origin === 'COMPANY') {
      const used = await tx.payrollCalculationTrace.count({ where: { orgId, statutoryRuleId: current.id } });
      if (!used) {
        await tx.statutoryRule.update({
          where: { id: current.id },
          data: { configJson: JSON.stringify({ ...config, contributeOnFullWage }), checkedAt: new Date(), checkedByUserId: userId },
        });
        return current.id;
      }
    }
    const sameDay = rules.filter((r) => r.effectiveFrom === today);
    const suffix = sameDay.reduce((n, r) => Math.max(n, Number(String(r.version).split('.')[1]) || 1), 0);
    const version = sameDay.length ? `${today}.${suffix + 1}` : today;
    for (const r of sameDay) {
      await tx.statutoryRule.update({ where: { id: r.id }, data: { effectiveTo: dayBefore(today), status: 'SUPERSEDED' } });
    }
    if (current.effectiveFrom < today) {
      await tx.statutoryRule.update({ where: { id: current.id }, data: { effectiveTo: dayBefore(today), status: 'SUPERSEDED' } });
    }
    const row = await tx.statutoryRule.create({
      data: {
        accountId,
        orgId,
        schemeId: pf.id,
        jurisdiction: current.jurisdiction,
        effectiveFrom: today,
        version,
        employeeRate: current.employeeRate,
        employerRate: current.employerRate,
        wageCeiling: current.wageCeiling,
        eligibilityThreshold: current.eligibilityThreshold,
        rounding: current.rounding,
        configJson: JSON.stringify({ ...config, contributeOnFullWage }),
        status: 'ACTIVE',
        note: contributeOnFullWage
          ? 'Contributions on the full PF wage, not stopped at the ceiling (chosen in payroll setup).'
          : 'Contributions stop at the PF wage ceiling (chosen in payroll setup).',
        origin: 'COMPANY',
        checkedAt: new Date(),
        checkedByUserId: userId,
        createdByUserId: userId,
      },
    });
    return row.id;
  });
}
