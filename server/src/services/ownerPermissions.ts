import { flattenCatalog } from '../constants/permissionCatalog.js';
import { adminUserIds } from './roleGuards.js';
import { ensurePermissionCatalog } from './permissionCatalogSeed.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { exclusive, leaseFor } from './jobLease.js';

/**
 * Every company's Owner role carries the whole permission catalogue, and a
 * company with no administrator gets its creator back as Owner.
 *
 * The catalogue grows with each release, and the seed at company creation runs
 * once, so existing Owners fall short of every permission added later — a new
 * screen answers 403 to the person who owns the company. This ran from
 * deploy.sh (scripts/backfillOwnerPermissions.ts), which Cloud Run deploys never
 * call, and the script had been pointed at the accounting database since the
 * platform tables moved out, so it could not run anywhere. Now it is a service:
 * the API runs it once per deploy at boot (under a lease), and the script stays
 * for an operator who wants the report.
 */

export async function syncOwnerPermissions(prisma: any, opts: { fix?: boolean; log?: (line: string) => void } = {}) {
  const FIX = !!opts.fix;
  const log = opts.log ?? ((line: string) => console.log(line));
  const orgs = await prisma.org.findMany({ select: { id: true, accountId: true, name: true, createdByUserId: true } });
  const catalog = flattenCatalog();

  let toppedUp = 0;
  let missingTotal = 0;
  let repaired = 0;

  for (const org of orgs) {
    /*
     * A company nobody administers gets its creator back as Owner.
     *
     * Request-time RBAC used to do this whenever the creator had no roles,
     * which also undid a deliberate hand-over. Here it happens only when the
     * company has no administrator at all — direct or through a profile — and
     * the creator is still a member who can sign in.
     */
    if ((await adminUserIds(prisma, org.accountId, org.id)).size === 0) {
      const member = await prisma.userOrgMembership.findFirst({
        where: { accountId: org.accountId, orgId: org.id, userId: org.createdByUserId, user: { isActive: true } },
        select: { id: true },
      });
      if (member) {
        log(`${org.name}: no administrator; restoring the creator as Owner`);
        if (FIX) {
          const role =
            (await prisma.role.findFirst({
              where: { accountId: org.accountId, orgId: org.id, branchId: null, name: 'Owner' },
              select: { id: true },
            })) ||
            (await prisma.role.create({
              data: {
                accountId: org.accountId,
                orgId: org.id,
                branchId: null,
                name: 'Owner',
                description: 'Full access. Created automatically for the account owner.',
                roleType: 'ADMIN',
                createdByUserId: org.createdByUserId,
              },
              select: { id: true },
            }));
          await prisma.role.update({ where: { id: role.id }, data: { roleType: 'ADMIN' } });
          try {
            await prisma.userRoleAssignment.create({
              data: {
                accountId: org.accountId,
                orgId: org.id,
                branchId: null,
                userId: org.createdByUserId,
                roleId: role.id,
                createdByUserId: org.createdByUserId,
              },
            });
          } catch (e: any) {
            if (String(e?.code) !== 'P2002') throw e;
          }
          repaired += 1;
        }
      }
    }

    const owner = await prisma.role.findFirst({
      where: { accountId: org.accountId, orgId: org.id, branchId: null, name: 'Owner' },
      select: { id: true },
    });
    if (!owner) continue;

    const held = await prisma.rolePermission.findMany({
      where: { accountId: org.accountId, orgId: org.id, roleId: owner.id },
      select: { permission: { select: { module: true, subModule: true, action: true } } },
    });
    const have = new Set(
      held.map((h: any) => `${h.permission.module}::${h.permission.subModule || ''}::${h.permission.action}`)
    );

    const missing = catalog.filter(
      (p) => !have.has(`${p.module}::${p.subModule || ''}::${p.action}`)
    );
    if (!missing.length) continue;

    missingTotal += missing.length;
    log(`${org.name}: ${missing.length} permission(s) missing from Owner`);

    if (!FIX) continue;

    for (const p of missing) {
      const permission =
        (await prisma.permission.findFirst({
          where: { module: p.module, subModule: p.subModule, action: p.action },
          select: { id: true },
        })) ||
        (await prisma.permission.create({
          data: { module: p.module, subModule: p.subModule, action: p.action },
          select: { id: true },
        }));

      try {
        await prisma.rolePermission.create({
          data: { accountId: org.accountId, orgId: org.id, roleId: owner.id, permissionId: permission.id, allowed: true },
        });
      } catch (e: any) {
        // Already granted by a concurrent run; nothing to do.
        if (String(e?.code) !== 'P2002') throw e;
      }
    }
    toppedUp += 1;
  }

  if (repaired) log(`Restored an administrator in ${repaired} org(s).`);
  if (!missingTotal) {
    log('Every Owner role already carries the full catalogue. Nothing to do.');
  } else if (FIX) {
    log(`\nTopped up ${toppedUp} org(s), ${missingTotal} permission(s) granted.`);
  } else {
    log(`\n${missingTotal} permission(s) missing across ${orgs.length} org(s). Re-run with --fix to grant them.`);
  }

  return { orgs: orgs.length, missing: missingTotal, toppedUp, repaired };
}

/** Once per deploy (per six hours, across instances), a minute after boot. */
export function startOwnerPermissionSync({ delayMs = 60_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const t = setTimeout(() => {
    exclusive('permissions.owner-sync', leaseFor(6 * 3_600_000), () =>
      outsideTenant('owner permissions: every company', async () => {
        await ensurePermissionCatalog();
        const r = await syncOwnerPermissions(platformPrisma, { fix: true, log: (l) => console.log(`[permissions] ${l}`) });
        console.log('[permissions] owner sync:', JSON.stringify(r));
      }), { idempotent: true }
    ).catch((e) => console.error('[permissions] owner sync failed:', e instanceof Error ? e.message : e));
  }, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
