import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS } from '../packages/shell/registry';

/**
 * Two icon roles (owner, 15 Nov 2026): navigation (rails, panels, Settings rows, the command palette) draws in
 * Fluent Emoji flat from @ui/components/ui/navEmoji; small controls and in-page actions stay Lucide line icons,
 * which an emoji set has no glyphs for. App identity marks on their colour tiles stay Lucide. The Fluent line
 * set, Phosphor two-tone marks and Fluent Color icons stay retired. The marketing site (website/) is not covered.
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

  it('every app navigates in Fluent Emoji: manifest nav icons come from navEmoji', () => {
    for (const a of APPS) {
      for (const i of a.nav || []) if (i.icon) expect(i.icon.displayName, `${a.id}:${i.label}`).toMatch(/^Emoji\(/);
      expect(a.icon?.displayName || '', `${a.id} identity mark`).not.toMatch(/^Emoji\(/);
    }
  });

  it('the emoji data holds exactly the names in use, from the local package (no runtime fetch)', () => {
    const used = new Set();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bemoji\('([a-z0-9-]+)'\)/g)) used.add(m[1]);
    const data = readFileSync('packages/ui/src/components/ui/fluentEmoji.data.js', 'utf8');
    const stored = [...data.matchAll(/^ "([a-z0-9-]+)":/gm)].map((m) => m[1]);
    expect(stored.sort()).toEqual([...used].sort());
    expect(data).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
