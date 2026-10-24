import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction, RoleType } from '../constants/enums.js';
import { isKnownPermission, permKey, roleGroup } from '../constants/permissionCatalog.js';
import { ROLE_DELETED_PREFIX, ensureDefaultRoles } from '../services/defaultRoles.js';
import { ensurePermissionCatalog } from '../services/permissionCatalogSeed.js';
import { resolveRoleIds } from '../services/access.js';
import {
  ADMIN_ONLY_ERROR,
  grantAuthority,
  OWN_ACCESS_ERROR,
  ANTI_LOCKOUT_KEYS,
  LAST_ADMIN_ERROR,
  cannotGrantError,
  LastAdminError,
  assertAnAdminRemains,
  rolePermissionKeys,
  unheldGrants,
} from '../services/roleGuards.js';

export const rolesRouter = Router();
rolesRouter.use(requireAuth, requireTenantContext);

const ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT'] as const;

const permissionObject = z.object({
  module: z.string().min(1),
  subModule: z.string().optional().nullable(),
  action: z.enum(ACTIONS),
  allowed: z.boolean().default(true),
});

/**
 * Accept both shapes: the object form above, and the catalog's string keys
 * ("MODULE::Resource::ACTION") that the Role form and the Role Permission
 * matrix hold natively. The UI sent strings and this schema rejected every
 * create with "Expected object, received string" — no custom role could be
 * made at all.
 */
const permissionInput = z.union([
  permissionObject,
  z
    .string()
    .regex(/^[^:]+::[^:]+::(VIEW|CREATE|EDIT|DELETE|APPROVE|EXPORT)$/)
    .transform((key) => {
      const [module, subModule, action] = key.split('::');
      return {
        module,
        subModule: subModule === '*' ? null : subModule,
        action: action as (typeof ACTIONS)[number],
        allowed: true,
      };
    }),
]);

const roleSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional().nullable(),
  roleType: z.enum(['ADMIN', 'ACCOUNTANT', 'SALES', 'CUSTOM']).default('CUSTOM'),
  // optional branch-scoped role
  branchId: z.string().optional().nullable(),
  // Reads limited to documents the holder created (Odoo "Own Documents Only").
  ownDocumentsOnly: z.boolean().optional(),
  permissions: z.array(permissionInput).default([]),
});

type GrantInput = z.infer<typeof permissionInput>;

/**
 * The permission keys a request asks a role to hold.
 *
 * Only catalogued permissions are accepted, the same rule the matrix endpoint
 * applies: a role must not hold a permission no route checks, and this must
 * not be a way to smuggle in new keys. `allowed: false` entries grant nothing
 * and are dropped rather than stored.
 */
function wantedKeys(grants: GrantInput[]): { keys: Set<string>; unknown: string[] } {
  const keys = new Set<string>();
  const unknown: string[] = [];
  for (const g of grants) {
    if (!g.allowed) continue;
    const module = g.module.trim();
    const subModule = g.subModule ? g.subModule.trim() : null;
    const key = permKey(module, subModule, g.action);
    if (!isKnownPermission(module, subModule, g.action)) {
      unknown.push(key);
      continue;
    }
    keys.add(key);
  }
  return { keys, unknown };
}

/** Permission ids by wire key, after making sure every catalogue row exists. */
async function permissionIdsByKey() {
  await ensurePermissionCatalog();
  const rows = await platformPrisma.permission.findMany({ select: { id: true, module: true, subModule: true, action: true } });
  return new Map(rows.map((p) => [permKey(p.module, p.subModule, p.action), p.id]));
}

const roleWithPermissions = (roleId: string) =>
  platformPrisma.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });

async function branchBelongsToOrg(accountId: string, orgId: string, branchId: string) {
  const branch = await platformPrisma.branch.findFirst({ where: { id: branchId, accountId, orgId }, select: { id: true } });
  return Boolean(branch);
}

rolesRouter.get('/orgs/:orgId/roles', requirePermission('SETTINGS', PermissionAction.VIEW, 'Roles'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  // First visit to any screen that lists roles materialises the standard set,
  // so the user-create dropdown is never just "Owner". Failure to seed must
  // not break listing what already exists.
  try {
    await ensureDefaultRoles(accountId, orgId, req.auth!.userId);
  } catch {
    /* listing continues with whatever roles exist */
  }

  const roles = await platformPrisma.role.findMany({
    where: { accountId, orgId },
    include: {
      permissions: { include: { permission: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  const roleIds = roles.map((r) => r.id);
  const assignmentCounts = roleIds.length
    ? await platformPrisma.userRoleAssignment.groupBy({
        by: ['roleId'],
        where: { accountId, orgId, roleId: { in: roleIds } },
        _count: { roleId: true },
      })
    : [];
  const countByRoleId = new Map<string, number>();
  for (const row of assignmentCounts) {
    countByRoleId.set(row.roleId, row._count.roleId);
  }

  const rolesWithCounts = roles.map((r) => ({
    ...r,
    assignedUsersCount: countByRoleId.get(r.id) || 0,
    group: roleGroup(r),
  }));

  res.json({ roles: rolesWithCounts });
});

rolesRouter.post('/orgs/:orgId/roles', requirePermission('SETTINGS', PermissionAction.CREATE, 'Roles'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const createdByUserId = req.auth!.userId;
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = roleSchema.parse(req.body);

  // A role reaches whoever holds it, wherever they work: bounded by what the caller holds company-wide (A-19).
  const { authority, refusal } = await grantAuthority(req, null, permKey('SETTINGS', 'Roles', 'CREATE'));
  if (refusal) return res.status(refusal.status).json(refusal.body);

  if (body.roleType === RoleType.ADMIN && !authority.isAdmin) return res.status(403).json(ADMIN_ONLY_ERROR);

  const { keys, unknown } = wantedKeys(body.permissions);
  if (unknown.length) return res.status(400).json({ error: `Unknown permission: ${unknown[0]}`, permissions: unknown });

  const missing = unheldGrants(authority, keys);
  if (missing.length) return res.status(403).json(cannotGrantError(missing));

  if (body.branchId && !(await branchBelongsToOrg(accountId, orgId, body.branchId))) {
    return res.status(400).json({ error: 'Branch does not belong to this organisation' });
  }

  const idByKey = keys.size ? await permissionIdsByKey() : new Map<string, string>();

  const role = await platformPrisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        accountId,
        orgId,
        branchId: body.branchId ?? null,
        name: body.name,
        description: body.description ?? null,
        roleType: body.roleType,
        ownDocumentsOnly: Boolean(body.ownDocumentsOnly),
        createdByUserId,
      },
      select: { id: true },
    });
    for (const key of keys) {
      const permissionId = idByKey.get(key);
      if (!permissionId) continue;
      await tx.rolePermission.create({
        data: { accountId, orgId, roleId: created.id, permissionId, allowed: true },
      });
    }
    return created;
  });

  const full = await roleWithPermissions(role.id);
  res.status(201).json({ role: full });
});

rolesRouter.patch('/orgs/:orgId/roles/:roleId', requirePermission('SETTINGS', PermissionAction.EDIT, 'Roles'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const roleId = String(req.params.roleId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = roleSchema.partial().parse(req.body);

  const role = await platformPrisma.role.findFirst({ where: { id: roleId, accountId, orgId } });
  if (!role) return res.status(404).json({ error: 'Role not found' });

  // An Administrator role, and anything becoming one, is administered only by
  // an administrator.
  const { authority, refusal } = await grantAuthority(req, null, permKey('SETTINGS', 'Roles', 'EDIT'));
  if (refusal) return res.status(refusal.status).json(refusal.body);
  const becomesAdmin = body.roleType === RoleType.ADMIN;
  if ((role.roleType === RoleType.ADMIN || becomesAdmin) && !authority.isAdmin) {
    return res.status(403).json(ADMIN_ONLY_ERROR);
  }

  // Lifting "own documents only" from a role you hold is widening your own access (A-20).
  if (
    !authority.isAdmin &&
    typeof body.ownDocumentsOnly === 'boolean' &&
    body.ownDocumentsOnly !== role.ownDocumentsOnly &&
    (await resolveRoleIds(accountId, orgId, req.auth!.userId)).includes(role.id)
  ) {
    return res.status(403).json(OWN_ACCESS_ERROR);
  }

  const nextType = body.roleType ?? role.roleType;
  const isAdminRole = nextType === RoleType.ADMIN;


  if (body.branchId && !(await branchBelongsToOrg(accountId, orgId, body.branchId))) {
    return res.status(400).json({ error: 'Branch does not belong to this organisation' });
  }

  let keys: Set<string> | null = null;
  if ('permissions' in body && body.permissions) {
    const held = await rolePermissionKeys(role.id);
    const wanted = wantedKeys(body.permissions);
    /*
     * A key the role already holds but the catalogue no longer knows is
     * dropped, not refused. The Roles screen used to offer nine such keys;
     * roles saved then carry them, and refusing them would make those roles
     * impossible to edit at all. A key the role does not hold yet is still
     * refused — that is somebody trying to grant something that is not real.
     */
    const newlyUnknown = wanted.unknown.filter((k) => !held.has(k));
    if (newlyUnknown.length) {
      return res.status(400).json({ error: `Unknown permission: ${newlyUnknown[0]}`, permissions: newlyUnknown });
    }
    keys = wanted.keys;

    // Only permissions newly added need to be held by the grantor; a role may
    // always be trimmed.
    const added = [...keys].filter((k) => !held.has(k));
    const missing = unheldGrants(authority, added);
    if (missing.length) return res.status(403).json(cannotGrantError(missing));
  }

  if (isAdminRole) {
    const effective = keys ?? (await rolePermissionKeys(role.id));
    const lost = ANTI_LOCKOUT_KEYS.filter((k) => !effective.has(k));
    if (lost.length) {
      return res.status(400).json({
        error: 'An Administrator role must keep the permissions to manage users and roles',
        code: 'admin_lockout',
        permissions: lost,
      });
    }
  }

  const idByKey = keys && keys.size ? await permissionIdsByKey() : new Map<string, string>();

  try {
    await platformPrisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...('name' in body ? { name: body.name } : {}),
          ...('description' in body ? { description: body.description ?? null } : {}),
          ...('roleType' in body ? { roleType: body.roleType } : {}),
          ...('branchId' in body ? { branchId: body.branchId ?? null } : {}),
          ...(typeof body.ownDocumentsOnly === 'boolean' ? { ownDocumentsOnly: body.ownDocumentsOnly } : {}),
        },
      });

      // Demoting an Administrator role takes administration from everybody who
      // held it, directly or through a profile.
      if (role.roleType === RoleType.ADMIN && !isAdminRole) await assertAnAdminRemains(tx, accountId, orgId);

      if (!keys) return;

      /*
       * Replace the set by diffing it. Clearing and re-inserting lost the field
       * level on every permission the role kept, so a role edited on the Roles
       * screen silently dropped back to level 0 everywhere the matrix had raised
       * it.
       */
      const wantedIds = new Set([...keys].map((k) => idByKey.get(k)).filter(Boolean) as string[]);
      const current = await tx.rolePermission.findMany({
        where: { roleId },
        select: { id: true, permissionId: true, allowed: true },
      });
      const currentByPermId = new Map(current.map((c) => [c.permissionId, c]));

      for (const permissionId of wantedIds) {
        const existing = currentByPermId.get(permissionId);
        if (!existing) {
          await tx.rolePermission.create({ data: { accountId, orgId, roleId, permissionId, allowed: true } });
        } else if (!existing.allowed) {
          await tx.rolePermission.update({ where: { id: existing.id }, data: { allowed: true } });
        }
      }
      const toRemove = current.filter((c) => !wantedIds.has(c.permissionId)).map((c) => c.id);
      if (toRemove.length) await tx.rolePermission.deleteMany({ where: { id: { in: toRemove } } });
    });
  } catch (err) {
    if (err instanceof LastAdminError) return res.status(409).json(LAST_ADMIN_ERROR);
    throw err;
  }

  const full = await roleWithPermissions(roleId);
  res.json({ role: full });
});

/**
 * Deleting a role.
 *
 * The Roles screen has offered this since it was written; the server never
 * answered it, so every attempt ended in a 404 dressed up as "Failed to
 * delete role". A role still assigned to somebody, or named as the approver
 * in an approval rule, is refused rather than silently unassigned: removing
 * access should be a decision made on the user, not a side effect of tidying
 * the role list.
 */
rolesRouter.delete('/orgs/:orgId/roles/:roleId', requirePermission('SETTINGS', PermissionAction.DELETE, 'Roles'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const roleId = String(req.params.roleId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const role = await platformPrisma.role.findFirst({ where: { id: roleId, accountId, orgId }, select: { id: true, name: true, roleType: true } });
  if (!role) return res.status(404).json({ error: 'Role not found' });

  const { authority, refusal } = await grantAuthority(req, null, permKey('SETTINGS', 'Roles', 'DELETE'));
  if (refusal) return res.status(refusal.status).json(refusal.body);
  if (role.roleType === RoleType.ADMIN && !authority.isAdmin) return res.status(403).json(ADMIN_ONLY_ERROR);

  const assigned = await platformPrisma.userRoleAssignment.count({ where: { roleId: role.id } });
  if (assigned > 0) {
    return res.status(409).json({
      error: `Role is assigned to ${assigned} user${assigned === 1 ? '' : 's'}; reassign them first`,
      code: 'role_in_use',
      assignedUsersCount: assigned,
    });
  }

  const approvals = await prisma.approvalRule.count({ where: { accountId, orgId, approverRoleId: role.id } });
  if (approvals > 0) {
    return res.status(409).json({
      error: `Role is the approver in ${approvals} approval rule${approvals === 1 ? '' : 's'}; change them first`,
      code: 'role_in_use',
      approvalRulesCount: approvals,
    });
  }

  try {
    await platformPrisma.$transaction(async (tx) => {
      // RoleProfileRole has no relation to Role, so it does not cascade.
      await tx.roleProfileRole.deleteMany({ where: { accountId, orgId, roleId: role.id } });
      await tx.role.delete({ where: { id: role.id } });
      // Nobody holds it directly, but a profile may — and its holders would
      // lose administration with it.
      if (role.roleType === RoleType.ADMIN) await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err) {
    if (err instanceof LastAdminError) return res.status(409).json(LAST_ADMIN_ERROR);
    throw err;
  }

  /* Written by name here; the general recorder (auditMutations) leaves it. */

  if (req.res) req.res.locals.audited = true;

  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId,
      branchId: req.tenant!.branchId,
      entity: 'Role',
      entityId: role.id,
      action: 'DELETE',
      // ensureDefaultRoles reads this back so a deleted preset is not re-seeded.
      message: `${ROLE_DELETED_PREFIX}${role.name}`,
      createdByUserId: req.auth!.userId,
    },
  });

  res.json({ ok: true });
});
