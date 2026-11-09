import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';

/**
 * One live payment per payslip, held by the database (audit 7 Nov 2026, #5;
 * review of #145, S3).
 *
 * Migration 20261107100000_run_integrity builds the partial unique index
 * PayrollPaymentLine_live_slip_key, unless a payslip is already in two live
 * payments: a migration cannot choose which bank file is the wrong one, so it
 * warns and leaves the index out. This keeps that from being forgotten:
 *
 *  - `liveLineHealth()` says whether the index is there and, company by
 *    company, which payslips are in more than one live payment;
 *  - the integrity check (services/integrity/checks.ts) reports those payslips
 *    for each company, nightly and on demand;
 *  - `ensureLiveLineIndex()`, run at start and nightly, builds the index the
 *    first time the data is clean, i.e. once somebody has cancelled the extra
 *    batch. Nothing is cancelled for them.
 */

export const LIVE_LINE_INDEX = 'PayrollPaymentLine_live_slip_key';

export type LiveLineClash = { orgId: string; slipId: string; paymentIds: string[] };

export async function liveLineIndexPresent(): Promise<boolean> {
  const rows = await outsideTenant('payroll: is the live payment index built', () =>
    payrollPrisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ${LIVE_LINE_INDEX}`
  );
  return Number(rows[0]?.n || 0) > 0;
}

/** Payslips in more than one live (PENDING or PAID) payment line; one company, or every one. */
export async function liveLineClashes(orgId?: string): Promise<LiveLineClash[]> {
  const run = () =>
    payrollPrisma.payrollPaymentLine.groupBy({
      by: ['orgId', 'slipId'],
      where: { status: { in: ['PENDING', 'PAID'] }, ...(orgId ? { orgId } : {}) },
      _count: { _all: true },
      having: { slipId: { _count: { gt: 1 } } },
    });
  const groups = orgId ? await run() : await outsideTenant('payroll: live payment clashes, every company', run);
  if (!groups.length) return [];
  const lines = await (orgId
    ? payrollPrisma.payrollPaymentLine.findMany({ where: { orgId, status: { in: ['PENDING', 'PAID'] }, slipId: { in: groups.map((g) => g.slipId) } }, select: { orgId: true, slipId: true, paymentId: true } })
    : outsideTenant('payroll: live payment clashes, every company', () =>
        payrollPrisma.payrollPaymentLine.findMany({ where: { status: { in: ['PENDING', 'PAID'] }, slipId: { in: groups.map((g) => g.slipId) } }, select: { orgId: true, slipId: true, paymentId: true } })
      ));
  return groups.map((g) => ({
    orgId: g.orgId,
    slipId: g.slipId,
    paymentIds: lines.filter((l) => l.slipId === g.slipId && l.orgId === g.orgId).map((l) => l.paymentId),
  }));
}

export async function liveLineHealth() {
  const present = await liveLineIndexPresent();
  const clashes = await liveLineClashes();
  return { indexPresent: present, clashes, companies: [...new Set(clashes.map((c) => c.orgId))] };
}

/**
 * Build the index when it is missing and nothing stands in its way. Returns
 * what it found, so the caller can log it. Safe to run on every instance: the
 * statement is IF NOT EXISTS, and the database refuses it outright if a clash
 * appeared between the check and the build.
 */
export const LIVE_LINE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "${LIVE_LINE_INDEX}" ON "PayrollPaymentLine"("slipId") WHERE "status" IN ('PENDING', 'PAID')`;

/** `build` runs the statement; the API's own connection unless a caller (the test suite, as the table owner) passes another. */
export async function ensureLiveLineIndex(
  build: (sql: string) => Promise<unknown> = (sql) => outsideTenant('payroll: build the live payment index', () => payrollPrisma.$executeRawUnsafe(sql)),
): Promise<{ indexPresent: boolean; built: boolean; clashes: LiveLineClash[] }> {
  if (await liveLineIndexPresent()) return { indexPresent: true, built: false, clashes: [] };
  const clashes = await liveLineClashes();
  if (clashes.length) {
    const companies = [...new Set(clashes.map((c) => c.orgId))];
    console.warn(
      `[payroll] ${LIVE_LINE_INDEX} is missing: ${clashes.length} payslip(s) in ${companies.length} company(ies) are in two live salary payments (${companies.join(', ')}). Cancel the extra batch; the index is built on the next check.`
    );
    return { indexPresent: false, built: false, clashes };
  }
  try {
    await build(LIVE_LINE_INDEX_SQL);
    console.log(`[payroll] ${LIVE_LINE_INDEX} built: no payslip is in two live payments any more.`);
    return { indexPresent: true, built: true, clashes: [] };
  } catch (e) {
    console.error(`[payroll] ${LIVE_LINE_INDEX} could not be built:`, e instanceof Error ? e.message : e);
    return { indexPresent: false, built: false, clashes: [] };
  }
}
