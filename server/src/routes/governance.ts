import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { accessForRequest } from '../services/access.js';
import { RoleType } from '../constants/enums.js';
import {
  ADMIN_ONLY_ERROR,
  OWN_ACCESS_ERROR,
  grantAuthority,
  LAST_ADMIN_ERROR,
  LastAdminError,
  assertAnAdminRemains,
  cannotGrantError,
  rolePermissionKeys,
  unheldGrants,
  userIsAdmin,
} from '../services/roleGuards.js';
import { PermissionAction } from '../constants/enums.js';
import { permKey } from '../constants/permissionCatalog.js';
import { ApprovalError, decide, notifyDecision, reopen } from '../services/approvals.js';
import { isAppEntitled } from '../services/subscriptions.js';
import { ensureLedgerSetup, invoicePostingLines, otherChargesFromExtras, postEntry } from '../services/ledger.js';
import { toBase } from '../services/fx.js';
import { entityExists } from '../services/integrity/crossStore.js';
import { postApprovedPurchaseDoc } from './purchaseDocs.js';
import { assertPeriodUnlocked, periodLockModuleForSource } from '../services/periodLock.js';
import { getApprovalPolicy } from '../services/approvalPolicy.js';
import { otherCompany } from '../utils/companyWords.js';

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
    otherCompany(res);
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

/**
 * Why putting these roles into a profile must be refused, or null.
 *
 * A profile hands every role in it to everybody who holds the profile, so
 * adding a role to one is assigning it — to people the editor never picked.
 * The same limits apply as to a direct assignment: only an administrator may
 * put an Administrator role in, and nobody may put in a role holding more
 * than they hold themselves. Roles already in the profile are not re-judged.
 */
async function profileRolesRefusal(req: any, roleIds: string[], alreadyIn: Set<string> = new Set()) {
  const added = roleIds.filter((id) => !alreadyIn.has(id));
  if (!added.length) return null;
  // A profile reaches whoever holds it, wherever they work (A-19).
  const { authority, refusal } = await grantAuthority(req, null, permKey('SETTINGS', 'Roles', 'EDIT'));
  if (refusal) return refusal;
  const adminRoles = await platformPrisma.role.count({ where: { id: { in: added }, roleType: RoleType.ADMIN } });
  if (adminRoles > 0 && !authority.isAdmin) return { status: 403, body: ADMIN_ONLY_ERROR };
  const granted = new Set<string>();
  for (const id of added) for (const k of await rolePermissionKeys(id)) granted.add(k);
  const missing = unheldGrants(authority, granted);
  return missing.length ? { status: 403, body: cannotGrantError(missing) } : null;
}

const lastAdmin = (res: any, err: unknown) => {
  if (err instanceof LastAdminError) {
    res.status(409).json(LAST_ADMIN_ERROR);
    return true;
  }
  return false;
};

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
    return res.status(400).json({ error: 'One of the roles is not in this company.' });
  }

  const refusedCreate = await profileRolesRefusal(req, owned.map((r) => r.id));
  if (refusedCreate) return res.status(refusedCreate.status).json(refusedCreate.body);

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
  if (!existing) return res.status(404).json({ error: 'No such role profile.' });

  const owned = await platformPrisma.role.findMany({
    where: { id: { in: body.roleIds }, accountId, orgId },
    select: { id: true },
  });
  if (owned.length !== body.roleIds.length) {
    return res.status(400).json({ error: 'One of the roles is not in this company.' });
  }

  const current = await platformPrisma.roleProfileRole.findMany({ where: { profileId }, select: { roleId: true } });
  const refusedUpdate = await profileRolesRefusal(req, owned.map((r) => r.id), new Set(current.map((c) => c.roleId)));
  if (refusedUpdate) return res.status(refusedUpdate.status).json(refusedUpdate.body);

  try {
    await platformPrisma.$transaction(async (tx) => {
      await tx.roleProfile.update({
        where: { id: profileId },
        data: { name: body.name.trim(), description: body.description ?? null },
      });
      await tx.roleProfileRole.deleteMany({ where: { profileId } });
      for (const r of owned) {
        await tx.roleProfileRole.create({ data: { accountId, orgId, profileId, roleId: r.id } });
      }
      // Taking the Administrator role out of a profile takes it from its holders.
      await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err) {
    if (lastAdmin(res, err)) return;
    throw err;
  }

  res.json({ ok: true });
});

governanceRouter.delete('/orgs/:orgId/role-profiles/:profileId', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await platformPrisma.roleProfile.findFirst({
    where: { id: String(req.params.profileId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'No such role profile.' });

  try {
    await platformPrisma.$transaction(async (tx) => {
      await tx.roleProfile.delete({ where: { id: existing.id } });
      await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err) {
    if (lastAdmin(res, err)) return;
    throw err;
  }
  res.json({ ok: true });
});

const assignProfileSchema = z.object({ profileIds: z.array(z.string()).default([]) });

governanceRouter.post('/orgs/:orgId/users/:userId/role-profiles', USERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const userId = String(req.params.userId);
  const body = assignProfileSchema.parse(req.body);

  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });

  const owned = await platformPrisma.roleProfile.findMany({
    where: { id: { in: body.profileIds }, accountId, orgId },
    select: { id: true },
  });
  if (owned.length !== body.profileIds.length) {
    return res.status(400).json({ error: 'One of the profiles is not in this company.' });
  }

  // Profiles are assigned company-wide: bounded by what the caller holds company-wide (A-19).
  const { authority, refusal } = await grantAuthority(req, null, permKey('SETTINGS', 'Users', 'EDIT'));
  if (refusal) return res.status(refusal.status).json(refusal.body);

  // Changing an administrator's profiles can take administration away; only
  // an administrator may do that, as with their direct role.
  if (!authority.isAdmin && (await userIsAdmin(accountId, orgId, userId))) return res.status(403).json(ADMIN_ONLY_ERROR);

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
      if (adminRoles > 0 && !authority.isAdmin) return res.status(403).json(ADMIN_ONLY_ERROR);
      const granted = new Set<string>();
      for (const roleId of roleIds) for (const k of await rolePermissionKeys(roleId)) granted.add(k);
      const missing = unheldGrants(authority, granted);
      if (missing.length) return res.status(403).json(cannotGrantError(missing));
    }
  }
  if (userId === req.auth!.userId && !authority.isAdmin) return res.status(403).json(OWN_ACCESS_ERROR);

  try {
    await platformPrisma.$transaction(async (tx) => {
      await tx.userRoleProfile.deleteMany({ where: { accountId, orgId, userId } });
      for (const p of owned) {
        await tx.userRoleProfile.create({
          data: { accountId, orgId, userId, profileId: p.id, createdByUserId: req.auth!.userId },
        });
      }
      await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err) {
    if (lastAdmin(res, err)) return;
    throw err;
  }

  res.json({ ok: true, assigned: owned.length });
});

// ---------------------------------------------------------------------------
// Approval thresholds
// ---------------------------------------------------------------------------

const approvalPolicySchema = z.object({
  allowSelfApproval: z.boolean(),
  requireApprovalRemarks: z.boolean(),
});

/** The company's own rules for deciding: may a requester approve their own, and is a note needed to approve. */
governanceRouter.get('/orgs/:orgId/approval-settings', ROLES_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  res.json({ policy: await getApprovalPolicy(req.tenant!.accountId, req.tenant!.orgId) });
});

governanceRouter.put('/orgs/:orgId/approval-settings', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const policy = approvalPolicySchema.parse(req.body);
  await prisma.orgMaster.upsert({
    where: { accountId_orgId_kind_name: { accountId, orgId, kind: 'APPROVAL_POLICY', name: 'Organization' } },
    create: { accountId, orgId, kind: 'APPROVAL_POLICY', name: 'Organization', dataJson: JSON.stringify(policy), createdByUserId: req.auth!.userId },
    update: { dataJson: JSON.stringify(policy) },
  });
  res.json({ policy });
});

const PURCHASE_SIDE = ['BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'EXPENSE'] as const;
type PurchaseSide = (typeof PURCHASE_SIDE)[number];
const isPurchaseSide = (docType: string): docType is PurchaseSide => (PURCHASE_SIDE as readonly string[]).includes(docType);
/** The Books table each purchase-side approval document is kept in. */
const purchaseSideTable = (docType: PurchaseSide) =>
  ({ BILL: prisma.bill, CREDIT_NOTE: prisma.creditNote, DEBIT_NOTE: prisma.debitNote, EXPENSE: prisma.expense })[docType] as any;

const PENDING_BLOCKS_CHANGE = 'Finish pending approvals for this transaction type before changing its workflow.';
/** A workflow is not changed under documents that are part-way through it. */
const hasPending = async (accountId: string, orgId: string, docType: string) =>
  (await prisma.approvalRequest.count({ where: { accountId, orgId, docType, status: 'PENDING' } })) > 0;

const ruleSchema = z.object({
  docType: z.enum(['INVOICE', 'BILL', 'EXPENSE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PAYMENT', 'JOURNAL']),
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

  if (await hasPending(accountId, orgId, body.docType)) return res.status(409).json({ error: PENDING_BLOCKS_CHANGE });

  if (body.maxAmount !== null && body.maxAmount !== undefined && body.maxAmount <= body.minAmount) {
    return res.status(400).json({ error: 'The maximum must be more than the minimum.' });
  }

  const role = await platformPrisma.role.findFirst({ where: { id: body.approverRoleId, accountId, orgId }, select: { id: true } });
  if (!role) return res.status(400).json({ error: 'The approver role is not in this company.' });
  if (body.branchId && !(await platformPrisma.branch.findFirst({ where: { id: body.branchId, accountId, orgId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'Branch does not belong to this company' });
  }

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

governanceRouter.put('/orgs/:orgId/approval-rules/:ruleId', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = ruleSchema.parse(req.body);
  const old = await prisma.approvalRule.findFirst({ where: { id: String(req.params.ruleId), accountId, orgId } });
  if (!old) return res.status(404).json({ error: 'No such rule.' });
  if ((await hasPending(accountId, orgId, old.docType)) || (body.docType !== old.docType && (await hasPending(accountId, orgId, body.docType)))) {
    return res.status(409).json({ error: PENDING_BLOCKS_CHANGE });
  }
  if (body.maxAmount != null && body.maxAmount <= body.minAmount) {
    return res.status(400).json({ error: 'The maximum must be more than the minimum.' });
  }
  if (!(await platformPrisma.role.findFirst({ where: { id: body.approverRoleId, accountId, orgId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'The approver role is not in this company.' });
  }
  if (body.branchId && !(await platformPrisma.branch.findFirst({ where: { id: body.branchId, accountId, orgId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'Branch does not belong to this company' });
  }
  // A rule that has decided something keeps its terms: what was approved was
  // approved under them. It may still be switched off.
  const used = await prisma.approvalRequest.count({ where: { accountId, orgId, ruleId: old.id } });
  if (
    used &&
    (body.docType !== old.docType ||
      body.name.trim() !== old.name ||
      (body.branchId ?? null) !== (old.branchId ?? null) ||
      body.approverRoleId !== old.approverRoleId ||
      body.sequence !== old.sequence ||
      body.blocksPosting !== old.blocksPosting ||
      body.minAmount !== Number(old.minAmount) ||
      (body.maxAmount ?? null) !== (old.maxAmount == null ? null : Number(old.maxAmount)))
  ) {
    return res.status(409).json({ error: 'This rule has approval history. Deactivate it and create a new rule to change its terms.' });
  }
  const rule = await prisma.approvalRule.update({
    where: { id: old.id },
    data: {
      name: body.name.trim(),
      docType: body.docType,
      branchId: body.branchId ?? null,
      minAmount: new Prisma.Decimal(body.minAmount.toFixed(2)),
      maxAmount: body.maxAmount == null ? null : new Prisma.Decimal(body.maxAmount.toFixed(2)),
      approverRoleId: body.approverRoleId,
      sequence: body.sequence,
      blocksPosting: body.blocksPosting,
      isActive: body.isActive,
    },
  });
  res.json({ rule });
});

governanceRouter.delete('/orgs/:orgId/approval-rules/:ruleId', ROLES_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rule = await prisma.approvalRule.findFirst({ where: { id: String(req.params.ruleId), accountId, orgId } });
  if (!rule) return res.status(404).json({ error: 'No such rule.' });
  if (await hasPending(accountId, orgId, rule.docType)) return res.status(409).json({ error: PENDING_BLOCKS_CHANGE });
  if (await prisma.approvalRequest.count({ where: { accountId, orgId, ruleId: rule.id } })) {
    return res.status(409).json({ error: 'This rule has approval history. Deactivate it instead of deleting it.' });
  }
  await prisma.approvalRule.delete({ where: { id: rule.id } });
  res.json({ ok: true });
});

/**
 * Approval requests, by scope: `mine` (waiting on a role the caller holds),
 * `requested` (what the caller raised), or `all` (the company's register).
 * With no scope it is the inbox as it was before scopes: what waits on the
 * caller's roles plus what they raised, and everything for an administrator.
 */
governanceRouter.get('/orgs/:orgId/approvals', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;

  const scope = String(req.query.scope || 'inbox');
  if (!['inbox', 'mine', 'requested', 'all'].includes(scope)) return res.status(400).json({ error: 'Choose which approvals to show.' });

  /*
   * An inbox, not a register.
   *
   * This listed every request in the company — document, amount, who raised
   * it — to anybody signed in. A person sees what waits on a role they hold
   * and what they raised themselves; the whole register is for an
   * administrator or somebody who may see the company's roles.
   */
  const access = await accessForRequest(req, branchId);
  if (scope === 'all' && !access.isAdmin && !access.permissions.has(permKey('SETTINGS', 'Roles', 'VIEW'))) {
    return res.status(403).json({ error: 'Only those who look after approvals for the whole company see these. Ask an administrator.' });
  }
  const allBranches = (scope === 'all' || scope === 'inbox') && String(req.query.allBranches || '') === 'true';
  const inbox =
    scope !== 'inbox' || access.isAdmin ? {} : { OR: [{ requestedByUserId: userId }, { rule: { approverRoleId: { in: access.roleIds } } }] };
  const policy = scope === 'mine' ? await getApprovalPolicy(accountId, orgId) : null;

  const requests = await prisma.approvalRequest.findMany({
    where: {
      accountId,
      orgId,
      ...(String(req.query.status || 'PENDING') === 'ALL' ? {} : { status: String(req.query.status || 'PENDING') }),
      ...(allBranches ? {} : { branchId }),
      ...inbox,
      ...(scope === 'requested' ? { requestedByUserId: userId } : {}),
      ...(scope === 'mine'
        ? {
            rule: { approverRoleId: { in: access.roleIds } },
            ...(policy?.allowSelfApproval ? {} : { requestedByUserId: { not: userId } }),
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { rule: { select: { name: true, approverRoleId: true, docType: true } } },
  });

  // The document each request is about, so the inbox can name it.
  const invoiceIds = requests.filter((r) => r.docType === 'INVOICE').map((r) => r.docId);
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({
        where: { accountId, orgId, id: { in: invoiceIds } },
        select: { id: true, number: true, customerName: true, date: true, status: true },
      })
    : [];
  const invoicesById = new Map(invoices.map((i) => [i.id, i]));
  const otherDocuments = new Map<string, unknown>();
  for (const kind of PURCHASE_SIDE) {
    const ids = requests.filter((r) => r.docType === kind).map((r) => r.docId);
    if (!ids.length) continue;
    const rows: Array<{ id: string; number: string; partyName: string; date: string; status: string }> = await purchaseSideTable(kind).findMany({
      where: { accountId, orgId, id: { in: ids } },
      select: { id: true, number: true, partyName: true, date: true, status: true },
    });
    for (const row of rows) otherDocuments.set(`${kind}:${row.id}`, row);
  }

  res.json({
    requests: requests.map((r) => ({
      ...r,
      amount: Number(r.amount),
      document: r.docType === 'INVOICE' ? invoicesById.get(r.docId) || null : otherDocuments.get(`${r.docType}:${r.docId}`) || null,
    })),
  });
});

const decideSchema = z.object({ approve: z.boolean(), comment: z.string().max(300).optional() });

/**
 * Releases a finally-approved document into the books: posts its journal entry
 * (once) and moves it out of "Pending Approval". True when it is posted.
 */
async function releaseApprovedDocument(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  docType: string;
  docId: string;
}) {
  if (opts.docType === 'INVOICE') {
    const existing = await prisma.journalEntry.findFirst({
      where: { accountId: opts.accountId, orgId: opts.orgId, sourceDocType: opts.docType, sourceDocId: opts.docId, status: 'POSTED', reversesId: null },
      select: { id: true },
    });
    const inv = await prisma.invoice.findFirst({
      where: { id: opts.docId, accountId: opts.accountId, orgId: opts.orgId, branchId: opts.branchId },
    });
    if (!inv) throw new ApprovalError('Approval document not found', 404);
    if (inv.status !== 'Pending Approval') return Boolean(existing);
    if (!existing) {
      await ensureLedgerSetup(opts.accountId, opts.orgId, opts.userId);
      // Held invoices keep the rate typed on them; the ledger is in base currency.
      const fxRate = Number(inv.exchangeRate) || 1;
      await postEntry({
        accountId: opts.accountId,
        orgId: opts.orgId,
        branchId: inv.branchId,
        userId: opts.userId,
        date: String(inv.date),
        journalCode: 'SAL',
        narration: `Invoice ${inv.number} (approved)` + (fxRate === 1 ? '' : ` (${inv.currency} at ${fxRate})`),
        sourceDocType: 'INVOICE',
        sourceDocId: inv.id,
        lines: invoicePostingLines({
          customerId: inv.customerId,
          customerName: inv.customerName,
          subtotal: toBase(Number(inv.subtotal), fxRate),
          cgstTotal: toBase(Number(inv.cgstTotal), fxRate),
          sgstTotal: toBase(Number(inv.sgstTotal), fxRate),
          igstTotal: toBase(Number(inv.igstTotal), fxRate),
          total: toBase(Number(inv.total), fxRate),
          otherChargesTotal: toBase(otherChargesFromExtras(inv.extrasJson), fxRate),
          reverseCharge: Boolean(inv.reverseCharge),
        }),
      });
    }
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid' } });
    return true;
  }
  if (isPurchaseSide(opts.docType)) {
    await postApprovedPurchaseDoc({ ...opts, kind: opts.docType });
    return true;
  }
  throw new ApprovalError('Unsupported approval document type', 400);
}

/** The date of the document a request is about, for the period-lock check. */
async function approvalDocumentDate(accountId: string, orgId: string, docType: string, docId: string): Promise<string | undefined> {
  const where = { id: docId, accountId, orgId };
  if (docType === 'INVOICE') return (await prisma.invoice.findFirst({ where, select: { date: true } }))?.date;
  if (isPurchaseSide(docType)) return (await purchaseSideTable(docType).findFirst({ where, select: { date: true } }))?.date;
  return undefined;
}

const ACCOUNTING_NOT_OWNED = { error: 'Books is not on this account’s subscription. An owner can add it under Workspace → Billing.', app: 'accounting', code: 'APP_NOT_SUBSCRIBED' };

governanceRouter.post('/orgs/:orgId/approvals/:requestId/decide', async (req, res) => {
  if (!orgOk(req, res)) return;
  const body = decideSchema.parse(req.body);
  /*
   * A-12: approving releases a document into the books. The approver's role
   * is checked in decide(); the account must also still have Accounting —
   * this route sat outside the shared RBAC path that refuses unowned apps.
   */
  if (!(await isAppEntitled(req.tenant!.accountId, 'accounting'))) {
    return res.status(402).json(ACCOUNTING_NOT_OWNED);
  }

  try {
    // An approval posts into the books on the document's date, so a locked
    // period refuses it before anything is decided.
    if (body.approve) {
      const pending = await prisma.approvalRequest.findFirst({
        where: {
          id: String(req.params.requestId),
          accountId: req.tenant!.accountId,
          orgId: req.tenant!.orgId,
          branchId: req.tenant!.branchId,
          status: 'PENDING',
        },
      });
      if (pending) {
        const date = await approvalDocumentDate(pending.accountId, pending.orgId, pending.docType, pending.docId);
        const module = periodLockModuleForSource(pending.docType);
        if (date && module) {
          try {
            await assertPeriodUnlocked({ accountId: pending.accountId, orgId: pending.orgId, userId: req.auth!.userId, module, date });
          } catch (err: any) {
            if (err?.status === 409) return res.status(409).json({ error: err.message, code: 'PERIOD_LOCKED' });
            throw err;
          }
        }
      }
    }
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
    // document existed as a row but had no journal entry. With several levels
    // only the last approval releases it.
    let posted = false;
    if (body.approve && !decided.nextLevel) {
      try {
        posted = await releaseApprovedDocument({
          accountId: req.tenant!.accountId,
          orgId: req.tenant!.orgId,
          branchId: decided.branchId,
          userId: req.auth!.userId,
          docType: decided.docType,
          docId: decided.docId,
        });
      } catch (err) {
        /* Not posted, so not approved: the request goes back to pending rather than claiming a decision the books do not show. */
        await reopen(decided.id);
        throw err;
      }
    }

    if (!body.approve && decided.docType === 'INVOICE') {
      await prisma.invoice.updateMany({ where: { id: decided.docId, accountId: req.tenant!.accountId, orgId: req.tenant!.orgId }, data: { status: 'Rejected' } });
    }
    if (!body.approve && isPurchaseSide(decided.docType)) {
      await purchaseSideTable(decided.docType).updateMany({ where: { id: decided.docId, accountId: req.tenant!.accountId, orgId: req.tenant!.orgId }, data: { status: 'Rejected' } });
    }

    // The decision stands whether or not the requester could be told.
    try {
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
    } catch (error) {
      console.error('Approval decision notification failed', error);
    }

    res.json({ request: { ...decided, amount: Number(decided.amount) }, posted, nextLevel: decided.nextLevel });
  } catch (e: any) {
    if (e instanceof ApprovalError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Retry ledger release if a final decision succeeded but posting failed. */
governanceRouter.post('/orgs/:orgId/approvals/:requestId/retry-post', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  /* Posts into the books, so the same two conditions as deciding: Accounting owned, and the approver's role. */
  if (!(await isAppEntitled(accountId, 'accounting'))) return res.status(402).json(ACCOUNTING_NOT_OWNED);
  const row = await prisma.approvalRequest.findFirst({
    where: { id: String(req.params.requestId), accountId, orgId, branchId, status: 'APPROVED' },
    include: { rule: { select: { approverRoleId: true } } },
  });
  if (!row) return res.status(404).json({ error: 'No such approved request.' });
  const later = await prisma.approvalRequest.count({
    where: { accountId, orgId, branchId, docType: row.docType, docId: row.docId, sequence: { gt: row.sequence } },
  });
  if (later) return res.status(409).json({ error: 'A later approval level has started on this, so it cannot be undone here. Reload it.' });
  const access = await accessForRequest(req, branchId);
  if (!access.roleIds.includes(row.rule.approverRoleId)) return res.status(403).json({ error: 'Only someone with the approver role can decide this.' });
  try {
    const posted = await releaseApprovedDocument({ accountId, orgId, branchId, userId: req.auth!.userId, docType: row.docType, docId: row.docId });
    res.json({ posted });
  } catch (e: any) {
    if (e instanceof ApprovalError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** What happened to one request: raised, then each decision. For the requester, an approver of it, or governance. */
governanceRouter.get('/orgs/:orgId/approvals/:requestId/history', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const row = await prisma.approvalRequest.findFirst({
    where: { id: String(req.params.requestId), accountId, orgId, branchId },
    include: { rule: { select: { approverRoleId: true } } },
  });
  if (!row) return res.status(404).json({ error: 'No such approval request.' });
  const access = await accessForRequest(req, branchId);
  if (
    row.requestedByUserId !== req.auth!.userId &&
    !access.roleIds.includes(row.rule.approverRoleId) &&
    !access.isAdmin &&
    !access.permissions.has(permKey('SETTINGS', 'Roles', 'VIEW'))
  ) {
    return res.status(403).json({ error: 'This approval is not yours to see.' });
  }
  const events = await platformPrisma.auditLog.findMany({
    where: { accountId, orgId, entity: 'APPROVAL_REQUEST', entityId: row.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, action: true, message: true, metadata: true, createdByUserId: true, createdAt: true },
  });
  res.json({
    events: [{ action: 'SUBMITTED', createdAt: row.createdAt, createdByUserId: row.requestedByUserId, message: null }, ...events],
  });
});

// ---------------------------------------------------------------------------
// User permissions (document restrictions)
// ---------------------------------------------------------------------------

const ENTITY_TYPES = ['CUSTOMER', 'VENDOR', 'COST_CENTRE', 'ITEM_GROUP'] as const;

/**
 * Who may change a person's record restrictions (A-20).
 *
 * A restriction narrows what somebody sees, but a second row of a type widens
 * it again (they may now see that customer too), and removing one lifts it —
 * so changing your own is changing your own access, which somebody else does.
 * Restrictions apply to administrators too, so only an administrator may fence
 * one off from records. Both judged by what the caller holds company-wide,
 * because restrictions hold in every branch.
 */
async function restrictionRefusal(req: any, userId: string) {
  const { accountId, orgId } = req.tenant!;
  const { authority, refusal } = await grantAuthority(req, null, permKey('SETTINGS', 'Users', 'EDIT'));
  if (refusal) return refusal;
  if (authority.isAdmin) return null;
  if (userId === req.auth!.userId) return { status: 403, body: OWN_ACCESS_ERROR };
  if (await userIsAdmin(accountId, orgId, userId)) {
    return { status: 403, body: { error: 'Only an administrator may restrict what an administrator sees.', code: 'admin_only' } };
  }
  return null;
}

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
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });

  const refused = await restrictionRefusal(req, userId);
  if (refused) return res.status(refused.status).json(refused.body);
  /* GAP-010: the customer, vendor or cost centre lives in Accounting; access to one that is not this company's names nothing. */
  if (!(await entityExists({ accountId, orgId }, body.entityType, body.entityId.trim()))) {
    return res.status(400).json({ error: `No such ${body.entityType === 'COST_CENTRE' ? 'cost centre' : body.entityType.toLowerCase()} in this company.` });
  }

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
      return res.status(409).json({ error: 'That restriction already exists.' });
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
  if (!row) return res.status(404).json({ error: 'No such restriction.' });
  const refused = await restrictionRefusal(req, row.userId);
  if (refused) return res.status(refused.status).json(refused.body);
  await platformPrisma.userPermission.delete({ where: { id: row.id } });
  res.json({ ok: true });
});
