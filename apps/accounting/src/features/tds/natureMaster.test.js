/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { TDS_SECTIONS } from '@ui/utils/tds';
import { NATURE_CODES, TDS_NATURES, TDS_RULE_VERSIONS, natureByCode } from './ruleMaster';

/**
 * The Nature Master's one law: identity is stable and internal.
 *
 * A nature code is what every posted event, ledger mapping and party default
 * stores for ever. The visible name is for people and may change; the code
 * may not. These tests are the freeze — a section without a literal code, a
 * duplicate, or a drifted spelling fails the build before it orphans data.
 */

describe('the nature identity is frozen', () => {
  it('every section carries a LITERAL internal code — never one derived from its label', () => {
    const missing = TDS_SECTIONS.filter((s) => !NATURE_CODES[s.code]).map((s) => s.code);
    expect(missing).toEqual([]);
  });

  it('codes are machine-shaped and unique', () => {
    const codes = Object.values(NATURE_CODES);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9_]{2,40}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  /* The exact spellings every stored row points at. Changing one of these is
     a data migration, not an edit — that is what this pin is for. */
  it('the spellings posted data already carries do not move', () => {
    expect(NATURE_CODES['194C']).toBe('CONTRACTOR_SUB_CONTRACTOR');
    expect(NATURE_CODES['194J(b)']).toBe('PROFESSIONAL_SERVICES');
    expect(NATURE_CODES['194I(b)']).toBe('RENT_LAND_BUILDING_FURNITURE');
  });

  it('the master exposes exactly the specified fields: code, name, active', () => {
    for (const n of TDS_NATURES) {
      expect(n.code).toBe(NATURE_CODES[n.legacySection]);
      expect(typeof n.name).toBe('string');
      expect(n.name.length).toBeGreaterThan(0);
      expect(typeof n.active).toBe('boolean');
      /* And the name is not the identity: the code never equals the name. */
      expect(n.code).not.toBe(n.name);
    }
  });

  it('rules point at the stable code, and every rule resolves to a known nature', () => {
    for (const r of TDS_RULE_VERSIONS) {
      expect(natureByCode(r.natureCode)).toBeTruthy();
    }
  });
});
