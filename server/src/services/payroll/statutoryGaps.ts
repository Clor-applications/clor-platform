import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { canonicalState } from '../../constants/stateLevies.js';
import { SCHEME_NAMES, SEED_RULES } from './statutory/defaults.js';

/**
 * Statutory lines a payroll's payslips carry but nothing worked out (audit 7 Nov 2026, #3).
 *
 * A structure with an "Employee PF" component says PF is deducted here. When the PF scheme is switched off,
 * or has no rate in force, the calculator puts nil on that line with a warning, and a payroll approved like
 * that under-deducts every statutory item. So approval stops on it.
 *
 * Not a gap: a state that does not levy professional tax or LWF (no rule for that state at all, in force or
 * not) — nil there is the law. A person with no state on their payroll details is the run's own NO_PT_STATE
 * warning, not this.
 *
 * Income tax (TDS) can never stand without: tax on salary is always worked out, and the rules already give
 * nil under the rebate. PF, ESI and LWF can (a company under 20 people for PF, under 10 or outside a notified
 * area for ESI, under a state's LWF headcount). Professional tax cannot: where the state levies it, the
 * slabs already carry the nil band.
 */

export type StatutoryGap = {
  scheme: string;
  name: string;
  /** OFF: the scheme is switched off (or was never added). NO_RULE: on, with no rate in force for this period. */
  reason: 'OFF' | 'NO_RULE';
  /** The owner may approve without it, recording why it does not apply. */
  mayStandWithout: boolean;
  people: { employeeId: string; name: string }[];
};

export const MAY_STAND_WITHOUT = ['PF', 'ESI', 'LWF'];
const STATE_LEVIES = ['PT', 'LWF'];
const NOT_IN_FORCE = ['DRAFT', 'WITHDRAWN'];

const inForceOn = (r: { status: string; effectiveFrom: string; effectiveTo: string | null }, onDate: string) =>
  (r.status === 'ACTIVE' || (r.status === 'SUPERSEDED' && Boolean(r.effectiveTo))) && r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate);

export async function statutoryGapsOnRun(orgId: string, runId: string): Promise<StatutoryGap[]> {
  const run = await payrollPrisma.payrollRun.findFirst({ where: { orgId, id: runId }, select: { periodId: true, payrollDate: true } });
  if (!run) return [];
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId, status: { not: 'CANCELLED' } },
    select: { employeeId: true, structureSnapshotJson: true, statutorySnapshotJson: true, employeeSnapshotJson: true },
  });
  if (!slips.length) return [];
  const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId }, select: { startDate: true } });
  const levyDate = period?.startDate || run.payrollDate;

  const [schemes, rules, profiles] = await Promise.all([
    payrollPrisma.statutoryScheme.findMany({ where: { orgId }, select: { id: true, code: true, name: true, isEnabled: true } }),
    payrollPrisma.statutoryRule.findMany({
      where: { orgId, status: { notIn: NOT_IN_FORCE } },
      select: { schemeId: true, jurisdiction: true, status: true, effectiveFrom: true, effectiveTo: true },
    }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: slips.map((s) => s.employeeId) } }, select: { employeeId: true, professionalTaxState: true } }),
  ]);
  const schemeByCode = new Map(schemes.map((s) => [s.code.toUpperCase(), s]));
  const stateOf = new Map(profiles.map((p) => [p.employeeId, canonicalState(p.professionalTaxState)]));
  const names = new Map<string, string>();
  const missingNames = slips.filter((s) => !(JSON.parse(s.employeeSnapshotJson || '{}') as any).name).map((s) => s.employeeId);
  if (missingNames.length) {
    for (const e of await peoplePrisma.employee.findMany({ where: { orgId, id: { in: missingNames } }, select: { id: true, name: true } })) names.set(e.id, e.name);
  }

  const gaps = new Map<string, StatutoryGap>();
  for (const slip of slips) {
    let components: any[] = [];
    let results: any[] = [];
    let who = '';
    try {
      components = (JSON.parse(slip.structureSnapshotJson || '{}').components || []) as any[];
      results = (JSON.parse(slip.statutorySnapshotJson || '{}').results || []) as any[];
      who = String(JSON.parse(slip.employeeSnapshotJson || '{}').name || '');
    } catch {
      continue;
    }
    const worked = new Set(results.map((r) => String(r.scheme || '').toUpperCase()));
    const wanted = new Set(
      components
        .filter((c) => c.calculationMethod === 'STATUTORY' && c.statutoryScheme)
        .map((c) => String(c.statutoryScheme).toUpperCase())
    );
    for (const code of wanted) {
      if (worked.has(code)) continue;
      const scheme = schemeByCode.get(code);
      const own = scheme ? rules.filter((r) => r.schemeId === scheme.id) : [];
      if (STATE_LEVIES.includes(code)) {
        const state = stateOf.get(slip.employeeId);
        /* No state on their details: the run's NO_PT_STATE warning says so. */
        if (!state) continue;
        const inState = own.filter((r) => canonicalState(r.jurisdiction) === state);
        /* The state does not levy it: no rates for that state, the company's or CLOR's catalogue. */
        const levied = inState.length > 0 || SEED_RULES.some((r) => r.scheme === code && canonicalState(r.jurisdiction) === state);
        if (!levied) continue;
        const reason: StatutoryGap['reason'] = !scheme || !scheme.isEnabled ? 'OFF' : 'NO_RULE';
        if (reason === 'NO_RULE' && inState.some((r) => inForceOn(r, levyDate))) continue;
        add(gaps, code, scheme?.name || SCHEME_NAMES[code] || code, reason, slip.employeeId, who || names.get(slip.employeeId) || 'Someone');
        continue;
      }
      const reason: StatutoryGap['reason'] = !scheme || !scheme.isEnabled ? 'OFF' : 'NO_RULE';
      add(gaps, code, scheme?.name || SCHEME_NAMES[code] || code, reason, slip.employeeId, who || names.get(slip.employeeId) || 'Someone');
    }
  }
  return [...gaps.values()].sort((a, b) => a.scheme.localeCompare(b.scheme));
}

function add(gaps: Map<string, StatutoryGap>, scheme: string, name: string, reason: StatutoryGap['reason'], employeeId: string, who: string) {
  const g = gaps.get(scheme) || { scheme, name, reason, mayStandWithout: MAY_STAND_WITHOUT.includes(scheme), people: [] };
  /* Off beats "no rate": switching it on is the first thing to do. */
  if (reason === 'OFF') g.reason = 'OFF';
  if (!g.people.some((p) => p.employeeId === employeeId)) g.people.push({ employeeId, name: who });
  gaps.set(scheme, g);
}

const list = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '');

/** "Provident Fund is switched off, and Income Tax (TDS) has no rate for this month" — one sentence for the refusal. */
export function gapsSentence(gaps: StatutoryGap[]) {
  return list(gaps.map((g) => `${g.name} ${g.reason === 'OFF' ? 'is switched off' : 'has no rate in force for this month'} (${g.people.length} ${g.people.length === 1 ? 'person' : 'people'})`));
}

/** The waiver recorded on a run counts only for the calculation it was given on. */
export type StatutoryWaiver = { schemes: string[]; reason: string; userId: string; at: string; calculatedAt: string | null };

export function waiverOf(run: { statutoryWaiver?: unknown; calculatedAt?: Date | null }): StatutoryWaiver | null {
  const w = run.statutoryWaiver as StatutoryWaiver | null | undefined;
  if (!w || !Array.isArray(w.schemes)) return null;
  const at = run.calculatedAt ? new Date(run.calculatedAt).toISOString() : null;
  return w.calculatedAt === at ? w : null;
}

/** Gaps that still stop approval: every one the waiver does not cover. */
export const unwaived = (gaps: StatutoryGap[], waiver: StatutoryWaiver | null) =>
  gaps.filter((g) => !(g.mayStandWithout && waiver?.schemes.includes(g.scheme)));
