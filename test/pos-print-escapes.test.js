/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The counter's receipt and Z report are written with document.write into a
 * pop-up on the app's own origin. Anything a user typed — the company name,
 * the customer, an item's description — lands there as markup unless it is
 * escaped, and an item named `<img src=x onerror=…>` would run script in the
 * cashier's session. The other print pop-ups escaped; these two did not.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'apps/accounting/src/features/sales/PosScreen.jsx'), 'utf8');

/** The template text handed to each document.write in the file. */
const writes = () => {
  const out = [];
  let at = source.indexOf('document.write(');
  while (at !== -1) {
    let depth = 0;
    let end = at + 'document.write'.length;
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')' && --depth === 0) break;
    }
    out.push(source.slice(at, end));
    at = source.indexOf('document.write(', end);
  }
  return out;
};

describe('point of sale print pop-ups', () => {
  it('writes both the receipt and the Z report', () => {
    expect(writes()).toHaveLength(2);
  });

  it('escapes every typed value before writing it', () => {
    for (const text of writes()) {
      for (const raw of ['${currentCompany.name}', '${buyer}', '${l.description}', '${tenderLabel(tender)}', '${number}']) {
        expect(text, `${raw} written unescaped`).not.toContain(raw);
      }
      expect(text).toContain('escapeHtml(currentCompany.name)');
    }
  });
});
