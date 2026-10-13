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

const CSS = readFileSync(join(ROOT, 'packages/ui/src/index.css'), 'utf8');
const APP = readFileSync(src('App.jsx'), 'utf8');

/**
 * Every glyph in the rail sits on one line.
 *
 * The rail indents a child under its module — that is how rank is read in a
 * tree. The collapse control carries no `data-level`, so it matched the child
 * rule and was pushed 2rem in: its icon sat half an inch right of every other
 * icon in the rail, under nothing.
 */

describe('the rail has one left edge', () => {
  it('does not indent the collapse control as a child', () => {
    /*
     * Every child rule the collapse could match excludes it by name. The
     * selected-child rules are not among them: they require
     * [data-active='true'], which the collapse never carries.
     */
    const childRules = [...CSS.matchAll(/\.ui-nav-item:not\(\[data-level='module'\]\)([^{]*)\{/g)]
      .map((m) => m[0])
      .filter((rule) => !rule.includes('data-active'));

    expect(childRules.length).toBeGreaterThan(0);
    for (const rule of childRules) {
      expect(rule).toContain(":not(.ui-nav-collapse)");
    }
  });

  it('still indents a real child', () => {
    /* The exclusion is for the collapse alone — the rule itself stands.
       1rem, not 2: the children wrapper's pl-5 already carries half the
       indent, and the pair lands the child's icon at 36px, under its
       module's label. 2rem stacked to 52px and truncated long labels. */
    expect(CSS).toMatch(/:not\(\.ui-nav-collapse\)\s*\{[^}]*padding-inline-start:\s*1rem/);
  });

  it('keeps the control in the rail, where the icons are', () => {
    expect(APP).toMatch(/ui-nav-item ui-nav-collapse/);
  });
});
