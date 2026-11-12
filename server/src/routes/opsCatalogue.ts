import { Router } from 'express';
import cors from 'cors';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { APP_LISTING, LISTING_STATUSES, type Listing } from '../constants/appListing.js';
import { audit } from './ops.js';

/**
 * The app catalogue (operator console, Product; roadmap item 14): which apps
 * clor.in and the app switcher show, as Available, Coming soon or Hidden, and
 * the one line under each. The owner changes it; everybody may read it.
 */

/** The catalogue as it stands: built-in entries with any change an operator made on top. */
export async function appListing(): Promise<(Listing & { changed: boolean; updatedAt: Date | null })[]> {
  const rows = await outsideTenant('app catalogue: read', () => platformPrisma.appCatalogueEntry.findMany());
  const by = new Map(rows.map((r) => [r.code, r]));
  return APP_LISTING.map((a) => {
    const r = by.get(a.code);
    return { ...a, status: (r?.status as Listing['status']) || a.status, blurb: r?.blurb || a.blurb, changed: Boolean(r), updatedAt: r?.updatedAt || null };
  });
}

/* ------------------------------------------------------------------ public */

export const publicAppCatalogueRouter = Router();
/* clor.in reads it from the browser: any origin, no credentials, GET only. */
export const appCatalogueCors = cors({ origin: true, methods: ['GET'], credentials: false, maxAge: 7200 });

/** Read-only, no sign-in: what clor.in and the app switcher list. Hidden apps are left out. */
publicAppCatalogueRouter.get('/public/app-catalogue', async (_req, res) => {
  const list = await appListing();
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ apps: list.filter((a) => a.status !== 'HIDDEN').map(({ code, appId, name, status, blurb }) => ({ code, appId, name, status, blurb })) });
});

/* ---------------------------------------------------------------- operator */

export const opsCatalogueRouter = Router();
opsCatalogueRouter.use('/ops/apps', requireAuth, requireOperator);

opsCatalogueRouter.get('/ops/apps', (_req, res) =>
  outsideTenant('ops: app catalogue', async () => {
    res.json({ apps: await appListing() });
  }),
);

const entryBody = z.object({
  status: z.enum(LISTING_STATUSES as [string, ...string[]]),
  blurb: z.string().trim().min(3, 'Write the one line people read.').max(160, 'Keep it to one line: 160 characters at most.'),
  reason: z.string().trim().min(3, 'Say why, in a sentence.').max(500),
});

/** Change how one app is listed. Owners only. */
opsCatalogueRouter.put('/ops/apps/:code', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change app catalogue', async () => {
    const code = String(req.params.code);
    const base = APP_LISTING.find((a) => a.code === code);
    if (!base) return res.status(404).json({ error: 'No such app.' });
    const parsed = entryBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the entry.' });
    if (code === 'workspace' && parsed.data.status !== 'AVAILABLE') return res.status(400).json({ error: 'Workspace is where every customer manages their account; it cannot be hidden or marked coming soon.' });
    const before = (await appListing()).find((a) => a.code === code)!;
    const data = { status: parsed.data.status, blurb: parsed.data.blurb, updatedByUserId: req.auth!.userId };
    await platformPrisma.appCatalogueEntry.upsert({ where: { code }, create: { code, ...data }, update: data });
    await audit(req, 'APP_CATALOGUE_CHANGED', {}, { app: base.name, from: before.status, to: parsed.data.status, blurb: parsed.data.blurb !== before.blurb ? parsed.data.blurb : undefined, reason: parsed.data.reason });
    res.json({ apps: await appListing() });
  }),
);
