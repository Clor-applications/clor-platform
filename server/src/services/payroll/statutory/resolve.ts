import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { canonicalState } from '../../../constants/stateLevies.js';
import {
  computeStatutory,
  ruleInForce,
  type LwfContext,
  type StatutoryAmount,
  type StatutoryEmployee,
  type StatutoryRuleInput,
  type StatutoryScheme,
  type StatutoryWages,
} from './engine.js';
import { SEED_RULES, SCHEME_NAMES, LEGACY_SEEDS, SEED_CATALOGUE_VERSION, type SeedRule } from './defaults.js';

/**
 * Picking the statutory rules a payroll run computes under, and applying them.
 *
 * The engine is pure and knows nothing about the database; this is the part
 * that decides which rule it is handed. Kept separate because rule selection is
 * where the subtle mistakes live — the wrong date, the wrong state, a
 * superseded version — and it is easier to see them when they are not tangled
 * up with the arithmetic.
 *
 * Rules are read once per run, not once per employee. A four-hundred-person
 * payroll asks for four rules.
 */

export type RuleSet = Map<StatutoryScheme, { general: StatutoryRuleInput[]; all: any[] }>;

export const parseConfig = (configJson: unknown): Record<string, any> => {
  try {
    return JSON.parse(String(configJson || '{}')) || {};
  } catch {
    return {};
  }
};

export const toEngineRule = (row: any): StatutoryRuleInput => ({
  id: row.id,
  scheme: row.scheme as StatutoryScheme,
  version: row.version,
  jurisdiction: row.jurisdiction,
  employeeRate: Number(row.employeeRate ?? 0),
  employerRate: Number(row.employerRate ?? 0),
  wageCeiling: row.wageCeiling == null ? null : Number(row.wageCeiling),
  eligibilityThreshold: row.eligibilityThreshold == null ? null : Number(row.eligibilityThreshold),
  rounding: row.rounding,
  config: parseConfig(row.configJson),
});

/** A rule CLOR could not confirm, that nobody has checked yet. */
export const ruleNeedsCheck = (row: { configJson?: unknown; checkedAt?: Date | null }) => Boolean(parseConfig(row.configJson).needsCheck) && !row.checkedAt;

/**
 * Every rule in force at some date for the schemes an organisation has
 * switched on: the ones in force now, and the superseded ones inside the
 * window they were closed to, so a past month recomputes under its own rule.
 *
 * Returned whole rather than pre-selected, because the right rule differs per
 * employee: professional tax depends on the state that person is taxed in, and
 * one company can have people in three.
 */
export async function loadRules(orgId: string): Promise<Map<StatutoryScheme, any[]>> {
  const schemes = await payrollPrisma.statutoryScheme.findMany({ where: { orgId, isEnabled: true } });
  if (!schemes.length) return new Map();

  const rules = await payrollPrisma.statutoryRule.findMany({
    where: { orgId, schemeId: { in: schemes.map((s) => s.id) }, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
    orderBy: { effectiveFrom: 'desc' },
  });

  const byScheme = new Map<StatutoryScheme, any[]>();
  for (const scheme of schemes) {
    byScheme.set(
      scheme.code as StatutoryScheme,
      rules.filter((r) => r.schemeId === scheme.id).map((r) => ({ ...r, scheme: scheme.code }))
    );
  }
  return byScheme;
}

export type StatutoryOutcome = {
  /** Keyed by component code, ready for the calculator. */
  amounts: Record<string, number>;
  /** One per scheme that produced something, for the trace and the snapshot. */
  results: StatutoryAmount[];
  /** Which rule version answered for each scheme — recorded on the payslip. */
  versions: Record<string, { ruleId: string; version: string }>;
};

/**
 * What one employee owes under every scheme in force.
 *
 * The mapping from a scheme to a payslip line is the component: a component
 * declaring `statutoryScheme: 'PF'` receives PF's employee share, and one
 * declaring PF as an EMPLOYER_CONTRIBUTION receives the employer's. Without a
 * component, a scheme computes and has nowhere to appear — which is reported
 * rather than silently dropped.
 */
export function applyStatutory(opts: {
  rules: Map<StatutoryScheme, any[]>;
  onDate: string;
  wages: StatutoryWages;
  employee: StatutoryEmployee;
  /** Components carrying a scheme, so each result knows where it lands. */
  components: { code: string; statutoryScheme?: string | null; type: string }[];
  monthsRemaining: number;
  taxAlreadyDeducted: number;
  /** Professional tax already deducted this financial year, for the ₹2,500 cap. */
  ptAlreadyDeducted?: number;
  /** People in payroll per state (canonical names), and the company's LWF coverage setting. */
  lwf?: { headcountByState?: Map<string, number>; coverage?: LwfContext['coverage'] };
  /** The year's declared deductions, given this period's employee PF (which counts towards 80C). */
  taxDeductionsFor?: (employeePf: number) => { total: number; note: string };
}): StatutoryOutcome {
  const amounts: Record<string, number> = {};
  const results: StatutoryAmount[] = [];
  const versions: StatutoryOutcome['versions'] = {};

  const month = Number(opts.onDate.slice(5, 7)) || 1;
  const state = canonicalState(opts.employee.professionalTaxState);

  /* Income tax last: it needs this period's PF for 80C. */
  const ordered = [...opts.rules].sort(([a], [b]) => Number(a === 'TDS') - Number(b === 'TDS'));
  for (const [scheme, rows] of ordered) {
    /*
     * Professional tax and LWF are state levies: the rule of the state somebody
     * works in. With no state on their profile there is no rule to pick — not
     * "any state's": the run's checks say so instead (run.ts NO_PT_STATE).
     */
    const stateLevy = scheme === 'PT' || scheme === 'LWF';
    if (stateLevy && !state) continue;
    const row = ruleInForce(rows, opts.onDate, stateLevy ? state : null);
    if (!row) continue;
    /* A state rule only: a PT rule written with no state must not tax everybody. */
    if (stateLevy && !row.jurisdiction) continue;

    const rule = toEngineRule(row);
    const wages =
      scheme === 'TDS' && opts.taxDeductionsFor
        ? { ...opts.wages, taxDeductions: opts.taxDeductionsFor(results.find((r) => r.scheme === 'PF')?.employee || 0) }
        : opts.wages;
    const result = computeStatutory(rule, wages, opts.employee, {
      month,
      monthsRemaining: opts.monthsRemaining,
      taxAlreadyDeducted: opts.taxAlreadyDeducted,
      ptAlreadyDeducted: opts.ptAlreadyDeducted ?? 0,
      lwf: {
        headcount: opts.lwf?.headcountByState ? opts.lwf.headcountByState.get(state) ?? 0 : null,
        coverage: opts.lwf?.coverage,
      },
    });
    if (stateLevy && ruleNeedsCheck(row)) result.needsCheck = true;
    else if (stateLevy) result.needsCheck = false;

    results.push(result);
    versions[scheme] = { ruleId: rule.id, version: rule.version };

    /* The employee's share goes to a DEDUCTION component of this scheme, the
       employer's to an EMPLOYER_CONTRIBUTION of the same scheme. */
    for (const component of opts.components) {
      if (String(component.statutoryScheme || '').toUpperCase() !== scheme) continue;
      if (component.type === 'DEDUCTION') amounts[component.code.toUpperCase()] = result.employee;
      else if (component.type === 'EMPLOYER_CONTRIBUTION') amounts[component.code.toUpperCase()] = result.employer;
    }
  }

  return { amounts, results, versions };
}

/* ------------------------------------------------------------------ */
/* Seeding                                                            */
/* ------------------------------------------------------------------ */

const sameConfig = (configJson: unknown, config: Record<string, unknown>) => {
  try {
    return JSON.stringify(JSON.parse(String(configJson || '{}'))) === JSON.stringify(config);
  } catch {
    return false;
  }
};

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Whether a rule row is CLOR's seed or one the company published.
 *
 * Recorded on every row made since `origin` existed. An older row is CLOR's if
 * it carries a seeded version with exactly the seeded figures; anything else —
 * a different version, or the same version with other figures — is the
 * company's, and is never touched.
 */
function originOf(row: { origin?: string | null; version: string; jurisdiction: string | null; configJson: string }, scheme: string): 'SEED' | 'COMPANY' {
  if (row.origin === 'SEED' || row.origin === 'COMPANY') return row.origin;
  const j = canonicalState(row.jurisdiction);
  const known = [...SEED_RULES, ...LEGACY_SEEDS].some(
    (s) => s.scheme === scheme && canonicalState(s.jurisdiction) === j && s.version === row.version && sameConfig(row.configJson, s.config as Record<string, unknown>)
  );
  return known ? 'SEED' : 'COMPANY';
}

export type SeedOutcome = {
  /** What was added: `PT:KARNATAKA:2025-04-01`. */
  created: string[];
  /** Newer CLOR figures not added, because the company has its own rule there from a later date. */
  kept: string[];
};

/**
 * Give an organisation the statutory rates to start from, and top it up when
 * CLOR's catalogue changes.
 *
 * Idempotent, and it never changes a rule somebody published themselves:
 *
 *  - A seed version already present is skipped.
 *  - Where the company has its own version for a scheme and state, CLOR's
 *    figures from that date or earlier are not added — the company's rule
 *    stays in force — and the outcome says so (`kept`). Figures dated after
 *    the company's latest are added, as the law moving on from it.
 *  - CLOR's own older version is closed the day before its successor starts,
 *    the way a company's new rate closes the one before it. A CLOR version
 *    corrected on the same date (Maharashtra's women's bands) is closed
 *    entirely, and stays on record for any payslip that used it.
 *
 * Schemes arrive switched off: a company says which apply to it.
 */
export async function seedStatutoryRules(orgId: string, accountId: string, userId: string): Promise<string[]> {
  return (await seedStatutoryCatalogue(orgId, accountId, userId)).created;
}

export async function seedStatutoryCatalogue(orgId: string, accountId: string, userId: string): Promise<SeedOutcome> {
  const created: string[] = [];
  const kept: string[] = [];

  /* One group per scheme and state, oldest version first, so each closes the one before. */
  const groups = new Map<string, SeedRule[]>();
  for (const seed of SEED_RULES) {
    const key = `${seed.scheme}|${canonicalState(seed.jurisdiction)}`;
    groups.set(key, [...(groups.get(key) || []), seed]);
  }

  for (const seeds of groups.values()) {
    seeds.sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? (a.version < b.version ? -1 : 1) : a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    const first = seeds[0];

    let scheme = await payrollPrisma.statutoryScheme.findFirst({ where: { orgId, code: first.scheme } });
    if (!scheme) {
      scheme = await payrollPrisma.statutoryScheme.create({
        data: {
          accountId,
          orgId,
          code: first.scheme,
          name: SCHEME_NAMES[first.scheme] || first.scheme,
          description: SCHEME_DESCRIPTIONS[first.scheme] || first.note,
          /* Off until a company says it applies. A deduction nobody asked for
             is money taken from somebody's pay by default. */
          isEnabled: false,
          createdByUserId: userId,
        },
      });
      created.push(`scheme:${first.scheme}`);
    }

    const state = canonicalState(first.jurisdiction);
    const existing = (await payrollPrisma.statutoryRule.findMany({ where: { orgId, schemeId: scheme.id } })).filter(
      (r) => canonicalState(r.jurisdiction) === state
    );
    const classified = existing.map((r) => ({ row: r, origin: originOf(r, first.scheme) }));
    /* Remember what an older row turned out to be, so the answer does not depend on today's catalogue next time. */
    for (const c of classified) {
      if (!c.row.origin && c.origin === 'SEED') await payrollPrisma.statutoryRule.update({ where: { id: c.row.id }, data: { origin: 'SEED' } });
    }
    const companyLatest = classified
      .filter((c) => c.origin === 'COMPANY')
      .reduce<string>((latest, c) => (c.row.effectiveFrom > latest ? c.row.effectiveFrom : latest), '');

    for (const seed of seeds) {
      if (existing.some((r) => r.version === seed.version && r.effectiveFrom === seed.effectiveFrom)) continue;
      if (companyLatest && seed.effectiveFrom <= companyLatest) {
        kept.push(`${seed.scheme}:${seed.jurisdiction || 'ALL'}:${seed.version}`);
        continue;
      }
      const row = await payrollPrisma.statutoryRule.create({
        data: {
          accountId,
          orgId,
          schemeId: scheme.id,
          jurisdiction: seed.jurisdiction,
          effectiveFrom: seed.effectiveFrom,
          version: seed.version,
          employeeRate: seed.employeeRate,
          employerRate: seed.employerRate,
          wageCeiling: seed.wageCeiling,
          eligibilityThreshold: seed.eligibilityThreshold,
          rounding: seed.rounding,
          configJson: JSON.stringify(seed.config),
          status: 'ACTIVE',
          note: seed.note,
          origin: 'SEED',
          createdByUserId: userId,
        },
      });
      existing.push(row);
      classified.push({ row, origin: 'SEED' });
      created.push(`${seed.scheme}:${seed.jurisdiction || 'ALL'}:${seed.version}`);
    }

    /*
     * CLOR's own versions, in date order: each ends the day before the next
     * begins. Only seed rows are touched, and only to close them — a window a
     * company already closed earlier is left as it is.
     */
    const ours = classified
      .filter((c) => c.origin === 'SEED')
      .map((c) => c.row)
      .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? (a.version < b.version ? -1 : 1) : a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 0; i < ours.length - 1; i += 1) {
      const a = ours[i];
      const b = ours[i + 1];
      /* Corrected on the same date: never in force again, kept for the payslips that used it. */
      const end = a.effectiveFrom === b.effectiveFrom ? dayBefore(a.effectiveFrom) : dayBefore(b.effectiveFrom);
      if (a.effectiveTo && a.effectiveTo <= end) continue;
      await payrollPrisma.statutoryRule.update({ where: { id: a.id }, data: { effectiveTo: end, status: 'SUPERSEDED' } });
    }
  }

  return { created, kept };
}

const SCHEME_DESCRIPTIONS: Record<string, string> = {
  PT: 'Professional tax, by the state each person is taxed in. CLOR’s figures for every state that levies it, from its research of 2 Nov 2026.',
  LWF: 'Labour Welfare Fund, by the state each person works in. CLOR’s figures for every state that collects it, from its research of 2 Nov 2026.',
};

/**
 * Top a company up to CLOR's current catalogue, once per catalogue version.
 *
 * Only a company that has seeded before: one that never asked for the
 * standard rates is not given them unasked. Safe to call on every read.
 */
export async function ensureStatutoryCatalogue(orgId: string, accountId: string, userId = 'system') {
  const setting = await payrollPrisma.payrollSetting.findUnique({ where: { orgId }, select: { statutoryCatalogue: true } });
  if (setting?.statutoryCatalogue === SEED_CATALOGUE_VERSION) return null;
  const seeded = await payrollPrisma.statutoryScheme.count({ where: { orgId } });
  if (!seeded) return null;
  const outcome = await seedStatutoryCatalogue(orgId, accountId, userId);
  await payrollPrisma.payrollSetting.upsert({
    where: { orgId },
    update: { statutoryCatalogue: SEED_CATALOGUE_VERSION },
    create: { accountId, orgId, statutoryCatalogue: SEED_CATALOGUE_VERSION, updatedByUserId: userId },
  });
  return outcome;
}

/** Every company that has statutory schemes, outside any request; safe to repeat. */
export async function backfillStatutoryCatalogue() {
  const orgs = await outsideTenant('job: statutory catalogue top-up', () =>
    payrollPrisma.statutoryScheme.findMany({ select: { orgId: true, accountId: true }, distinct: ['orgId'] })
  );
  let topped = 0;
  for (const o of orgs) {
    try {
      if (await runInTenant(o.orgId, () => ensureStatutoryCatalogue(o.orgId, o.accountId))) topped += 1;
    } catch (e) {
      console.error(`[statutory-catalogue] ${o.orgId}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  }
  return { orgs: orgs.length, topped };
}

export function startStatutoryCatalogueBackfill({ delayMs = 120_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const t = setTimeout(() => {
    exclusive('payroll.statutory-catalogue.backfill', leaseFor(6 * 3_600_000), async () => {
      console.log('[statutory-catalogue] top-up:', JSON.stringify(await backfillStatutoryCatalogue())); // eslint-disable-line no-console
    }, { idempotent: true }).catch((e) => console.error('[statutory-catalogue] top-up failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  }, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
