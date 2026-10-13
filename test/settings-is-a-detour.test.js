/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isSettingsRoute } from '../apps/accounting/src/features/settings/settingsRegistry';

/* src/test/ → src/ */
/*
 * The source, which is now in two places.
 *
 * This file used to sit in `src/test/`, so two `dirname`s reached `src/` and
 * one grep covered the whole application. The tree is a platform now — screens
 * under `apps/`, shared UI under `packages/` — and the same two `dirname`s
 * reach the repository root, where a grep also walks node_modules and dist and
 * reports matches that are not the product.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * Where a file that used to be `src/<path>` lives now.
 *
 * The tree became a platform: screens under `apps/accounting/src`, payroll
 * under `apps/payroll/src`, and everything more than one app uses under
 * `packages/ui/src`. A test that reads source has to look in all three, and
 * looking in the wrong one reports a missing file rather than a real result.
 */
const SRC_DIRS = [
  join(ROOT, 'apps/accounting/src'),
  join(ROOT, 'packages/ui/src'),
  join(ROOT, 'apps/payroll/src'),
];
const SRC = SRC_DIRS[0];
const src = (rel) => SRC_DIRS.map((d) => join(d, rel)).find((p) => existsSync(p)) || join(SRC_DIRS[0], rel);

const APP = readFileSync(src('App.jsx'), 'utf8');

/**
 * Leaving a document to check a setting, and coming back to it.
 *
 * A document form can send you to the screen that configures it — ⋮ → Custom
 * fields, the numbering panel's All numbering. Every open editor was torn down
 * the instant the screen key changed, so Back landed on the list with the
 * document gone: the menu entry that offered the errand was the thing that
 * lost your place.
 */

describe('what counts as a settings errand', () => {
  it('includes the framed settings and the standalone ones', () => {
    /* Framed: opens inside the settings chrome. */
    expect(isSettingsRoute('settingsCustomFields')).toBe(true);
    expect(isSettingsRoute('docNumbering')).toBe(true);
    /* Standalone: a settings item that opens as a whole screen. */
    expect(isSettingsRoute('invoiceTemplates')).toBe(true);
  });

  it('does not swallow the document screens themselves', () => {
    for (const key of ['bills', 'invoices', 'estimates', 'creditNotes', 'payments']) {
      expect(isSettingsRoute(key)).toBe(false);
    }
  });

  it('says no to nothing at all', () => {
    expect(isSettingsRoute('')).toBe(false);
    expect(isSettingsRoute(null)).toBe(false);
  });
});

describe('an open document survives the errand', () => {
  /**
   * The effects that close editors when the screen changes. Each one must let
   * a settings screen pass, or the document is gone before Back is pressed.
   *
   * A source scan because the behaviour lives in App.jsx's routing, which no
   * test renders — and the thing worth pinning is that NO such effect is
   * missed, which reading them is the way to know.
   */
  const closingEffects = () => {
    const out = [];
    const re = /useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[active[^\]]*\]\);/g;
    let m = re.exec(APP);
    while (m) {
      /* The ones whose job is closing an editor because the screen changed —
         not the share-link effect, which opens one and happens to mention the
         same shape. */
      if (/if \(active !==/.test(m[1]) && /Editor\(\{ open: false/.test(m[1])) out.push(m[1]);
      m = re.exec(APP);
    }
    return out;
  };

  it('every editor-closing effect stands down on a settings screen', () => {
    const effects = closingEffects();
    /* If this is zero the scan has stopped matching and proves nothing. */
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.filter((body) => !body.includes('if (onSettingsDetour) return;'))).toEqual([]);
  });

  it('and the flag is the registry answer, not a hand-kept list of keys', () => {
    expect(APP).toContain('const onSettingsDetour = isSettingsRoute(active);');
  });
});
