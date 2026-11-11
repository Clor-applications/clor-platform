import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { appAccess, getSubscription } from '../services/subscriptions.js';
import { appOfFeature, entitlementFor, needsAny, splitKeys } from '../services/entitlements.js';
import { FEATURE_CATALOG } from '../constants/featureCatalog.js';
import { DEFAULT_PLAN_KEY, planFor } from '../constants/planCatalog.js';
import { appByCode, appForFeature, tierAllows } from '../constants/appCatalog.js';
import { audit } from './ops.js';

/**
 * A customer's limits on the operator console (Ops plan P1, item 5): how many
 * companies and users the account may have, and which modules of the apps it
 * owns are on, set by CLOR without code.
 *
 * Kept on AccountEntitlement beside the plan: maxCompanies / maxUsers (null =
 * the plan's own), extraFeatures (added on top) and removedFeatures (turned
 * off although the plan has them). Subscription changes rewrite the plan and
 * leave these alone, so a limit CLOR set survives a renewal.
 *
 * Billing changes them, each with a fresh authenticator code and a reason,
 * written to the operator record and to the customer's own security log.
 * Apps themselves are not here: they follow the subscription.
 */
export const opsLimitsRouter = Router();
opsLimitsRouter.use('/ops/accounts', requireAuth, requireOperator);

const SAY_WHY = 'Say why, in a sentence.';
const reason = z.string().trim().min(3, SAY_WHY).max(500);
const limit = z.number().int().min(1, 'A limit is at least 1.').max(100000).nullable();
const limitsBody = z.object({ maxCompanies: limit, maxUsers: limit, reason });
const featureBody = z.object({ state: z.enum(['plan', 'on', 'off']), reason });

const account = (id: string) => platformPrisma.account.findUnique({ where: { id }, select: { id: true, name: true } });
const join = (keys: string[]) => [...new Set(keys)].sort().join(',');

/** Settings a company chooses for itself, not something sold: never switched by CLOR. */
const NOT_SOLD = new Set(['peopleSimpleMode']);

/** The modules CLOR may switch for this account: those of the apps it owns, never an app's own switch. */
async function switchable(accountId: string) {
  const [access, sub, row] = await Promise.all([appAccess(accountId), getSubscription(accountId), platformPrisma.accountEntitlement.findUnique({ where: { accountId } })]);
  const plan = planFor(row?.planKey ?? DEFAULT_PLAN_KEY);
  const owns = (app: string | null) => (app ? access.ownedApps.includes(app) : access.ownedApps.includes('accounting'));
  const tierOf = (code: string) => sub?.items.find((i) => i.appCode === code)?.tier ?? null;
  const inPlan = (key: string, app: string | null) => (app ? tierAllows(app, tierOf(app), key) : plan.features === '*' || plan.features.includes(key));
  const list = FEATURE_CATALOG.filter((f) => !f.locked && !appForFeature(f.key) && !NOT_SOLD.has(f.key))
    .map((f) => ({ f, app: appOfFeature(f.key) }))
    .filter(({ app }) => owns(app));
  return { row, plan, list, inPlan };
}

/** Limits and modules, with what is used. */
opsLimitsRouter.get('/ops/accounts/:id/limits', (req, res) =>
  outsideTenant('ops: customer limits', async () => {
    const id = String(req.params.id);
    if (!(await account(id))) return res.status(404).json({ error: 'No such customer' });
    const [{ row, plan, list, inPlan }, e, companies, users] = await Promise.all([
      switchable(id),
      entitlementFor(id),
      platformPrisma.org.count({ where: { accountId: id, archivedAt: null } }),
      platformPrisma.user.count({ where: { accountId: id, isActive: true } }),
    ]);
    const extras = splitKeys(row?.extraFeatures);
    const removed = splitKeys(row?.removedFeatures);
    const features = list.map(({ f, app }) => {
      const planHas = inPlan(f.key, app);
      const state = removed.includes(f.key) ? 'off' : extras.includes(f.key) && !planHas ? 'on' : planHas ? 'plan' : 'not-in-plan';
      return {
        key: f.key,
        label: f.label,
        app: app || 'accounting',
        appName: appByCode(app || 'accounting')?.name || 'Accounting',
        state,
        inPlan: planHas,
        /* Off because something it needs was turned off, not by itself. */
        offWithParent: state !== 'off' && !e.features.has(f.key) && needsAny(f.key, removed),
        needs: f.dependsOn ? FEATURE_CATALOG.find((x) => x.key === f.dependsOn)?.label || f.dependsOn : null,
      };
    });
    res.json({
      plan: { key: plan.key, name: plan.name, limits: plan.limits },
      set: { maxCompanies: row?.maxCompanies ?? null, maxUsers: row?.maxUsers ?? null },
      limits: e.limits,
      used: { companies, users },
      inGoodStanding: e.inGoodStanding,
      features,
    });
  }),
);

/** Upsert, so an account still on the default plan (no row yet) can be given a limit. */
const save = (accountId: string, data: Record<string, unknown>, by: string) =>
  platformPrisma.accountEntitlement.upsert({
    where: { accountId },
    create: { accountId, planKey: DEFAULT_PLAN_KEY, ...data, updatedByUserId: by },
    update: { ...data, updatedByUserId: by },
  });

/** Companies and users. null puts a limit back to the plan's own. */
opsLimitsRouter.post('/ops/accounts/:id/limits', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: set customer limits', async () => {
    const id = String(req.params.id);
    const p = limitsBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the limits.' });
    if (!(await account(id))) return res.status(404).json({ error: 'No such customer' });
    const was = await platformPrisma.accountEntitlement.findUnique({ where: { accountId: id } });
    const before = { maxCompanies: was?.maxCompanies ?? null, maxUsers: was?.maxUsers ?? null };
    const after = { maxCompanies: p.data.maxCompanies, maxUsers: p.data.maxUsers };
    if (before.maxCompanies === after.maxCompanies && before.maxUsers === after.maxUsers) return res.status(409).json({ error: 'Nothing changed.' });
    await save(id, after, req.auth!.userId);
    clearAccessCache();
    const word = (n: number | null) => (n == null ? 'plan' : String(n));
    await audit(
      req,
      'LIMITS_CHANGED',
      { accountId: id },
      { companies: `${word(before.maxCompanies)} → ${word(after.maxCompanies)}`, users: `${word(before.maxUsers)} → ${word(after.maxUsers)}`, reason: p.data.reason },
    );
    const e = await entitlementFor(id);
    res.json({ limits: e.limits, set: after });
  }),
);

/** One module: on (added on top of the plan), off (taken away), or back to what the plan says. */
opsLimitsRouter.post('/ops/accounts/:id/features/:key', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: switch a customer feature', async () => {
    const id = String(req.params.id);
    const key = String(req.params.key);
    const p = featureBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Choose on, off or the plan, and say why.' });
    if (!(await account(id))) return res.status(404).json({ error: 'No such customer' });
    const { row, list, inPlan } = await switchable(id);
    const item = list.find(({ f }) => f.key === key);
    if (!item) return res.status(404).json({ error: 'This customer does not have the app that feature belongs to.' });
    const planHas = inPlan(key, item.app);
    let extras = splitKeys(row?.extraFeatures).filter((k) => k !== key);
    let removed = splitKeys(row?.removedFeatures).filter((k) => k !== key);
    if (p.data.state === 'on') {
      if (planHas && !splitKeys(row?.removedFeatures).includes(key)) return res.status(409).json({ error: 'Their plan already has it.' });
      /* A module cannot run without what it needs. */
      const e = await entitlementFor(id);
      const parent = item.f.dependsOn;
      if (parent && !e.features.has(parent)) {
        const name = FEATURE_CATALOG.find((x) => x.key === parent)?.label || parent;
        return res.status(409).json({ error: `Turn on ${name} first; this needs it.` });
      }
      if (!planHas) extras = [...extras, key];
    } else if (p.data.state === 'off') {
      removed = [...removed, key];
    }
    const data = { extraFeatures: join(extras), removedFeatures: join(removed) };
    if (data.extraFeatures === join(splitKeys(row?.extraFeatures)) && data.removedFeatures === join(splitKeys(row?.removedFeatures))) {
      return res.status(409).json({ error: 'Nothing changed.' });
    }
    await save(id, data, req.auth!.userId);
    clearAccessCache();
    const action = p.data.state === 'on' ? 'FEATURE_TURNED_ON' : p.data.state === 'off' ? 'FEATURE_TURNED_OFF' : 'FEATURE_BACK_TO_PLAN';
    await audit(req, action, { accountId: id }, { feature: item.f.label, reason: p.data.reason });
    res.json({ key, state: p.data.state });
  }),
);
