import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { sendTemplate } from '../mailer.js';
import { notifyPermissionOnce, notifyUsers, recipientsWithPermission } from '../notifications.js';
import { isFeatureEnabled } from '../features.js';
import { exclusive, leaseFor } from '../jobLease.js';

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

/** Documents expiring within the window, not yet announced: one announcement each. Returns how many. */
export async function runDocumentReminders(now = new Date()) {
  const until = istDate(new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000));
  const today = istDate(now);
  const docs = await peoplePrisma.employeeDocument.findMany({ where: { expiresOn: { not: null, lte: until, gte: today }, expiryNotifiedAt: null }, orderBy: { expiresOn: 'asc' }, take: 500 });
  let sent = 0;
  const byOrg = new Map<string, typeof docs>();
  for (const d of docs) {
    if (!byOrg.has(d.orgId)) byOrg.set(d.orgId, []);
    byOrg.get(d.orgId)!.push(d);
  }
  for (const [orgId, rows] of byOrg) {
    const accountId = rows[0].accountId;
    try {
      if (!(await isFeatureEnabled(accountId, orgId, 'people'))) continue;
      const [recipients, org] = await Promise.all([recipientsWithPermission(accountId, orgId, MANAGES_PEOPLE), platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } })]);
      const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true } });
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      for (const d of rows) {
        const days = Math.max(0, Math.round((Date.parse(`${d.expiresOn}T00:00:00+05:30`) - now.getTime()) / 86_400_000));
        const name = nameOf.get(d.employeeId) || 'An employee';
        await notifyUsers(accountId, orgId, recipients.map((r) => r.id), { kind: 'people.document_expiring', title: `${name}’s ${d.title} expires in ${days} day${days === 1 ? '' : 's'}`, body: `${d.kind} · ${d.expiresOn}`, link: { app: 'people', screen: 'employees', params: { id: d.employeeId } } });
        for (const r of recipients) {
          await sendTemplate({ templateKey: 'people.document_expiring', to: r.email, toName: r.fullName, accountId, orgId, relatedType: 'EmployeeDocument', relatedId: d.id, data: { name, title: d.title, kind: d.kind, expiresOn: d.expiresOn || '', days: String(days), orgName: org?.name || '' } });
        }
        await peoplePrisma.employeeDocument.update({ where: { id: d.id }, data: { expiryNotifiedAt: now } });
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
  for (const c of rows) {
    try {
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
    exclusive('people.contractor-licences', leaseFor(intervalMs), () => runContractorLicenceReminders()).catch((e) => console.error('[contractor-licence] failed:', e instanceof Error ? e.message : e));
  };
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
