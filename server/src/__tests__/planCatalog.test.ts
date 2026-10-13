import { describe, it, expect } from 'vitest';
import { FEATURE_CATALOG } from '../constants/featureCatalog.js';
import { MODULE_PACKS, PLAN_CATALOG, DEFAULT_PLAN_KEY, planFor, lowestPlanWith } from '../constants/planCatalog.js';

/**
 * Plans and packs may only name features that exist.
 *
 * A pack is fully entitled when every key under it is entitled, and the default
 * plan entitles every key in the catalogue — so a pack naming a feature that
 * does not exist can never be fully entitled by anything. It renders locked
 * forever, on every plan, including the unlimited one.
 *
 * That is exactly what shipped: six invented keys across three packs.
 * `quotations` is really `estimates`; `stockAdjustments`, `ewayBill`, `gstr`
 * and `tds` are not switchable features at all. Nothing caught it, because the
 * unit tests for the picker supplied their own packs and the server tests
 * only ever exercised plans that entitle everything. It took looking at the
 * running product to see three packs locked on an unlimited plan.
 */

const CATALOG_KEYS = new Set(FEATURE_CATALOG.map((f) => f.key));

describe('every feature a plan or pack names exists', () => {
  it('holds for module packs', () => {
    const unknown = MODULE_PACKS.flatMap((p) => p.features.filter((k) => !CATALOG_KEYS.has(k)).map((k) => `${p.key}:${k}`));
    expect(unknown).toEqual([]);
  });

  it('holds for plans', () => {
    const unknown = PLAN_CATALOG.filter((p) => p.features !== '*').flatMap((p) =>
      (p.features as string[]).filter((k) => !CATALOG_KEYS.has(k)).map((k) => `${p.key}:${k}`)
    );
    expect(unknown).toEqual([]);
  });

  /* The bug in one line: on the unlimited plan, nothing may be locked. */
  it('leaves no pack locked on the plan that entitles everything', () => {
    const full = planFor(DEFAULT_PLAN_KEY);
    expect(full.features).toBe('*');
    const entitled = new Set(FEATURE_CATALOG.map((f) => f.key));
    const locked = MODULE_PACKS.filter((p) => !p.features.every((k) => entitled.has(k))).map((p) => p.key);
    expect(locked).toEqual([]);
  });

  it('gives every pack a plan that carries it, so the upgrade line is never blank', () => {
    for (const pack of MODULE_PACKS) {
      const plan = lowestPlanWith(pack.features[0]);
      expect(`${pack.key}:${plan ? plan.name : 'none'}`).not.toBe(`${pack.key}:none`);
    }
  });

  it('gives every pack at least one feature', () => {
    for (const p of MODULE_PACKS) expect(`${p.key}:${p.features.length > 0}`).toBe(`${p.key}:true`);
  });
});
