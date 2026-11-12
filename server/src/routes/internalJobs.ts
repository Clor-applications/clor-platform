import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

import { registeredJobs, runRegisteredJobs } from '../services/jobRegistry.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { failedEvents } from '../services/people/outbox.js';

/**
 * The wake call for background jobs (services/jobRegistry.ts).
 *
 * Cloud Scheduler posts here every few minutes, through api.clor.in like any
 * other caller, with `x-jobs-token: <JOBS_TOKEN>` (a Secret Manager value).
 * Without JOBS_TOKEN set, the route does not exist (404): a deployment that
 * has not set it up cannot be woken by anyone, and nothing guesses a token.
 *
 * The answer lists each job, whether its tick finished in time, and how long
 * it took, so the scheduler's own log shows a failing job; a job that threw
 * makes the whole call 500, so the scheduler retries it (each job is
 * guarded by its lease, so the retry does not double anything).
 */
export const internalJobsRouter = Router();

const digest = (s: string) => createHash('sha256').update(s).digest();
const tokenOk = (got: string | undefined) => {
  const want = process.env.JOBS_TOKEN;
  return Boolean(want && got && timingSafeEqual(digest(got), digest(want)));
};

internalJobsRouter.post('/internal/jobs/tick', async (req, res) => {
  if (!process.env.JOBS_TOKEN) return res.status(404).json({ error: 'Not found' });
  if (!tokenOk(req.get('x-jobs-token'))) return res.status(401).json({ error: 'Unauthorized' });
  const only = Array.isArray(req.body?.only) ? req.body.only.map(String) : undefined;
  /* The request runs in a strict scope with no company (beginRequestScope), where row
     security shows nothing. The jobs work across every company, as they do from the
     in-process timer, so they run outside it; each enters a company itself (runInTenant). */
  const runs = await outsideTenant('jobs: wake call', () => runRegisteredJobs({ only }));
  const failed = runs.filter((r) => !r.ok && !r.timedOut);
  res.status(failed.length ? 500 : 200).json({ ran: runs.length, failed: failed.length, runs });
});

internalJobsRouter.get('/internal/jobs', (req, res) => {
  if (!process.env.JOBS_TOKEN) return res.status(404).json({ error: 'Not found' });
  if (!tokenOk(req.get('x-jobs-token'))) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ jobs: registeredJobs() });
});

/** People outbox events that used every retry (leave and request notices among them), with their last error. */
internalJobsRouter.get('/internal/outbox/failed', async (req, res) => {
  if (!process.env.JOBS_TOKEN) return res.status(404).json({ error: 'Not found' });
  if (!tokenOk(req.get('x-jobs-token'))) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ events: await failedEvents(Number(req.query.limit) || 100) });
});
