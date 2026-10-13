/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { csvSafeValue } from './csv';

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

/*
 * An export is a file this product hands to an accountant to open on their own
 * machine, and Excel, LibreOffice and Sheets all treat a value beginning `=`,
 * `+`, `-`, `@`, tab or carriage return as a formula. A customer saved as
 * `=cmd|'/c calc'!A1` is a name here and a command there — and the person who
 * typed it is not the person who opens the file.
 *
 * Quoting is not the fix. `"=cmd|..."` in a CSV becomes the cell value
 * `=cmd|...` once the spreadsheet strips the quotes, and it is a formula again.
 */
describe('a cell a spreadsheet will not execute', () => {
  it.each(['=cmd|\'/c calc\'!A1', '+1+1', '@SUM(A1)', '-2+3+cmd|\' /C calc\'!A0', '\tSUM(A1)', '\r=1+1'])(
    'defuses %j',
    (payload) => {
      expect(csvSafeValue(payload)).toBe(`'${payload}`);
    }
  );

  /*
   * A negative number is a credit, not an injection. Prefixing it would turn
   * every negative figure in the book into text that will not sum, which is a
   * worse bug than the one being fixed.
   */
  it.each(['-500', '-0.01', '-1e3', '+42'])('leaves the number %j alone', (n) => {
    expect(csvSafeValue(n)).toBe(n);
  });

  it('passes ordinary text through untouched', () => {
    expect(csvSafeValue('Acme Traders')).toBe('Acme Traders');
    expect(csvSafeValue('INV-2026-001')).toBe('INV-2026-001');
  });

  it('renders nothing for nothing', () => {
    expect(csvSafeValue(null)).toBe('');
    expect(csvSafeValue(undefined)).toBe('');
  });
});

const jsFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsFiles(full);
    if (!/\.(js|jsx)$/.test(name) || name.includes('.test.')) return [];
    return [full];
  });

/*
 * The guard is only worth having everywhere. This product grew seven separate
 * CSV writers — two shared utilities and five hand-rolled inside feature
 * screens — and fixing one of them would have left six exports that still run
 * whatever a customer typed into a name field.
 */
describe('every CSV writer', () => {
  it('routes its cells through the guard', () => {
    const unguarded = [];
    for (const file of jsFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      // A CSV is a row joined on a comma AND written out as a CSV. Joining on
      // a comma alone is just a query string.
      if (!/\.join\(','\)/.test(text)) continue;
      if (!/text\/csv|\.csv['"`]/.test(text)) continue;
      if (!text.includes('csvSafeValue')) unguarded.push(relative(SRC, file));
    }
    expect(unguarded).toEqual([]);
  });
});
