/**
 * Tops up every org creator's Owner role to the full permission catalogue.
 *
 * Authorisation used to repair itself: when a creator hit a permission their
 * Owner role did not carry, `requirePermission` created the permission, granted
 * it, assigned the role and let the request through. A denied request therefore
 * rewrote security configuration — the thing an audit trail exists to make
 * impossible, happening inside the authorisation check itself. It also made
 * effective access depend on which endpoints somebody happened to visit first.
 *
 * New orgs have been seeded with the whole catalogue at setup for a while, so
 * this is for the ones created before that. Run once, then request-time RBAC is
 * read-only.
 *
 *   npx tsx scripts/backfillOwnerPermissions.ts          # report only
 *   npx tsx scripts/backfillOwnerPermissions.ts --fix    # grant what is missing
 */
import { flattenCatalog } from '../src/constants/permissionCatalog.js';
import { adminUserIds } from '../src/services/roleGuards.js';

import { ownerClient } from './ownerDb.js';

/*
 * As the owner, because row-level security applies to the application role and
 * this script belongs to no company. Run as the application it found no orgs
 * at all and printed "nothing to do" — the same line it prints when everything
 * is in order. See ownerDb.ts.
 */
const prisma = ownerClient();
const FIX = process.argv.includes('--fix');

async function main() {
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
        console.log(`${org.name}: no administrator; restoring the creator as Owner`);
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
      held.map((h) => `${h.permission.module}::${h.permission.subModule || ''}::${h.permission.action}`)
    );

    const missing = catalog.filter(
      (p) => !have.has(`${p.module}::${p.subModule || ''}::${p.action}`)
    );
    if (!missing.length) continue;

    missingTotal += missing.length;
    console.log(`${org.name}: ${missing.length} permission(s) missing from Owner`);

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

  if (repaired) console.log(`Restored an administrator in ${repaired} org(s).`);
  if (!missingTotal) {
    console.log('Every Owner role already carries the full catalogue. Nothing to do.');
  } else if (FIX) {
    console.log(`\nTopped up ${toppedUp} org(s), ${missingTotal} permission(s) granted.`);
  } else {
    console.log(`\n${missingTotal} permission(s) missing across ${orgs.length} org(s). Re-run with --fix to grant them.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Backfill failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
