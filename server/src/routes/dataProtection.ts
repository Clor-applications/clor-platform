import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { hrOrAttendanceRouteOk } from '../services/people/guards.js';
import { BIOMETRIC_GRACE_UNTIL, biometricPolicy, clearBiometricPolicy, isMinor } from '../services/attendance/biometrics.js';
import { privacyNoticeFor } from '../services/attendance/privacyNotice.js';
import { punchLocationRetentionDays, punchPhotoRetentionDays, readerEventRetentionDays } from '../services/retention.js';
import { sendTemplate } from '../services/mailer.js';

/**
 * Data protection for attendance, as the DPDP Act and Rules ask of the
 * company (the Data Fiduciary) and of CLOR (its Data Processor):
 *  - the company's contact for personal-data questions and grievances;
 *  - whether CLOR keeps copies of fingerprints and faces (off unless switched
 *    on with a recorded confirmation that employees were told and agreed);
 *  - the employee privacy notice, built from these settings;
 *  - where the company stands: requests waiting and overdue, people under 18,
 *    withdrawals, open breaches;
 *  - a breach register: record, tell the affected people, and note the Data
 *    Protection Board's intimation and 72-hour report.
 */
export const dataProtectionRouter = Router();
const base = '/orgs/:orgId/attendance/data-protection';
dataProtectionRouter.use('/orgs/:orgId/attendance/data-protection', requireAuth, requireTenantContext);
const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, ATTENDANCE_RESOURCE.portal);

const settingsOf = async (accountId: string, orgId: string, userId: string) =>
  (await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } })) ||
  peoplePrisma.attendanceSettings.create({ data: { accountId, orgId, updatedByUserId: userId } });

dataProtectionRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await settingsOf(accountId, orgId, req.auth!.userId);
  const now = new Date();
  const [templates, optedOut, people, requests, overdue, breaches, acked, notice] = await Promise.all([
    peoplePrisma.biometricTemplate.count({ where: { orgId } }),
    peoplePrisma.employee.count({ where: { orgId, biometricOptOutAt: { not: null } } }),
    peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' } }, select: { id: true, name: true, dateOfBirth: true, mobilePunch: true } }),
    peoplePrisma.dataRequest.count({ where: { orgId, status: 'PENDING' } }),
    peoplePrisma.dataRequest.count({ where: { orgId, status: 'PENDING', dueAt: { lt: now } } }),
    peoplePrisma.dataBreach.count({ where: { orgId, status: 'OPEN' } }),
    peoplePrisma.employee.count({ where: { orgId, privacyNoticeAckAt: { not: null } } }),
    privacyNoticeFor(orgId),
  ]);
  const minors = people.filter((p) => isMinor(p.dateOfBirth));
  const current = await peoplePrisma.employee.count({ where: { orgId, privacyNoticeVersion: notice.version } });
  res.json({
    settings: {
      privacyContactName: s.privacyContactName, privacyContactEmail: s.privacyContactEmail, privacyContactPhone: s.privacyContactPhone,
      biometricCopy: s.biometricCopy, biometricCopyAt: s.biometricCopyAt, privacyNoticeAt: s.privacyNoticeAt,
    },
    status: {
      templatesStored: templates,
      biometricGraceUntil: s.biometricCopy ? null : templates ? BIOMETRIC_GRACE_UNTIL : null,
      optedOut,
      minors: minors.map((m) => ({ id: m.id, name: m.name, mobilePunch: m.mobilePunch })),
      noBirthDate: people.filter((p) => !p.dateOfBirth).length,
      requestsWaiting: requests,
      requestsOverdue: overdue,
      breachesOpen: breaches,
      noticeRead: acked,
      noticeReadCurrent: current,
      employees: people.length,
    },
    retention: { selfieDays: s.photoRetentionDays ?? (await punchPhotoRetentionDays(orgId)), locationDays: punchLocationRetentionDays(), readerEventDays: readerEventRetentionDays() },
    notice,
  });
});

const settingsSchema = z.object({
  privacyContactName: z.string().trim().max(120).nullable().optional(),
  privacyContactEmail: z.string().trim().email('Give a valid e-mail address.').max(200).nullable().optional().or(z.literal('')),
  privacyContactPhone: z.string().trim().max(40).nullable().optional(),
  biometricCopy: z.boolean().optional(),
  /** Required to switch copying on: the admin confirms employees were told and agreed. */
  attest: z.boolean().optional(),
  publishNotice: z.boolean().optional(),
});

dataProtectionRouter.put(base, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = settingsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the settings.' });
  const b = parsed.data;
  const s = await settingsOf(accountId, orgId, req.auth!.userId);
  const data: Record<string, unknown> = { updatedByUserId: req.auth!.userId };
  for (const k of ['privacyContactName', 'privacyContactEmail', 'privacyContactPhone'] as const) if (b[k] !== undefined) data[k] = b[k] || null;
  let deleted = 0;
  if (b.biometricCopy === true && !s.biometricCopy) {
    if (b.attest !== true) return res.status(400).json({ error: 'Confirm that employees were told CLOR keeps a copy of their fingerprints and face, and agreed, before switching copying on.' });
    Object.assign(data, { biometricCopy: true, biometricCopyAt: new Date(), biometricCopyBy: req.auth!.userId });
  }
  if (b.biometricCopy === false && s.biometricCopy) {
    Object.assign(data, { biometricCopy: false, biometricCopyAt: new Date(), biometricCopyBy: req.auth!.userId });
  }
  if (b.biometricCopy === false) {
    /* Off means CLOR holds none: every copy goes now. The readers keep their own. */
    deleted = (await peoplePrisma.biometricTemplate.deleteMany({ where: { orgId } })).count;
  }
  if (b.publishNotice) data.privacyNoticeAt = new Date();
  await peoplePrisma.attendanceSettings.update({ where: { id: s.id }, data });
  clearBiometricPolicy(orgId);
  const changes = [
    b.biometricCopy === true && !s.biometricCopy ? 'fingerprint and face copies switched on (employees told and agreed, confirmed)' : null,
    b.biometricCopy === false ? `fingerprint and face copies off; ${deleted} stored cop${deleted === 1 ? 'y' : 'ies'} deleted` : null,
    b.publishNotice ? 'employee privacy notice published' : null,
    ['privacyContactName', 'privacyContactEmail', 'privacyContactPhone'].some((k) => (b as any)[k] !== undefined) ? 'privacy contact updated' : null,
  ].filter(Boolean);
  if (changes.length) {
    await platformPrisma.auditLog
      .create({ data: { accountId, orgId, branchId: req.tenant!.branchId, entity: 'DataProtection', entityId: orgId, action: 'EDIT', message: `Data protection: ${changes.join('; ')}`, createdByUserId: req.auth!.userId } })
      .catch(() => null);
  }
  res.json({ ok: true, templatesDeleted: deleted, notice: await privacyNoticeFor(orgId), policy: { copy: (await biometricPolicy(orgId)).copy } });
});

// ---------------------------------------------------------------------------
// Breach register
// ---------------------------------------------------------------------------

const breachSchema = z.object({
  title: z.string().trim().min(1, 'Name the breach.').max(160),
  description: z.string().trim().min(1, 'Say what happened.').max(4000),
  discoveredAt: z.coerce.date(),
  occurredFrom: z.coerce.date().nullable().optional(),
  occurredTo: z.coerce.date().nullable().optional(),
  categories: z.array(z.string().trim().min(1).max(40)).min(1, 'Say what kind of data.').max(20),
  employeeIds: z.array(z.string().min(1)).max(100_000).default([]),
  consequences: z.string().trim().min(1, 'Say what it may mean for people.').max(4000),
  mitigation: z.string().trim().min(1, 'Say what has been done.').max(4000),
  stepsForPeople: z.string().trim().min(1, 'Say what people can do.').max(4000),
});

/** The Board's clocks: intimation without delay, the full report within 72 hours of becoming aware. */
const shapeBreach = (b: any) => {
  const reportDue = new Date(b.discoveredAt.getTime() + 72 * 3_600_000);
  return {
    ...b,
    employeeIds: JSON.parse(b.employeeIdsJson || '[]'),
    employeeIdsJson: undefined,
    affected: JSON.parse(b.employeeIdsJson || '[]').length,
    boardReportDue: reportDue,
    boardReportLate: !b.boardReportAt && Date.now() > reportDue.getTime(),
  };
};

dataProtectionRouter.get(`${base}/breaches`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const rows = await peoplePrisma.dataBreach.findMany({ where: { orgId: req.tenant!.orgId }, orderBy: { discoveredAt: 'desc' } });
  res.json({ breaches: rows.map(shapeBreach) });
});

dataProtectionRouter.post(`${base}/breaches`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = breachSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the breach.' });
  const b = parsed.data;
  const known = b.employeeIds.length ? (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: b.employeeIds } }, select: { id: true } })).map((e) => e.id) : [];
  const row = await peoplePrisma.dataBreach.create({
    data: {
      accountId, orgId, title: b.title, description: b.description, discoveredAt: b.discoveredAt, occurredFrom: b.occurredFrom ?? null, occurredTo: b.occurredTo ?? null,
      categories: b.categories.join(', '), employeeIdsJson: JSON.stringify(known), consequences: b.consequences, mitigation: b.mitigation, stepsForPeople: b.stepsForPeople,
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ breach: shapeBreach(row) });
});

/** Note the Board's intimation, report and reference; or close it. */
dataProtectionRouter.put(`${base}/breaches/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const row = await peoplePrisma.dataBreach.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!row) return res.status(404).json({ error: 'No such breach.' });
  const parsed = z
    .object({ boardIntimatedAt: z.coerce.date().nullable().optional(), boardReportAt: z.coerce.date().nullable().optional(), boardReference: z.string().trim().max(120).nullable().optional(), status: z.enum(['OPEN', 'CLOSED']).optional() })
    .safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Check the dates.' });
  if (parsed.data.status === 'CLOSED' && !(row.peopleNotifiedAt || JSON.parse(row.employeeIdsJson || '[]').length === 0)) return res.status(409).json({ error: 'Tell the affected people before closing it.' });
  const updated = await peoplePrisma.dataBreach.update({ where: { id: row.id }, data: parsed.data });
  res.json({ breach: shapeBreach(updated) });
});

/** Tell every affected person who has an e-mail address, in plain words (rule 7(1)). Others are listed to be told another way. */
dataProtectionRouter.post(`${base}/breaches/:id/notify`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const row = await peoplePrisma.dataBreach.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!row) return res.status(404).json({ error: 'No such breach.' });
  const ids: string[] = JSON.parse(row.employeeIdsJson || '[]');
  const [people, org, s] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, email: true, workEmail: true, personalEmail: true } }),
    platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }),
  ]);
  const contact = [s?.privacyContactName, s?.privacyContactEmail, s?.privacyContactPhone].filter(Boolean).join(', ') || `${org?.name || 'your employer'}'s HR`;
  const fmt = (d: Date | null) => (d ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : null);
  const when = [fmt(row.occurredFrom), fmt(row.occurredTo)].filter(Boolean).join(' to ') || `found ${fmt(row.discoveredAt)}`;
  let sent = 0;
  const noEmail: Array<{ id: string; name: string }> = [];
  for (const p of people) {
    /* Every address on file counts (review R-09): the employee form saves the personal address in `email`. */
    const to = p.personalEmail || p.email || p.workEmail;
    if (!to) {
      noEmail.push({ id: p.id, name: p.name });
      continue;
    }
    await sendTemplate({
      templateKey: 'people.data_breach', to, toName: p.name, accountId, orgId, transactional: true, relatedType: 'DataBreach', relatedId: row.id,
      data: { orgName: org?.name || 'Your employer', description: row.description, when, categories: row.categories, consequences: row.consequences, mitigation: row.mitigation, stepsForPeople: row.stepsForPeople, contact },
    });
    sent += 1;
  }
  const updated = await peoplePrisma.dataBreach.update({ where: { id: row.id }, data: { peopleNotifiedAt: new Date(), notifiedCount: row.notifiedCount + sent } });
  res.json({ sent, noEmail, breach: shapeBreach(updated) });
});
