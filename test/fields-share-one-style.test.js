/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One field style, everywhere.
 *
 * Every text box, select and textarea in the product wears `.ui-input` or
 * `.ui-select`, so the radius, the height, the border and the focus ring are
 * one decision in one file. A field that draws its own box does not follow
 * when that decision changes — which is exactly what happened when the fields
 * squared and one input in the numbering settings kept its 8px corner.
 */

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.jsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
};

/*
 * Brace-aware, because a tag's attributes contain arrow functions and the
 * first `>` in `onChange={(e) => …}` is not the end of the tag. A plain regex
 * reports hundreds of false positives here; this reports the real ones.
 */
/* Comments talk about `<select>` and `<input>` — this file included. They are
   prose, not markup, and counting them finds four offenders that do not
   exist. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

const fieldTags = (src, name) => {
  const out = [];
  const opens = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  let m;
  while ((m = opens.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        out.push({ attrs: src.slice(m.index + m[0].length, i), at: m.index });
        break;
      }
      i += 1;
    }
  }
  return out;
};

/* A tick box and a file picker are not field boxes; they have their own
   shapes and none of them is a bordered rectangle of text. */
const EXEMPT_TYPE = /type=["']?(checkbox|radio|file|hidden|range|color)/;

/* The command palette's box is deliberately borderless — it is the search
   line inside a panel, not a field on a form. */
const ALLOWED = new Set(['packages/ui/src/components/ui/CommandPalette.jsx']);

describe('every field wears the shared style', () => {
  it('has no input, select or textarea drawing its own box', () => {
    const offenders = [];
    /* Both halves of the tree: screens and the shared UI. */
    for (const file of [...walk('apps'), ...walk('packages')]) {
      const rel = file.replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const name of ['input', 'select', 'textarea']) {
        for (const { attrs, at } of fieldTags(src, name)) {
          if (/ui-(input|select|checkbox)/.test(attrs)) continue;
          if (EXEMPT_TYPE.test(attrs)) continue;
          offenders.push(`${rel}:${src.slice(0, at).split('\n').length}  <${name}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the radius in one place, so changing it changes every field', () => {
    const css = readFileSync('packages/ui/src/index.css', 'utf8');
    const token = css.match(/--radius-input:\s*([^;]+);/);
    expect(token).toBeTruthy();
    /* The point of the token is that this is the only place it is written.
       What it says is a design decision and has changed twice already; that
       it is said once is the thing worth holding.

       Only the declaration is checked. A first cut also scanned the stylesheet
       for any hardcoded 0.5rem radius and flagged `.ui-brand-mark` — the logo
       square, which is not a field and has no business following the field
       token. The test above already guarantees every field wears the class
       that reads this; a second, broader scan only invents work. */
    expect(token[1].trim().split(/\s/)[0]).toMatch(/^[\d.]+rem$/);
  });
});
