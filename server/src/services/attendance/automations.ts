import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { addMonths } from '../../utils/istDate.js';
import { resolveAccess } from '../access.js';
import { upsertNotice, usersWithPermission, type Notice } from '../notifications.js';
import { defineRecipe, recipientUsers, type RecipientKind } from '../people/engagement/automations.js';
import { teamScope } from '../people/scope.js';

/**
 * Attendance's ready-made automations (platform audit, 11 Nov 2026: the registry listed Attendance but
 * nothing was defined, so its Automations screen was empty). Each is a plain sentence with a switch and one
 * number of days, run by the daily job (`people.automations`) once per company and day, and each starts off.
 *
 *  - last month still not locked: a reminder every morning from the chosen day until the month is locked;
 *  - readers gone quiet: every morning, the readers that have sent nothing for the chosen days. Reader health
 *    already raises one alert when a reader stops reporting; this is the list that keeps coming back until
 *    somebody fixes it;
 *  - attendance fixes waiting: each approver hears how many requests in their reach have waited the chosen days.
 *
 * The missing-punch reminder and the absence check stay where they are (People's list, set under Attendance
 * rules): one recipe, one place.
 *
 * A standing reminder is one notice per person, refreshed each morning (`upsertNotice`), not a new row a day.
 */

const TO_HR = { default: ['HR'], options: ['HR', 'OWNER', 'PERSON'] as RecipientKind[] };
const MORNING = { job: 'people.automations', when: 'Every morning', channels: ['bell' as const] };
const CLOSING = 'Closing the month';
const READERS = 'Readers';
const REQUESTS = 'Requests';

const namesOf = async (ids: string[]) => new Map((ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id, u.fullName]));
const monthWords = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Tells each of `ids` once (one refreshed notice per person); who was told, and how many could not be. */
async function tell(ctx: { accountId: string; orgId: string }, ids: string[], notice: Notice, key: string) {
  const names = await namesOf(ids);
  const told: string[] = [];
  let failed = 0;
  for (const id of ids) {
    try {
      if (await upsertNotice(ctx.accountId, ctx.orgId, id, notice, key)) told.push(names.get(id) || 'A user');
    } catch (e) {
      console.error('[automations] attendance notice not sent:', e instanceof Error ? e.message : e);
      failed += 1;
    }
  }
  return { count: told.length, recipients: told, failed };
}

export const monthNotLocked = defineRecipe({
  module: 'attendance', key: 'monthNotLocked', group: CLOSING,
  sentence: 'Remind each morning when last month is still not locked {n} days into the month',
  defaultOn: false, n: { default: 5, min: 1, max: 28 }, ...MORNING, recipients: TO_HR,
  run: async ({ accountId, orgId, today, n, to }) => {
    if (Number(today.slice(8, 10)) < (n ?? 5)) return { count: 0, recipients: [] };
    const month = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const [lock, used] = await Promise.all([
      peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } }, select: { id: true } }),
      /* A company with no attendance that month (it started this month, or does not keep attendance) has nothing to lock. */
      peoplePrisma.attendanceRecord.findFirst({ where: { orgId, date: { gte: `${month}-01`, lte: `${month}-31` } }, select: { id: true } }),
    ]);
    if (lock || !used) return { count: 0, recipients: [] };
    const ids = await recipientUsers({ accountId, orgId }, to, { fallback: TO_HR.default });
    return tell({ accountId, orgId }, ids, {
      kind: 'attendance.month_open',
      title: `${monthWords(month)} attendance is not locked yet`,
      body: 'Check the month-close list and lock the month, so payroll works from days that no longer change.',
      link: { app: 'attendance', screen: 'monthClose' },
    }, `attendance-month-open:${month}`);
  },
});

export const readersSilent = defineRecipe({
  module: 'attendance', key: 'readersSilent', group: READERS,
  sentence: 'List each morning the readers that have sent nothing for {n} days',
  defaultOn: false, n: { default: 2, min: 1, max: 30 }, ...MORNING, recipients: TO_HR,
  run: async ({ accountId, orgId, n, now, to }) => {
    const days = n ?? 2;
    /* A reader that never connected is being set up, not silent: Reader health says so on its own. */
    const quiet = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, isActive: true, lastSeenAt: { lte: new Date(now.getTime() - days * 86_400_000) } }, orderBy: { lastSeenAt: 'asc' }, select: { name: true, lastSeenAt: true } });
    if (!quiet.length) return { count: 0, recipients: [] };
    const ids = await recipientUsers({ accountId, orgId }, to, { fallback: TO_HR.default });
    const names = quiet.slice(0, 5).map((d) => d.name).join(', ');
    return tell({ accountId, orgId }, ids, {
      kind: 'reader.silent',
      title: quiet.length === 1 ? `${quiet[0].name} has sent nothing for ${days} ${days === 1 ? 'day' : 'days'} or more` : `${quiet.length} readers have sent nothing for ${days} ${days === 1 ? 'day' : 'days'} or more`,
      body: `${quiet.length === 1 ? '' : `${names}${quiet.length > 5 ? ` and ${quiet.length - 5} more` : ''}. `}Punches made there stay on the reader until it reconnects: check its power and network.`,
      link: { app: 'attendance', screen: 'readerHealth' },
    }, 'readers-silent');
  },
});

const APPROVES_REQUESTS = 'ATTENDANCE::Attendance Requests::APPROVE';

export const requestsWaiting = defineRecipe({
  module: 'attendance', key: 'requestsWaiting', group: REQUESTS,
  sentence: 'Remind approvers of attendance fixes waiting {n} days',
  defaultOn: false, n: { default: 2, min: 1, max: 14 }, ...MORNING,
  run: async ({ accountId, orgId, n, now }) => {
    const days = n ?? 2;
    const old = await peoplePrisma.attendanceRequest.findMany({ where: { orgId, status: 'PENDING', createdAt: { lte: new Date(now.getTime() - days * 86_400_000) } }, select: { employeeId: true, requestedByUserId: true }, take: 2000 });
    if (!old.length) return { count: 0, recipients: [] };
    const approvers = await usersWithPermission(accountId, orgId, APPROVES_REQUESTS);
    const names = await namesOf(approvers);
    const told: string[] = [];
    let failed = 0;
    for (const userId of approvers) {
      /* What this approver could decide: their team's (a team-only role) or the company's, never their own. */
      const access = await resolveAccess(accountId, orgId, userId);
      const scope = await teamScope({ ownDocumentsOnly: access.ownDocumentsOnly, tenant: { orgId }, auth: { userId } } as any);
      const mine = old.filter((r) => r.requestedByUserId !== userId && (scope.all || (scope.ids.includes(r.employeeId) && r.employeeId !== scope.selfId)));
      if (!mine.length) continue;
      try {
        const sent = await upsertNotice(accountId, orgId, userId, {
          kind: 'attendance.requests_waiting',
          title: `${mine.length} attendance ${mine.length === 1 ? 'fix has' : 'fixes have'} waited ${days} ${days === 1 ? 'day' : 'days'} or more`,
          body: 'Approve or reject them so the days can be closed.',
          link: { app: 'attendance', screen: 'requests' },
        }, 'attendance-requests-waiting');
        if (sent) told.push(names.get(userId) || 'An approver');
      } catch (e) {
        console.error('[automations] attendance notice not sent:', e instanceof Error ? e.message : e);
        failed += 1;
      }
    }
    return { count: told.length, recipients: told, failed };
  },
});
