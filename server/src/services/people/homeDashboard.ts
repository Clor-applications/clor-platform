import type { Request } from 'express';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../attendance/guards.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../payroll/guards.js';
import { isFeatureEnabled } from '../features.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';
import { scopeWhere, teamScope } from './scope.js';
import { seesLeavings } from './companyChoices.js';
import { headcount } from './headcount.js';
import { IFSC, PAN, UAN } from './dataHealth.js';
import { OPEN_STAGES } from './talent/hiring.js';
import { DEPT_WORD, type Dept } from './engagement/clearance.js';
import { addDays, todayIst } from '../../utils/istDate.js';
import { crossAppLinks } from './homeCrossApp.js';

/**
 * People → Home's dashboard (owner's suite spec, 5–6 Nov 2026), beside the to-do list in home.ts: today's
 * attendance, the decisions that wait on this reader with their facts, the shape of the workforce, and hiring.
 * Every number is counted from the records; a part this reader may not see, or an app the company does not
 * use, is left out (null), never shown as nought.
 */

const clean = (v: string | null | undefined) => String(v || '').replace(/\s+/g, '').toUpperCase();
const digits = (v: string | null | undefined) => String(v || '').replace(/\D/g, '');
/** A leave type that is sick leave, by its name or its code. */
export const isSickLeave = (t: { name?: string | null; code?: string | null } | undefined) => Boolean(t && (/sick|medical/i.test(t.name || '') || /^(SL|ML|SICK)$/i.test(t.code || '')));
/** Probation check-ins, counted in days from the joining date. */
export const PROBATION_MARKS = [30, 60, 90] as const;
/** A check-in shows from a week before its day until a week after. */
const MARK_WINDOW = 7;
/** Contract labour and consultants: paid on an invoice, not on the payroll. */
const CONTRACT_KINDS = new Set(['CONSULTANT', 'AGENCY']);
const LEARNER_KINDS = new Set(['INTERN', 'TRAINEE']);

type Kind = 'FULL_TIME' | 'PART_TIME' | 'LEARNER' | 'CONTRACTOR';
export const KIND_WORD: Record<Kind, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', LEARNER: 'Interns and trainees', CONTRACTOR: 'Contractors' };

const tally = (keys: string[]) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export async function homeDashboard(req: Request) {
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const may = async (module: string, action: string, resource: string) => !(await authorize(req, module, action as any, resource));
  const [scope, leavingsOk, attendanceOn, payrollOn, seeRecords, seeLeave, seeHiring, seeProfiles, editPeople] = await Promise.all([
    teamScope(req),
    seesLeavings(req),
    isFeatureEnabled(accountId, orgId, 'attendance'),
    isFeatureEnabled(accountId, orgId, 'payroll'),
    may(ATTENDANCE_MODULE, PermissionAction.VIEW, ATTENDANCE_RESOURCE.records),
    may(ATTENDANCE_MODULE, PermissionAction.VIEW, ATTENDANCE_RESOURCE.leave),
    may(PEOPLE_MODULE, PermissionAction.VIEW, 'Recruitment'),
    may(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.profile),
    may(PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees),
  ]);
  const hr = editPeople && scope.all;
  const today = todayIst();

  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' }, ...scopeWhere(scope) },
    select: { id: true, name: true, photoUrl: true, department: true, dateOfJoining: true, probationEndDate: true, confirmedOn: true, attendanceRequired: true, branchId: true, workLocation: true, establishmentId: true, employeeTypeId: true, contractorId: true, hours: true },
  });
  /* Working here today: someone joining next week is not yet counted (as the overview counts). */
  const working = people.filter((p) => !p.dateOfJoining || String(p.dateOfJoining).slice(0, 10) <= today);
  const ids = working.map((p) => p.id);
  const byId = new Map(people.map((p) => [p.id, p]));
  const who = (id: string) => ({ employeeId: id, name: byId.get(id)?.name || 'Someone', photoUrl: byId.get(id)?.photoUrl || null, department: byId.get(id)?.department || null });

  const [today_, workforce, decisions, hiring, links] = await Promise.all([
    todayAt(),
    workforceOf(),
    decisionsFor(),
    seeHiring ? hiringNow() : Promise.resolve(null),
    crossAppLinks(req, { attendanceOn, payrollOn, scopeIds: scope.all ? null : ids }).catch((e) => {
      console.error(`[home] cross-app links for ${orgId}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
      return [];
    }),
  ]);
  return { today: today_, decisions, workforce, hiring, links };

  /* ------------------------------------------------------------------ today */
  async function todayAt() {
    const [leave, requests, records] = await Promise.all([
      seeLeave
        ? peoplePrisma.leaveRequest.findMany({ where: { accountId, orgId, status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today }, employeeId: { in: ids } }, select: { employeeId: true, leaveTypeId: true, toDate: true, halfDay: true } })
        : Promise.resolve(null),
      attendanceOn && (seeRecords || seeLeave)
        ? peoplePrisma.attendanceRequest.findMany({ where: { accountId, orgId, status: 'APPROVED', kind: { in: ['WFH', 'ON_DUTY'] }, date: { lte: today }, employeeId: { in: ids } }, select: { employeeId: true, kind: true, date: true, toDate: true, place: true, halfDay: true } })
        : Promise.resolve(null),
      attendanceOn && seeRecords
        ? peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date: today, employeeId: { in: ids } }, select: { employeeId: true, checkIn: true, checkOut: true, lateMinutes: true } })
        : Promise.resolve(null),
    ]);
    const types = leave?.length ? await peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: [...new Set(leave.map((l) => l.leaveTypeId))] } }, select: { id: true, name: true, code: true } }) : [];
    const typeOf = new Map(types.map((t) => [t.id, t]));
    const away = {
      planned: (leave || []).filter((l) => !isSickLeave(typeOf.get(l.leaveTypeId))).map((l) => ({ ...who(l.employeeId), what: typeOf.get(l.leaveTypeId)?.name || 'Leave', until: l.toDate, half: l.halfDay || null })),
      sick: (leave || []).filter((l) => isSickLeave(typeOf.get(l.leaveTypeId))).map((l) => ({ ...who(l.employeeId), what: typeOf.get(l.leaveTypeId)?.name || 'Sick leave', until: l.toDate, half: l.halfDay || null })),
      /* A one-day request has no end date: it covers its own day only. */
      wfh: (requests || []).filter((r) => r.kind === 'WFH' && (r.toDate || r.date) >= today).map((r) => ({ ...who(r.employeeId), what: 'Work from home', until: r.toDate || r.date, half: r.halfDay || null })),
      field: (requests || []).filter((r) => r.kind === 'ON_DUTY' && (r.toDate || r.date) >= today).map((r) => ({ ...who(r.employeeId), what: r.place ? `On duty: ${r.place}` : 'On duty', until: r.toDate || r.date, half: r.halfDay || null })),
    };
    const expected = working.filter((p) => p.attendanceRequired !== false).length;
    const clock = records
      ? {
          expected,
          clockedIn: records.filter((r) => r.checkIn).length,
          inNow: records.filter((r) => r.checkIn && !r.checkOut).length,
          late: records.filter((r) => r.checkIn && r.lateMinutes > 0).length,
        }
      : null;
    return {
      date: today,
      clock,
      away: leave || requests ? { planned: leave ? away.planned : null, sick: leave ? away.sick : null, wfh: requests ? away.wfh : null, field: requests ? away.field : null } : null,
    };
  }

  /* -------------------------------------------------------------- decisions */
  async function decisionsFor() {
    /* Probation check-ins at 30, 60 and 90 days, a week either side, unless a review was written since. */
    const onProbation = working.filter((p) => p.probationEndDate && !p.confirmedOn && p.dateOfJoining);
    const reviews = onProbation.length ? await peoplePrisma.probationReview.findMany({ where: { orgId, employeeId: { in: onProbation.map((p) => p.id) } }, select: { employeeId: true, createdAt: true } }) : [];
    const lastReview = new Map<string, string>();
    for (const r of reviews) {
      const d = r.createdAt.toISOString().slice(0, 10);
      if (d > (lastReview.get(r.employeeId) || '')) lastReview.set(r.employeeId, d);
    }
    const probation: Array<ReturnType<typeof who> & { mark: number; on: string; late: boolean }> = [];
    for (const p of onProbation) {
      const joined = String(p.dateOfJoining).slice(0, 10);
      for (const mark of PROBATION_MARKS) {
        const on = addDays(joined, mark);
        if (on > String(p.probationEndDate)) break;
        if (on < addDays(today, -MARK_WINDOW) || on > addDays(today, MARK_WINDOW)) continue;
        if ((lastReview.get(p.id) || '') >= addDays(on, -MARK_WINDOW)) continue;
        probation.push({ ...who(p.id), mark, on, late: on < today });
      }
    }
    probation.sort((a, b) => a.on.localeCompare(b.on));

    /* Statutory details payroll and the returns need, by field. Counts only: the numbers never leave the server. */
    let statutory: null | { people: number; fields: Array<{ key: string; label: string; count: number }> } = null;
    if (editPeople) {
      const identity = await peoplePrisma.employeeIdentity.findMany({ where: { orgId, employeeId: { in: ids } }, select: { employeeId: true, aadhaarLast4: true } });
      const hasAadhaar = new Set(identity.filter((i) => /^\d{4}$/.test(i.aadhaarLast4 || '')).map((i) => i.employeeId));
      const gaps = new Map<string, Set<string>>([['aadhaar', new Set(ids.filter((id) => !hasAadhaar.has(id)))]]);
      if (payrollOn && seeProfiles) {
        const paid = (await payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids }, payrollStatus: 'IN_PAYROLL' }, select: { employeeId: true, pan: true, uan: true, pfApplicable: true, bankAccountNumber: true, bankIfsc: true } }));
        gaps.set('pan', new Set(paid.filter((p) => !PAN.test(clean(p.pan))).map((p) => p.employeeId)));
        gaps.set('bank', new Set(paid.filter((p) => !digits(p.bankAccountNumber) || !IFSC.test(clean(p.bankIfsc))).map((p) => p.employeeId)));
        gaps.set('uan', new Set(paid.filter((p) => p.pfApplicable && !UAN.test(digits(p.uan))).map((p) => p.employeeId)));
      }
      const LABEL: Record<string, string> = { aadhaar: 'Aadhaar', pan: 'PAN', bank: 'Bank account or IFSC', uan: 'UAN for PF' };
      const all = new Set([...gaps.values()].flatMap((s) => [...s]));
      statutory = { people: all.size, fields: ['aadhaar', 'pan', 'bank', 'uan'].filter((k) => gaps.get(k)?.size).map((k) => ({ key: k, label: LABEL[k], count: gaps.get(k)!.size })) };
    }

    /* Exit clearance: the open no-dues lines this reader signs (their own), and HR the ones nobody owns. */
    const lines = await peoplePrisma.clearanceLine.findMany({
      where: { accountId, orgId, status: 'OPEN', OR: [{ ownerUserId: userId }, ...(hr ? [{ ownerUserId: null }] : [])] },
      select: { employeeId: true, dept: true, label: true, leavingDate: true, ownerUserId: true },
      orderBy: [{ leavingDate: 'asc' }, { sortOrder: 'asc' }],
    });
    const leaverIds = [...new Set(lines.map((l) => l.employeeId))];
    const leavers = leaverIds.length ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: leaverIds } }, select: { id: true, name: true, photoUrl: true, department: true } }) : [];
    const leaverOf = new Map(leavers.map((e) => [e.id, e]));
    const clearance = leaverIds
      /* Leavings kept from this reader (SPEC 3.5): only a line they own themselves. */
      .filter((id) => leavingsOk || lines.some((l) => l.employeeId === id && l.ownerUserId === userId))
      .map((id) => {
        const mine = lines.filter((l) => l.employeeId === id);
        const e = leaverOf.get(id);
        return { employeeId: id, name: e?.name || 'Someone', photoUrl: e?.photoUrl || null, department: e?.department || null, lastDay: mine[0].leavingDate, lines: mine.map((l) => ({ dept: l.dept, label: l.label || DEPT_WORD[l.dept as Dept] || l.dept })), late: mine[0].leavingDate < today };
      });

    return { probation, statutory, clearance };
  }

  /* -------------------------------------------------------------- workforce */
  async function workforceOf() {
    const [types, ests, entities, branches] = await Promise.all([
      peoplePrisma.employeeType.findMany({ where: { orgId }, select: { id: true, category: true } }),
      peoplePrisma.establishment.findMany({ where: { orgId }, select: { id: true, legalEntityId: true } }),
      peoplePrisma.legalEntity.findMany({ where: { orgId }, select: { id: true, name: true } }),
      platformPrisma.branch.findMany({ where: { orgId }, select: { id: true, branchName: true } }),
    ]);
    const category = new Map(types.map((t) => [t.id, t.category]));
    const entityOfEst = new Map(ests.map((e) => [e.id, e.legalEntityId]));
    const entityName = new Map(entities.map((e) => [e.id, e.name]));
    const branchName = new Map(branches.map((b) => [b.id, b.branchName]));
    const kindOf = (p: (typeof working)[number]): Kind => {
      const c = p.employeeTypeId ? category.get(p.employeeTypeId) : null;
      if (p.contractorId || (c && CONTRACT_KINDS.has(c))) return 'CONTRACTOR';
      if (c && LEARNER_KINDS.has(c)) return 'LEARNER';
      return p.hours === 'PART_TIME' ? 'PART_TIME' : 'FULL_TIME';
    };
    const kinds = tally(working.map(kindOf)).map((k) => ({ key: k.name, name: KIND_WORD[k.name as Kind], count: k.count }));
    /* An entity breakdown says something only when the company has more than one, or people sit outside one. */
    const byEntity = entities.length ? tally(working.map((p) => entityName.get(entityOfEst.get(p.establishmentId || '') || '') || 'No entity')) : [];
    const byLocation = tally(working.map((p) => (p.branchId && branchName.get(p.branchId)) || p.workLocation || 'Not set'));

    /* Joiners and leavers, the last twelve months, from the stints (the People report's numbers). Company-wide only. */
    let months: Array<{ month: string; joiners: number; leavers: number | null }> | null = null;
    if (scope.all) {
      const first = `${addDays(`${today.slice(0, 7)}-01`, -330).slice(0, 7)}-01`;
      const h = await headcount(orgId, { from: first, to: today });
      months = h.months.slice(-12).map((m) => ({ month: m.month, joiners: m.joiners, leavers: leavingsOk ? m.leavers : null }));
    }
    return {
      headcount: working.length,
      byDepartment: tally(working.map((p) => p.department || 'No department')),
      byEntity: byEntity.length > 1 || byEntity.some((e) => e.name !== 'No entity') ? byEntity : null,
      byLocation,
      byKind: kinds,
      months,
    };
  }

  /* ----------------------------------------------------------------- hiring */
  async function hiringNow() {
    const openings = await peoplePrisma.jobOpening.findMany({ where: { orgId, status: { in: ['REQUESTED', 'OPEN', 'ON_HOLD'] } }, select: { id: true, status: true, places: true } });
    const live = openings.filter((o) => o.status !== 'REQUESTED');
    const candidates = live.length
      ? await peoplePrisma.candidate.groupBy({ by: ['stage'], where: { orgId, openingId: { in: live.map((o) => o.id) }, stage: { in: OPEN_STAGES } }, _count: { _all: true } })
      : [];
    const at = new Map(candidates.map((c) => [c.stage, c._count._all]));
    return {
      open: openings.filter((o) => o.status === 'OPEN').length,
      onHold: openings.filter((o) => o.status === 'ON_HOLD').length,
      requested: openings.filter((o) => o.status === 'REQUESTED').length,
      places: live.reduce((n, o) => n + (o.places || 0), 0),
      pipeline: OPEN_STAGES.map((stage) => ({ stage, count: at.get(stage) || 0 })),
    };
  }
}

