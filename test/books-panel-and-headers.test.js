import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (p) => readFileSync(resolve(cwd(), p), 'utf8');

describe("Books' screens panel wears the rail's emoji family (owner, 16 Nov 2026)", () => {
  const app = read('apps/accounting/src/App.jsx');
  const map = read('apps/accounting/src/navPanelEmoji.js');
  const mapped = new Set([...map.matchAll(/^\s+(\w+): emoji\('/gm)].map((m) => m[1]));

  it('gives every screen in a rail group its own emoji', () => {
    // Items inside a group carry `key: '…', label: '…'` without `type: 'item'`.
    const keys = [...app.matchAll(/\{ key: '(\w+)', label: '[^']*', icon:/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.filter((key) => !mapped.has(key))).toEqual([]);
  });

  it('gives every Settings screen an emoji', () => {
    const registry = read('apps/accounting/src/features/settings/settingsRegistry.js');
    const keys = [...registry.matchAll(/\{ key: '(\w+)',[^\n]*category: '(?!platform)\w+'/g)].map((m) => m[1]);
    expect(keys.filter((key) => key !== 'gstRates' && !mapped.has(key))).toEqual([]);
  });

  it('draws panel icons through panelIcon', () => {
    expect(app).toContain('const ItemIcon = panelIcon(item);');
  });
});

describe('every list header row is the Invoices pale blue-grey (owner, 16 Nov 2026)', () => {
  it('defines the token once, as #EAF2F8', () => {
    expect(read('packages/ui/src/index.css')).toContain('--list-head: 234 242 248;');
  });

  it('paints Books, the other apps, Workspace and Ops header rows with it', () => {
    const index = read('packages/ui/src/index.css');
    expect(index).toMatch(/\.ui-table-sticky thead th \{[^}]*rgb\(var\(--list-head\)\)/);
    expect(index).toContain('.ui-table thead th { background-color: rgb(var(--list-head)); }');
    expect(read('packages/ui/src/rnd.css')).toMatch(/\.ui-table thead th \{[^}]*rgb\(var\(--list-head\)\)/);
    expect(read('apps/admin/src/screens/workspace.css')).toMatch(/\.ws-table thead th \{[^}]*var\(--list-head/);
    expect(read('packages/ops/ops.css')).toMatch(/\.ws-table th \{[^}]*var\(--list-head/);
  });
});
