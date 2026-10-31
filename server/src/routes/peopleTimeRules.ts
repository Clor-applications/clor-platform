import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { recordAudit } from '../services/auditTrail.js';
import { ownRecordRefusal } from '../services/makerChecker.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, hrOrAttendanceRouteOk } from '../services/people/guards.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { correlationOf } from '../services/people/employees.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { myEmployee, today } from '../services/attendance/days.js';
import { RulesError, mergeRules, saveTimeRules, timeRulesFor, timeRulesSchema, currentRuleVersion } from '../services/attendance/timeRules.js';
import * as marks from '../services/attendance/markRules.js';
import * as absence from '../services/people/absconding.js';
import * as night from '../services/people/nightConsent.js';

/**
 * People's attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6, B19), HR's and the
 * manager's side. Open when People or Attendance is on.
 *
 *  - Settings → Attendance rules: read by anyone who sees attendance; changed only by someone who
 *    decides attendance requests for the whole company (as the request rules are).
 *  - Late marks: a month's penalties, with a preview of a draft rule. A manager sees and waives for
 *    their team; HR waives for anyone and applies the month.
 *  - Absences: unexplained absence cases, notices, the leaving and the settlement hold (HR).
 *  - Night work: women's consent, recorded with the signed copy, and the report (HR).
 */
export const peopleTimeRulesRouter = Router();
const base = '/orgs/:orgId/people';
for (const p of ['attendance-rules', 'late-marks', 'absences', 'night-work', 'my/late-marks']) peopleTimeRulesRouter.use(`${base}/${p}`, requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const att = (action: string, resource: string) => requirePermission(ATTENDANCE_MODULE, action as any, resource);
const ppl = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId });
const whoC = (req: Request) => ({ ...who(req), correlationId: correlationOf(req as any) });
const CUT_WORDS: Record<string, string> = { TIME_MISSED: 'the time actually missed', TIME_MISSED_ROUNDED_DOWN: 'the time missed, rounded down', HALF_DAY_PER_N: 'every N marks, ½ or 1 day' };
const isMonth = (m: unknown) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const lastMonth = () => {
  const [y, m] = today().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    await fn(req, res);
  } catch (e: any) {
    if (e instanceof RulesError || e instanceof marks.MarksError || e instanceof absence.AbsenceError || e instanceof night.ConsentError || (e?.status && e.status < 500)) {
      return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.month ? { month: e.month } : {}) });
    }
    console.error('[attendance rules]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
};

/* ------------------------------------------------------------- the rules */

peopleTimeRulesRouter.get(`${base}/attendance-rules`, att(PermissionAction.VIEW, R.requests), handle(async (req, res) => {
  const { orgId } = req.tenant!;
  const [rules, types, version] = await Promise.all([
    timeRulesFor(orgId),
    peoplePrisma.leaveType.findMany({ where: { orgId, isPaid: true, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    currentRuleVersion(orgId),
  ]);
  res.json({ rules, leaveTypes: types, version, canEdit: (await teamScope(req)).all && !(await authorize(req, ATTENDANCE_MODULE, PermissionAction.APPROVE, R.requests)) });
}));

/*
 * The rules cost pay (late marks), so they are HR's for the whole company, or the owner's (SPEC 3.1). The right is the
 * one that decides attendance requests, which the Team Manager preset holds too, for its own team: so a role limited
 * to its team (ownDocumentsOnly) is refused here, whatever rights it holds (attendanceRules.test, lateMarkCut.test).
 */
peopleTimeRulesRouter.put(`${base}/attendance-rules`, att(PermissionAction.APPROVE, R.requests), handle(async (req, res) => {
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Attendance rules are set by someone who decides for the whole company.' });
  const { accountId, orgId } = req.tenant!;
  const before = await timeRulesFor(orgId);
  const out = await saveTimeRules(accountId, orgId, req.auth!.userId, req.body);
  if (JSON.stringify(before) !== JSON.stringify(out.rules)) {
    await recordAudit(req, { entity: 'AttendanceSettings', entityId: orgId, action: 'UPDATE', message: `Attendance rules changed (version ${out.version})${out.marksFrom ? `; late marks from ${out.marksFrom}` : ''}`, metadata: { before, after: out.rules, from: out.marksFrom } });
  }
  /* The late-mark cut is one of the company's choices (SPEC 3, DECISIONS.md 1): its own line, as the others have. */
  const cutOf = (m: typeof before.marks) => ({ cutMode: m.cutMode, roundToMinutes: m.roundToMinutes });
  if (JSON.stringify(cutOf(before.marks)) !== JSON.stringify(cutOf(out.rules.marks))) {
    await recordAudit(req, { entity: 'COMPANY_SETTING', entityId: 'attendance.lateMarkCut', action: 'CHANGED', message: `Late marks cut: ${CUT_WORDS[before.marks.cutMode]} → ${CUT_WORDS[out.rules.marks.cutMode]}${out.marksFrom ? `, from ${out.marksFrom}` : ', from this month'}`, metadata: { before: cutOf(before.marks), after: cutOf(out.rules.marks), from: out.marksFrom } });
  }
  res.json(out);
}));

/* ------------------------------------------------------------- late marks */

/** The month's penalties: the viewer's team only, for a team role. */
peopleTimeRulesRouter.get(`${base}/late-marks`, att(PermissionAction.VIEW, R.requests), handle(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const month = isMonth(req.query.month) ? String(req.query.month) : lastMonth();
  const scope = await teamScope(req);
  const out = await marks.monthPenalties(accountId, orgId, month, scope.all ? {} : { employeeIds: scope.ids });
  res.json({ ...out, canApply: scope.all, canWaive: true });
}));

/** What a rule not yet saved would do to a month: each person now and with the change. */
peopleTimeRulesRouter.post(`${base}/late-marks/preview`, att(PermissionAction.VIEW, R.requests), handle(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const month = isMonth(req.body?.month) ? String(req.body.month) : lastMonth();
  const parsed = timeRulesSchema.safeParse({ marks: req.body?.marks || {} });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rule.' });
  const current = await timeRulesFor(orgId);
  const draft = mergeRules(current, parsed.data).marks;
  const scope = await teamScope(req);
  const limit = scope.all ? {} : { employeeIds: scope.ids };
  const [now, then] = await Promise.all([marks.monthPenalties(accountId, orgId, month, { ...limit, draft: current.marks }), marks.monthPenalties(accountId, orgId, month, { ...limit, draft })]);
  const nowOf = new Map(now.rows.map((r) => [r.employeeId, r]));
  const ids = [...new Set([...now.rows.map((r) => r.employeeId), ...then.rows.map((r) => r.employeeId)])];
  const thenOf = new Map(then.rows.map((r) => [r.employeeId, r]));
  const rows = ids.map((id) => {
    const a = nowOf.get(id);
    const b = thenOf.get(id);
    return { employeeId: id, name: (b || a)!.name, code: (b || a)!.code, lateMarks: (b || a)!.lateMarks, earlyMarks: (b || a)!.earlyMarks, now: a?.days ?? 0, then: b?.days ?? 0, timeMissedDays: b?.timeMissedDays ?? 0, timeMissedMinutes: b?.timeMissedMinutes ?? 0, fromLeave: b?.fromLeave ?? [], lossOfPayDays: b?.lossOfPayDays ?? 0 };
  }).filter((r) => r.now || r.then).sort((x, y) => y.then - x.then || x.name.localeCompare(y.name));
  res.json({ month, rules: draft, rows, totals: { now: now.totals.days, then: then.totals.days, people: rows.filter((r) => r.then > 0).length } });
}));

peopleTimeRulesRouter.post(`${base}/late-marks/:employeeId/waive`, att(PermissionAction.APPROVE, R.requests), handle(async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const scope = await teamScope(req);
  if (!inScope(scope, employeeId)) return res.status(404).json({ error: 'No such person in your team.' });
  /* A manager does not waive their own. */
  const mine = await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId).catch(() => null);
  if (mine?.id === employeeId) return res.status(403).json({ error: 'Your own penalty is waived by your manager or HR.', code: 'OWN' });
  const month = String(req.body?.month || '');
  const row = await marks.waive(who(req), employeeId, month, String(req.body?.reason || ''));
  res.status(201).json({ penalty: row });
}));

peopleTimeRulesRouter.post(`${base}/late-marks/:employeeId/undo`, att(PermissionAction.APPROVE, R.requests), handle(async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const scope = await teamScope(req);
  if (!inScope(scope, employeeId)) return res.status(404).json({ error: 'No such person in your team.' });
  const month = String(req.body?.month || '');
  /* Undoing an apply gives leave back: HR's, as applying is. A waiver is taken back by whoever gave it, or HR. */
  res.json(await marks.undo(who(req), employeeId, month, { hr: scope.all }));
}));

peopleTimeRulesRouter.post(`${base}/late-marks/apply`, att(PermissionAction.APPROVE, R.requests), handle(async (req, res) => {
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'HR applies the month for the whole company.' });
  const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(String).slice(0, 2000) : null;
  res.json(await marks.apply(who(req), String(req.body?.month || ''), ids));
}));

/** The signed-in person's own month (People's My attendance). */
peopleTimeRulesRouter.get(`${base}/my/late-marks`, handle(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const me = await myEmployee(accountId, orgId, req.auth!.userId).catch(() => null);
  if (!me) return res.json({ on: false });
  const month = isMonth(req.query.month) ? String(req.query.month) : today().slice(0, 7);
  res.json(await marks.myMarks({ id: me.id, accountId, orgId }, month));
}));

/* ------------------------------------------------------------- absences */

peopleTimeRulesRouter.get(`${base}/absences`, ppl(PermissionAction.VIEW, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  const scope = await teamScope(req);
  const status = ['open', 'closed', 'absconded', 'all'].includes(String(req.query.status)) ? String(req.query.status) : 'open';
  res.json({ ...(await absence.listCases(req.tenant!.orgId, { status, scopeIds: scope.all ? null : scope.ids })), canAct: scope.all });
}));

/** Look for streaks now (HR's "check now"); the morning job does the same. */
peopleTimeRulesRouter.post(`${base}/absences/check`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'HR follows up absences.' });
  res.json(await absence.checkCompany(req.tenant!.accountId, req.tenant!.orgId));
}));

const hrOnly = async (req: Request, res: Response) => {
  if ((await teamScope(req)).all) return true;
  res.status(403).json({ error: 'HR follows up absences.' });
  return false;
};

peopleTimeRulesRouter.post(`${base}/absences/:id/notice`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await hrOnly(req, res))) return;
  res.status(201).json({ notice: await absence.sendAbsenceNotice(whoC(req), String(req.params.id), req.body || {}) });
}));

peopleTimeRulesRouter.get(`${base}/absences/notices/:id`, ppl(PermissionAction.VIEW, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await hrOnly(req, res))) return;
  res.json({ notice: await absence.noticeCopy(req.tenant!.orgId, String(req.params.id)) });
}));

peopleTimeRulesRouter.post(`${base}/absences/:id/close`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await hrOnly(req, res))) return;
  res.json({ case: await absence.closeCase(whoC(req), String(req.params.id), req.body || {}) });
}));

peopleTimeRulesRouter.post(`${base}/absences/:id/absconded`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await hrOnly(req, res))) return;
  res.json({ case: await absence.recordAbsconded(whoC(req), String(req.params.id), req.body || {}) });
}));

peopleTimeRulesRouter.post(`${base}/absences/:id/hold`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await hrOnly(req, res))) return;
  res.json({ case: await absence.holdSettlement(whoC(req), String(req.params.id), String(req.body?.reason || '')) });
}));

peopleTimeRulesRouter.post(`${base}/absences/:id/release`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await hrOnly(req, res))) return;
  /* Never by the person held: somebody else in HR, or the owner, lifts it (as Payroll's release-hold does). */
  const held = await peoplePrisma.absenceCase.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId }, select: { employeeId: true } });
  const mine = held ? await ownRecordRefusal(req, held.employeeId, 'settlement hold', { who: 'another HR user or the owner', does: 'lift it' }) : null;
  if (mine) return void res.status(mine.status).json(mine.body);
  res.json({ case: await absence.releaseHold(whoC(req), String(req.params.id), String(req.body?.note || '')) });
}));

/** Settlements on hold, for Home and for Payroll. */
peopleTimeRulesRouter.get(`${base}/absences/holds`, ppl(PermissionAction.VIEW, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  const scope = await teamScope(req);
  const rows = await absence.settlementHolds(req.tenant!.orgId);
  res.json({ holds: rows.filter((r) => inScope(scope, r.employeeId)) });
}));

/* ------------------------------------------------------------- night work */

peopleTimeRulesRouter.get(`${base}/night-work`, ppl(PermissionAction.VIEW, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  const scope = await teamScope(req);
  res.json({ ...(await night.nightReport(req.tenant!.orgId, scope.all ? null : scope.ids, { hr: scope.all })), canEdit: scope.all });
}));

peopleTimeRulesRouter.get(`${base}/night-work/:employeeId`, ppl(PermissionAction.VIEW, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  /* Consent notes and history are HR's: a manager sees the status in the report, nothing more. */
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Consent history is kept by HR.' });
  res.json({ history: await night.consentHistory(req.tenant!.orgId, String(req.params.employeeId)) });
}));

peopleTimeRulesRouter.post(`${base}/night-work/:employeeId`, ppl(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), handle(async (req, res) => {
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'HR records consent.' });
  let file = null;
  if (req.body?.file?.data) {
    const f = decodeDocument(req.body.file.data, req.body.file.mime);
    if ('error' in f) return res.status(400).json({ error: f.error });
    file = { name: String(req.body.file.name || 'consent').slice(0, 120), mime: f.mime, data: f.data };
  }
  const row = await night.recordConsent(who(req), String(req.params.employeeId), { status: req.body?.status, onDate: req.body?.onDate, note: req.body?.note, file });
  res.status(201).json({ consent: row });
}));
