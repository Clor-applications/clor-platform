import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { canonicalState, stateLabel } from '../../../constants/stateLevies.js';
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
  /**
   * The day the pay period starts. Professional tax and LWF belong to the
   * month the pay is for, not the day it is paid: September's salary paid on
   * 1 October is September's tax, under September's rule, in September's
   * financial year. Defaults to `onDate`.
   */
  levyDate?: string;
  /** Professional tax already on this financial year's payslips (run.ts ptPaidSoFar). */
  ptSoFar?: { yearToDate: number; thisMonth: number; byState: Map<string, { amount: number; months: number; gross?: number }> };
  /** Months of the financial year the person is employed (run.ts monthsEmployedInYear). */
  ptMonthsEmployed?: number;
  /** People in payroll per state (canonical names), and the company's LWF coverage setting. */
  lwf?: { headcountByState?: Map<string, number>; coverage?: LwfContext['coverage'] };
  /** The year's declared deductions, given this period's employee PF (which counts towards 80C). */
  taxDeductionsFor?: (employeePf: number) => { total: number; note: string };
}): StatutoryOutcome {
  const amounts: Record<string, number> = {};
  const results: StatutoryAmount[] = [];
  const versions: StatutoryOutcome['versions'] = {};

  const month = Number(opts.onDate.slice(5, 7)) || 1;
  const levyDate = opts.levyDate || opts.onDate;
  const levyMonth = Number(levyDate.slice(5, 7)) || month;
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
    const row = ruleInForce(rows, stateLevy ? levyDate : opts.onDate, stateLevy ? state : null);
    if (!row) continue;
    /* A state rule only: a PT rule written with no state must not tax everybody. */
    if (stateLevy && !row.jurisdiction) continue;

    const rule = toEngineRule(row);
    const wages =
      scheme === 'TDS' && opts.taxDeductionsFor
        ? { ...opts.wages, taxDeductions: opts.taxDeductionsFor(results.find((r) => r.scheme === 'PF')?.employee || 0) }
        : opts.wages;
    const inState = opts.ptSoFar?.byState.get(state);
    const result = computeStatutory(rule, wages, opts.employee, {
      month: stateLevy ? levyMonth : month,
      monthsRemaining: opts.monthsRemaining,
      taxAlreadyDeducted: opts.taxAlreadyDeducted,
      pt: opts.ptSoFar
        ? {
            yearToDate: opts.ptSoFar.yearToDate,
            thisMonth: opts.ptSoFar.thisMonth,
            inState: inState?.amount ?? 0,
            monthsInState: inState?.months ?? 0,
            grossInState: inState?.gross ?? 0,
            monthsEmployed: opts.ptMonthsEmployed,
          }
        : {},
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
  /** What was added and is in force: `PT:KARNATAKA:2025-04-01`. */
  created: string[];
  /** CLOR figures not added, because the company has its own rule there from that date or later. */
  kept: string[];
  /** Newer CLOR figures added as DRAFT beside a company's own rule, for HR to adopt or leave. */
  offered: string[];
};

/** Rules no payroll ever reads: CLOR's figures waiting to be adopted, and ones a company removed. */
export const NOT_IN_FORCE = ['DRAFT', 'WITHDRAWN'];

/**
 * Give an organisation the statutory rates to start from, and top it up when
 * CLOR's catalogue changes.
 *
 * Idempotent, and it never changes or overrides a rule somebody published:
 *
 *  - A seed version already present is skipped — including one the company
 *    removed (kept as WITHDRAWN, so it does not come back).
 *  - Where the company has its own version for a scheme and state, CLOR's
 *    figures from that date or earlier are not added (`kept`), and newer
 *    ones arrive as DRAFT (`offered`): never in force until somebody adopts
 *    them on the Compliance screen. The company's figures stay in force.
 *  - CLOR's own older version is closed the day before its successor starts,
 *    the way a company's new rate closes the one before it. A CLOR version
 *    corrected on the same date (Maharashtra's women's bands) is closed
 *    entirely, and stays on record for any payslip that used it.
 *
 * One company at a time (an advisory lock inside one transaction), so two
 * reads or a read and the startup job cannot add the same rule twice.
 *
 * Schemes arrive switched off: a company says which apply to it.
 */
export async function seedStatutoryRules(orgId: string, accountId: string, userId: string): Promise<string[]> {
  return (await seedStatutoryCatalogue(orgId, accountId, userId)).created;
}

export async function seedStatutoryCatalogue(orgId: string, accountId: string, userId: string): Promise<SeedOutcome> {
  return payrollPrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-statutory-seed:${orgId}`}))`;
      return seedInside(tx, orgId, accountId, userId);
    },
    { timeout: 60_000, maxWait: 30_000 }
  );
}

async function seedInside(db: any, orgId: string, accountId: string, userId: string): Promise<SeedOutcome> {
  const created: string[] = [];
  const kept: string[] = [];
  const offered: string[] = [];

  /* One group per scheme and state, oldest version first, so each closes the one before. */
  const groups = new Map<string, SeedRule[]>();
  for (const seed of SEED_RULES) {
    const key = `${seed.scheme}|${canonicalState(seed.jurisdiction)}`;
    groups.set(key, [...(groups.get(key) || []), seed]);
  }
  const byDate = (a: { effectiveFrom: string; version: string }, b: { effectiveFrom: string; version: string }) =>
    a.effectiveFrom === b.effectiveFrom ? (a.version < b.version ? -1 : 1) : a.effectiveFrom < b.effectiveFrom ? -1 : 1;

  for (const seeds of groups.values()) {
    seeds.sort(byDate);
    const first = seeds[0];

    let scheme = await db.statutoryScheme.findFirst({ where: { orgId, code: first.scheme } });
    if (!scheme) {
      scheme = await db.statutoryScheme.create({
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
    const existing = ((await db.statutoryRule.findMany({ where: { orgId, schemeId: scheme.id } })) as any[]).filter((r) => canonicalState(r.jurisdiction) === state);
    const classified = existing.map((r) => ({ row: r, origin: originOf(r, first.scheme) }));
    /* Remember what an older row turned out to be, so the answer does not depend on today's catalogue next time. */
    for (const c of classified) {
      if (!c.row.origin && c.origin === 'SEED') await db.statutoryRule.update({ where: { id: c.row.id }, data: { origin: 'SEED' } });
    }
    const companyLatest = classified
      .filter((c) => c.origin === 'COMPANY' && !NOT_IN_FORCE.includes(c.row.status))
      .reduce<string>((latest, c) => (c.row.effectiveFrom > latest ? c.row.effectiveFrom : latest), '');
    /* Only a company rule still in force holds CLOR's figures back as an offer. */
    const companyInForce = classified.some((c) => c.origin === 'COMPANY' && c.row.status === 'ACTIVE');

    for (const seed of seeds) {
      const label = `${seed.scheme}:${seed.jurisdiction || 'ALL'}:${seed.version}`;
      if (existing.some((r) => r.version === seed.version && r.effectiveFrom === seed.effectiveFrom)) continue;
      if (companyLatest && seed.effectiveFrom <= companyLatest) {
        kept.push(label);
        continue;
      }
      /*
       * Beside a company's own rule in force, CLOR's newer figures are an
       * offer, not a change. Once the company has adopted CLOR's figures (its
       * own rule superseded), later CLOR versions arrive as usual.
       */
      const draft = companyInForce;
      const row = await db.statutoryRule.create({
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
          status: draft ? 'DRAFT' : 'ACTIVE',
          note: seed.note,
          origin: 'SEED',
          createdByUserId: userId,
        },
      });
      existing.push(row);
      classified.push({ row, origin: 'SEED' });
      (draft ? offered : created).push(label);
    }

    /*
     * CLOR's own versions in force, in date order: each ends the day before
     * the next begins. Only seed rows are touched, and only to close them — a
     * window a company already closed earlier is left as it is. Drafts and
     * withdrawn rows take no part.
     */
    const ours = classified
      .filter((c) => c.origin === 'SEED' && !NOT_IN_FORCE.includes(c.row.status))
      .map((c) => c.row)
      .sort(byDate);
    for (let i = 0; i < ours.length - 1; i += 1) {
      const a = ours[i];
      const b = ours[i + 1];
      /* Corrected on the same date: never in force again, kept for the payslips that used it. */
      const end = a.effectiveFrom === b.effectiveFrom ? dayBefore(a.effectiveFrom) : dayBefore(b.effectiveFrom);
      if (a.effectiveTo && a.effectiveTo <= end) continue;
      await db.statutoryRule.update({ where: { id: a.id }, data: { effectiveTo: end, status: 'SUPERSEDED' } });
    }
  }

  return { created, kept, offered };
}

const SCHEME_DESCRIPTIONS: Record<string, string> = {
  PT: 'Professional tax, by the state each person is taxed in. CLOR’s figures for every state that levies it, from its research of 2 Nov 2026.',
  LWF: 'Labour Welfare Fund, by the state each person works in. CLOR’s figures for every state that collects it, from its research of 2 Nov 2026.',
};

const isUniqueClash = (e: unknown) => Boolean(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002');

/**
 * Top a company up to CLOR's current catalogue, once per catalogue version.
 *
 * Only a company that has seeded before: one that never asked for the
 * standard rates is not given them unasked. Two at once wait for each other
 * (the seed's lock); the second finds nothing left to add. A clash that gets
 * past that is read again rather than failed: the rules are there either way.
 */
export async function ensureStatutoryCatalogue(orgId: string, accountId: string, userId = 'system') {
  const setting = await payrollPrisma.payrollSetting.findUnique({ where: { orgId }, select: { statutoryCatalogue: true } });
  if (setting?.statutoryCatalogue === SEED_CATALOGUE_VERSION) return null;
  const seeded = await payrollPrisma.statutoryScheme.count({ where: { orgId } });
  if (!seeded) return null;
  let outcome: SeedOutcome | null = null;
  try {
    outcome = await seedStatutoryCatalogue(orgId, accountId, userId);
  } catch (e) {
    if (!isUniqueClash(e)) throw e;
    outcome = await seedStatutoryCatalogue(orgId, accountId, userId);
  }
  try {
    await payrollPrisma.payrollSetting.upsert({
      where: { orgId },
      update: { statutoryCatalogue: SEED_CATALOGUE_VERSION },
      create: { accountId, orgId, statutoryCatalogue: SEED_CATALOGUE_VERSION, updatedByUserId: userId },
    });
  } catch (e) {
    /* Another top-up made the settings row first: it says the same. */
    if (!isUniqueClash(e)) throw e;
    await payrollPrisma.payrollSetting.update({ where: { orgId }, data: { statutoryCatalogue: SEED_CATALOGUE_VERSION } });
  }
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

/**
 * The state rules a run's payslips were computed under that CLOR could not
 * confirm and nobody has checked yet — PT and LWF, by state.
 *
 * A run like that can be calculated and previewed, but not approved: the
 * approval check (routes/payrollRuns.ts) refuses until every one of them is
 * confirmed or corrected on the Compliance screen. Read from the payslips'
 * own record of the rule versions they used, so it is the rules actually
 * applied, not the ones in force today.
 */
export async function uncheckedRulesOnRun(orgId: string, runId: string) {
  const slips = await payrollPrisma.salarySlip.findMany({ where: { orgId, runId, status: { not: 'CANCELLED' } }, select: { statutorySnapshotJson: true } });
  const ids = new Set<string>();
  for (const slip of slips) {
    try {
      const snap = JSON.parse(slip.statutorySnapshotJson || '{}');
      for (const scheme of ['PT', 'LWF']) {
        const id = snap?.versions?.[scheme]?.ruleId;
        /* A rule that took nothing because this is not its month used none of its figures. */
        const result = (snap?.results || []).find((r: any) => r.scheme === scheme);
        if (id && result?.exemptReason !== 'NOT_THIS_MONTH') ids.add(String(id));
      }
    } catch {
      /* an old payslip without a snapshot */
    }
  }
  if (!ids.size) return [];
  const rules = await payrollPrisma.statutoryRule.findMany({ where: { orgId, id: { in: [...ids] } }, include: { scheme: { select: { code: true } } } });
  return rules
    .filter((r) => ruleNeedsCheck(r))
    .map((r) => ({ ruleId: r.id, scheme: r.scheme.code, state: stateLabel(String(r.jurisdiction || '')), version: r.version, effectiveFrom: r.effectiveFrom }))
    .sort((a, b) => a.state.localeCompare(b.state) || a.scheme.localeCompare(b.scheme));
}

/** "Meghalaya professional tax and Kerala Labour Welfare Fund". */
export const checksSentence = (checks: Array<{ scheme: string; state: string }>) => {
  const parts = checks.map((c) => `${c.state} ${c.scheme === 'LWF' ? 'Labour Welfare Fund' : 'professional tax'}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
};
