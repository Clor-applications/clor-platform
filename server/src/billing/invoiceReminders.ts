import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { LeaseLost, currentLease, exclusive, leaseFor } from '../services/jobLease.js';
import { registerJob } from '../services/jobRegistry.js';
import { sendInvoiceEmail } from './invoiceEmail.js';
import { invoicing, type Reminders } from './invoicing.js';
import { PaymentsError } from './providers.js';

/**
 * Automatic reminders to pay an issued invoice (owner, 17 Nov 2026), on the
 * schedule staff set in Money, Invoice settings: so many days before the due
 * date, on the due date, and so many days after it.
 *
 * This writes to customers, so every doubt is settled by not sending:
 *
 *  - Off until a person switches it on (`reminders.on === true`), and an
 *    invoice issued before the switch was FIRST turned on (`reminders.since`)
 *    is never reminded. No `since` on record: nothing is sent.
 *  - Only an ISSUED invoice with a due date, whose own switch is not off,
 *    which has had fewer reminders than the cap (reminders sent by hand count),
 *    of an account that is not suspended.
 *  - Only between 09:00 and 19:00 in India. Days are days in India.
 *  - One step at a time: the latest one whose day has come. A step's day is
 *    that day; a run that was missed still sends it the next day, and after
 *    that it is dropped, so switching reminders on again after a pause does
 *    not send a pile of old ones. A step whose day is the day the invoice was
 *    issued, or before it, is never sent: the invoice itself just went.
 *  - Never an earlier step after a later one, and never the same step twice:
 *    the record is BillingInvoiceSend, whose unique key
 *    (`<invoiceId>:auto:<step>`) makes a second run or a second server send
 *    nothing (invoiceEmail.ts writes the record before the mail goes).
 *
 * The wording is chosen by invoiceEmail.ts when the mail goes: the overdue
 * one once the due date has passed.
 */
const EVERY_MS = 3600_000;
const DAY = 86_400_000;
/** A step missed on its day is still sent this many days later, then dropped. */
export const LATE_DAYS = 1;
/** India time, 09:00 up to 19:00. */
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 19;
const MOST_AT_ONCE = 2000;

export type Step = `before:${number}` | 'due' | `after:${number}`;

const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const daysBetween = (fromKey: string, toKey: string) => Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY);

/** True between 09:00 and 19:00 in India. */
export function inSendingHours(now = new Date()): boolean {
  const hour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

/** Where a step stands against the due date, in days: before:3 is -3, due is 0, after:7 is 7. Null for anything else. */
export function stepOffset(step: string): number | null {
  if (step === 'due') return 0;
  const m = /^(before|after):(\d{1,3})$/.exec(step);
  if (!m) return null;
  return m[1] === 'before' ? -Number(m[2]) : Number(m[2]);
}

/**
 * The one step to send for this invoice today (India's day), or null: the
 * latest step whose day has come, if that day is today or at most LATE_DAYS
 * ago and after the day the invoice was issued. Dates only: whether the
 * invoice may be reminded at all is `runInvoiceReminders`' business.
 */
export function dueStep(inv: { dueDate: Date | null; issueDate: Date | null }, settings: Pick<Reminders, 'daysBefore' | 'onDueDate' | 'daysAfter'>, now = new Date()): Step | null {
  if (!inv.dueDate || !inv.issueDate) return null;
  const today = daysBetween(istDay(inv.dueDate), istDay(now));
  const issued = daysBetween(istDay(inv.dueDate), istDay(inv.issueDate));
  const steps: Array<[number, Step]> = [...settings.daysBefore.map((n): [number, Step] => [-n, `before:${n}`]), ...(settings.onDueDate ? [[0, 'due'] as [number, Step]] : []), ...settings.daysAfter.map((n): [number, Step] => [n, `after:${n}`])];
  const come = steps.filter(([at]) => at <= today).sort((a, b) => b[0] - a[0])[0];
  if (!come) return null;
  const [at, step] = come;
  if (today - at > LATE_DAYS) return null;
  if (at <= issued) return null;
  return step;
}

type Due = { id: string; accountId: string; step: Step };

/**
 * The invoices a run would mail now, each with its step, whatever the hour and
 * whether or not reminders are on (the caller decides those). Three small
 * reads: the invoices near a step, their suspended accounts, and the automatic
 * reminders they have had.
 */
export async function dueReminders(settings: Reminders, now = new Date(), only?: string[]): Promise<Due[]> {
  /* Never switched on: nothing issued so far may be reminded, whatever else is set. */
  if (!settings.since) return [];
  const since = new Date(settings.since);
  if (!Number.isFinite(since.getTime())) return [];
  const furthestBefore = Math.max(0, ...settings.daysBefore);
  const furthestAfter = Math.max(0, ...settings.daysAfter);
  return outsideTenant('billing: invoices to remind', async () => {
    const rows = await platformPrisma.billingInvoice.findMany({
      where: {
        ...(only ? { accountId: { in: only } } : {}),
        status: 'ISSUED',
        remindersOff: false,
        issueDate: { gte: since },
        reminderCount: { lt: settings.cap },
        /* A day wider on each side than the furthest step: the day keys below decide exactly. */
        dueDate: { not: null, gte: new Date(now.getTime() - (furthestAfter + LATE_DAYS + 1) * DAY), lte: new Date(now.getTime() + (furthestBefore + 1) * DAY) },
      },
      orderBy: { dueDate: 'asc' },
      take: MOST_AT_ONCE,
      select: { id: true, accountId: true, issueDate: true, dueDate: true },
    });
    const stepped = rows.map((r) => ({ id: r.id, accountId: r.accountId, step: dueStep(r, settings, now) })).filter((r): r is Due => r.step !== null);
    if (!stepped.length) return [];
    const [suspended, had] = await Promise.all([
      platformPrisma.account.findMany({ where: { id: { in: [...new Set(stepped.map((r) => r.accountId))] }, suspendedAt: { not: null } }, select: { id: true } }),
      platformPrisma.billingInvoiceSend.findMany({ where: { invoiceId: { in: stepped.map((r) => r.id) }, auto: true, kind: 'REMINDER' }, select: { invoiceId: true, step: true } }),
    ]);
    const stopped = new Set(suspended.map((a) => a.id));
    /* The latest automatic step each invoice has had. One the code cannot read counts as the latest of all: nothing more goes. */
    const latest = new Map<string, number>();
    for (const s of had) latest.set(s.invoiceId, Math.max(latest.get(s.invoiceId) ?? -Infinity, stepOffset(s.step) ?? Infinity));
    return stepped.filter((r) => !stopped.has(r.accountId) && (latest.get(r.id) ?? -Infinity) < stepOffset(r.step)!);
  });
}

/** For Invoice settings: how many invoices the job would mail today as things are saved, and how many it would if it were on. */
export async function reminderForecast(settings: Reminders, now = new Date()): Promise<{ wouldRemindToday: number; wouldRemindIfOn: number }> {
  const n = (await dueReminders(settings, now)).length;
  return { wouldRemindToday: settings.on ? n : 0, wouldRemindIfOn: n };
}

export type InvoiceReminderRun = { sent: number; skipped: number; failed: number; why?: 'OFF' | 'OUTSIDE_HOURS' | 'STOPPED' };

/** One pass (`only`: just these accounts, for tests). */
export async function runInvoiceReminders(now = new Date(), only?: string[]): Promise<InvoiceReminderRun> {
  const out: InvoiceReminderRun = { sent: 0, skipped: 0, failed: 0 };
  const { reminders } = await invoicing();
  /* Exactly `true`, and a first-switched-on time on record: anything else is off. */
  if (reminders.on !== true || !reminders.since) return { ...out, why: 'OFF' };
  if (!inSendingHours(now)) return { ...out, why: 'OUTSIDE_HOURS' };
  for (const inv of await dueReminders(reminders, now, only)) {
    try {
      /* Another instance has the job now, or this one is stopping: what is left waits for the next run. */
      await currentLease()?.assertHeld();
    } catch (e) {
      if (e instanceof LeaseLost) return { ...out, why: 'STOPPED' };
      throw e;
    }
    try {
      /* Reads the invoice again and refuses unless it is still issued and its reminders still on. */
      const r = await sendInvoiceEmail(inv.id, { kind: 'REMINDER', step: inv.step, auto: true, userId: null });
      if (r.sent) out.sent += 1;
      else out.skipped += 1;
    } catch (e) {
      /* Paid or cancelled a moment ago, or no one to write to: not sent, and not a fault. */
      if (e instanceof PaymentsError) out.skipped += 1;
      else {
        out.failed += 1;
        console.error(`[billing.invoiceReminders] invoice ${inv.id} not reminded:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return out;
}

export function startInvoiceReminders({ intervalMs = EVERY_MS, startupDelayMs = 300_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('billing.invoiceReminders', leaseFor(intervalMs), () => runInvoiceReminders(), { idempotent: true })
      .then((r) => r && (r.sent || r.failed) && console.log('[billing.invoiceReminders]', JSON.stringify(r)))
      .catch((e) => console.error('[billing.invoiceReminders] failed:', e instanceof Error ? e.message : e));
  registerJob('billing.invoiceReminders', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
