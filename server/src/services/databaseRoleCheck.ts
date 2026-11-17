import { prisma } from '../utils/prisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Is the role this server signs in to the database with one that row-level
 * security applies to? PostgreSQL skips every policy for a superuser and for a
 * role with BYPASSRLS, so a role that has quietly gained either turns the
 * company walls into decoration, and no query would fail to say so.
 *
 * scripts/provisionAppRole.mjs checks this when the role is made. This checks
 * it each time the server starts, because the role can be altered afterwards.
 * It reports; it does not stop the server: a customer-facing outage is the
 * wrong answer to a setting a person must correct.
 */
export type RoleState = { role: string; superuser: boolean; bypassRls: boolean };

export const roleProblem = (r: RoleState | null): string | null =>
  r && (r.superuser || r.bypassRls)
    ? `[security] The database role "${r.role}" is ${[r.superuser ? 'a superuser' : '', r.bypassRls ? 'set to BYPASSRLS' : ''].filter(Boolean).join(' and ')}: row-level security does not apply to it, so one company's rows are not walled from another's. Fix with: ALTER ROLE "${r.role}" NOSUPERUSER NOBYPASSRLS;`
    : null;

export async function readRoleState(): Promise<RoleState | null> {
  const rows = await outsideTenant('startup: the database role', () =>
    prisma.$queryRaw<Array<{ role: string; superuser: boolean; bypassRls: boolean }>>`SELECT rolname AS "role", rolsuper AS "superuser", rolbypassrls AS "bypassRls" FROM pg_roles WHERE rolname = current_user`,
  );
  return rows[0] || null;
}

/** At start, in production: say loudly when the walls are not in force. */
export async function checkDatabaseRole(log: (line: string) => void = console.error): Promise<string | null> {
  if (process.env.NODE_ENV !== 'production') return null;
  try {
    const problem = roleProblem(await readRoleState());
    if (problem) log(problem);
    return problem;
  } catch (e) {
    log(`[security] Could not read the database role's attributes: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
