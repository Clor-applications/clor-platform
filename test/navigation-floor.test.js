/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
 * What is left when every module is switched off.
 *
 * A person who ticks nothing at signup must still be able to reach their own
 * data and their own settings — otherwise the product they land in cannot be
 * turned back on, and the choice they made ten seconds ago is unrecoverable.
 *
 * So the floor is: the core of Master Data and the core of Settings carry no
 * feature gate at all. Anything genuinely specific to a module — price lists,
 * discount rules, branches — is gated, and rightly.
 */

const groupSlice = (label) => {
  const at = APP.indexOf(`label: '${label}'`);
  expect(at).toBeGreaterThan(-1);
  return APP.slice(at, at + 6000);
};

const entryHasFeature = (slice, key) => {
  const m = slice.match(new RegExp(`\\{ key: '${key}',[^}]*\\}`));
  return m ? /feature:/.test(m[0]) : null;
};

describe('the navigation floor', () => {
  /* Without these a company cannot enter anything at all. */
  it('never hides the core of Master Data', () => {
    const slice = groupSlice('Master Data');
    for (const key of ['items', 'uoms', 'itemCategories', 'bankCash', 'gstRates']) {
      expect(`${key}:${entryHasFeature(slice, key)}`).toBe(`${key}:false`);
    }
  });

  /*
   * Without these the choice made at signup could never be changed.
   *
   * Settings is no longer a group in the rail — it is a workspace of its own,
   * built from the registry — so the floor is checked where the settings now
   * live rather than where they used to be listed.
   */
  it('never hides Features behind a feature', async () => {
    /* The screen that switches capabilities on cannot itself be switched off,
       or a company that turned everything off has no way back. */
    const app = readFileSync('apps/accounting/src/App.jsx', 'utf8');
    const entry = app.slice(app.indexOf("key: 'features'"), app.indexOf("key: 'features'") + 320);
    expect(entry).not.toMatch(/feature:/);
    expect(entry).toMatch(/perm: 'SETTINGS::Company Profile::VIEW'/);
  });

  it('never hides the core of Settings', async () => {
    const { SETTINGS_ITEMS } = await import('../apps/accounting/src/features/settings/settingsRegistry');
    /* `settingsFeatures` left this list when capability management left
       Settings. The floor it guarded still holds: Features is a top-level
       module of its own now, and the test below checks it is reachable. */
    for (const key of ['settingsModules', 'settingsCompany', 'settingsUsers', 'settingsRoles']) {
      const item = SETTINGS_ITEMS.find((i) => i.key === key);
      expect(`${key}:${Boolean(item)}`).toBe(`${key}:true`);
      expect(`${key}:${item.feature ?? 'none'}`).toBe(`${key}:none`);
    }
  });

  /*
   * Modules in particular. If that one were ever gated behind a feature, a user
   * who switched everything off would have no way back — the screen that turns
   * modules on would be the screen they had just turned off.
   */
  it('never hides the screen that turns modules back on', async () => {
    const { SETTINGS_ITEMS } = await import('../apps/accounting/src/features/settings/settingsRegistry');
    expect(SETTINGS_ITEMS.find((i) => i.key === 'settingsModules')?.feature ?? 'none').toBe('none');
  });

  /* And Settings itself is still one entry in the rail, reachable from it. */
  it('keeps a Settings entry in the rail', () => {
    expect(APP).toMatch(/key: 'settings', label: 'Settings'/);
  });
});
