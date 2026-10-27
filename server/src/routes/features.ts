import { track } from '../services/productEvents.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { isKnownFeature } from '../constants/featureCatalog.js';
import { featureDisableBlocker, getFeatureCatalogWithValues, getFeatures, DETAILED_KEY } from '../services/features.js';
import { appOfFeature, entitlementFor, upgradeHintFor } from '../services/entitlements.js';
import { appOwnershipReason } from '../services/subscriptions.js';
import { MODULE_PACKS } from '../constants/planCatalog.js';

export const featuresRouter = Router();
featuresRouter.use(requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

/**
 * Effective flags for the active org. Deliberately readable by any member:
 * the client needs it to render, and knowing that warehouses are switched off
 * is not privileged information.
 */
featuresRouter.get('/orgs/:orgId/features', async (req, res) => {
  if (!orgOk(req, res)) return;
  const values = await getFeatures(req.tenant!.accountId, req.tenant!.orgId);
  res.json({ features: values });
});

/** Catalog plus values, for the Settings screen. */
featuresRouter.get(
  '/orgs/:orgId/features/catalog',
  requirePermission('SETTINGS', PermissionAction.VIEW, 'Company Profile'),
  async (req, res) => {
    if (!orgOk(req, res)) return;
    const data = await getFeatureCatalogWithValues(req.tenant!.accountId, req.tenant!.orgId);
    res.json(data);
  }
);

/**
 * What this account is entitled to, and what it has spent of its limits.
 *
 * Readable by any member: the client needs it to decide whether a sidebar
 * entry offers "turn on" or "on the Growth plan", and knowing which plan you
 * are on is not privileged.
 */
featuresRouter.get('/orgs/:orgId/entitlement', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId } = req.tenant!;
  const e = await entitlementFor(accountId);
  const [companies, users] = await Promise.all([
    platformPrisma.org.count({ where: { accountId } }),
    platformPrisma.user.count({ where: { accountId, isActive: true } }),
  ]);
  /*
   * Packs go out with the entitlement because they are the same question asked
   * at the level a business thinks in. A shop owner cannot answer "do you want
   * batchSerial"; they can answer "do you hold stock".
   */
  const packs = MODULE_PACKS.map((p) => ({
    ...p,
    entitled: p.features.some((k) => e.features.has(k)),
    fullyEntitled: p.features.every((k) => e.features.has(k)),
    upgradeHint: p.features.every((k) => e.features.has(k)) ? null : upgradeHintFor(p.features[0]),
  }));

  res.json({
    plan: { key: e.planKey, name: e.planName, status: e.status, inGoodStanding: e.inGoodStanding },
    features: [...e.features],
    packs,
    limits: e.limits,
    usage: { companies, users },
  });
});

const putSchema = z.object({ features: z.record(z.string(), z.boolean()) });

featuresRouter.put(
  '/orgs/:orgId/features',
  requirePermission('SETTINGS', PermissionAction.EDIT, 'Company Profile'),
  async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId } = req.tenant!;
    const body = putSchema.parse(req.body);
    /* Derived on read (on unless simple mode is), never stored: a client that sends back what it read is not refused for it. */
    delete (body.features as Record<string, unknown>)[DETAILED_KEY];

    for (const key of Object.keys(body.features)) {
      if (!isKnownFeature(key)) return res.status(400).json({ error: `Unknown feature: ${key}` });
    }

    /*
     * Some flags are whole apps (payroll). Switching one on is buying the app,
     * so the subscription — the commercial ceiling above the plan — has to own
     * it. 402, not 403: the client shows an upgrade path, not "forbidden".
     */
    for (const [key, enabled] of Object.entries(body.features)) {
      if (!enabled) continue;
      const reason = await appOwnershipReason(accountId, key);
      if (reason) return res.status(402).json({ error: reason, code: 'APP_NOT_SUBSCRIBED', feature: key });
    }

    /*
     * The ceiling is enforced here as well as when features are read. Reading
     * alone would let a switch be stored for something the account cannot have,
     * which then turns itself on the moment anyone upgrades — a surprise, and
     * not the one they paid for.
     *
     * Turning something OFF is always allowed, whatever the plan says.
     */
    const entitlement = await entitlementFor(accountId);
    for (const [key, enabled] of Object.entries(body.features)) {
      if (enabled && !entitlement.features.has(key)) {
        return res.status(403).json({
          error: appOfFeature(key) ? `${upgradeHintFor(key)}: ${key} cannot be switched on.` : `${key} is not included in the ${entitlement.planName} plan.`,
          code: 'NOT_ENTITLED',
          feature: key,
          upgradeHint: upgradeHintFor(key),
        });
      }
    }

    const current = await getFeatures(accountId, orgId);
    for (const [key, enabled] of Object.entries(body.features)) {
      if (!enabled && current[key]) {
        const blocker = await featureDisableBlocker(accountId, orgId, key);
        if (blocker) {
          return res.status(409).json({ error: blocker, code: 'FEATURE_IN_USE', feature: key });
        }
      }
    }

    for (const [key, enabled] of Object.entries(body.features)) {
      await platformPrisma.featureSetting.upsert({
        where: { orgId_key: { orgId, key } },
        update: { enabled, updatedByUserId: req.auth!.userId },
        create: { accountId, orgId, key, enabled, updatedByUserId: req.auth!.userId },
      });
    }

    if (Object.prototype.hasOwnProperty.call(body.features, 'peopleSimpleMode') && Boolean(body.features.peopleSimpleMode) !== Boolean(current.peopleSimpleMode)) {
      void track(orgId, req.auth!.userId, 'simple_mode_toggled', { on: Boolean(body.features.peopleSimpleMode), trigger: String(req.body?.trigger || 'settings').slice(0, 30), app: 'people' });
    }

    /* Written by name here; the general recorder (auditMutations) leaves it. */

    if (req.res) req.res.locals.audited = true;

    await platformPrisma.auditLog.create({
      data: {
        accountId,
        orgId,
        branchId: req.tenant!.branchId,
        entity: 'Features',
        entityId: orgId,
        action: 'EDIT',
        message: `Features updated: ${Object.keys(body.features).join(', ')}`,
        createdByUserId: req.auth!.userId,
      },
    });

    // Dependencies mean the stored value is not always the effective one.
    const values = await getFeatures(accountId, orgId);
    res.json({ features: values });
  }
);
