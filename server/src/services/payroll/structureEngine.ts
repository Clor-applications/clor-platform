import type { EngineComponent } from './engine/calculator.js';

/**
 * A structure's lines, merged with the components they point at.
 *
 * The override wins where it is set; the component answers for everything else.
 * The engine never sees this distinction — by the time it runs, each line is
 * one settled set of rules.
 */
export function toEngineComponents(
  lines: { componentId: string; calculationMethod: string | null; amount: any; percentage: any; formula: string | null; calculationBase: string | null; isBalancing: boolean; displayOrder: number }[],
  components: any[]
): { engine: EngineComponent[]; missing: string[] } {
  const byId = new Map(components.map((c) => [c.id, c]));
  const missing: string[] = [];
  const engine: EngineComponent[] = [];

  for (const line of lines) {
    const c = byId.get(line.componentId);
    if (!c) {
      missing.push(line.componentId);
      continue;
    }
    engine.push({
      componentId: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      calculationMethod: (line.calculationMethod || c.calculationMethod) as EngineComponent['calculationMethod'],
      amount: Number(line.amount ?? c.amount ?? 0),
      percentage: Number(line.percentage ?? c.percentage ?? 0),
      formula: line.formula ?? c.formula ?? null,
      calculationBase: line.calculationBase ?? c.calculationBase ?? null,
      rounding: c.rounding,
      statutoryScheme: c.statutoryScheme,
      isTaxable: !!c.isTaxable,
      prorate: !!c.prorate,
      includeInPfWage: !!c.includeInPfWage,
      includeInEsiWage: !!c.includeInEsiWage,
      includeInGratuityWage: !!c.includeInGratuityWage,
      includeInGross: !!c.includeInGross,
      includeInNetPay: !!c.includeInNetPay,
      isVariable: !!c.isVariable,
      isBalancing: !!line.isBalancing,
      displayOrder: line.displayOrder ?? c.displayOrder ?? 0,
      expenseLedgerId: c.expenseLedgerId,
      liabilityLedgerId: c.liabilityLedgerId,
    });
  }
  return { engine, missing };
}
