import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { registerJob } from '../../jobRegistry.js';
import { notifyUsers, sendNotice, usersWithPermission } from '../../notifications.js';
import type { TeamScope } from '../scope.js';
import { TalentError, anonymiseOldCandidates } from './hiring.js';
import { runReferralBonuses } from './referrals.js';
import { addDays, addMonths, todayIst } from '../../../utils/istDate.js';

/**
 * Talent → Training (docs/people/design-v1/TALENT-DECISIONS.md): one training, many people.
 * An attendee completes on a date; a certificate good for N months lapses N months later, and
 * HR and the person hear 60, 30 and 0 days before (once per stage).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const date = (v: unknown) => { const s = String(v ?? '').trim(); if (!s) return null; if (!ISO.test(s)) throw new TalentError('Dates are YYYY-MM-DD.'); return s; };
export { addMonths };
export const CERT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
export const CERT_MAX = 5 * 1024 * 1024;

type Who = { accountId: string; orgId: string; userId: string | null };

function trainingInput(raw: any) {
  const title = text(raw?.title, 200);
  if (!title) throw new TalentError('Name the training.');
  const startDate = date(raw?.startDate);
  const endDate = date(raw?.endDate);
  if (startDate && endDate && endDate < startDate) throw new TalentError('It ends before it starts.');
  const hours = raw?.hours === undefined || raw?.hours === null || raw?.hours === '' ? null : Number(raw.hours);
  if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 10000)) throw new TalentError('Hours is a number.');
  const validMonths = raw?.validMonths === undefined || raw?.validMonths === null || raw?.validMonths === '' ? null : Math.round(Number(raw.validMonths));
  if (validMonths !== null && (!Number.isFinite(validMonths) || validMonths < 1 || validMonths > 240)) throw new TalentError('Valid for is 1 to 240 months, or blank if it does not lapse.');
  return {
    title, provider: text(raw?.provider, 200), kind: ['INTERNAL', 'EXTERNAL', 'ONLINE'].includes(raw?.kind) ? raw.kind : 'INTERNAL',
    startDate, endDate, hours, mandatory: Boolean(raw?.mandatory), validMonths, description: text(raw?.description, 4000),
  };
}

export async function saveTraining(who: Who, raw: any, id?: string) {
  const data = trainingInput(raw);
  if (!id) return peoplePrisma.training.create({ data: { ...data, accountId: who.accountId, orgId: who.orgId, createdByUserId: who.userId } });
  const t = await peoplePrisma.training.findFirst({ where: { id, orgId: who.orgId } });
  if (!t) throw new TalentError('No such training.', 404);
  const status = raw?.status && ['PLANNED', 'DONE', 'CANCELLED'].includes(raw.status) ? raw.status : t.status;
  const row = await peoplePrisma.training.update({ where: { id }, data: { ...data, status } });
  /* A new validity applies to the certificates already earned too. */
  if (t.validMonths !== row.validMonths) {
    const seats = await peoplePrisma.trainingSeat.findMany({ where: { orgId: who.orgId, trainingId: id, completedOn: { not: null } } });
    for (const s of seats) await peoplePrisma.trainingSeat.update({ where: { id: s.id }, data: { expiresOn: row.validMonths ? addMonths(s.completedOn!, row.validMonths) : null, remindedStage: null } });
  }
  return row;
}

export async function deleteTraining(who: Who, id: string) {
  const t = await peoplePrisma.training.findFirst({ where: { id, orgId: who.orgId } });
  if (!t) throw new TalentError('No such training.', 404);
  if (await peoplePrisma.trainingSeat.count({ where: { orgId: who.orgId, trainingId: id, status: 'COMPLETED' } })) throw new TalentError('People have completed this training. Cancel it instead; their certificates stay.', 409);
  await peoplePrisma.$transaction([peoplePrisma.trainingSeat.deleteMany({ where: { orgId: who.orgId, trainingId: id } }), peoplePrisma.training.delete({ where: { id } })]);
}

/** Put people on a training. Someone already on it is left as they are. */
export async function assign(who: Who, trainingId: string, employeeIds: unknown, scope: TeamScope) {
  const t = await peoplePrisma.training.findFirst({ where: { id: trainingId, orgId: who.orgId } });
  if (!t) throw new TalentError('No such training.', 404);
  if (t.status === 'CANCELLED') throw new TalentError('This training is cancelled.', 409);
  const ids = [...new Set((Array.isArray(employeeIds) ? employeeIds : []).map(String))].slice(0, 500);
  if (!ids.length) throw new TalentError('Pick the people.');
  const people = await peoplePrisma.employee.findMany({ where: { orgId: who.orgId, id: { in: ids }, status: { not: 'LEFT' } }, select: { id: true, userId: true } });
  if (people.length !== ids.length || people.some((p) => !(scope.all || scope.ids.includes(p.id)))) throw new TalentError('Pick people working here, in your team.');
  const r = await peoplePrisma.trainingSeat.createMany({ data: people.map((p) => ({ accountId: who.accountId, orgId: who.orgId, trainingId, employeeId: p.id })), skipDuplicates: true });
  await notifyUsers(who.accountId, who.orgId, people.map((p) => p.userId).filter(Boolean) as string[], { kind: 'people.training', title: `Training: ${t.title}`, body: t.startDate ? `From ${t.startDate}` : null, link: null }, { except: who.userId });
  return r.count;
}

/** Completed (a date, optionally a certificate), missed, or back to assigned. */
export async function markSeat(who: Who, seatId: string, raw: any, cert?: { name: string; mime: string; data: Buffer } | null) {
  const s = await peoplePrisma.trainingSeat.findFirst({ where: { id: seatId, orgId: who.orgId } });
  if (!s) throw new TalentError('No such attendee.', 404);
  const t = await peoplePrisma.training.findFirstOrThrow({ where: { id: s.trainingId } });
  const status = ['ASSIGNED', 'COMPLETED', 'MISSED'].includes(raw?.status) ? raw.status : s.status;
  const completedOn = status === 'COMPLETED' ? date(raw?.completedOn) || s.completedOn || todayIst() : null;
  if (completedOn && completedOn > todayIst()) throw new TalentError('Completed on a day that has not come yet.');
  if (cert) {
    if (!CERT_TYPES.has(cert.mime)) throw new TalentError('A certificate is a PDF, JPG or PNG.');
    if (!cert.data.length || cert.data.length > CERT_MAX) throw new TalentError('A certificate is up to 5 MB.');
  }
  return peoplePrisma.trainingSeat.update({
    where: { id: seatId },
    data: {
      status, completedOn, expiresOn: completedOn && t.validMonths ? addMonths(completedOn, t.validMonths) : null, remindedStage: completedOn !== s.completedOn ? null : s.remindedStage,
      ...(cert ? { certName: cert.name.slice(0, 200), certMime: cert.mime, certSize: cert.data.length, certData: cert.data } : {}),
    },
  });
}

export async function removeSeat(who: Who, seatId: string) {
  const s = await peoplePrisma.trainingSeat.findFirst({ where: { id: seatId, orgId: who.orgId } });
  if (!s) throw new TalentError('No such attendee.', 404);
  if (s.status === 'COMPLETED') throw new TalentError('They completed it: the record stays.', 409);
  await peoplePrisma.trainingSeat.delete({ where: { id: seatId } });
}

const seatShape = (s: any, name?: { name: string; code: string | null } | null, today = todayIst()) => ({
  id: s.id, trainingId: s.trainingId, employeeId: s.employeeId, employee: name || null, status: s.status, completedOn: s.completedOn, expiresOn: s.expiresOn,
  expired: Boolean(s.expiresOn && s.expiresOn < today), expiringSoon: Boolean(s.expiresOn && s.expiresOn >= today && s.expiresOn <= addDays(today, 60)),
  cert: s.certName ? { name: s.certName, size: s.certSize, mime: s.certMime } : null, certUrl: s.certUrl,
});

export async function listTrainings(orgId: string, scope: TeamScope, q: { status?: string; q?: string } = {}) {
  const rows = await peoplePrisma.training.findMany({ where: { orgId, ...(q.status === 'all' ? {} : q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }) }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], take: 500 });
  const seats = await peoplePrisma.trainingSeat.groupBy({ by: ['trainingId', 'status'], where: { orgId, trainingId: { in: rows.map((r) => r.id) }, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, _count: { _all: true } });
  const needle = String(q.q || '').trim().toLowerCase();
  return rows.filter((r) => !needle || [r.title, r.provider].some((w) => String(w || '').toLowerCase().includes(needle))).map((r) => {
    const mine = seats.filter((s) => s.trainingId === r.id);
    const n = (st: string) => mine.find((s) => s.status === st)?._count._all || 0;
    return { ...r, hours: r.hours === null ? null : Number(r.hours), assigned: n('ASSIGNED'), completed: n('COMPLETED'), missed: n('MISSED') };
  });
}

export async function trainingOf(orgId: string, id: string, scope: TeamScope) {
  const t = await peoplePrisma.training.findFirst({ where: { id, orgId } });
  if (!t) throw new TalentError('No such training.', 404);
  const seats = await peoplePrisma.trainingSeat.findMany({ where: { orgId, trainingId: id, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, select: { id: true, trainingId: true, employeeId: true, status: true, completedOn: true, expiresOn: true, certName: true, certSize: true, certMime: true, certUrl: true } });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: seats.map((s) => s.employeeId) } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p]));
  return { training: { ...t, hours: t.hours === null ? null : Number(t.hours) }, seats: seats.map((s) => seatShape(s, people.get(s.employeeId))).sort((a, b) => String(a.employee?.name).localeCompare(String(b.employee?.name))) };
}

/** Certificates lapsed or lapsing within 60 days, soonest first. */
export async function expiring(orgId: string, scope: TeamScope, now = new Date()) {
  const today = todayIst(now);
  const seats = await peoplePrisma.trainingSeat.findMany({ where: { orgId, status: 'COMPLETED', expiresOn: { not: null, lte: addDays(today, 60) }, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, orderBy: { expiresOn: 'asc' }, select: { id: true, trainingId: true, employeeId: true, status: true, completedOn: true, expiresOn: true, certName: true, certSize: true, certMime: true, certUrl: true }, take: 500 });
  const [people, trainings] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: seats.map((s) => s.employeeId) }, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true } }),
    peoplePrisma.training.findMany({ where: { orgId, id: { in: seats.map((s) => s.trainingId) } }, select: { id: true, title: true } }),
  ]);
  const p = new Map(people.map((x) => [x.id, x]));
  const t = new Map(trainings.map((x) => [x.id, x.title]));
  /* A later completion of the same training renews it: only the newest certificate per person counts. */
  return seats.filter((s) => p.has(s.employeeId)).map((s) => ({ ...seatShape(s, p.get(s.employeeId), today), trainingTitle: t.get(s.trainingId) || '' }));
}

/* ------------------------------------------------------------------- the job */

const stageFor = (daysLeft: number) => (daysLeft <= 0 ? 0 : daysLeft <= 30 ? 30 : daysLeft <= 60 ? 60 : null);

/** One notice per certificate per stage, to HR (Learning edit) and the person. */
export async function runCertificateReminders(now = new Date()) {
  const today = todayIst(now);
  const due = await outsideTenant('job: certificate renewals', () => peoplePrisma.trainingSeat.findMany({ where: { status: 'COMPLETED', expiresOn: { not: null, lte: addDays(today, 60) } }, select: { id: true, accountId: true, orgId: true, trainingId: true, employeeId: true, expiresOn: true, remindedStage: true }, take: 2000 }));
  let sent = 0;
  for (const s of due) {
    const days = Math.round((Date.parse(`${s.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const stage = stageFor(days);
    if (stage === null || (s.remindedStage !== null && s.remindedStage <= stage)) continue;
    try {
      await runInTenant(s.orgId, async () => {
        const [t, e] = await Promise.all([peoplePrisma.training.findFirst({ where: { id: s.trainingId }, select: { title: true } }), peoplePrisma.employee.findFirst({ where: { id: s.employeeId }, select: { name: true, userId: true, status: true } })]);
        if (!t || !e || e.status === 'LEFT') return;
        const hr = await usersWithPermission(s.accountId, s.orgId, 'PEOPLE::Learning::EDIT').catch(() => [] as string[]);
        const title = days <= 0 ? `${t.title} certificate lapsed: ${e.name}` : `${t.title} certificate lapses in ${days} days: ${e.name}`;
        await sendNotice(s.accountId, s.orgId, [...new Set([...hr, ...(e.userId ? [e.userId] : [])])], { kind: 'people.training', title, body: `On ${s.expiresOn}`, link: { app: 'people', screen: 'learning', params: { view: 'expiring' } } as any }, { dedupeKey: `cert:${s.id}:${s.expiresOn}:${stage}` });
        await peoplePrisma.trainingSeat.update({ where: { id: s.id }, data: { remindedStage: stage } });
        sent += 1;
      });
    } catch (err) {
      console.error(`[talent] certificate ${s.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/** Old rejected candidates cleared, company by company. */
export async function runCandidateRetention(now = new Date()) {
  const orgs = await outsideTenant('job: candidate retention', () => peoplePrisma.candidate.findMany({ where: { anonymisedAt: null, stage: { in: ['REJECTED', 'WITHDRAWN'] }, stageAt: { lt: new Date(now.getTime() - 365 * 86_400_000) } }, select: { orgId: true }, distinct: ['orgId'], take: 1000 }));
  let done = 0;
  for (const o of orgs) {
    try {
      done += await runInTenant(o.orgId, () => anonymiseOldCandidates(o.orgId, 365, now));
    } catch (err) {
      console.error(`[talent] retention ${o.orgId}:`, err instanceof Error ? err.message : err);
    }
  }
  return done;
}

export function startTalentJobs({ intervalMs = 6 * 3_600_000, startupDelayMs = 200_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('people.talent', leaseFor(intervalMs), async () => ({ certificates: await runCertificateReminders(), candidates: await runCandidateRetention(), referralBonuses: await runReferralBonuses() })).catch((e) => console.error('[talent] failed:', e instanceof Error ? e.message : e));
  registerJob('startTalentJobs', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
