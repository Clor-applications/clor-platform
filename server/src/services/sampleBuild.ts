import { platformPrisma } from '../utils/platformPrisma.js';
import { prisma } from '../utils/prisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { exclusive } from './jobLease.js';
import { ensureSampleCompany, SAMPLE } from './sampleCompany.js';
import { sampleOrgIdOrNull } from './sampleIdentity.js';

/**
 * Building Explore's sample company from the operator console
 * (routes/opsExplore.ts), so nobody has to run a script.
 *
 * The build is the same one `npm run seed:sample` runs (ensureSampleCompany):
 * safe to run again, adding only what is missing. "Rebuild" is its `force`:
 * every step runs again even though the company says it is filled.
 *
 * It runs in the background under a job lease, so two operators (or two API
 * instances) never build at once, and each run is a JobRun row — started,
 * finished, failed and why — that every instance can read. The steps done so
 * far are known only to the instance running it; another instance shows
 * "building" without them.
 */
export const SAMPLE_BUILD_JOB = 'explore-sample-build';
/* The lease is renewed while the build runs; a build cut off mid-way frees it within a few minutes. */
const LEASE_MS = 60_000;
/* A RUNNING row older than this was cut off (the instance stopped); it no longer blocks a new build. */
const STALE_MS = 30 * 60_000;

type Here = {
  force: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  state: 'running' | 'done' | 'failed';
  /** The fill's steps finished so far, in its own words (sampleCompanyData.ts). */
  done: string[];
  problems: string[];
  error: string | null;
};
let here: Here | null = null;

/** Plain words for a fill step's log line ("people: departments, positions, employees (3.1 s)"). */
const stepWords = (line: string) => line.replace(/\s*\(\d+(\.\d+)?\s*s\)\s*$/, '').trim();

export class SampleBuildBusy extends Error {
  constructor() {
    super('The sample company is being built already. Wait for it to finish.');
  }
}

/** Is a build running anywhere (this instance, or a RUNNING row that is not stale)? */
async function runningAnywhere() {
  if (here?.state === 'running') return true;
  const last = await platformPrisma.jobRun.findFirst({ where: { worker: SAMPLE_BUILD_JOB }, orderBy: { startedAt: 'desc' }, select: { outcome: true, startedAt: true } });
  return Boolean(last && last.outcome === 'RUNNING' && Date.now() - last.startedAt.getTime() < STALE_MS);
}

/**
 * Start a build in the background; returns at once. Throws SampleBuildBusy
 * when one is running. `fill` follows EXPLORE_SAMPLE_FILL (off in the
 * server's tests: the skeleton only).
 */
export async function startSampleBuild(opts: { force: boolean }) {
  if (await runningAnywhere()) throw new SampleBuildBusy();
  const run: Here = { force: opts.force, startedAt: new Date(), finishedAt: null, state: 'running', done: [], problems: [], error: null };
  here = run;
  const log = (line: string) => {
    const text = String(line || '').trim();
    if (!text) return;
    if (text.startsWith('!')) {
      if (run.problems.length < 50) run.problems.push(text.replace(/^!\s*/, ''));
    } else if (/\(\d+(\.\d+)?\s*s\)\s*$/.test(text)) {
      run.done.push(stepWords(text));
    }
  };
  void (async () => {
    try {
      const out = await exclusive(SAMPLE_BUILD_JOB, LEASE_MS, async () => {
        await ensureSampleCompany({ fill: String(process.env.EXPLORE_SAMPLE_FILL || 'on').toLowerCase() !== 'off', force: opts.force, log });
        return { problems: run.problems.length };
      });
      if (out === null) {
        run.state = 'failed';
        run.error = 'Another build had just started or finished. Try again in a minute.';
      } else {
        run.state = 'done';
      }
    } catch (e: any) {
      run.state = 'failed';
      run.error = String(e?.message || e).slice(0, 500);
      console.error('[explore] sample build failed', e);
    } finally {
      run.finishedAt = new Date();
    }
  })();
  return buildSummary(run);
}

const buildSummary = (r: Here) => ({
  state: r.state,
  force: r.force,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  done: r.done,
  problems: r.problems,
  error: r.error,
});

/** The latest build: this instance's own when it has one at least as new as the record, else the record. */
async function lastBuild() {
  const row = await platformPrisma.jobRun.findFirst({ where: { worker: SAMPLE_BUILD_JOB }, orderBy: { startedAt: 'desc' } });
  if (here && (!row || here.startedAt.getTime() >= row.startedAt.getTime() - 5_000)) return buildSummary(here);
  if (!row) return null;
  const stale = row.outcome === 'RUNNING' && Date.now() - row.startedAt.getTime() >= STALE_MS;
  let problems = 0;
  try {
    problems = Number(JSON.parse(String(row.counts || '{}')).problems) || 0;
  } catch {
    problems = 0;
  }
  return {
    state: row.outcome === 'RUNNING' && !stale ? 'running' : row.outcome === 'OK' ? 'done' : 'failed',
    force: null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    done: [],
    problems: problems ? [`${problems} step${problems === 1 ? '' : 's'} did not go through (the details are in the server log of that run).`] : [],
    error: stale ? 'The build was cut off before it finished.' : row.error,
  };
}

/** What the console's Sample company screen shows. */
export async function sampleCompanyStatus() {
  return outsideTenant('ops: the sample company', async () => {
    const orgId = await sampleOrgIdOrNull({ fresh: true });
    const now = new Date();
    const [build, livePasses, allPasses] = await Promise.all([
      lastBuild(),
      platformPrisma.explorePass.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      platformPrisma.explorePass.count(),
    ]);
    if (!orgId) return { exists: false, company: SAMPLE.company, builtAt: null, counts: null, livePasses, allPasses, build };
    const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true, profileJson: true } });
    let builtAt: string | null = null;
    try {
      builtAt = JSON.parse(String(org?.profileJson || '{}'))?.sample?.filledAt || null;
    } catch {
      builtAt = null;
    }
    const safe = async (n: () => Promise<number>) => n().catch(() => null);
    const [employees, customers, vendors, items, invoices, bills, payRuns, leaveRequests, attendanceDays] = await Promise.all([
      safe(() => peoplePrisma.employee.count({ where: { orgId } })),
      safe(() => prisma.party.count({ where: { orgId, partyType: { in: ['CUSTOMER', 'BOTH'] } } })),
      safe(() => prisma.party.count({ where: { orgId, partyType: { in: ['VENDOR', 'BOTH'] } } })),
      safe(() => prisma.itemMaster.count({ where: { orgId } })),
      safe(() => prisma.invoice.count({ where: { orgId } })),
      safe(() => prisma.bill.count({ where: { orgId } })),
      safe(() => payrollPrisma.payrollRun.count({ where: { orgId } })),
      safe(() => peoplePrisma.leaveRequest.count({ where: { orgId } })),
      safe(() => peoplePrisma.attendanceRecord.count({ where: { orgId } })),
    ]);
    return {
      exists: true,
      company: org?.name || SAMPLE.company,
      builtAt,
      counts: { employees, customers, vendors, items, invoices, bills, payRuns, leaveRequests, attendanceDays },
      livePasses,
      allPasses,
      build,
    };
  });
}

/** For tests: forget this instance's build. */
export const _forgetSampleBuild = () => {
  here = null;
};
