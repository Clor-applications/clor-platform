import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import {
  computeStatutory,
  ruleInForce,
  type StatutoryAmount,
  type StatutoryEmployee,
  type StatutoryRuleInput,
  type StatutoryScheme,
  type StatutoryWages,
} from './engine.js';
import { SEED_RULES, SCHEME_NAMES } from './defaults.js';

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

const toEngineRule = (row: any): StatutoryRuleInput => ({
  id: row.id,
  scheme: row.scheme as StatutoryScheme,
  version: row.version,
  jurisdiction: row.jurisdiction,
  employeeRate: Number(row.employeeRate ?? 0),
  employerRate: Number(row.employerRate ?? 0),
  wageCeiling: row.wageCeiling == null ? null : Number(row.wageCeiling),
  eligibilityThreshold: row.eligibilityThreshold == null ? null : Number(row.eligibilityThreshold),
  rounding: row.rounding,
  config: (() => {
    try {
      return JSON.parse(String(row.configJson || '{}')) || {};
    } catch {
      return {};
    }
  })(),
});

/**
 * Every active rule for the schemes an organisation has switched on.
 *
 * Returned whole rather than pre-selected, because the right rule differs per
 * employee: professional tax depends on the state that person is taxed in, and
 * one company can have people in three.
 */
export async function loadRules(orgId: string): Promise<Map<StatutoryScheme, any[]>> {
  const schemes = await payrollPrisma.statutoryScheme.findMany({ where: { orgId, isEnabled: true } });
  if (!schemes.length) return new Map();

  const rules = await payrollPrisma.statutoryRule.findMany({
    where: { orgId, schemeId: { in: schemes.map((s) => s.id) }, status: 'ACTIVE' },
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
}): StatutoryOutcome {
  const amounts: Record<string, number> = {};
  const results: StatutoryAmount[] = [];
  const versions: StatutoryOutcome['versions'] = {};

  const month = Number(opts.onDate.slice(5, 7)) || 1;

  for (const [scheme, rows] of opts.rules) {
    /* Professional tax is the one that varies by where somebody is taxed. */
    const jurisdiction = scheme === 'PT' ? opts.employee.professionalTaxState : null;
    const row = ruleInForce(rows, opts.onDate, jurisdiction);
    if (!row) continue;

    const rule = toEngineRule(row);
    const result = computeStatutory(rule, opts.wages, opts.employee, {
      month,
      monthsRemaining: opts.monthsRemaining,
      taxAlreadyDeducted: opts.taxAlreadyDeducted,
    });

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

/**
 * Give an organisation the statutory rates to start from.
 *
 * Idempotent, and it never touches a scheme somebody has already configured —
 * seeding over a company's own PF rate would be the worst kind of helpful.
 * Schemes arrive switched off: a company says which apply to it.
 */
export async function seedStatutoryRules(orgId: string, accountId: string, userId: string) {
  const created: string[] = [];

  for (const seed of SEED_RULES) {
    let scheme = await payrollPrisma.statutoryScheme.findFirst({ where: { orgId, code: seed.scheme } });
    if (!scheme) {
      scheme = await payrollPrisma.statutoryScheme.create({
        data: {
          accountId,
          orgId,
          code: seed.scheme,
          name: SCHEME_NAMES[seed.scheme] || seed.scheme,
          description: seed.note,
          /* Off until a company says it applies. A deduction nobody asked for
             is money taken from somebody's pay by default. */
          isEnabled: false,
          createdByUserId: userId,
        },
      });
      created.push(`scheme:${seed.scheme}`);
    }

    const exists = await payrollPrisma.statutoryRule.findFirst({
      where: { orgId, schemeId: scheme.id, jurisdiction: seed.jurisdiction, version: seed.version },
    });
    if (exists) continue;

    await payrollPrisma.statutoryRule.create({
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
        createdByUserId: userId,
      },
    });
    created.push(`${seed.scheme}:${seed.jurisdiction || 'ALL'}:${seed.version}`);
  }

  return created;
}
