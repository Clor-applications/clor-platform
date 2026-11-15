import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS } from '../packages/shell/registry';

/**
 * One icon family (frontend-redesign-2026-11-15.md §7 and §17 check 10): Lucide only. The Fluent line set, the
 * Phosphor two-tone marks and the Fluent colour icons were retired on 15 Nov 2026; this keeps them out. The
 * marketing site (website/) is a separate build and is not covered.
 */
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(path);
  }
};
walk('apps');
walk('packages');

describe('one icon family', () => {
  it('no app or package imports a retired icon set', () => {
    const offenders = files.filter((f) => /from ['"](@fluentui\/react-icons|@phosphor-icons\/react)['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no manifest asks for a second icon set', () => {
    expect(APPS.filter((a) => a.iconSet || a.lineIcons).map((a) => a.id)).toEqual([]);
  });

  it('the stroke comes from one rule, not from call sites', () => {
    expect(readFileSync('packages/ui/src/index.css', 'utf8')).toMatch(/svg\.lucide \{ stroke-width: 1\.75;/);
  });
});
