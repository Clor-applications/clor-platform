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
import { appOfFeature, entitlementFor, needsAny, upgradeHintFor } from '../services/entitlements.js';
import { appOwnershipReason } from '../services/subscriptions.js';
import { MODULE_PACKS } from '../constants/planCatalog.js';
import { editLogChanges } from '../middleware/auditMutations.js';
import { backfillPartyCodes } from '../services/partyCodeNumbering.js';
import { recordAudit } from '../services/auditTrail.js';
import { otherCompany } from '../utils/companyWords.js';

export const featuresRouter = Router();
featuresRouter.use(requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    otherCompany(res);
    return false;
  }
  return true;
};

const companyProfileSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200),
  companySettings: z.record(z.string(), z.unknown()),
});

const partyCodeFormatSchema = z.object({
  prefix: z.string().max(12).regex(/^[A-Za-z0-9_-]*$/),
  suffix: z.string().max(12).regex(/^[A-Za-z0-9_-]*$/),
  separator: z.enum(['', '-', '/', '_']),
  digits: z.number().int().min(1).max(10),
  nextNumber: z.number().int().min(1).max(9999999999),
  mode: z.enum(['automatic', 'manual', 'override']),
  includeBranchCode: z.boolean(),
  includeYear: z.boolean(),
  componentOrder: z.array(z.enum(['prefix', 'branch', 'year', 'sequence', 'suffix'])).length(5).refine((order) => new Set(order).size === 5, 'Each code component must appear once').optional(),
});

const parseProfile = (raw: string | null | undefined): Record<string, any> => {
  try {
    const p = JSON.parse(raw || '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
};

/** How customer and vendor codes are numbered, and where each series has reached. */
featuresRouter.get('/orgs/:orgId/party-code-settings', requirePermission('SETTINGS', PermissionAction.VIEW, 'Company Profile'), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const org = await platformPrisma.org.findFirst({ where: { accountId, id: orgId }, select: { profileJson: true } });
  if (!org) return res.status(404).json({ error: 'No such company.' });
  const profile = parseProfile(org.profileJson);
  const counters = await prisma.partyCodeCounter.findMany({ where: { accountId, orgId }, select: { kind: true, branchScope: true, nextNumber: true } });
  res.json({ partyCodeSettings: profile.partyCodeSettings || {}, counters: counters.map((row) => ({ ...row, nextNumber: Number(row.nextNumber) })) });
});

featuresRouter.patch('/orgs/:orgId/party-code-settings', requirePermission('SETTINGS', PermissionAction.EDIT, 'Company Profile'), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const { kind, format } = z.object({ kind: z.enum(['customer', 'vendor']), format: partyCodeFormatSchema }).parse(req.body);
  if (String(format.nextNumber).length > format.digits) return res.status(400).json({ error: 'Next number must fit the selected number of digits' });
  if ((format.prefix.match(/\d/g) || []).length + (format.suffix.match(/\d/g) || []).length + Math.max(format.digits, String(format.nextNumber).length) > 10) return res.status(400).json({ error: 'Code format may contain at most 10 digits in total' });
  const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { id: true, profileJson: true } });
  if (!org) return res.status(404).json({ error: 'No such company.' });
  const profile = parseProfile(org.profileJson);
  const partyCodeSettings = { ...(profile.partyCodeSettings || {}), [kind]: format };
  const otherKind = kind === 'customer' ? 'vendor' : 'customer';
  const otherFormat = { prefix: otherKind === 'customer' ? 'CUST' : 'VEND', suffix: '', separator: '-', digits: 5, includeBranchCode: false, includeYear: false, componentOrder: ['prefix', 'branch', 'year', 'sequence', 'suffix'], ...(partyCodeSettings[otherKind] || {}) };
  const signature = (value: typeof otherFormat) => JSON.stringify([value.prefix, value.suffix, value.separator, value.digits, value.includeBranchCode, value.includeYear, value.componentOrder]);
  if (signature({ ...otherFormat, ...format }) === signature(otherFormat)) return res.status(409).json({ error: 'Customer and vendor code series must use different formats' });
  /*
   * The company record and the counters live in different databases, so the
   * two writes cannot share a transaction. The format is saved first: a
   * counter left behind by a failure is corrected by saving again.
   */
  await platformPrisma.org.update({ where: { id: org.id }, data: { profileJson: JSON.stringify({ ...profile, partyCodeSettings }) } });
  // A counter only moves forward: saving the form again with the number it
  // showed earlier must not hand out codes already issued.
  await prisma.partyCodeCounter.updateMany({ where: { accountId, orgId, kind: kind.toUpperCase(), nextNumber: { lt: BigInt(format.nextNumber) } }, data: { nextNumber: BigInt(format.nextNumber) } });
  await recordAudit(req, { entity: 'Company', entityId: orgId, action: 'UPDATE', message: `Changed ${kind} code numbering`, metadata: { kind } });
  res.json({ partyCodeSettings });
});

/** The company profile as Books' own settings screen saves it: the names, and the settings kept whole in the profile. */
featuresRouter.patch('/orgs/:orgId/profile', requirePermission('SETTINGS', PermissionAction.EDIT, 'Company Profile'), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = companyProfileSchema.parse(req.body);
  const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { id: true, name: true, baseCurrency: true, profileJson: true } });
  if (!org) return res.status(404).json({ error: 'No such company.' });
  const previous = parseProfile(org.profileJson);
  const settings = body.companySettings;
  const baseCurrency = String(settings.baseCurrency || org.baseCurrency).trim().toUpperCase();
  /*
   * Every ledger posting is in the base currency, so it can only change while
   * nothing has been posted: afterwards the same figures would be read as
   * another currency's.
   */
  if (baseCurrency !== String(org.baseCurrency).toUpperCase()) {
    if (!/^[A-Z]{3}$/.test(baseCurrency)) return res.status(400).json({ error: 'The base currency is a three-letter code, like INR.' });
    const posted = await prisma.journalEntry.count({ where: { accountId, orgId } });
    if (posted > 0) return res.status(409).json({ error: 'The base currency cannot change once entries have been posted to the books.', code: 'BASE_CURRENCY_IN_USE' });
  }
  if (body.companyName !== org.name) {
    const taken = await platformPrisma.org.findFirst({ where: { accountId, name: body.companyName, NOT: { id: org.id } }, select: { id: true } });
    if (taken) return res.status(409).json({ error: 'Another company in this account already has that name.' });
  }
  const profile = {
    ...previous,
    companySettings: settings,
    state: String(settings.regStateName || previous.state || ''),
    gstin: String(settings.gstin || ''),
    baseCurrency,
  };
  const updated = await platformPrisma.org.update({
    where: { id: org.id },
    data: {
      name: body.companyName,
      legalName: body.legalName,
      pan: String(settings.pan || ''),
      baseCurrency,
      profileJson: JSON.stringify(profile),
    },
    select: { id: true, name: true, legalName: true, profileJson: true },
  });
  await recordAudit(req, { entity: 'Company', entityId: orgId, action: 'UPDATE', message: 'Changed company details', metadata: { fields: ['companyName', 'legalName', 'companySettings'] } });
  res.json({ company: updated });
});

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

const putSchema = z.object({ features: z.record(z.string(), z.boolean()), confirmCodeBackfill: z.boolean().optional() });

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
        const offByClor = entitlement.removed.has(key) || needsAny(key, [...entitlement.removed]);
        const hint = offByClor ? 'Turned off by CLOR. Ask CLOR support to turn it back on.' : upgradeHintFor(key);
        return res.status(403).json({
          error: offByClor ? `CLOR has turned this off for your account: ${key} cannot be switched on.` : appOfFeature(key) ? `${upgradeHintFor(key)}: ${key} cannot be switched on.` : `${key} is not included in the ${entitlement.planName} plan.`,
          code: 'NOT_ENTITLED',
          feature: key,
          upgradeHint: hint,
        });
      }
    }

    const current = await getFeatures(accountId, orgId);
    if (current.periodLock && body.features.periodLock === false) {
      return res.status(409).json({ error: 'Period Lock cannot be disabled after it has been enabled.', code: 'PERIOD_LOCK_PERMANENT', feature: 'periodLock' });
    }
    for (const key of ['customerCodes', 'vendorCodes']) {
      if (current[key] && body.features[key] === false) return res.status(409).json({ error: `${key === 'customerCodes' ? 'Customer' : 'Vendor'} Code Numbering cannot be disabled after it has been enabled.`, code: 'CODE_NUMBERING_PERMANENT', feature: key });
    }
    const newlyEnabledCodes = (['customerCodes', 'vendorCodes'] as const).filter((key) => !current[key] && body.features[key] === true);
    if (newlyEnabledCodes.length && !body.confirmCodeBackfill) {
      return res.status(409).json({ error: 'Confirm automatic numbering of existing customers and vendors before enabling code numbering.', code: 'CODE_BACKFILL_CONFIRMATION_REQUIRED' });
    }
    for (const [key, enabled] of Object.entries(body.features)) {
      if (!enabled && current[key]) {
        const blocker = await featureDisableBlocker(accountId, orgId, key);
        if (blocker) {
          return res.status(409).json({ error: blocker, code: 'FEATURE_IN_USE', feature: key });
        }
      }
    }

    /*
     * Switching code numbering on gives every existing customer or vendor
     * without a code one, in a single Books transaction. The switches
     * themselves are in the platform database and are written after it: if
     * that fails, the codes stay (they are valid) and saving again skips the
     * parties already numbered.
     */
    let backfilled: Awaited<ReturnType<typeof backfillPartyCodes>> = [];
    if (newlyEnabledCodes.length) {
      const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { profileJson: true } });
      if (!org) return res.status(404).json({ error: 'No such company.' });
      backfilled = await prisma.$transaction(async (tx) => {
        const assigned: Awaited<ReturnType<typeof backfillPartyCodes>> = [];
        for (const key of newlyEnabledCodes) {
          const kind = key === 'customerCodes' ? 'CUSTOMER' : 'VENDOR';
          assigned.push(...(await backfillPartyCodes(tx, accountId, orgId, kind, org.profileJson)));
        }
        return assigned;
      }, { timeout: 120000 });
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
        message: `Features updated: ${Object.keys(body.features).join(', ')}${newlyEnabledCodes.length ? `. Existing party codes assigned: ${backfilled.length}` : ''}`,
        createdByUserId: req.auth!.userId,
        /* Which switches moved, from what to what (auditMutations.ts EDIT_LOG). */
        changes: (await editLogChanges(req)) ?? undefined,
      },
    });

    // Dependencies mean the stored value is not always the effective one.
    const values = await getFeatures(accountId, orgId);
    res.json({ features: values, backfilled });
  }
);
