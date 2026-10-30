import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { notifyPermission } from '../notifications.js';
import { isFeatureEnabled } from '../features.js';
import { loadSchedule, resolveShift } from '../attendance/schedule.js';
import { daysBetween, today } from '../attendance/days.js';
import { nightWords, timeRulesFor, touchesNight, type NightRules } from '../attendance/timeRules.js';

/**
 * Women's consent to night work (WORKFLOW-GAP-RESEARCH-2026-10-30 B19).
 *
 * The OSH Code 2020 s.43 lets a woman work before 6 am or after 7 pm only with her consent, and with
 * the safeguards the government sets; some states add their own (Tamil Nadu's 365-day permission,
 * complianceRules IN-TN-365). CLOR keeps the consent itself, given or withdrawn with its date and the
 * signed copy, and refuses to give a woman a shift that touches the night window without consent in
 * force, wherever the shift is given: a shift assignment, a temporary schedule, a rotation, a shift
 * change request and a shift swap. The safeguards (transport, CCTV, POSH) stay in Compliance.
 *
 * The window is a company setting (7 pm to 6 am by default) because states differ. Who is a woman is
 * the employee file's gender (FEMALE); someone with no gender recorded is not checked, and the report
 * says how many those are.
 */

export class ConsentError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

export type Consent = { status: 'GIVEN' | 'WITHDRAWN'; onDate: string; note: string | null; documentId: string | null; recordedByUserId: string; at: Date };

/** The consent in force for each person: their latest record, or none. */
export async function consentOf(orgId: string, employeeIds: string[]): Promise<Map<string, Consent>> {
  const out = new Map<string, Consent>();
  if (!employeeIds.length) return out;
  const rows = await peoplePrisma.nightWorkConsent.findMany({ where: { orgId, employeeId: { in: employeeIds } }, orderBy: [{ createdAt: 'desc' }] });
  for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, { status: r.status as Consent['status'], onDate: r.onDate, note: r.note, documentId: r.documentId, recordedByUserId: r.recordedByUserId, at: r.createdAt });
  return out;
}

export type Giving = { employeeId: string; shiftIds: string[] };

/**
 * Why these shifts may not be given to these people, or null when they may. One message, naming the
 * first person refused, so the screen can show it as it is.
 */
export async function nightRefusal(orgId: string, giving: Giving[], opts: { rules?: NightRules; self?: boolean } = {}): Promise<ConsentError | null> {
  const night = opts.rules || (await timeRulesFor(orgId)).night;
  if (!night.on || !giving.length) return null;
  const shiftIds = [...new Set(giving.flatMap((g) => g.shiftIds).filter((s) => s && s !== 'OFF'))];
  if (!shiftIds.length) return null;
  const shifts = await peoplePrisma.shift.findMany({ where: { orgId, id: { in: shiftIds } }, select: { id: true, name: true, startTime: true, endTime: true } });
  const nightly = new Map(shifts.filter((s) => touchesNight(s, night)).map((s) => [s.id, s]));
  if (!nightly.size) return null;
  const asked = giving.filter((g) => g.shiftIds.some((s) => nightly.has(s)));
  if (!asked.length) return null;
  const women = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(asked.map((g) => g.employeeId))] }, gender: 'FEMALE' }, select: { id: true, name: true } });
  if (!women.length) return null;
  const consent = await consentOf(orgId, women.map((w) => w.id));
  const missing = women.filter((w) => consent.get(w.id)?.status !== 'GIVEN');
  if (!missing.length) return null;
  const first = missing[0];
  const shift = nightly.get(asked.find((g) => g.employeeId === first.id)!.shiftIds.find((s) => nightly.has(s))!)!;
  const others = missing.length > 1 ? ` (and ${missing.length - 1} more)` : '';
  const withdrawn = consent.get(first.id)?.status === 'WITHDRAWN';
  /* The person asking for themselves (a shift change, a swap) is told what to do, not what HR should. */
  if (opts.self && missing.length === 1) {
    return new ConsentError(`${shift.name} (${shift.startTime}–${shift.endTime}) runs into ${nightWords(night)}, and ${giving.length > 1 && first.id !== giving[0].employeeId ? `${first.name} has` : 'you have'} no consent to night work on file. ${giving.length > 1 && first.id !== giving[0].employeeId ? 'Ask another colleague.' : 'Give it in the app under Me, Night work, or ask HR.'}`, 409, 'NIGHT_CONSENT');
  }
  return new ConsentError(
    `${first.name}${others} ${withdrawn ? 'withdrew her consent to night work' : 'has no consent to night work on file'}. ${shift.name} (${shift.startTime}–${shift.endTime}) runs into ${nightWords(night)}. Record her written consent under People, Night work first, or choose a day shift.`,
    409,
    'NIGHT_CONSENT',
  );
}

export async function assertNightConsent(orgId: string, giving: Giving[], opts: { self?: boolean } = {}) {
  const refused = await nightRefusal(orgId, giving, opts);
  if (refused) throw refused;
}

/** A rotation's shifts, for the check: its sequence names them, "OFF" between. */
export const rotationShiftIds = (sequence: string) => String(sequence || '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'OFF');

// ---------------------------------------------------------------------------
// Recording consent
// ---------------------------------------------------------------------------

type Actor = { accountId: string; orgId: string; userId: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Record consent given or withdrawn, from HR (with the signed copy when there is one) or from the
 * person in the employee app. Withdrawn with night shifts still ahead: HR is told, so they can move
 * her before those days.
 */
export async function recordConsent(who: Actor, employeeId: string, input: { status?: string; onDate?: string | null; note?: string | null; file?: { name: string; mime: string; data: Buffer } | null }) {
  const status = String(input.status || '').toUpperCase();
  if (status !== 'GIVEN' && status !== 'WITHDRAWN') throw new ConsentError('Say whether consent is given or withdrawn.');
  const onDate = String(input.onDate || '').trim() || today();
  if (!ISO.test(onDate)) throw new ConsentError('Dates are YYYY-MM-DD.');
  if (onDate > today()) throw new ConsentError('Record consent on or after the day it was given.');
  const person = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: who.orgId }, select: { id: true, name: true, gender: true, status: true } });
  if (!person) throw new ConsentError('No such employee.', 404);
  const note = String(input.note || '').trim().slice(0, 500) || null;
  const row = await peopleWrite(who.orgId, async () => {
    const current = (await consentOf(who.orgId, [employeeId])).get(employeeId);
    if (current?.status === status && !input.file) throw new ConsentError(status === 'GIVEN' ? 'Consent is already on file.' : 'Consent is already withdrawn.', 409, 'SAME');
    let documentId: string | null = null;
    if (input.file) {
      const doc = await peoplePrisma.employeeDocument.create({
        data: { accountId: who.accountId, orgId: who.orgId, employeeId, kind: 'OTHER', title: `Night-work consent ${status === 'GIVEN' ? 'given' : 'withdrawn'} ${onDate}`.slice(0, 120), mime: input.file.mime, size: input.file.data.length, data: input.file.data, classification: 'EMPLOYEE_VISIBLE', visibleToEmployee: true, uploadedByUserId: who.userId },
      });
      documentId = doc.id;
    }
    return peoplePrisma.nightWorkConsent.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId, status, onDate, note, documentId, recordedByUserId: who.userId } });
  });
  await platformPrisma.auditLog
    .create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'NightWorkConsent', entityId: row.id, action: status === 'GIVEN' ? 'GIVE' : 'WITHDRAW', message: `Night-work consent ${status === 'GIVEN' ? 'given' : 'withdrawn'} for ${person.name}, ${onDate}${who.userId.startsWith('portal:') ? ' (in the employee app)' : ''}`, metadata: JSON.stringify({ employeeId, onDate, documentId: row.documentId }), createdByUserId: who.userId, correlationId: null } })
    .catch((e) => console.error('[night consent] audit not recorded:', e instanceof Error ? e.message : e));
  if (status === 'WITHDRAWN') {
    const ahead = await nightDaysAhead(who.orgId, [employeeId], 30);
    const days = ahead.get(employeeId) || [];
    if (days.length) {
      const app = (await isFeatureEnabled(who.accountId, who.orgId, 'people')) ? 'people' : 'attendance';
      await notifyPermission(who.accountId, who.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.night_consent', title: `${person.name} withdrew consent to night work`, body: `She has ${days.length} night ${days.length === 1 ? 'shift' : 'shifts'} ahead, the first on ${days[0]}. Give her a day shift for those days.`, link: { app, screen: 'nightWork' } }).catch(() => undefined);
    }
  }
  return row;
}

/** The days in the next `count` days each person is scheduled on a shift that touches the night window. */
export async function nightDaysAhead(orgId: string, employeeIds: string[], count: number, night?: NightRules) {
  const rules = night || (await timeRulesFor(orgId)).night;
  const out = new Map<string, string[]>();
  if (!employeeIds.length) return out;
  const t = today();
  const end = new Date(Date.parse(`${t}T00:00:00Z`) + (count - 1) * 86_400_000).toISOString().slice(0, 10);
  const schedule = await loadSchedule(orgId, employeeIds);
  const shifts = new Map((await peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, startTime: true, endTime: true } })).map((s) => [s.id, s]));
  for (const id of employeeIds) {
    const days: string[] = [];
    for (const d of daysBetween(t, end)) {
      const r = resolveShift(schedule, id, d);
      const s = r.shiftId ? shifts.get(r.shiftId) : null;
      if (s && touchesNight(s, rules)) days.push(d);
    }
    out.set(id, days);
  }
  return out;
}

/**
 * HR's report: every woman on the books, her consent and since when, the signed copy, and her night
 * shifts in the next 30 days, those without consent first. `scope` limits it to a team.
 */
export async function nightReport(orgId: string, scopeIds: string[] | null) {
  const night = (await timeRulesFor(orgId)).night;
  const people = await peoplePrisma.employee.findMany({
    where: { orgId, status: { not: 'LEFT' }, ...(scopeIds ? { id: { in: scopeIds } } : {}) },
    select: { id: true, name: true, code: true, department: true, gender: true },
    orderBy: { name: 'asc' },
  });
  const women = people.filter((p) => p.gender === 'FEMALE');
  const ids = women.map((w) => w.id);
  const [consent, ahead] = await Promise.all([consentOf(orgId, ids), nightDaysAhead(orgId, ids, 30, night)]);
  const rows = women.map((w) => {
    const c = consent.get(w.id) || null;
    const days = ahead.get(w.id) || [];
    return { employeeId: w.id, name: w.name, code: w.code, department: w.department, consent: c ? { status: c.status, onDate: c.onDate, note: c.note, documentId: c.documentId, byApp: c.recordedByUserId.startsWith('portal:') } : null, nightDays: days.length, firstNightDay: days[0] || null, problem: days.length > 0 && c?.status !== 'GIVEN' };
  });
  rows.sort((a, b) => Number(b.problem) - Number(a.problem) || a.name.localeCompare(b.name));
  return {
    night: { ...night, words: nightWords(night) },
    rows,
    totals: { women: rows.length, given: rows.filter((r) => r.consent?.status === 'GIVEN').length, withdrawn: rows.filter((r) => r.consent?.status === 'WITHDRAWN').length, problems: rows.filter((r) => r.problem).length, noGender: people.filter((p) => !p.gender).length },
  };
}

/** One person's history, newest first (the record's consent card and the employee app). */
export async function consentHistory(orgId: string, employeeId: string) {
  const rows = await peoplePrisma.nightWorkConsent.findMany({ where: { orgId, employeeId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map((r) => ({ id: r.id, status: r.status, onDate: r.onDate, note: r.note, documentId: r.documentId, byApp: r.recordedByUserId.startsWith('portal:'), at: r.createdAt }));
}
