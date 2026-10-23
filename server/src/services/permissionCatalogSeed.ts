import { platformPrisma } from '../utils/platformPrisma.js';
import { flattenCatalog, permKey } from '../constants/permissionCatalog.js';

/**
 * The permission catalogue in the database, created or topped up from constants/permissionCatalog.ts. Moved out of routes/permissions.ts so defaultRoles (a service) does not import a route; behaviour unchanged.
 */
/** Ensure a Permission row exists for every catalog entry. Idempotent. */
export async function ensurePermissionCatalog() {
  const existing = await platformPrisma.permission.findMany({
    select: { id: true, module: true, subModule: true, action: true },
  });
  const seen = new Set(existing.map((p) => permKey(p.module, p.subModule, p.action)));

  const missing = flattenCatalog().filter((r) => !seen.has(permKey(r.module, r.subModule, r.action)));
  for (const m of missing) {
    try {
      await platformPrisma.permission.create({ data: { module: m.module, subModule: m.subModule, action: m.action } });
    } catch (err: any) {
      // Unique constraint: another request seeded it first.
      if (String(err?.code || '') !== 'P2002') throw err;
    }
  }
  return missing.length;
}
