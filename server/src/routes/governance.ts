import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveAccess } from '../services/access.js';
import { RoleType } from '../constants/enums.js';
import { ADMIN_ONLY_ERROR, cannotGrantError, rolePermissionKeys, unheldGrants } from '../services/roleGuards.js';
import { PermissionAction } from '../constants/enums.js';
import { ApprovalError, decide, notifyDecision } from '../services/approvals.js';
import { ensureLedgerSetup, invoicePostingLines, postEntry } from '../services/ledger.js';

/**
 * Administration surfaces layered on top of roles: role profiles, approval
 * thresholds, and document-level user permissions.
 */
export const governanceRouter = Router();
governanceRouter.use(requireAuth, requireTenantContext);

const ROLES_VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Roles');
const ROLES_EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Roles');
const USERS_VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Users');
const USERS_EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Users');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Role profiles
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional().nullable(),
  roleIds: z.array(z.string()).default([]),
});

governanceRouter.get('/orgs/:orgId/role-profiles', ROLES_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  const profiles = await platformPrisma.roleProfile.findMany({
    where: { accountId, orgId },
    orderBy: { name: 'asc' },
    include: { roles: { select: { roleId: true } }, _count: { select: { assignments: true } } },
  });

  const roleIds = Array.from(new Set(profiles.flatMap((p) => p.roles.map((r) => r.roleId))));
  const roles = roleIds.length
    ? await platformPrisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleById = new Map(roles.map((r) => [r.id, r]));

  res.json({
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      assignedUsers: p._count.assignments,
      roles: p.roles.map((r) => roleById.get(r.roleId) || { id: r.roleId, name: '(deleted role)' }),
    })),
  });
});

governanceRouter.post('/orgs/:orgId/role-profiles', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = profileSchema.parse(req.body);

  const owned = await platformPrisma.role.findMany({
    where: { id: { in: body.roleIds }, accountId, orgId },
    select: { id: true },
  });
  if (owned.length !== body.roleIds.length) {
    return res.status(400).json({ error: 'One or more roles do not belong to this organisation' });
  }

  const profile = await platformPrisma.roleProfile.create({
    data: {
      accountId,
      orgId,
      name: body.name.trim(),
      description: body.description ?? null,
      createdByUserId: req.auth!.userId,
      roles: { create: owned.map((r) => ({ accountId, orgId, roleId: r.id })) },
    },
    include: { roles: true },
  });

  res.status(201).json({ profile });
});

governanceRouter.put('/orgs/:orgId/role-profiles/:profileId', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const profileId = String(req.params.profileId);
  const body = profileSchema.parse(req.body);

  const existing = await platformPrisma.roleProfile.findFirst({ where: { id: profileId, accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Role profile not found' });

  const owned = await platformPrisma.role.findMany({
    where: { id: { in: body.roleIds }, accountId, orgId },
    select: { id: true },
  });
  if (owned.length !== body.roleIds.length) {
    return res.status(400).json({ error: 'One or more roles do not belong to this organisation' });
  }

  await platformPrisma.$transaction(async (tx) => {
    await tx.roleProfile.update({
      where: { id: profileId },
      data: { name: body.name.trim(), description: body.description ?? null },
    });
    await tx.roleProfileRole.deleteMany({ where: { profileId } });
    for (const r of owned) {
      await tx.roleProfileRole.create({ data: { accountId, orgId, profileId, roleId: r.id } });
    }
  });

  res.json({ ok: true });
});

governanceRouter.delete('/orgs/:orgId/role-profiles/:profileId', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await platformPrisma.roleProfile.findFirst({
    where: { id: String(req.params.profileId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Role profile not found' });

  await platformPrisma.roleProfile.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

const assignProfileSchema = z.object({ profileIds: z.array(z.string()).default([]) });

governanceRouter.post('/orgs/:orgId/users/:userId/role-profiles', USERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const userId = String(req.params.userId);
  const body = assignProfileSchema.parse(req.body);

  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'User not found in org' });

  const owned = await platformPrisma.roleProfile.findMany({
    where: { id: { in: body.profileIds }, accountId, orgId },
    select: { id: true },
  });
  if (owned.length !== body.profileIds.length) {
    return res.status(400).json({ error: 'One or more profiles do not belong to this organisation' });
  }

  // A profile hands out every role inside it, so it is bounded the way a
  // direct assignment is: only an administrator may hand out an Administrator
  // role, and the caller must hold what the profile's roles grant.
  if (owned.length) {
    const links = await platformPrisma.roleProfileRole.findMany({
      where: { accountId, orgId, profileId: { in: owned.map((p) => p.id) } },
      select: { roleId: true },
    });
    const roleIds = [...new Set(links.map((l) => l.roleId))];
    if (roleIds.length) {
      const adminRoles = await platformPrisma.role.count({ where: { id: { in: roleIds }, roleType: RoleType.ADMIN } });
      if (adminRoles > 0 && !req.isAdmin) return res.status(403).json(ADMIN_ONLY_ERROR);
      const granted = new Set<string>();
      for (const roleId of roleIds) for (const k of await rolePermissionKeys(roleId)) granted.add(k);
      const missing = unheldGrants(req, granted);
      if (missing.length) return res.status(403).json(cannotGrantError(missing));
    }
  }

  await platformPrisma.$transaction(async (tx) => {
    await tx.userRoleProfile.deleteMany({ where: { accountId, orgId, userId } });
    for (const p of owned) {
      await tx.userRoleProfile.create({
        data: { accountId, orgId, userId, profileId: p.id, createdByUserId: req.auth!.userId },
      });
    }
  });

  res.json({ ok: true, assigned: owned.length });
});

// ---------------------------------------------------------------------------
// Approval thresholds
// ---------------------------------------------------------------------------

const ruleSchema = z.object({
  docType: z.enum(['INVOICE', 'BILL', 'PAYMENT', 'JOURNAL']),
  name: z.string().min(1).max(80),
  minAmount: z.number().nonnegative().default(0),
  maxAmount: z.number().positive().optional().nullable(),
  approverRoleId: z.string().min(1),
  sequence: z.number().int().min(1).default(1),
  blocksPosting: z.boolean().default(true),
  isActive: z.boolean().default(true),
  branchId: z.string().optional().nullable(),
});

governanceRouter.get('/orgs/:orgId/approval-rules', ROLES_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  const rules = await prisma.approvalRule.findMany({
    where: { accountId, orgId },
    orderBy: [{ docType: 'asc' }, { sequence: 'asc' }],
  });
  const roles = await platformPrisma.role.findMany({ where: { accountId, orgId }, select: { id: true, name: true } });
  const roleById = new Map(roles.map((r) => [r.id, r.name]));

  res.json({
    rules: rules.map((r) => ({
      ...r,
      minAmount: Number(r.minAmount),
      maxAmount: r.maxAmount === null ? null : Number(r.maxAmount),
      approverRoleName: roleById.get(r.approverRoleId) || '(deleted role)',
    })),
  });
});

governanceRouter.post('/orgs/:orgId/approval-rules', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = ruleSchema.parse(req.body);

  if (body.maxAmount !== null && body.maxAmount !== undefined && body.maxAmount <= body.minAmount) {
    return res.status(400).json({ error: 'Maximum must be greater than minimum' });
  }

  const role = await platformPrisma.role.findFirst({ where: { id: body.approverRoleId, accountId, orgId }, select: { id: true } });
  if (!role) return res.status(400).json({ error: 'Approver role does not belong to this organisation' });

  const rule = await prisma.approvalRule.create({
    data: {
      accountId,
      orgId,
      branchId: body.branchId ?? null,
      docType: body.docType,
      name: body.name.trim(),
      minAmount: new Prisma.Decimal(body.minAmount.toFixed(2)),
      maxAmount:
        body.maxAmount === null || body.maxAmount === undefined
          ? null
          : new Prisma.Decimal(body.maxAmount.toFixed(2)),
      approverRoleId: body.approverRoleId,
      sequence: body.sequence,
      blocksPosting: body.blocksPosting,
      isActive: body.isActive,
      createdByUserId: req.auth!.userId,
    },
  });

  res.status(201).json({ rule });
});

governanceRouter.delete('/orgs/:orgId/approval-rules/:ruleId', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rule = await prisma.approvalRule.findFirst({ where: { id: String(req.params.ruleId), accountId, orgId } });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await prisma.approvalRule.delete({ where: { id: rule.id } });
  res.json({ ok: true });
});

/** Documents waiting on the caller, or on anyone when ?all=true. */
governanceRouter.get('/orgs/:orgId/approvals', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;

  /*
   * An inbox, not a register.
   *
   * This listed every request in the company — document, amount, who raised
   * it — to anybody signed in. A person now sees what waits on a role they
   * hold and what they raised themselves; an administrator sees everything.
   */
  const access = await resolveAccess(accountId, orgId, userId, branchId);
  const scope = access.isAdmin
    ? {}
    : { OR: [{ requestedByUserId: userId }, { rule: { approverRoleId: { in: access.roleIds } } }] };

  const requests = await prisma.approvalRequest.findMany({
    where: {
      accountId,
      orgId,
      ...scope,
      ...(String(req.query.status || 'PENDING') === 'ALL' ? {} : { status: String(req.query.status || 'PENDING') }),
      ...(String(req.query.allBranches || '') === 'true' ? {} : { branchId }),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { rule: { select: { name: true, approverRoleId: true, docType: true } } },
  });

  res.json({ requests: requests.map((r) => ({ ...r, amount: Number(r.amount) })) });
});

const decideSchema = z.object({ approve: z.boolean(), comment: z.string().max(300).optional() });

governanceRouter.post('/orgs/:orgId/approvals/:requestId/decide', async (req, res) => {
  if (!orgOk(req, res)) return;
  const body = decideSchema.parse(req.body);

  try {
    const decided = await decide({
      accountId: req.tenant!.accountId,
      orgId: req.tenant!.orgId,
      branchId: req.tenant!.branchId,
      userId: req.auth!.userId,
      requestId: String(req.params.requestId),
      approve: body.approve,
      comment: body.comment,
    });
    // Approval is what releases the document into the books. Until now the
    // invoice existed as a row but had no journal entry.
    let posted = false;
    if (body.approve && decided.docType === 'INVOICE') {
      const rows = await prisma.invoice.findMany({ where: { id: decided.docId } });
      const inv = rows[0];
      if (inv) {
        await ensureLedgerSetup(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
        await postEntry({
          accountId: req.tenant!.accountId,
          orgId: req.tenant!.orgId,
          branchId: inv.branchId,
          userId: req.auth!.userId,
          date: String(inv.date),
          journalCode: 'SAL',
          narration: `Invoice ${inv.number} (approved)`,
          sourceDocType: 'INVOICE',
          sourceDocId: inv.id,
          lines: invoicePostingLines({
            customerId: inv.customerId,
            customerName: inv.customerName,
            subtotal: Number(inv.subtotal),
            cgstTotal: Number(inv.cgstTotal),
            sgstTotal: Number(inv.sgstTotal),
            igstTotal: Number(inv.igstTotal),
            total: Number(inv.total),
          }),
        });
        await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid' } });
        posted = true;
      }
    }

    if (!body.approve && decided.docType === 'INVOICE') {
      await prisma.invoice.update({ where: { id: decided.docId }, data: { status: 'Rejected' } });
    }

    await notifyDecision({
      accountId: req.tenant!.accountId,
      orgId: req.tenant!.orgId,
      requestedByUserId: decided.requestedByUserId,
      deciderUserId: req.auth!.userId,
      docType: decided.docType,
      docId: decided.docId,
      amount: Number(decided.amount),
      approved: body.approve,
      comment: body.comment,
    });

    res.json({ request: { ...decided, amount: Number(decided.amount) }, posted });
  } catch (e: any) {
    if (e instanceof ApprovalError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------------------------------------------------------------------------
// User permissions (document restrictions)
// ---------------------------------------------------------------------------

const ENTITY_TYPES = ['CUSTOMER', 'VENDOR', 'COST_CENTRE', 'ITEM_GROUP'] as const;

const userPermissionSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1),
  label: z.string().max(200).optional().nullable(),
});

governanceRouter.get('/orgs/:orgId/users/:userId/permissions', USERS_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await platformPrisma.userPermission.findMany({
    where: { accountId, orgId, userId: String(req.params.userId) },
    orderBy: [{ entityType: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ entityTypes: ENTITY_TYPES, permissions: rows });
});

governanceRouter.post('/orgs/:orgId/users/:userId/permissions', USERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const userId = String(req.params.userId);
  const body = userPermissionSchema.parse(req.body);

  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'User not found in org' });

  try {
    const row = await platformPrisma.userPermission.create({
      data: {
        accountId,
        orgId,
        userId,
        entityType: body.entityType,
        entityId: body.entityId.trim(),
        label: body.label ?? null,
        createdByUserId: req.auth!.userId,
      },
    });
    res.status(201).json({ permission: row });
  } catch (err: any) {
    if (String(err?.code || '') === 'P2002') {
      return res.status(409).json({ error: 'That restriction already exists' });
    }
    throw err;
  }
});

governanceRouter.delete('/orgs/:orgId/users/:userId/permissions/:id', USERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const row = await platformPrisma.userPermission.findFirst({
    where: { id: String(req.params.id), accountId, orgId, userId: String(req.params.userId) },
  });
  if (!row) return res.status(404).json({ error: 'Restriction not found' });
  await platformPrisma.userPermission.delete({ where: { id: row.id } });
  res.json({ ok: true });
});
