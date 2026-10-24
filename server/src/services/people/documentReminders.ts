import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { sendTemplate } from '../mailer.js';
import { notifyPermissionOnce, notifyUsers, recipientsWithPermission } from '../notifications.js';
import { anyAppLive, appLive } from '../principalAllowed.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { startChecklist } from './checklists.js';
import { writeEvent } from './outbox.js';

/**
 * People's own events, told to whoever manages employees (PEOPLE::Employees
 * EDIT, and administrators): someone joined, someone left, a document is
 * about to expire. Each is an e-mail the organisation can switch off under
 * Settings → E-mail, and a row in the bell either way.
 */
const MANAGES_PEOPLE = 'PEOPLE::Employees::EDIT';
export const EXPIRY_WINDOW_DAYS = 30;

const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

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
 * Documents at a reminder stage they have not been announced at: one
 * announcement per stage, not one per day. A work permit or certificate at
 * 30 days (or later, seen for the first time) also leaves renewal tasks for
 * HR and the manager on the person's record (LIFE-08). Returns how many.
 */
export async function runDocumentReminders(now = new Date()) {
  const until = istDate(new Date(now.getTime() + EXPIRY_STAGES[0] * 86_400_000));
  const docs = await peoplePrisma.employeeDocument.findMany({ where: { expiresOn: { not: null, lte: until } }, select: { id: true, accountId: true, orgId: true, employeeId: true, kind: true, title: true, expiresOn: true, expiryStage: true, restrictsWork: true }, orderBy: { expiresOn: 'asc' }, take: 2000 });
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
      for (const d of rows) {
        const person = personOf.get(d.employeeId);
        if (!person || person.status === 'LEFT') continue;
        const daysLeft = daysUntil(d.expiresOn!, now);
        const stage = stageOf(daysLeft)!;
        const name = person.name;
        const permit = PERMIT_KINDS.has(d.kind);
        const title = daysLeft < 0 ? `${name}’s ${d.title} expired on ${d.expiresOn}` : daysLeft === 0 ? `${name}’s ${d.title} expires today` : `${name}’s ${d.title} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        const body = `${d.kind}${permit && d.restrictsWork ? ` · until renewed: ${d.restrictsWork}` : ` · ${d.expiresOn}`}`;
        await notifyUsers(accountId, orgId, recipients.map((r) => r.id), { kind: 'people.document_expiring', title, body, link: { app: 'people', screen: 'employees', params: { id: d.employeeId } } });
        for (const r of recipients) {
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
  const rows = await peoplePrisma.contractor.findMany({ where: { isActive: true, licenceValidTo: { not: null, lte: until } }, take: 500 });
  let sent = 0;
  const live = new Map<string, Promise<unknown>>();
  for (const c of rows) {
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
      });
    } catch (e) {
      console.error(`[contractor-licence] ${c.orgId}:`, e instanceof Error ? e.message : e);
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
  };
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
