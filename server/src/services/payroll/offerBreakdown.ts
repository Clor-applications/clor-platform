import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { calculateStructure } from './engine/calculator.js';
import { toEngineComponents } from './structureEngine.js';

/**
 * Payroll's read interface for an offer letter (HR-VIEW gap 5): the salary
 * structures a company can offer on, and what one pays a month for a given
 * annual CTC, worked out by the same engine a payroll run uses. People calls
 * these two and never the payroll client (AGENT_RULES rule 1).
 */

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, FORTNIGHTLY: 26, WEEKLY: 52 };

export async function structuresForOffer(orgId: string) {
  const rows = await payrollPrisma.salaryStructure.findMany({ where: { orgId, status: 'ACTIVE', frequency: 'MONTHLY' }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, effectiveFrom: true } });
  return rows;
}

/** The monthly lines of a structure for this CTC: earnings, then what the employer pays on top. Null if the structure is not one to offer on. */
export async function offerBreakdown(orgId: string, structureId: string, annualCtc: number) {
  const structure = await payrollPrisma.salaryStructure.findFirst({ where: { orgId, id: structureId, status: 'ACTIVE' }, include: { components: true } });
  if (!structure) return null;
  const components = await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: structure.components.map((c) => c.componentId) } } });
  const { engine } = toEngineComponents(structure.components as any, components);
  const periods = PERIODS_PER_YEAR[structure.frequency] ?? 12;
  const result = calculateStructure(engine, { annualCtc, periodsPerYear: periods, workingDays: 30, payableDays: 30, lwpDays: 0 });
  const lines = result.lines
    .filter((l) => l.type !== 'DEDUCTION' && l.amount)
    .sort((a, b) => (a.type === b.type ? a.displayOrder - b.displayOrder : a.type === 'EARNING' ? -1 : 1))
    .map((l) => ({ label: l.type === 'EMPLOYER_CONTRIBUTION' ? `${l.name} (employer)` : l.name, monthly: Math.round(l.amount * 100) / 100, kind: l.type === 'EARNING' ? 'EARNING' : 'EMPLOYER' }));
  return { structure: { id: structure.id, name: structure.name }, lines, monthlyGross: Math.round(result.grossEarnings * 100) / 100, errors: result.errors.map((e) => e.message) };
}
