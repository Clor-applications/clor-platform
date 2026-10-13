import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERMISSION_CATALOG } from '../constants/permissionCatalog.js';

const ROUTES = join(dirname(dirname(fileURLToPath(import.meta.url))), 'routes');

/*
 * Every resource a route guards must exist in the catalogue.
 *
 * Authorisation used to repair itself: when a permission was missing,
 * `requirePermission` created it, granted it to the org creator's Owner role
 * and let the request through. That hid this entirely — routes guarded
 * resources that were in no catalogue, nobody could be granted them
 * deliberately, and they came into existence the first time an owner happened
 * to hit the endpoint.
 *
 * Removing that fallback exposed four: Sales Orders, Delivery Challans, the six
 * reference masters and the audit trail. This keeps the fifth from arriving
 * unnoticed — a resource that is not here cannot be granted to anyone but an
 * owner, which is a permission system with a hole in it.
 */
const catalogued = new Set(
  PERMISSION_CATALOG.flatMap((m) => m.resources.map((r) => `${m.key}::${r.key}`))
);

/*
 * And the action, not only the resource.
 *
 * A route guarding SETTINGS::Company Profile::EXPORT passed the resource check
 * and could never be granted to anybody: Company Profile carries VIEW and EDIT
 * and no EXPORT, so the permission it asked for did not exist. Checking that
 * the resource is listed says nothing about whether the action is.
 */
const cataloguedActions = new Set(
  PERMISSION_CATALOG.flatMap((m) =>
    m.resources.flatMap((r) => r.actions.map((a) => `${m.key}::${r.key}::${a}`))
  )
);

const actionsUsed = new Map<string, string>();

const guardsInRoutes = () => {
  const found = new Map<string, string>();
  actionsUsed.clear();
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(ROUTES, file), 'utf8');

    // The direct form: requirePermission('MODULE', PermissionAction.X, 'Resource')
    const direct = /requirePermission\(\s*'([A-Z_]+)'\s*,\s*PermissionAction\.(\w+)\s*,\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = direct.exec(text))) {
      found.set(`${m[1]}::${m[3]}`, file);
      actionsUsed.set(`${m[1]}::${m[3]}::${m[2]}`, file);
    }

    /*
     * And the config form. quoteDocs.ts guards five document types from a table
     * of `{ module, resource }` objects rather than five literal calls, so a
     * scan that only reads the direct form declares those five covered without
     * ever looking at them — which is exactly what it did until removing a
     * catalogue entry failed to fail this test.
     */
    const config = /module:\s*'([A-Z_]+)'[\s\S]{0,200}?resource:\s*'([^']+)'/g;
    while ((m = config.exec(text))) found.set(`${m[1]}::${m[2]}`, file);
  }
  return found;
};

describe('the permission catalogue', () => {
  it('covers every resource the routes guard', () => {
    const missing: string[] = [];
    for (const [key, file] of guardsInRoutes()) {
      if (!catalogued.has(key)) missing.push(`${key}  (${file})`);
    }
    expect(missing).toEqual([]);
  });

  it('covers the action each route asks for, not only the resource', () => {
    guardsInRoutes();
    const missing: string[] = [];
    for (const [key, file] of actionsUsed) {
      if (!cataloguedActions.has(key)) missing.push(`${key}  (${file})`);
    }
    expect(missing).toEqual([]);
  });

  it('finds the guards at all, so an empty pass cannot look like a pass', () => {
    expect(guardsInRoutes().size).toBeGreaterThan(10);
    expect(actionsUsed.size).toBeGreaterThan(10);
  });
});
