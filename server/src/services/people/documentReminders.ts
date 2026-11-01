import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { sendTemplate } from '../mailer.js';
import { notifyPermissionOnce, notifyUsers, recipientsWithPermission } from '../notifications.js';
import { anyAppLive, appLive } from '../principalAllowed.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { startChecklist } from './checklists.js';
import { writeEvent } from './outbox.js';
import { registerJob } from '../jobRegistry.js';
import { RECIPE, automation, automationsFor, recordRun } from './engagement/automations.js';
import { istDate } from '../../utils/istDate.js';

/**
 * People's own events, told to whoever manages employees (PEOPLE::Employees
 * EDIT, and administrators): someone joined, someone left, a document is
 * about to expire. Each is an e-mail the organisation can switch off under
 * Settings → E-mail, and a row in the bell either way.
 */
const MANAGES_PEOPLE = 'PEOPLE::Employees::EDIT';
export const EXPIRY_WINDOW_DAYS = 30;


/** Joined / left: mail and bell to the people who manage employees, not to whoever did it. */
export async function peopleEvent(accountId: string, orgId: string, key: 'people.joined' | 'people.left', employee: { id: string; name: string; code: string | null; departmentId?: string | null }, byUserId: string | null) {
  try {
    const [recipients, by, org, dept] = await Promise.all([
      recipientsWithPermission(accountId, orgId, MANAGES_PEOPLE),
      byUserId ? platformPrisma.user.findUnique({ where: { id: byUserId }, select: { fullName: true } }) : null,
      platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
      employee.departmentId ? peoplePrisma.department.findFirst({ where: { id: employee.departmentId, orgId }, select: { name: true } }) : null,
    ]);
    const joined = key === 'people.joined';
    const link = { app: 'people', screen: 'employees', params: { id: employee.id } };
    await notifyUsers(accountId, orgId, recipients.map((r) => r.id), { kind: key, title: joined ? `${employee.name} joined${dept ? ` ${dept.name}` : ''}` : `${employee.name} has left`, body: `${employee.code ? `${employee.code} · ` : ''}by ${by?.fullName || 'CLOR'}`, link }, { except: byUserId });
    for (const r of recipients) {
      if (r.id === byUserId) continue;
      await sendTemplate({ templateKey: key, to: r.email, toName: r.fullName, accountId, orgId, relatedType: 'Employee', relatedId: employee.id, data: { name: employee.name, code: employee.code || '', department: dept ? ` in ${dept.name}` : '', byName: by?.fullName || 'CLOR', orgName: org?.name || '' } });
    }
  } catch (e) {
    console.error('[people-events]', e instanceof Error ? e.message : e);
  }
}

/** Reminders go out this many days before a document expires, and on the day; each once (DOC-03). */
export const EXPIRY_STAGES = [60, 30, 7, 0] as const;
/** Documents that permit work: a lapse is more than a missing file (LIFE-08). */
export const PERMIT_KINDS = new Set(['WORK_PERMIT', 'CERTIFICATE']);
/** Whole days from `now` (IST) to a YYYY-MM-DD; negative once past. */
export const daysUntil = (date: string, now: Date) => Math.round((Date.parse(`${date}T00:00:00+05:30`) - Date.parse(`${istDate(now)}T00:00:00+05:30`)) / 86_400_000);
/** The stage a document is at: the nearest threshold its days-left has crossed, or null when it has not reached the first. */
export const stageOf = (daysLeft: number): number | null => {
  const crossed = EXPIRY_STAGES.filter((t) => daysLeft <= t);
  return crossed.length ? crossed[crossed.length - 1] : null;
};

/**
 * The documents a stage is due for, as a database filter: at no stage yet and
 * within the first window, or at a stage and past the next threshold below
 * it. A document at the last stage (on the day) is never read again, nor is
 * one whose person has left, so stale rows cannot crowd out new ones.
 */
export function dueDocumentsWhere(now: Date) {
  const by = (days: number) => istDate(new Date(now.getTime() + days * 86_400_000));
  const stages = [...EXPIRY_STAGES].sort((x, y) => y - x);
  const or: Array<Record<string, unknown>> = [{ expiryStage: null, expiresOn: { not: null, lte: by(stages[0]) } }];
  for (let i = 0; i < stages.length - 1; i += 1) or.push({ expiryStage: stages[i], expiresOn: { not: null, lte: by(stages[i + 1]) } });
  return { OR: or, employee: { status: { not: 'LEFT' } } };
}

/** Rows read per page, so a backlog is worked through rather than cut off. */
const PAGE = 500;
/** Every row a query matches, a page at a time, in id order (the query takes the last id seen). */
async function* pages<T extends { id: string }>(read: (after: string | null) => Promise<T[]>, size = PAGE) {
  let after: string | null = null;
  for (;;) {
    const page = await read(after);
    for (const row of page) yield row;
    if (page.length < size) return;
    after = page[page.length - 1].id;
  }
}
type DueDoc = { id: string; accountId: string; orgId: string; employeeId: string; kind: string; title: string; expiresOn: string | null; expiryStage: number | null; restrictsWork: string | null };

/**
 * Documents at a reminder stage they have not been announced at: one
 * announcement per stage, not one per day. A work permit or certificate at
 * 30 days (or later, seen for the first time) also leaves renewal tasks for
 * HR and the manager on the person's record (LIFE-08). Returns how many.
 */
export async function runDocumentReminders(now = new Date(), pageSize = PAGE) {
  let sent = 0;
  let after: string | null = null;
  for (;;) {
    const page: DueDoc[] = await peoplePrisma.employeeDocument.findMany({
      where: { ...dueDocumentsWhere(now), ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, accountId: true, orgId: true, employeeId: true, kind: true, title: true, expiresOn: true, expiryStage: true, restrictsWork: true },
      orderBy: { id: 'asc' },
      take: pageSize,
    });
    if (!page.length) break;
    after = page[page.length - 1].id;
    sent += await remindDocuments(page, now);
    if (page.length < pageSize) break;
  }
  return sent;
}

async function remindDocuments(docs: DueDoc[], now: Date) {
  const due = docs.filter((d) => {
    const stage = stageOf(daysUntil(d.expiresOn!, now));
    return stage !== null && (d.expiryStage === null || d.expiryStage > stage);
  });
  let sent = 0;
  const byOrg = new Map<string, typeof due>();
  for (const d of due) {
    if (!byOrg.has(d.orgId)) byOrg.set(d.orgId, []);
    byOrg.get(d.orgId)!.push(d);
  }
  for (const [orgId, rows] of byOrg) {
    const accountId = rows[0].accountId;
    try {
      /* Switched on is not enough: People must be on the subscription and the company not closing (A-48). */
      if (await appLive(accountId, orgId, 'people')) continue;
      const [recipients, org] = await Promise.all([recipientsWithPermission(accountId, orgId, MANAGES_PEOPLE), platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } })]);
      const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true, status: true } });
      const personOf = new Map(people.map((p) => [p.id, p]));
      /* Settings → Automations (WORKFLOW-GAP-RESEARCH 4.7): switched off, HR is not told; the stage still moves on, so turning it back on does not send a backlog. */
      const tell = (await automation(orgId, 'documentExpiry')).on;
      const told: string[] = [];
      for (const d of rows) {
        const person = personOf.get(d.employeeId);
        if (!person || person.status === 'LEFT') continue;
        const daysLeft = daysUntil(d.expiresOn!, now);
        const stage = stageOf(daysLeft)!;
        const name = person.name;
        const permit = PERMIT_KINDS.has(d.kind);
        const title = daysLeft < 0 ? `${name}’s ${d.title} expired on ${d.expiresOn}` : daysLeft === 0 ? `${name}’s ${d.title} expires today` : `${name}’s ${d.title} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        const body = `${d.kind}${permit && d.restrictsWork ? ` · until renewed: ${d.restrictsWork}` : ` · ${d.expiresOn}`}`;
        if (tell) await notifyUsers(accountId, orgId, recipients.map((r) => r.id), { kind: 'people.document_expiring', title, body, link: { app: 'people', screen: 'employees', params: { id: d.employeeId } } });
        if (tell) told.push(`${name}: ${d.title}`);
        for (const r of tell ? recipients : []) {
          await sendTemplate({ templateKey: 'people.document_expiring', to: r.email, toName: r.fullName, accountId, orgId, relatedType: 'EmployeeDocument', relatedId: d.id, data: { name, title: d.title, kind: d.kind, expiresOn: d.expiresOn || '', days: String(Math.max(0, daysLeft)), orgName: org?.name || '' } });
        }
        /* A permit running out is work for HR and the manager, once per document while it is open. */
        if (permit && stage <= 30) {
          const open = await peoplePrisma.checklistTask.count({ where: { orgId, employeeId: d.employeeId, kind: 'RENEWAL', doneAt: null, note: { contains: d.id } } });
          if (!open) {
            await startChecklist({ accountId, orgId, userId: null }, { id: d.employeeId }, 'RENEWAL', d.expiresOn, { items: [
              { title: `Renew ${d.title} (expires ${d.expiresOn})`, owner: 'HR', dueDays: -7, note: `Document ${d.id}. Until renewed${d.restrictsWork ? `: ${d.restrictsWork}` : ', check what work needs it.'}` },
              { title: `Plan ${name}’s work while ${d.title} is renewed`, owner: 'MANAGER', dueDays: -7, note: `Document ${d.id}. ${d.restrictsWork ? `They may not: ${d.restrictsWork}.` : 'Check what work needs it.'} Shown on the record, not enforced by other apps.` },
            ] });
          }
        }
        await peoplePrisma.$transaction(async (tx) => {
          await tx.employeeDocument.update({ where: { id: d.id }, data: { expiryStage: stage, expiryNotifiedAt: now } });
          await writeEvent(tx, { accountId, orgId, correlationId: `expiry_${d.id}_${stage}` }, 'people.document.expiring.v1', { documentId: d.id, kind: d.kind, title: d.title, expiresOn: d.expiresOn, daysLeft, stage, employee: { id: person.id, code: person.code, name: person.name } }, d.employeeId);
        });
        sent += 1;
      }
      await recordRun(accountId, orgId, 'documentExpiry', told.length, told, now);
    } catch (e) {
      console.error(`[document-reminders] ${orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/**
 * Contract Labour Act licences running out: a contractor whose licence ends
 * within the window (or has ended) is named on the bell of whoever looks
 * after the org structure, once per licence date — a renewed licence with a
 * new date is announced again when it, too, runs out.
 */
export async function runContractorLicenceReminders(now = new Date()) {
  const until = istDate(new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000));
  const today = istDate(now);
  let sent = 0;
  const live = new Map<string, Promise<unknown>>();
  for await (const c of pages((after) => peoplePrisma.contractor.findMany({ where: { isActive: true, licenceValidTo: { not: null, lte: until }, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: PAGE }))) {
    try {
      /* Contractors are used by People and Attendance; reminded while either is live (A-48). */
      const key = `${c.accountId}:${c.orgId}`;
      if (!live.has(key)) live.set(key, anyAppLive(c.accountId, c.orgId, ['people', 'attendance']));
      if (await live.get(key)) continue;
      const expired = (c.licenceValidTo as string) < today;
      sent += await notifyPermissionOnce(c.accountId, c.orgId, 'PEOPLE::Org Structure::VIEW', {
        kind: 'people.contractor_licence',
        title: expired ? `${c.name}’s labour licence has expired` : `${c.name}’s labour licence expires on ${c.licenceValidTo}`,
        body: `${c.licenceNo ? `Licence ${c.licenceNo}. ` : ''}Workers supplied without a valid licence are a compliance risk.`,
        link: { app: 'attendance', screen: 'contractors' },
        dedupeKey: `licence:${c.id}:${c.licenceValidTo}`,
      }, { ever: true });
    } catch (e) {
      console.error(`[contractor-licence] ${c.orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/**
 * Contract, internship and probation end dates (Workforce audit O1, O2).
 * HR hears at 30 and 7 days and on the day for a contract, at 14 days and on
 * the day for probation, each once (the bell remembers); a decision task goes
 * on the plan once per date: renew or end for a contract (HR), review for
 * probation (the manager). A date that has passed with nothing decided is
 * also on Data Health and the People home.
 */
const CONTRACT_STAGES = [30, 7, 0];
const PROBATION_STAGES = [14, 0];
/* The first warning is the company's number under Settings → Automations (default 30 and 14, as before). */
const contractStages = (n: number | null) => [...new Set([n ?? CONTRACT_STAGES[0], 7, 0])].sort((a, b) => b - a);
const probationStages = (n: number | null) => [...new Set([n ?? PROBATION_STAGES[0], 0])].sort((a, b) => b - a);
const stageIn = (stages: number[], days: number) => (days <= 0 ? 0 : stages.filter((s) => days <= s).sort((a, b) => a - b)[0] ?? null);
const words = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`; };

export async function runEndDateReminders(now = new Date(), pageSize = PAGE) {
  const today = istDate(now);
  /* The widest number any company may choose (Automations), so nobody's first warning is missed. */
  const horizon = istDate(new Date(now.getTime() + Math.max(RECIPE.get('contractEnds')!.n!.max, RECIPE.get('probationEnds')!.n!.max) * 86_400_000));
  const settings = new Map<string, Awaited<ReturnType<typeof automationsFor>>>();
  let sent = 0;
  const live = new Map<string, Promise<unknown>>();
  const read = (after: string | null) => peoplePrisma.employee.findMany({
    where: { status: { not: 'LEFT' }, OR: [{ contractEndDate: { not: null, lte: horizon } }, { probationEndDate: { not: null, lte: horizon }, confirmedOn: null }], ...(after ? { id: { gt: after } } : {}) },
    select: { id: true, accountId: true, orgId: true, name: true, contractEndDate: true, probationEndDate: true, confirmedOn: true },
    orderBy: { id: 'asc' },
    take: pageSize,
  });
  for await (const e of pages(read, pageSize)) {
    try {
      const key = `${e.accountId}:${e.orgId}`;
      if (!live.has(key)) live.set(key, appLive(e.accountId, e.orgId, 'people'));
      if (await live.get(key)) continue;
      if (!settings.has(e.orgId)) settings.set(e.orgId, await automationsFor(e.orgId));
      const auto = settings.get(e.orgId)!;
      const link = { app: 'people', screen: 'employee', params: { id: e.id, tab: 'employment' } };
      const contract = e.contractEndDate ? String(e.contractEndDate).slice(0, 10) : null;
      const cStage = contract ? stageIn(contractStages(auto.contractEnds.n), daysUntil(contract, now)) : null;
      if (contract && cStage !== null) {
        const past = contract < today;
        if (auto.contractEnds.on) {
          const n = await notifyPermissionOnce(e.accountId, e.orgId, MANAGES_PEOPLE, {
          kind: 'people.contract_ending',
          title: past ? `${e.name}’s contract ended on ${words(contract)}` : contract === today ? `${e.name}’s contract ends today` : `${e.name}’s contract ends on ${words(contract)}`,
          body: past ? 'They are still active. Renew it or record their leaving.' : 'Renew it with a new end date, or record their leaving.',
          link,
          dedupeKey: `contract:${e.id}:${contract}:${cStage}`,
        }, { ever: true });
          sent += n;
          await recordRun(e.accountId, e.orgId, 'contractEnds', n, n ? [e.name] : [], now);
        }
        /* The task's note says the date in words, and doubles as the marker that it was made; older tasks carry `contract:<date>`. */
        const marker = `Contract ends ${words(contract)}`;
        if (!(await peoplePrisma.checklistTask.count({ where: { orgId: e.orgId, employeeId: e.id, kind: 'RENEWAL', OR: [{ note: { contains: marker } }, { note: { contains: `contract:${contract}` } }] } }))) {
          await startChecklist({ accountId: e.accountId, orgId: e.orgId, userId: null }, { id: e.id }, 'RENEWAL', contract, { items: [{ title: `Renew or end ${e.name}’s contract (ends ${words(contract)})`, owner: 'HR', dueDays: -7, note: `${marker}. Renew on their Employment tab, or record leaving.` }] });
        }
      }
      const probation = e.probationEndDate && !e.confirmedOn ? String(e.probationEndDate).slice(0, 10) : null;
      const pStage = probation ? stageIn(probationStages(auto.probationEnds.n), daysUntil(probation, now)) : null;
      if (probation && pStage !== null) {
        if (auto.probationEnds.on) {
          const n = await notifyPermissionOnce(e.accountId, e.orgId, MANAGES_PEOPLE, {
          kind: 'people.probation_ending',
          title: probation < today ? `${e.name}’s probation ended on ${words(probation)}, not yet decided` : probation === today ? `${e.name}’s probation ends today` : `${e.name}’s probation ends on ${words(probation)}`,
          body: 'Confirm, extend or end it on their Employment tab.',
          link,
          dedupeKey: `probation:${e.id}:${probation}:${pStage}`,
        }, { ever: true });
          sent += n;
          await recordRun(e.accountId, e.orgId, 'probationEnds', n, n ? [e.name] : [], now);
        }
        /* The note says the date in words and doubles as the marker; older tasks carry `probation:<date>`. */
        const marker = `Probation ends ${words(probation)}`;
        if (!(await peoplePrisma.checklistTask.count({ where: { orgId: e.orgId, employeeId: e.id, kind: 'PROBATION', OR: [{ note: { contains: marker } }, { note: { contains: `probation:${probation}` } }] } }))) {
          await startChecklist({ accountId: e.accountId, orgId: e.orgId, userId: null }, { id: e.id }, 'PROBATION', probation, { items: [{ title: `Review ${e.name}’s probation (ends ${words(probation)})`, owner: 'MANAGER', dueDays: -3, note: `${marker}. Confirm, extend or end it on their Employment tab.` }] });
        }
      }
    } catch (err) {
      console.error(`[end-dates] ${e.orgId}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/** Once a day; a document found expiring is announced once. */
export function startDocumentReminders({ intervalMs = 24 * 3_600_000, startupDelayMs = 180_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => {
    exclusive('people.document-reminders', leaseFor(intervalMs), () => runDocumentReminders()).catch((e) => console.error('[document-reminders] failed:', e instanceof Error ? e.message : e));
    exclusive('people.contractor-licences', leaseFor(intervalMs), () => runContractorLicenceReminders(), { idempotent: true }).catch((e) => console.error('[contractor-licence] failed:', e instanceof Error ? e.message : e));
    exclusive('people.end-dates', leaseFor(intervalMs), () => runEndDateReminders(), { idempotent: true }).catch((e) => console.error('[end-dates] failed:', e instanceof Error ? e.message : e));
  };
  registerJob('startDocumentReminders', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
