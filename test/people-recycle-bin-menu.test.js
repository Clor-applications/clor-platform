import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { peopleApp } from '../apps/people/manifest.jsx';
import { PERMISSION_CATALOG } from '../server/src/constants/permissionCatalog.ts';

/*
 * The Recycle bin menu entry shows to whoever may delete some kind in the bin
 * (server/src/services/recycleBin.ts: each kind opens to its own DELETE right).
 * The list in People's manifest is read off BIN_KINDS here, so a kind added to
 * the bin without its right in the menu fails this test. The server file is
 * read as text: importing it would start Prisma.
 */
const constants = (file, name) => {
  const src = readFileSync(file, 'utf8');
  const block = src.slice(src.indexOf(`export const ${name} = {`)).split('}')[0];
  return Object.fromEntries([...block.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
};
const P = constants('server/src/services/people/guards.ts', 'PEOPLE_RESOURCE');
const A = constants('server/src/services/attendance/guards.ts', 'ATTENDANCE_RESOURCE');
const bin = readFileSync('server/src/services/recycleBin.ts', 'utf8');
const binKeys = [...new Set([...bin.matchAll(/module:\s*(PEOPLE|ATTENDANCE)_MODULE,\s*resource:\s*([PA])\.(\w+)/g)].map(([, mod, set, k]) => `${mod}::${(set === 'P' ? P : A)[k]}::DELETE`))];
const catalog = new Set(PERMISSION_CATALOG.flatMap((m) => m.resources.flatMap((r) => r.actions.map((a) => `${m.key}::${r.key}::${a}`))));

describe('Recycle bin in the People menu', () => {
  it('reads every kind in the bin', () => {
    expect(binKeys.length).toBeGreaterThan(5);
    expect(binKeys).toContain('PEOPLE::Employees::DELETE');
  });

  it('shows to exactly the delete rights a role can hold for the kinds in the bin', () => {
    const menu = peopleApp.nav.find((i) => i.key === 'recycleBin').permission;
    expect([...menu].sort()).toEqual(binKeys.filter((k) => catalog.has(k)).sort());
  });

  it('names the kinds no role can delete, so they stay an administrator’s', () => {
    /* Leave adjustments ask for Leave Requests DELETE, which the catalog does not offer: only an administrator restores them. */
    expect(binKeys.filter((k) => !catalog.has(k))).toEqual(['ATTENDANCE::Leave Requests::DELETE']);
  });
});
