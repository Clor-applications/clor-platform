import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { notifyUsers, usersWithPermission } from '../notifications.js';
import { queueNotice, type DirectNotice } from './notices.js';
import { resolveAccess } from '../access.js';
import { isFeatureEnabled } from '../features.js';
import { activeManagerOf, chainFor, CHAINS, type Chain } from './approvalChain.js';
import { addDays, periodEnd, periodOf } from './leaveAccrual.js';
import { leavePeriodOf } from './leaveBalances.js';
import { today } from './days.js';
import { teamScope } from '../people/scope.js';
import { registerJob } from '../jobRegistry.js';
import { COMP_OFF_REMIND_DAYS, compOffGrants } from './compOff.js';
import { addWorkingDays, REMIND_EVERY_WORKING_DAYS } from '../people/approvals/engine.js';
import { deciders, stepsOf } from './leaveRules.js';
import { handOnLeaveOnEngine, isOnEngine, refreshLeaveSteps } from './leaveEngine.js';
import { automation, recordRun } from '../people/engagement/automations.js';

/**
 * Leave automation that runs on its own (TIME-LEAVE-DECISIONS.md, advanced
 * build), once per instance under a lease:
 *
 *  - hand-on: a request whose manager step has waited longer than the type
 *    allows (LeaveType.handOnAfterDays) goes on to HR, with a line in its
 *    history, so nothing waits on someone who is away;
 *  - the morning digest: one notice a day to each approver with what waits
 *    on them, never one per request;
 *  - lapsing days: the person is told once, 30 days before the period end,
 *    when days of theirs will lapse;
 *  - comp-off that expires: what is left of a day after its last day lapses,
 *    and the person is told a week before (runCompOffExpiry).
 */

const DAY = 86_400_000;

export async function runLeaveHandOns(now = new Date()) {
  const types = await peoplePrisma.leaveType.findMany({ where: { handOnAfterDays: { not: null } }, select: { id: true, orgId: true, handOnAfterDays: true, approval: true } });
  let handed = 0;
  for (const t of types) {
    const company = await chainFor(t.orgId, 'leave');
    const chain: Chain = t.approval && (CHAINS as string[]).includes(t.approval) ? (t.approval as Chain) : company;
    if (chain === 'HR') continue;
    const cutoff = now.getTime() - t.handOnAfterDays! * DAY;
    /* A request under the leave rule follows its own step's due time (runLeaveRuleDues), not the type's hand-on. */
    const open = await peoplePrisma.leaveRequest.findMany({ where: { orgId: t.orgId, leaveTypeId: t.id, status: 'PENDING', managerApprovedAt: null, ruleId: null, createdAt: { lt: new Date(cutoff) } } });
    /* The wait starts when the manager last got it: a change starts it over. */
    const stepStart = (r: { createdAt: Date; history: unknown }) => {
      const h = (Array.isArray(r.history) ? r.history : []) as Array<{ at?: string; what?: string }>;
      const edited = [...h].reverse().find((x) => x.what === 'EDITED');
      return edited?.at ? Math.max(new Date(edited.at).getTime(), r.createdAt.getTime()) : r.createdAt.getTime();
    };
    const waiting = open.filter((r) => stepStart(r) < cutoff);
    for (const r of waiting) {
      /* One request that cannot be handed on (a company with nobody to take it) never stops the rest. */
      try {
      if (!(await activeManagerOf(t.orgId, r.employeeId))) continue;
      const history = [...((Array.isArray(r.history) ? r.history : []) as any[]), { at: now.toISOString(), by: 'system', what: 'HANDED_ON', note: `No decision from the manager in ${t.handOnAfterDays} days` }];
      /* The manager's step counts as taken by nobody: HR decides, and the story says so. */
      /* Only while it still waits for the manager: a decision taken meanwhile is never written over (closure audit, 27 Oct 2026). */
      /* The hand-on and the notice to HR commit together (closure audit O-07). */
      const { tellWaiting } = await import('../../routes/leave.js');
      const claimed = await peopleWrite(t.orgId, async () => {
        /* On the approval engine (2c), the engine's step moves first: HR's step opens, or HR takes the manager's. With nobody to take it, it stays, and nothing is written on the leave. */
        if (await isOnEngine(t.orgId, r) && !(await handOnLeaveOnEngine(t.orgId, r, `Handed on to HR: no decision from the manager in ${t.handOnAfterDays} days`))) return { count: 0 };
        const c = await peoplePrisma.leaveRequest.updateMany({ where: { id: r.id, status: 'PENDING', managerApprovedAt: null, updatedAt: r.updatedAt }, data: { managerApprovedAt: now, managerApprovedById: null, managerNote: `Handed on to HR: no decision in ${t.handOnAfterDays} days`, history } });
        /* Written over meanwhile (a decision): the engine's move is undone with it. */
        if (!c.count) throw Object.assign(new Error('decided meanwhile'), { skip: true });
        await tellWaiting(t.orgId, r.id);
        return c;
      }).catch((e) => { if (e?.skip) return { count: 0 }; throw e; });
      if (!claimed.count) continue;
      await platformPrisma.auditLog
        .create({ data: { accountId: r.accountId, orgId: t.orgId, branchId: '', entity: 'LeaveRequest', entityId: r.id, action: 'HAND_ON', message: `Handed on to HR: no decision from the manager in ${t.handOnAfterDays} days`, metadata: JSON.stringify({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId }), createdByUserId: 'system' } })
        .catch((e) => console.error('[audit] hand-on not recorded:', e instanceof Error ? e.message : e));
      handed += 1;
      } catch (e) {
        console.error(`[leave] hand-on: org ${t.orgId}, request ${r.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return handed;
}

/*
 * The digest and lapse notices are addressed here and delivered by the outbox
 * (attendance/notices.ts), under a key unique per person (Notification
 * dedupeKey): a job that runs twice, or a delivery tried again, sends once.
 * Before queueing, the job skips a person who already has it, sent or queued.
 */
const correlationFor = (userId: string, key: string) => `notice_${key}_${userId}`;
async function alreadyQueued(orgId: string, userId: string, key: string) {
  const sent = await platformPrisma.notification.findUnique({ where: { orgId_userId_dedupeKey: { orgId, userId, dedupeKey: key } }, select: { id: true } });
  if (sent) return true;
  return Boolean(await peoplePrisma.outboxEvent.findFirst({ where: { orgId, correlationId: correlationFor(userId, key) }, select: { id: true } }));
}
async function queueDirect(accountId: string, orgId: string, d: DirectNotice, employeeId: string | null = null) {
  await queueNotice({ accountId, orgId }, 'direct', d as unknown as Record<string, unknown>, { employeeId, correlationId: correlationFor(d.userIds[0], d.dedupeKey) });
}

/** Approvers with something waiting on them, told once a day. */
export async function runLeaveDigest(now = new Date()) {
  const date = today();
  const orgs = await peoplePrisma.leaveRequest.groupBy({ by: ['accountId', 'orgId'], where: { status: 'PENDING' } });
  let sent = 0;
  for (const { accountId, orgId } of orgs) {
    /* People → Settings → Automations (WORKFLOW-GAP-RESEARCH 4.7): a company may switch the digest off. */
    if (!(await automation(orgId, 'leaveDigest')).on) continue;
    let told = 0;
    const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
    const { waitingForReader } = await import('../../routes/leave.js');
    for (const userId of await usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE')) {
      const access = await resolveAccess(accountId, orgId, userId);
      const scope = await teamScope({ ownDocumentsOnly: access.ownDocumentsOnly, tenant: { orgId }, auth: { userId } } as any);
      const waiting = await waitingForReader(orgId, scope, userId);
      if (!waiting.length) continue;
      const key = `leave-digest:${date}`;
      if (await alreadyQueued(orgId, userId, key)) continue;
      const oldest = Math.floor((now.getTime() - waiting[0].createdAt.getTime()) / DAY);
      await queueDirect(accountId, orgId, { userIds: [userId], dedupeKey: key, notice: { kind: 'attendance.leave_digest', title: `${waiting.length} leave ${waiting.length === 1 ? 'request waits' : 'requests wait'} for you${oldest >= 3 ? `; the oldest for ${oldest} days` : ''}`, link: { app, screen: 'leaveRequests' } } });
      sent += 1;
      told += 1;
    }
    await recordRun(accountId, orgId, 'leaveDigest', told);
  }
  return sent;
}

/**
 * Days that will lapse: each person told once, 30 days before the period end,
 * what will go unless taken (the year-end preview, read for them). Pay-outs
 * the year end would make are not "lapsing".
 */
export async function runLapseNotices(date = today()) {
  const { yearEndPreview } = await import('../../routes/leave.js');
  const { dayWords } = await import('../../routes/leave.js');
  const orgs = await peoplePrisma.leaveType.groupBy({ by: ['accountId', 'orgId'], where: { isPaid: true, isActive: true } });
  let sent = 0;
  for (const { accountId, orgId } of orgs) {
    const period = await leavePeriodOf(orgId);
    const year = periodOf(period, date);
    const end = periodEnd(period, year);
    if (date < addDays(end, -30) || date > end) continue;
    const preview = await yearEndPreview(accountId, orgId, year);
    const byPerson = new Map<string, Array<{ leaveType: string; days: number }>>();
    for (const r of preview.rows) {
      const days = Math.round((r.lapse - r.payOut) * 100) / 100;
      if (days <= 0) continue;
      byPerson.set(r.employeeId, [...(byPerson.get(r.employeeId) || []), { leaveType: r.leaveType, days }]);
    }
    if (!byPerson.size) continue;
    const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
    const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...byPerson.keys()] }, userId: { not: null } }, select: { id: true, userId: true } });
    for (const p of people) {
      const key = `leave-lapse:${year}`;
      if (await alreadyQueued(orgId, p.userId!, key)) continue;
      const lines = byPerson.get(p.id)!;
      const total = lines.reduce((a, l) => a + l.days, 0);
      await queueDirect(accountId, orgId, { userIds: [p.userId!], dedupeKey: key, notice: { kind: 'attendance.leave_lapse', title: `${total} ${total === 1 ? 'day' : 'days'} of leave will lapse on ${dayWords(end)}`, body: lines.map((l) => `${l.leaveType}: ${l.days}`).join('; '), link: { app, screen: 'myLeave' } } }, p.id);
      sent += 1;
    }
  }
  return sent;
}

/**
 * What of one person's leave lapses at this period's end, once that end is 30
 * days away or less (the same window and sum as runLapseNotices). The employee
 * app's feed reads it on demand: staff with no CLOR sign-in get no
 * notification, so this is how they hear.
 */
export async function lapseFor(accountId: string, orgId: string, employeeId: string, date = today()) {
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, date);
  const end = periodEnd(period, year);
  if (date < addDays(end, -30) || date > end) return null;
  const { yearEndPreview } = await import('../../routes/leave.js');
  const preview = await yearEndPreview(accountId, orgId, year, [employeeId]);
  const lines = preview.rows
    .filter((r) => r.employeeId === employeeId)
    .map((r) => ({ leaveType: r.leaveType, days: Math.round((r.lapse - r.payOut) * 100) / 100 }))
    .filter((l) => l.days > 0);
  if (!lines.length) return null;
  return { year, end, total: Math.round(lines.reduce((a, l) => a + l.days, 0) * 100) / 100, lines };
}

/**
 * Comp-off that expires (compOff.ts), once a day:
 *
 *  - what is left of a grant after its last day lapses: the grant is marked,
 *    and the days come out of the balance through a ledger row of kind LAPSE,
 *    never more than the person can still take (a year end may have let them
 *    go already);
 *  - a week before a grant's last day, the person is told once what will
 *    expire and when.
 *
 * Runs outside any one company, as every job has since the wake call left the
 * request's scope: the grants that are due are found across companies, then
 * each company's are worked in its own scope. One company that fails is
 * logged and the rest go on. Decided from the database, so a day the job
 * missed is caught up the next time it runs.
 */
export async function runCompOffExpiry(date = today()) {
  const { outsideTenant, runInTenant } = await import('../../utils/tenantScope.js');
  const due = await outsideTenant('job: comp-off expiry', () =>
    peoplePrisma.leaveAdjustment.findMany({
      where: { expiresOn: { not: null, lte: addDays(date, COMP_OFF_REMIND_DAYS) }, lapsedAt: null, reversedAt: null, days: { gt: 0 }, workedOn: { not: null } },
      select: { accountId: true, orgId: true, employeeId: true },
    }),
  );
  const orgs = new Map<string, { accountId: string; employeeIds: Set<string> }>();
  for (const g of due) {
    if (!orgs.has(g.orgId)) orgs.set(g.orgId, { accountId: g.accountId, employeeIds: new Set() });
    orgs.get(g.orgId)!.employeeIds.add(g.employeeId);
  }
  let lapsed = 0;
  let reminded = 0;
  for (const [orgId, o] of orgs) {
    try {
      const out = await runInTenant(orgId, () => compOffExpiryFor(o.accountId, orgId, [...o.employeeIds], date));
      lapsed += out.lapsed;
      reminded += out.reminded;
    } catch (e) {
      console.error(`[comp-off] expiry: org ${orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { lapsed, reminded };
}

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

async function compOffExpiryFor(accountId: string, orgId: string, employeeIds: string[], date: string) {
  const { dayWords } = await import('../../routes/leave.js');
  const { balancesFor, leaveYearOf } = await import('./leaveBalances.js');
  const all = await compOffGrants(orgId, employeeIds);
  const typeIds = [...new Set([...all.values()].flatMap((m) => [...m.keys()]))];
  const typeName = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: typeIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const users = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, userId: true } })).map((p) => [p.id, p.userId]));
  const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
  const year = await leaveYearOf(orgId, date);
  let lapsed = 0;
  let reminded = 0;
  for (const [employeeId, byType] of all) {
    for (const [leaveTypeId, grants] of byType) {
      const name = typeName.get(leaveTypeId) || 'Comp-off';
      for (const g of grants) {
        if (!g.expiresOn || g.lapsedAt) continue;
        try {
          if (g.expiresOn < date) {
            /* Its last day has passed. Never more than can still be taken: read again for each grant, as the one before it may just have lapsed. */
            const done = await peopleWrite(orgId, async () => {
              const available = (await balancesFor(accountId, orgId, [employeeId], year)).balances.get(employeeId)?.get(leaveTypeId)?.available ?? 0;
              const days = Math.round(Math.min(g.left, Math.max(0, available)) * 100) / 100;
              /* Only while it has not lapsed: a second run, or another instance, writes nothing. */
              const claimed = await peoplePrisma.leaveAdjustment.updateMany({ where: { id: g.id, lapsedAt: null, reversedAt: null }, data: { lapsedAt: new Date(), lapsedDays: days } });
              if (!claimed.count) return null;
              if (days > 0) {
                await peoplePrisma.leaveAdjustment.create({ data: { accountId, orgId, employeeId, leaveTypeId, year, days: -days, kind: 'LAPSE', reason: `Comp-off for ${dayWords(g.workedOn)} was not used by ${dayWords(g.expiresOn!)}: ${dayCount(days)} lapsed`, createdByUserId: 'system' } });
              }
              return days;
            });
            if (done === null) continue;
            lapsed += 1;
            await platformPrisma.auditLog
              .create({ data: { accountId, orgId, branchId: '', entity: 'LeaveAdjustment', entityId: g.id, action: 'LAPSE', message: `Comp-off for ${g.workedOn} expired on ${g.expiresOn}: ${dayCount(done)} lapsed`, metadata: JSON.stringify({ employeeId, leaveTypeId, workedOn: g.workedOn, expiresOn: g.expiresOn, days: done }), createdByUserId: 'system' } })
              .catch((e) => console.error('[audit] comp-off lapse not recorded:', e instanceof Error ? e.message : e));
            continue;
          }
          /* A week or less to go, something left, and not yet told. */
          if (g.left <= 0 || g.expiresOn > addDays(date, COMP_OFF_REMIND_DAYS)) continue;
          const claimed = await peoplePrisma.leaveAdjustment.updateMany({ where: { id: g.id, expiryRemindedAt: null, lapsedAt: null }, data: { expiryRemindedAt: new Date() } });
          if (!claimed.count) continue;
          const userId = users.get(employeeId);
          const key = `comp-off-expiry:${g.id}`;
          /* No CLOR sign-in: the employee app's feed says it instead (compOffExpiringFor). */
          if (userId && !(await alreadyQueued(orgId, userId, key))) {
            await queueDirect(accountId, orgId, { userIds: [userId], dedupeKey: key, notice: { kind: 'attendance.leave_lapse', title: `${dayCount(g.left)} of ${name} ${g.left === 1 ? 'expires' : 'expire'} on ${dayWords(g.expiresOn)}`, body: `Earned for work on ${dayWords(g.workedOn)}. Take ${g.left === 1 ? 'it' : 'them'} by then, or ${g.left === 1 ? 'it lapses' : 'they lapse'}.`, link: { app, screen: 'myLeave' } } }, employeeId);
          }
          reminded += 1;
        } catch (e) {
          console.error(`[comp-off] expiry: org ${orgId}, grant ${g.id}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  return { lapsed, reminded };
}

/**
 * One person's comp-off with a week or less to go, for the employee app's
 * feed: staff with no CLOR sign-in get no notification, so this is how they
 * hear (as lapseFor does for the year end).
 */
export async function compOffExpiringFor(accountId: string, orgId: string, employeeId: string, date = today()) {
  const byType = (await compOffGrants(orgId, [employeeId])).get(employeeId);
  if (!byType) return [];
  const soon = [...byType].flatMap(([leaveTypeId, grants]) => grants.filter((g) => g.expiresOn && !g.lapsedAt && g.left > 0 && g.expiresOn >= date && g.expiresOn <= addDays(date, COMP_OFF_REMIND_DAYS)).map((g) => ({ ...g, leaveTypeId })));
  if (!soon.length) return [];
  const names = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId, accountId, id: { in: [...new Set(soon.map((g) => g.leaveTypeId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return soon.map((g) => ({ id: g.id, leaveType: names.get(g.leaveTypeId) || 'Comp-off', days: g.left, workedOn: g.workedOn, expiresOn: g.expiresOn! }));
}

/**
 * Steps of the leave rule that are late (services/attendance/leaveRules.ts),
 * as the approval engine treats its own: a reminder to whoever the step names
 * first; then, a day on, handed on if the rule says so, or reminded again
 * every three working days. One leave split at the period end is one request:
 * its parts move together. A step that fails is logged and the rest go on.
 */
export async function runLeaveRuleDues(now = new Date()) {
  const due = await peoplePrisma.leaveRequest.findMany({ where: { status: 'PENDING', ruleId: { not: null }, ruleStep: { not: null }, stepDueAt: { lt: now } }, orderBy: { fromDate: 'asc' } });
  const seen = new Set<string>();
  let reminded = 0;
  let handedOn = 0;
  for (const r of due) {
    const key = r.groupId || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const parts = r.groupId ? due.filter((x) => x.groupId === r.groupId) : [r];
      const steps = await stepsOf(r.ruleId!);
      const spec = steps.find((x) => x.order === r.ruleStep);
      const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId: r.orgId }, select: { name: true, isPrivate: true } });
      const person = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId: r.orgId }, select: { name: true } });
      const what = `${type?.isPrivate ? 'leave' : type?.name || 'leave'} for ${person?.name || 'someone'}, ${r.fromDate}${parts[parts.length - 1].toDate !== r.fromDate ? ` to ${parts[parts.length - 1].toDate}` : ''}`;
      const link = { app: (await isFeatureEnabled(r.accountId, r.orgId, 'people')) ? 'people' : 'attendance', screen: 'leaveRequests', params: { id: r.id } } as any;
      const remind = async () => {
        await peoplePrisma.leaveRequest.updateMany({ where: { id: { in: parts.map((x) => x.id) }, status: 'PENDING', ruleStep: r.ruleStep }, data: { stepRemindedAt: now } });
        const users = r.stepUserIds.filter((u) => !u.startsWith('portal:'));
        if (users.length) await notifyUsers(r.accountId, r.orgId, users, { kind: 'attendance.leave_asked', title: `Overdue: ${what}`, body: `Step ${r.ruleStep} was due ${r.stepDueAt!.toISOString().slice(0, 10)}.`, link });
        reminded += 1;
      };
      if (!r.stepRemindedAt) { await remind(); continue; }
      if (spec?.overdue?.action === 'HAND_ON' && spec.overdue.to && now.getTime() - r.stepRemindedAt.getTime() >= DAY) {
        const days = Math.round(parts.reduce((a, x) => a + x.days, 0) * 100) / 100;
        const users = await deciders(r.accountId, r.orgId, spec.overdue.to, { employeeId: r.employeeId, requestedByUserId: r.requestedByUserId, leaveTypeId: r.leaveTypeId, days }, now.toISOString().slice(0, 10));
        if (!users.length) continue;
        const { withHistory, tellWaiting } = await import('../../routes/leave.js');
        await peopleWrite(r.orgId, async () => {
          for (const x of parts) {
            const moved = await peoplePrisma.leaveRequest.updateMany({ where: { id: x.id, status: 'PENDING', ruleStep: r.ruleStep, updatedAt: x.updatedAt }, data: { stepUserIds: users, stepDueAt: addWorkingDays(now, spec.dueDays), stepRemindedAt: null, history: withHistory(x, { by: 'system', what: 'STEP_HANDED_ON', note: `Step ${r.ruleStep} handed on: it was due ${r.stepDueAt!.toISOString().slice(0, 10)}` }) as any } });
            if (!moved.count) return;
          }
          await tellWaiting(r.orgId, r.id);
        });
        handedOn += 1;
        continue;
      }
      if (spec?.overdue?.action !== 'HAND_ON' && addWorkingDays(r.stepRemindedAt, REMIND_EVERY_WORKING_DAYS).getTime() <= now.getTime()) await remind();
    } catch (e) {
      console.error(`[leave-rule-dues] ${r.orgId}: request ${r.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { due: seen.size, reminded, handedOn };
}

/**
 * Leave waiting on the approval engine, its steps' people worked out again for today, hourly (phase 2c-ii): an
 * approver whose leave starts today is passed up, one back from leave gets it again, a stand-in whose dates began
 * or ended is in or out, and whoever it goes to is told. Also catches a big company's refresh a screen left to it.
 * One company that fails is logged and the rest go on.
 */
export async function runLeaveEngineRefresh() {
  const { outsideTenant, runInTenant } = await import('../../utils/tenantScope.js');
  const orgs = await outsideTenant('job: leave on the engine', () => peoplePrisma.approvalRequest.groupBy({ by: ['accountId', 'orgId'], where: { sourceKind: 'LEAVE', status: 'WAITING' } }));
  let moved = 0;
  for (const o of orgs) {
    try {
      moved += Math.max(0, await runInTenant(o.orgId, () => refreshLeaveSteps(o.accountId, o.orgId)));
    } catch (e) {
      console.error(`[leave-engine] refresh: org ${o.orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return moved;
}

export function startLeaveJobs({ intervalMs = 3_600_000, startupDelayMs = 180_000 } = {}) {
  const tick = () =>
    exclusive('leave.automation', leaseFor(intervalMs), async () => {
      await runLeaveHandOns();
      await runLeaveRuleDues();
      await runLeaveEngineRefresh();
      /* The digest goes out once, in the morning (IST), not every hour. */
      const hour = (new Date(Date.now() + 330 * 60_000).getUTCHours());
      if (hour >= 9 && hour < 11) {
        await runLeaveDigest();
        await runLapseNotices();
        await runCompOffExpiry();
      }
    }).catch((e) => {
      console.error('[leave-automation] failed:', e instanceof Error ? e.message : e);
      /* Thrown on, so the wake call reports it and Cloud Scheduler retries (services/jobRegistry.ts); the timer swallows it below. */
      throw e;
    });
  registerJob('startLeaveJobs', tick, intervalMs);
  const timed = () => tick().catch(() => {});
  const t = setTimeout(() => {
    timed();
    const i = setInterval(timed, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
