/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The shared control geometry, held in the stylesheet that owns it.
 *
 * These are the rules a hundred screens inherit, so a regression here is a
 * regression everywhere — and the two defects this file was written for were
 * both invisible in a diff and obvious on screen.
 */

const CSS = readFileSync('packages/ui/src/index.css', 'utf8');

/*
 * The block a selector OPENS, not the first place its text appears.
 *
 * `.ui-select` occurs inside the shared `.ui-input, .ui-select` block as well
 * as in its own, so a plain indexOf reads the wrong rule and the first cut of
 * this file failed against a stylesheet that was correct.
 */
const rule = (selector, which = 0) => {
  const open = `\n  ${selector}`;
  let i = -1;
  for (let n = 0; n <= which; n += 1) {
    i = CSS.indexOf(open, i + 1);
    if (i < 0) return '';
  }
  return CSS.slice(i, CSS.indexOf('\n  }', i));
};

/*
 * `.ui-select {` opens twice: once as the second line of the shared
 * `.ui-input, .ui-select` block, and once as its own. The shared one comes
 * first in the file, so the standalone is occurrence 1 — and reading the
 * wrong one is how the first cut of this file failed against a stylesheet
 * that was already correct.
 */
const SELECT_OWN = 1;

describe('the select draws its own indicator', () => {
  it('reserves room on the right so text cannot reach the chevron', () => {
    /* Native, the browser drew the arrow inside the same 10px the text used:
       a long vendor name ran into it and the arrow touched the border. */
    const r = rule('.ui-select {', SELECT_OWN);
    expect(r).toContain('appearance: none');
    expect(r).toContain('padding-inline-end: 2.25rem');
    expect(r).toContain('background-position: right 0.75rem center');
    expect(r).toContain('text-overflow: ellipsis');
  });

  it('does NOT put that chevron on every text input', () => {
    /*
     * `.ui-input` and `.ui-select` share one rule block, and the first cut of
     * the fix went into it — so every text box in the product grew a dropdown
     * arrow. The chevron belongs to the select's own block.
     */
    const shared = rule('.ui-input,');
    expect(shared).not.toContain('background-image');
    expect(shared).not.toContain('appearance: none');
    expect(shared).toContain('padding: 0.375rem 0.625rem');
  });

  it('has exactly one indicator, not a native one under a drawn one', () => {
    /* One block draws it; the theme override swaps the stroke, it does not
       add a second mark. */
    expect(rule('.ui-select {', SELECT_OWN)).toContain('background-image');
    expect(rule('.ui-input,')).not.toContain('background-image');
  });

  it('gives the dark theme its own stroke, guarded by the media query', () => {
    /* The stroke is baked into the data URI, so dark needs its own — and a
       bare `:root:not([data-theme='light'])` matches a LIGHT page too, since
       the default theme stamps no attribute at all. */
    expect(CSS).toContain("@media (prefers-color-scheme: dark) {\n    :root:not([data-theme='light']) .ui-select");
    expect(CSS).toContain(":root[data-theme='dark'] .ui-select");
  });
});

describe('one control height', () => {
  it('keeps the shared baseline at 36px and compact at 28px', () => {
    expect(rule('.ui-input,')).toContain('min-height: 2.25rem');
    expect(rule('.ui-btn {')).toContain('min-height: 2.25rem');
    expect(rule('.ui-btn-sm {')).toContain('height: 1.75rem');
  });

  it('carries no override that merely restates the baseline', async () => {
    /*
     * `!h-9` IS 36px, so wherever the base is already 36 it says nothing and
     * hides the fact that the height is shared.
     *
     * `.ui-icon-btn` is the exception, and not the one I first assumed: it is
     * 36px normally and 28px only inside `.ui-table tbody`, which is a second
     * rule at higher specificity further down the stylesheet. So squaring one
     * to 36 is a real decision INSIDE a table and redundant outside it — and
     * the first cut of this pass had that backwards and stripped fifteen
     * deliberate compact heights from in-field actions, where a 36px mark
     * fills a 36px input edge to edge.
     */
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir, out = []) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.jsx') && !p.includes('.test.')) out.push(p);
      }
      return out;
    };
    const offenders = [];
    /* Both halves of the tree: screens and the shared UI. */
      for (const f of [...walk('apps'), ...walk('packages')]) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/className="([^"]*!h-9[^"]*)"/g)) {
        /* Left to the table-row exception, which the stylesheet documents. */
        if (!m[1].includes('ui-icon-btn')) offenders.push(`${f}  ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a value sits where its meaning puts it', () => {
  it('names the three alignments once rather than at every call site', () => {
    for (const c of ['.ui-val-left', '.ui-val-center', '.ui-val-right']) {
      expect(CSS).toContain(c);
    }
  });

  it('gives a centred value symmetrical padding', () => {
    /* Centred inside a box whose usable width is lopsided only LOOKS centred
       by accident. */
    expect(rule('.ui-val-center {')).toContain('padding-inline: 0.625rem');
  });

  it('moves a currency symbol with its number rather than pinning it left', () => {
    /* Absolutely positioned at the start, the ₹ stays on the border while the
       digits drift to the middle, and one amount renders as two things. */
    const r = rule('.ui-money-centred {');
    expect(r).toContain('justify-content: center');
    expect(CSS).toContain('.ui-money-centred > .ui-input');
    expect(rule('.ui-money-centred > .ui-input {')).toContain('flex: 0 1 auto');
  });
});
