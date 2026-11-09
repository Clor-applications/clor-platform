import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { endExplorePass, passSummary, resendExplorePass } from '../services/explore.js';
import { SampleBuildBusy, sampleCompanyStatus, startSampleBuild } from '../services/sampleBuild.js';
import { audit } from './ops.js';

/**
 * Explore in the operator console: the sample company and every Explore link.
 *
 * The owner's rule is that Clor's own staff work happens on screens, not in
 * scripts: the sample company is built and rebuilt here (the same build as
 * `npm run seed:sample`), and the links of every demo request are listed,
 * resent and ended here. Reading needs an operator; every change needs the
 * support or billing role, a step-up, and goes on the operator log.
 */
export const opsExploreRouter = Router();

opsExploreRouter.use('/ops/explore', requireAuth, requireOperator);

/** Whether the sample company is there, when it was last built, what is in it, and how its build is going. */
opsExploreRouter.get('/ops/explore/sample', async (_req, res) => {
  res.json(await sampleCompanyStatus());
});

const buildBody = z.object({ force: z.boolean().optional() });

/** Build (or, with force, rebuild) the sample company, in the background. */
opsExploreRouter.post('/ops/explore/sample/build', requireOperatorRole('SUPPORT', 'BILLING'), requireOperatorStepUp, async (req, res) => {
  const parsed = buildBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const force = Boolean(parsed.data.force);
  try {
    const build = await startSampleBuild({ force });
    await audit(req, force ? 'EXPLORE_SAMPLE_REBUILT' : 'EXPLORE_SAMPLE_BUILT', {}, { force });
    res.status(202).json({ build });
  } catch (e) {
    if (e instanceof SampleBuildBusy) return res.status(409).json({ error: e.message, code: 'SAMPLE_BUILD_RUNNING' });
    throw e;
  }
});

const listQuery = z.object({
  state: z.enum(['all', 'active', 'expired', 'ended']).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
});
const PAGE = 25;

/** Every Explore link, newest first, with the request it came from. */
opsExploreRouter.get('/ops/explore/passes', (req, res) =>
  outsideTenant('ops: explore links', async () => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { state = 'all', page = 0 } = parsed.data;
    const now = new Date();
    const where =
      state === 'active'
        ? { revokedAt: null, expiresAt: { gt: now } }
        : state === 'expired'
          ? { revokedAt: null, expiresAt: { lte: now } }
          : state === 'ended'
            ? { revokedAt: { not: null } }
            : {};
    const [total, rows, active] = await Promise.all([
      platformPrisma.explorePass.count({ where }),
      platformPrisma.explorePass.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE }),
      platformPrisma.explorePass.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    const ids = [...new Set(rows.map((r) => r.demoRequestId).filter(Boolean))] as string[];
    const requests = ids.length ? await platformPrisma.demoRequest.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, company: true } }) : [];
    const byId = new Map(requests.map((r) => [r.id, r]));
    res.json({
      total,
      page,
      pageSize: PAGE,
      active,
      passes: rows.map((p) => ({ ...passSummary(p), demoRequest: p.demoRequestId ? byId.get(p.demoRequestId) || { id: p.demoRequestId, name: null, company: null } : null })),
    });
  }),
);

/** Resend one link (a new link; an ended or run-out one opens again for 14 days). */
opsExploreRouter.post('/ops/explore/passes/:id/resend', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: resend an Explore link', async () => {
    const id = String(req.params.id);
    const pass = await platformPrisma.explorePass.findUnique({ where: { id } });
    if (!pass) return res.status(404).json({ error: 'No such link' });
    const r = pass.demoRequestId ? await platformPrisma.demoRequest.findUnique({ where: { id: pass.demoRequestId }, select: { name: true, apps: true } }) : null;
    const done = await resendExplorePass(id, r?.name || '', r?.apps || (pass.app ? [pass.app] : []));
    await audit(req, 'EXPLORE_RESENT', {}, { demoRequestId: pass.demoRequestId || undefined, explorePassId: id, reopened: Boolean(done?.reopened), first: false });
    res.json({ explore: passSummary(done?.pass) });
  }),
);

/** End one link: it stops working and every session it opened ends. */
opsExploreRouter.post('/ops/explore/passes/:id/end', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: end an Explore link', async () => {
    const id = String(req.params.id);
    const pass = await platformPrisma.explorePass.findUnique({ where: { id }, select: { id: true, demoRequestId: true } });
    if (!pass) return res.status(404).json({ error: 'No such link' });
    const done = await endExplorePass(id, req.auth!.userId);
    await audit(req, 'EXPLORE_ENDED', {}, { demoRequestId: pass.demoRequestId || undefined, explorePassId: id, sessionsEnded: done?.sessionsEnded ?? 0 });
    res.json({ explore: passSummary(done?.pass), sessionsEnded: done?.sessionsEnded ?? 0 });
  }),
);
