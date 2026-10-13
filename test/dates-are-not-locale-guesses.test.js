/**
 * @vitest-environment node
 *
 * No accounting date is rendered by asking the browser what shape a date is.
 *
 * `toLocaleDateString()` with no locale hands the decision to whatever machine
 * the page opened on. Seven screens did that, and on a US-locale browser a
 * ledger dated 2026-12-09 read as the twelfth of September — the right number
 * and the wrong day, on a document someone files a return from.
 *
 * The product's format is `dd/mm/yyyy`, produced by `formatDateIn`. A call
 * that passes an explicit locale AND options is a deliberate choice (a chart's
 * month label, a datetime beside a login) and is left alone; a bare call is
 * not a choice at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * There is no exception list. There was one — the ledger statement's PDF, CSV
 * and HTML headed themselves with a browser-shaped date — and it is empty now
 * that those are fixed, so the rule applies everywhere without a footnote.
 * Nothing goes back on it: a date a reader sees is either the product's format
 * or it is a bug.
 */

const sources = () =>
  execSync("git ls-files 'apps/**/*.js' 'packages/**/*.js' 'apps/accounting/src/**/*.jsx' 'apps/accounting/src/*.jsx'", { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('.test.'));

/** A locale-free date call: `toLocaleDateString()` with nothing passed. */
const BARE = /\.toLocaleDateString\(\s*\)/g;

const offenders = () => {
  const out = [];
  for (const file of sources()) {
    const rel = relative(root, resolve(root, file));
    const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (BARE.test(line)) out.push(`${rel}:${i + 1}`);
      BARE.lastIndex = 0;
    });
  }
  return out;
};

describe('accounting dates', () => {
  it('are never left to the browser locale', () => {
    expect(offenders()).toEqual([]);
  });

  it('has files to check, so an empty search cannot pass it', () => {
    expect(sources().length).toBeGreaterThan(100);
  });
});
