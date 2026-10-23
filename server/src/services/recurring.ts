import { prisma } from '../utils/prisma.js';
import { isFeatureEnabled } from './features.js';
import { appLive } from './principalAllowed.js';

/**
 * Raising the invoices a schedule is due.
 *
 * This ran in the browser: schedules lived in localStorage and were materialised
 * when somebody signed in. Clearing the browser lost them, nobody signing in
 * meant nobody was billed, and two open tabs could raise the same month twice.
 *
 * Moved here, the guarantee is the `RecurringScheduleRun` row: unique on
 * (schedule, period). A job that runs twice, runs late, or races another
 * instance still produces one invoice per period, because the second attempt
 * collides on that key and stops rather than billing the customer again.
 *
 * What is raised is a DRAFT, deliberately, exactly as before. Nothing reaches
 * the ledger until a person opens it and saves it, so a forgotten schedule
 * cannot quietly bill somebody for a year.
 */

const CATCH_UP_LIMIT = 12;

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  // Jan 31 + 1 month is Feb 28, not Mar 3.
  date.setUTCDate(Math.min(d, lastDay));
  return date.toISOString().slice(0, 10);
};

export const advanceRunDate = (iso: string, frequency: string, interval = 1) => {
  const n = Math.max(1, Math.floor(Number(interval) || 1));
  switch (String(frequency || 'MONTHLY')) {
    case 'WEEKLY': {
      const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7 * n);
      return d.toISOString().slice(0, 10);
    }
    case 'QUARTERLY':
      return addMonths(iso, 3 * n);
    case 'YEARLY':
      return addMonths(iso, 12 * n);
    default:
      return addMonths(iso, 1 * n);
  }
};

/** A draft with no due date can never be overdue, so it needs one. */
const dueDateFrom = (iso: string, dueDays: number) => {
  const n = Number(dueDays);
  if (!Number.isFinite(n) || n < 0) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export type RunSummary = { raised: number; schedules: number; skipped: number; repaired: number; failed: number; gated: number };

/**
 * May this company's schedules raise invoices today? (A-44)
 *
 * The job ran for every active schedule, whether or not the company still had
 * recurring invoices switched on — or Accounting at all. A lapsed account kept
 * collecting drafts. Now both: the feature, and Accounting live (entitled, and
 * the company not on its way to being closed).
 */
async function mayRaise(accountId: string, orgId: string) {
  if (!(await isFeatureEnabled(accountId, orgId, 'recurringInvoices'))) return false;
  return !(await appLive(accountId, orgId, 'accounting'));
}

type Schedule = Awaited<ReturnType<typeof prisma.recurringSchedule.findMany>>[number];

/**
 * One period, all or nothing (A-44).
 *
 * The claim, the invoice, the link between them and the schedule's progress
 * used to be four separate writes. A crash after the claim left a claim with
 * no invoice, every later run collided with it and moved on, and that period
 * was never billed. They are one transaction now, so a crash leaves nothing
 * and the next run raises the period. A claim left without an invoice by the
 * old code is repaired here: its invoice is raised (or, if the draft exists,
 * linked) instead of the period being skipped.
 *
 * The transaction begins by locking the schedule's row, so two runs of one
 * schedule queue behind each other rather than both reading "not yet raised".
 */
async function raisePeriod(schedule: Schedule, template: any, periodDate: string): Promise<'raised' | 'repaired' | 'skipped' | 'done'> {
  return prisma.$transaction(async (tx) => {
    await tx.recurringSchedule.updateMany({ where: { id: schedule.id }, data: { lastRunAt: new Date() } });
    const live = await tx.recurringSchedule.findUnique({ where: { id: schedule.id }, select: { isActive: true, generatedCount: true, maxOccurrences: true } });
    if (!live?.isActive) return 'done';

    const claim = await tx.recurringScheduleRun.findUnique({ where: { scheduleId_periodDate: { scheduleId: schedule.id, periodDate } } });
    if (claim?.invoiceId) return 'skipped';
    if (!claim && live.maxOccurrences !== null && live.generatedCount >= live.maxOccurrences) return 'done';

    const number = `DRAFT/${schedule.id.slice(-6)}/${periodDate}`;
    /* A draft the old code raised but never linked: link it rather than raise a second. */
    const already = claim ? await tx.invoice.findFirst({ where: { orgId: schedule.orgId, number }, select: { id: true } }) : null;
    const items = Array.isArray(template.items) ? template.items : [];
    const invoice =
      already ||
      (await tx.invoice.create({
        data: {
          accountId: schedule.accountId,
          orgId: schedule.orgId,
          branchId: schedule.branchId || '',
          warehouseId: schedule.warehouseId || null,
          /*
           * A provisional marker, not a number.
           *
           * Rule 46(b) wants issued invoices consecutively numbered, and a
           * draft is not issued — so a draft must not consume a series number,
           * or discarding it leaves a hole nobody can explain at filing time.
           * The real number is allotted when a person saves it through the
           * form.
           *
           * It cannot simply be blank: Invoice is unique on (orgId, number)
           * and every draft would collide with the last. Keying the marker to
           * the schedule and the period turns that constraint into a second
           * guarantee — even with the run claim removed, the database itself
           * would refuse to raise one period twice.
           */
          number,
          date: periodDate,
          dueDate: dueDateFrom(periodDate, schedule.dueDays),
          customerId: schedule.partyId,
          customerName: schedule.partyName,
          subtotal: num(template.subtotal),
          cgstTotal: num(template.cgstTotal),
          sgstTotal: num(template.sgstTotal),
          igstTotal: num(template.igstTotal),
          gstTotal: num(template.gstTotal),
          total: num(template.total),
          paidAmount: 0,
          status: 'Draft',
          itemsJson: JSON.stringify(items),
          createdByUserId: schedule.createdByUserId,
        },
        select: { id: true },
      }));

    if (claim) {
      await tx.recurringScheduleRun.update({ where: { id: claim.id }, data: { invoiceId: invoice.id } });
    } else {
      await tx.recurringScheduleRun.create({
        data: { accountId: schedule.accountId, orgId: schedule.orgId, scheduleId: schedule.id, periodDate, invoiceId: invoice.id },
      });
    }
    /* A repaired period whose draft already existed was counted when it was raised. */
    if (!already) await tx.recurringSchedule.update({ where: { id: schedule.id }, data: { generatedCount: { increment: 1 } } });
    const next = advanceRunDate(periodDate, schedule.frequency, schedule.interval);
    await tx.recurringSchedule.updateMany({ where: { id: schedule.id, nextRunDate: { lt: next } }, data: { nextRunDate: next } });
    return claim ? 'repaired' : 'raised';
  });
}

/**
 * @param today  the date to bill up to. Passed in rather than read from the
 *               clock so a test can state what day it is.
 */
export async function runDueSchedules(
  { accountId, orgId, today }: { accountId?: string; orgId?: string; today?: string } = {}
): Promise<RunSummary> {
  const upTo = String(today || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const schedules = await prisma.recurringSchedule.findMany({
    where: {
      isActive: true,
      nextRunDate: { lte: upTo },
      ...(accountId ? { accountId } : {}),
      ...(orgId ? { orgId } : {}),
    },
  });

  const summary: RunSummary = { raised: 0, schedules: 0, skipped: 0, repaired: 0, failed: 0, gated: 0 };
  const allowed = new Map<string, Promise<boolean>>();

  for (const schedule of schedules) {
    const orgKey = `${schedule.accountId}:${schedule.orgId}`;
    if (!allowed.has(orgKey)) allowed.set(orgKey, mayRaise(schedule.accountId, schedule.orgId));
    if (!(await allowed.get(orgKey))) {
      summary.gated += 1;
      continue;
    }

    let template: any = {};
    try {
      template = JSON.parse(schedule.templateJson || '{}');
    } catch {
      // A schedule whose template will not parse cannot raise anything, and
      // must not stop the schedules after it.
      continue;
    }

    let run = schedule.nextRunDate;
    let guard = 0;
    let touched = false;
    try {
      while (run && run <= upTo && guard < CATCH_UP_LIMIT && (!schedule.endDate || run <= schedule.endDate)) {
        guard += 1;
        let outcome: Awaited<ReturnType<typeof raisePeriod>>;
        try {
          outcome = await raisePeriod(schedule, template, run);
        } catch (e: any) {
          /* Another run raised this period at the same moment and won the claim. */
          if (String(e?.code) !== 'P2002') throw e;
          outcome = 'skipped';
        }
        if (outcome === 'done') break;
        if (outcome === 'skipped') summary.skipped += 1;
        else {
          touched = true;
          summary[outcome] += 1;
        }
        run = advanceRunDate(run, schedule.frequency, schedule.interval);
      }
      /* Periods somebody else raised still move the schedule on. */
      if (run !== schedule.nextRunDate) {
        await prisma.recurringSchedule.updateMany({ where: { id: schedule.id, nextRunDate: { lt: run } }, data: { nextRunDate: run } });
      }
    } catch (e) {
      /* Nothing of the failed period was written; the next run raises it. Other schedules carry on. */
      summary.failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[recurring] schedule ${schedule.id} (${schedule.orgId}) failed at ${run}; it will be raised on the next run:`, e instanceof Error ? e.message : e);
    }
    if (touched) summary.schedules += 1;
  }

  return summary;
}
