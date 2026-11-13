import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { recordAudit } from '../services/auditTrail.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { inReportingLine, inScope, teamScope } from '../services/people/scope.js';
import { seesLeavings } from '../services/people/companyChoices.js';
import { ownPlanRefusal } from '../services/people/checklists.js';
import { StayOnError } from '../services/people/lifecycle/stayOn.js';
import '../services/people/engagement/index.js';
import { AutomationError } from '../services/people/engagement/automations.js';
import { getAutomations, putAutomations } from './automations.js';
import { ClearanceError, addLine, clearanceFor, ensureClearance, finalPayBoard, finalPayOf, removeLine, updateLine } from '../services/people/engagement/clearance.js';
import { ExitError, decideInterview, exitSettings, interviewFor, leavingReasons, resetExitSettings, saveExitSettings, submitInterview } from '../services/people/engagement/exitInterview.js';
import { optedOut, setOptOut } from '../services/people/engagement/greetings.js';
import { istDate } from '../services/attendance/compute.js';
import { z } from 'zod';
import { anyBody, check, flag, id, idParams, list, num, q, text } from '../middleware/validate.js';

/**
 * Leaving and engagement, HR's and the manager's side (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.7, 4.8, 4.9).
 *
 *  - A leaving plan's no-dues lines and final-pay clock: read by whoever sees the person (team scope), and a
 *    line's owner outside it sees that line. Money on a line: HR and its owner. A line signed off by its owner
 *    or HR; lines added, interviews entered and outcomes recorded by HR (Employees edit, whole company).
 *  - The exit interview: HR, those above them on the reporting line, and the person (Lifecycle view).
 *  - Home's final-pay banner and today's celebrations.
 *  - Settings → Exit interview questions and Settings → Automations: read by anyone in People, changed by HR;
 *    who an automation last told is HR's to read.
 *  - The People report's reasons for leaving: HR only. Even without names, a small team's counts name the person.
 */
export const peopleEngagementRouter = Router();
const base = '/orgs/:orgId/people';
for (const p of ['leaving', 'clearance-lines', 'final-pay', 'exit-questions', 'automations', 'celebrations', 'reports/leaving-reasons', 'assignees']) peopleEngagementRouter.use(`${base}/${p}`, requireAuth, requireTenantContext);
peopleEngagementRouter.use(`${base}/employees/:id/celebrations`, requireAuth, requireTenantContext);

const R = PEOPLE_RESOURCE;
const ppl = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId });
/** HR for these screens: may edit employees, across the whole company. */
const isHr = async (req: Request) => !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, R.employees)) && (await teamScope(req)).all;

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await fn(req, res);
  } catch (e: any) {
    if (e instanceof ClearanceError || e instanceof ExitError || e instanceof AutomationError || e instanceof StayOnError || (e?.status && e.status < 500)) {
      return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
    console.error('[leaving and engagement]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
};
const hrOnly = (fn: (req: Request, res: Response) => Promise<unknown>) => handle(async (req, res) => {
  if (!(await isHr(req))) return res.status(403).json({ error: 'Only HR, for the whole company, can do this.' });
  return fn(req, res);
});
/** The person must be inside the caller's team scope; outside it they read as absent. */
async function personIn(req: Request, res: Response) {
  const id = String(req.params.employeeId || req.params.id);
  const p = await peoplePrisma.employee.findFirst({ where: { id, orgId: req.tenant!.orgId }, select: { id: true, name: true, status: true, dateOfLeaving: true, leavingType: true, areaId: true, branchId: true } });
  if (!p || !inScope(await teamScope(req), p.id)) {
    res.status(404).json({ error: 'No such employee.' });
    return null;
  }
  return p;
}

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far too
 * long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words for
 * it, stay the services'. The exit interview, its outcome, the exit questions and the automations go whole into
 * services that have their own schemas (exitInterview.ts answerSchema, decideSchema, settingsSchema;
 * automations.ts saveSchema), so here they are only checked for being an object.
 */
/* A number a form may send as its text: the service makes the number and has the words for one that is not. */
const amount = z.union([num(-1e15, 1e15), text(40)]);
/* An id in a body: "" reads as none (a line handed back to nobody). */
const ref = text(200);
const LEAVER = z.object({ employeeId: id });
const LINE_CHANGE = z.object({
  direction: text(40).nullish(), amount: amount.nullish(), note: text(5000).nullish(), ownerUserId: ref.nullish(), sign: flag.nullish(), seenAt: text(80).nullish(),
  /* The service keeps the first 40. */
  items: list(z.object({ title: text(2000).nullish(), assetId: ref.nullish(), returned: flag.nullish() }), 500).nullish(),
});

/* ---------------------------------------------------------- the leaving plan */

/**
 * The plan's Clearance, Final pay and Exit interview sections in one read. Someone on their own leaving reads
 * it as themself, not as HR (JCL-007), unless they are the only one who can do HR's part.
 */
peopleEngagementRouter.get(`${base}/leaving/:employeeId`, ppl(PermissionAction.VIEW, R.employees), check({ params: LEAVER }), handle(async (req, res) => {
  const orgId = req.tenant!.orgId;
  const userId = req.auth!.userId;
  const id = String(req.params.employeeId);
  const p = await peoplePrisma.employee.findFirst({ where: { id, orgId }, select: { id: true, name: true, status: true, dateOfJoining: true, dateOfLeaving: true, leavingType: true, areaId: true, branchId: true, userId: true, portalEnabled: true, portalPasswordHash: true } });
  const none = () => res.status(404).json({ error: 'No such employee.' });
  if (!p) return none();
  /* The status too: right after "They stay" the open plan reads it, not the list row it was opened from. */
  const person = { id: p.id, name: p.name, status: p.status, dateOfLeaving: p.dateOfLeaving };
  if (!inScope(await teamScope(req), p.id)) {
    /* HR gave them a line on someone outside their team: they see that line, and nothing else about the person. */
    if (!(await peoplePrisma.clearanceLine.count({ where: { orgId, employeeId: p.id, ownerUserId: userId, status: { not: 'WITHDRAWN' } } }))) return none();
    await ensureClearance(who(req), p.id);
    const clearance = await clearanceFor(orgId, p.id, { userId, hr: false, onlyMine: true });
    if (!clearance.lines.length) return none();
    return res.json({ person, clearance, finalPay: null, interview: null, canEdit: false, lineOnly: true });
  }
  /*
   * Leavings kept from this reader (Viewer, IT administrator; SPEC 3.5): the plan does not open, and the person reads
   * as anyone else. A clearance line HR gave them is still theirs to close, and only that.
   */
  if (!(p.userId && p.userId === userId) && !(await seesLeavings(req))) {
    const clearance = await clearanceFor(orgId, p.id, { userId, hr: false, onlyMine: true });
    if (!clearance.lines.length) return none();
    return res.json({ person: { id: p.id, name: p.name, status: p.status === 'ON_NOTICE' ? 'ACTIVE' : p.status, dateOfLeaving: null }, clearance, finalPay: null, interview: null, canEdit: false, lineOnly: true });
  }
  const ownPlan = Boolean(await ownPlanRefusal(who(req), { employeeId: p.id, owner: 'HR' }));
  const hr = !ownPlan && (await isHr(req));
  const self = Boolean(p.userId) && p.userId === userId;
  const line = !hr && !self && (await inReportingLine(orgId, userId, p.id));
  await ensureClearance(who(req), p.id);
  const [clearance, finalPay, interview] = await Promise.all([
    clearanceFor(orgId, p.id, { userId, hr, ownPlan }),
    finalPayOf(orgId, p),
    /* Why someone leaves is HR's and the line's to read (JCL-009): Lifecycle view, and being one of them. */
    (await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, R.lifecycle)) ? null : interviewFor(orgId, p.id, { hr, line, self }),
  ]);
  /* Whether they can answer it themselves: the employee app needs access switched on and a password they set. */
  const appAccess = Boolean(p.portalEnabled && p.portalPasswordHash);
  res.json({ person, clearance, finalPay, interview: interview ? { ...interview, appAccess } : null, canEdit: hr });
}));

peopleEngagementRouter.post(`${base}/leaving/:employeeId/clearance-lines`, ppl(PermissionAction.EDIT, R.employees), check({ params: LEAVER, body: z.object({ label: text(2000).nullish(), ownerUserId: ref.nullish() }) }), hrOnly(async (req, res) => {
  const p = await personIn(req, res);
  if (!p) return;
  const line = await addLine(who(req), p.id, { label: req.body?.label, ownerUserId: req.body?.ownerUserId || null });
  await recordAudit(req, { entity: 'ClearanceLine', entityId: line!.id, action: 'CREATE', message: `No-dues line added for ${p.name}: ${line!.label}`, metadata: { employeeId: p.id } });
  res.status(201).json({ line });
}));

/** Sign off, or change, one line: its owner or HR (the service decides which change each may make). */
peopleEngagementRouter.patch(`${base}/clearance-lines/:id`, ppl(PermissionAction.VIEW, R.employees), check({ params: idParams, body: LINE_CHANGE }), handle(async (req, res) => {
  const line = await peoplePrisma.clearanceLine.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId }, select: { employeeId: true } });
  if (!line || !inScope(await teamScope(req), line.employeeId)) {
    /* An owner outside the scope (IT signing for anyone) still signs their own line. */
    const own = await peoplePrisma.clearanceLine.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId, ownerUserId: req.auth!.userId }, select: { id: true } });
    if (!own) return res.status(404).json({ error: 'No such line.' });
  }
  const b = req.body || {};
  const out = await updateLine({ ...who(req) }, String(req.params.id), { direction: b.direction, amount: b.amount, note: b.note, items: b.items, ownerUserId: b.ownerUserId, sign: b.sign, seenAt: b.seenAt }, { hr: await isHr(req) });
  await recordAudit(req, { entity: 'ClearanceLine', entityId: out!.id, action: b.sign === true ? 'SIGNED' : b.sign === false ? 'REOPENED' : 'UPDATE', message: `No-dues line ${b.sign === true ? 'signed off' : b.sign === false ? 'opened again' : 'changed'}: ${out!.label}`, metadata: { employeeId: out!.employeeId, direction: out!.direction, amount: Number(out!.amount) } });
  res.json({ line: out });
}));

peopleEngagementRouter.delete(`${base}/clearance-lines/:id`, ppl(PermissionAction.EDIT, R.employees), check({ params: idParams }), hrOnly(async (req, res) => {
  const line = await removeLine(who(req), String(req.params.id));
  await recordAudit(req, { entity: 'ClearanceLine', entityId: line.id, action: 'DELETE', message: `No-dues line removed: ${line.label}`, metadata: { employeeId: line.employeeId } });
  res.json({ ok: true });
}));

/** Home's banner: final pay due for leavers whose last day has come, not yet marked paid. */
peopleEngagementRouter.get(`${base}/final-pay`, ppl(PermissionAction.VIEW, R.employees), handle(async (req, res) => {
  /* Final pay is about who left and when: not for a reader the company keeps leavings from (SPEC 3.5). */
  if (!(await seesLeavings(req))) return res.json({ rows: [] });
  const scope = await teamScope(req);
  res.json({ rows: await finalPayBoard(req.tenant!.orgId, { scopeIds: scope.all ? null : scope.ids }) });
}));

/* ------------------------------------------------------------ exit interview */

peopleEngagementRouter.post(`${base}/leaving/:employeeId/exit-interview`, ppl(PermissionAction.EDIT, R.employees), check({ params: LEAVER, body: anyBody }), hrOnly(async (req, res) => {
  const p = await personIn(req, res);
  if (!p) return;
  const row = await submitInterview(req.tenant!.orgId, p.id, { kind: 'HR', userId: req.auth!.userId, accountId: req.tenant!.accountId }, req.body);
  await recordAudit(req, { entity: 'ExitInterview', entityId: row!.id, action: 'SUBMITTED', message: `Exit interview entered for ${p.name}`, /* Not the reason code: the audit trail is read by roles the reason is kept from (SPEC 3.5). */ metadata: { employeeId: p.id } });
  res.json({ interview: await interviewFor(req.tenant!.orgId, p.id, { hr: true }) });
}));

peopleEngagementRouter.post(`${base}/leaving/:employeeId/exit-interview/outcome`, ppl(PermissionAction.EDIT, R.employees), check({ params: LEAVER, body: anyBody }), hrOnly(async (req, res) => {
  const p = await personIn(req, res);
  if (!p) return;
  const row = await decideInterview(who(req), p.id, req.body);
  await recordAudit(req, { entity: 'ExitInterview', entityId: row!.id, action: row!.outcome === 'RETAINED' ? 'RETAINED' : 'DECIDED', message: `Exit interview outcome for ${p.name}: ${row!.outcome || 'not decided'}${row!.couldKeep ? `, could have kept: ${row!.couldKeep.toLowerCase()}` : ''}`, metadata: { employeeId: p.id, outcome: row!.outcome, couldKeep: row!.couldKeep } });
  /* Retained: they are no longer leaving, so there is no interview to show; the answer still says what was decided. */
  res.json({ interview: (await interviewFor(req.tenant!.orgId, p.id, { hr: true })) ?? { id: row!.id, status: row!.status, outcome: row!.outcome, outcomeAt: row!.outcomeAt, withdrawn: true } });
}));

peopleEngagementRouter.get(`${base}/exit-questions`, ppl(PermissionAction.VIEW, R.employees), handle(async (req, res) => {
  res.json({ ...(await exitSettings(req.tenant!.orgId)), canEdit: await isHr(req) });
}));

peopleEngagementRouter.put(`${base}/exit-questions`, ppl(PermissionAction.EDIT, R.employees), check({ body: anyBody }), hrOnly(async (req, res) => {
  const before = await exitSettings(req.tenant!.orgId);
  const out = await saveExitSettings(who(req), req.body);
  await recordAudit(req, { entity: 'EngagementSettings', entityId: req.tenant!.orgId, action: 'UPDATE', message: 'Exit interview questions changed', metadata: { before, after: out } });
  res.json({ ...out, canEdit: true });
}));

peopleEngagementRouter.delete(`${base}/exit-questions`, ppl(PermissionAction.EDIT, R.employees), hrOnly(async (req, res) => {
  const out = await resetExitSettings(req.tenant!.orgId);
  await recordAudit(req, { entity: 'EngagementSettings', entityId: req.tenant!.orgId, action: 'UPDATE', message: 'Exit interview questions back to CLOR’s', metadata: {} });
  res.json({ ...out, canEdit: true });
}));

/** Leavers by month and reason, for the People report: HR only, as a team's counts would name the person. */
peopleEngagementRouter.get(`${base}/reports/leaving-reasons`, ppl(PermissionAction.VIEW, R.lifecycle), check({ query: z.object({ months: q(z.coerce.number().min(-1e9).max(1e9)) }) }), hrOnly(async (req, res) => {
  const months = Math.max(3, Math.min(24, Number(req.query.months) || 12));
  res.json(await leavingReasons(req.tenant!.orgId, months));
}));

/* ----------------------------------------------------------------- assignees */

/**
 * Who HR may hand a no-dues line or a plan step to: the company's people with a CLOR sign-in, by name. The
 * users screen is the administrator's (it refuses HR); this is just the names, nothing private (QA on #81).
 */
peopleEngagementRouter.get(`${base}/assignees`, ppl(PermissionAction.EDIT, R.employees), hrOnly(async (req, res) => {
  const orgId = req.tenant!.orgId;
  const members = await platformPrisma.userOrgMembership.findMany({ where: { orgId }, select: { userId: true } });
  const users = members.length ? await platformPrisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) }, isActive: true }, select: { id: true, fullName: true }, orderBy: [{ fullName: 'asc' }, { id: 'asc' }] }) : [];
  res.json({ users: users.map((u) => ({ id: u.id, fullName: u.fullName })) });
}));

/* --------------------------------------------------------------- automations */

/* The old path of Settings → Automations: the same handlers as /orgs/:orgId/automations?module=people (routes/automations.ts). */
peopleEngagementRouter.get(`${base}/automations`, ppl(PermissionAction.VIEW, R.employees), (req, res) => getAutomations(req, res, 'people'));
peopleEngagementRouter.put(`${base}/automations`, ppl(PermissionAction.EDIT, R.employees), check({ body: anyBody }), (req, res) => putAutomations(req, res, 'people'));

/* ------------------------------------------------------------- celebrations */

/** Home: today's posts the reader's team may see, and who opted out (left out of the Celebrate list). */
peopleEngagementRouter.get(`${base}/celebrations`, ppl(PermissionAction.VIEW, R.employees), handle(async (req, res) => {
  const orgId = req.tenant!.orgId;
  const today = istDate(new Date());
  const scope = await teamScope(req);
  const posts = await peoplePrisma.greetingPost.findMany({ where: { orgId, onDate: today, kind: { in: ['BIRTHDAY', 'ANNIVERSARY'] }, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, orderBy: { createdAt: 'asc' } });
  const out = await optedOut(orgId);
  res.json({ today: posts.filter((p) => !out.has(String(p.employeeId))).map((p) => ({ id: p.id, kind: p.kind, employeeId: p.employeeId, text: p.text, years: p.years })), optedOut: [...out].filter((id) => inScope(scope, id)) });
}));

/** Whether this person is announced on birthdays and work anniversaries: their record, for whoever sees them; HR changes it. */
peopleEngagementRouter.get(`${base}/employees/:id/celebrations`, ppl(PermissionAction.VIEW, R.employees), check({ params: idParams }), handle(async (req, res) => {
  const p = await personIn(req, res);
  if (!p) return;
  res.json({ optedOut: (await optedOut(req.tenant!.orgId)).has(p.id), canEdit: await isHr(req) });
}));

/** HR records someone's wish not to be announced (or the wish taken back), as the person can in the app. */
peopleEngagementRouter.put(`${base}/employees/:id/celebrations`, ppl(PermissionAction.EDIT, R.employees), check({ params: idParams, body: z.object({ optedOut: flag.nullish() }) }), hrOnly(async (req, res) => {
  const p = await personIn(req, res);
  if (!p) return;
  const out = Boolean(req.body?.optedOut);
  await setOptOut(req.tenant!.orgId, req.tenant!.accountId, p.id, out, req.auth!.userId);
  await recordAudit(req, { entity: 'Employee', entityId: p.id, action: 'UPDATE', message: `${p.name} ${out ? 'not announced on birthdays and anniversaries' : 'announced on birthdays and anniversaries again'}`, metadata: { optedOut: out } });
  res.json({ optedOut: out });
}));

