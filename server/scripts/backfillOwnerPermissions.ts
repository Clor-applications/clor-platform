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
import { syncOwnerPermissions } from '../src/services/ownerPermissions.js';
import { platformOwnerClient } from './ownerDb.js';

/*
 * As the owner, because row-level security applies to the application role and
 * this script belongs to no company. Companies, roles and grants live in the
 * platform database. The API does the same at boot (services/ownerPermissions.ts).
 */
const prisma = platformOwnerClient();
const FIX = process.argv.includes('--fix');

syncOwnerPermissions(prisma, { fix: FIX })
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill failed:', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
