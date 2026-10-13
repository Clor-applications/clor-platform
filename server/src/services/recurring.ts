import { prisma } from '../utils/prisma.js';

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

export type RunSummary = { raised: number; schedules: number; skipped: number };

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

  let raised = 0;
  let skipped = 0;
  let touchedSchedules = 0;

  for (const schedule of schedules) {
    let run = schedule.nextRunDate;
    let count = schedule.generatedCount;
    let guard = 0;
    let touched = false;

    let template: any = {};
    try {
      template = JSON.parse(schedule.templateJson || '{}');
    } catch {
      // A schedule whose template will not parse cannot raise anything, and
      // must not stop the schedules after it.
      continue;
    }

    while (
      run &&
      run <= upTo &&
      guard < CATCH_UP_LIMIT &&
      (!schedule.endDate || run <= schedule.endDate) &&
      (schedule.maxOccurrences === null || count < schedule.maxOccurrences)
    ) {
      guard += 1;
      const periodDate = run;

      /*
       * Claim the period first, raise the invoice second.
       *
       * The claim is the unique row. If another instance already has this
       * period the create throws P2002 and this one moves on — so the worst a
       * race can do is nothing, rather than billing twice.
       */
      let claimId: string | null = null;
      try {
        const claim = await prisma.recurringScheduleRun.create({
          data: { accountId: schedule.accountId, orgId: schedule.orgId, scheduleId: schedule.id, periodDate },
        });
        claimId = claim.id;
      } catch (e: any) {
        if (String(e?.code) === 'P2002') {
          skipped += 1;
          run = advanceRunDate(run, schedule.frequency, schedule.interval);
          continue;
        }
        throw e;
      }

      const items = Array.isArray(template.items) ? template.items : [];
      const invoice = await prisma.invoice.create({
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
          number: `DRAFT/${schedule.id.slice(-6)}/${periodDate}`,
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
      });

      await prisma.recurringScheduleRun.update({
        where: { id: claimId },
        data: { invoiceId: invoice.id },
      });

      raised += 1;
      count += 1;
      touched = true;
      run = advanceRunDate(run, schedule.frequency, schedule.interval);
    }

    if (touched) {
      touchedSchedules += 1;
      await prisma.recurringSchedule.update({
        where: { id: schedule.id },
        data: { nextRunDate: run, generatedCount: count, lastRunAt: new Date() },
      });
    }
  }

  return { raised, schedules: touchedSchedules, skipped };
}
