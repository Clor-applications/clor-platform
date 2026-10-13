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

/**
 * Every screen the product can put in the address bar can be opened from it.
 *
 * The app writes `#/<screen>` on every move, and reads it back only for keys
 * it recognises — the rail's, and Settings'. Reports live behind the Reports
 * hub, so none of them were recognised: clicking Trial Balance put
 * `#/trialBalance` in the address bar, and following that link, or reloading
 * on it, opened something else entirely. Twenty-eight screens handed out URLs
 * that lied.
 *
 * Checked here because the next screen added behind a hub will inherit the
 * same silence — nothing fails, the link just goes somewhere else.
 */

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

const app = readFileSync(src('App.jsx'), 'utf8');
const registry = readFileSync(src('features/settings/settingsRegistry.js'), 'utf8');

/* Screens that genuinely cannot stand up from a cold link, with the reason. */
const NEEDS_A_DOCUMENT = new Set([
  /* The single-ledger view is a ledger's own page; without one it is blank. */
  'ledger',
]);

const screensInSwitch = () => {
  const from = app.indexOf('switch (active)');
  expect(from).toBeGreaterThan(-1);
  return new Set([...app.slice(from).matchAll(/^ {6}case '([A-Za-z0-9]+)':/gm)].map((m) => m[1]));
};

const hubScreens = () => {
  const from = app.indexOf('const HUB_SCREENS = new Set([');
  expect(from).toBeGreaterThan(-1);
  const to = app.indexOf(']);', from);
  return new Set([...app.slice(from, to).matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]));
};

/* A rail entry always carries an icon, a permission or a feature beside its
   key — which is what tells it apart from a table column of the same name. */
const railScreens = () => {
  const out = new Set();
  for (const line of app.split('\n')) {
    if (!line.includes('key:')) continue;
    if (!/(icon:|Icon:|perm:|permAny:|feature:)/.test(line)) continue;
    const m = line.match(/key: '([A-Za-z0-9]+)'/);
    if (m) out.add(m[1]);
  }
  return out;
};

const settingsScreens = () =>
  new Set([...registry.matchAll(/key: '([A-Za-z0-9]+)'/g)].map((m) => m[1]));

describe('the address bar', () => {
  it('can open every screen the render switch knows', () => {
    const known = new Set([...hubScreens(), ...railScreens(), ...settingsScreens()]);
    const orphans = [...screensInSwitch()].filter((k) => !known.has(k) && !NEEDS_A_DOCUMENT.has(k)).sort();
    expect(orphans).toEqual([]);
  });

  it('keeps the reports reachable — the set that started this', () => {
    const hub = hubScreens();
    for (const key of ['trialBalance', 'profitLoss', 'balanceSheet', 'cashFlow', 'gstr1', 'gstr3b', 'tds']) {
      expect(hub.has(key)).toBe(true);
    }
  });
});
