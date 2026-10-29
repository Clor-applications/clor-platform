import { Router, type Request, type Response, type NextFunction } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, peopleRouteOk } from '../services/people/guards.js';
import { teamScope } from '../services/people/scope.js';
import { recordAudit } from '../services/auditTrail.js';
import { isFeatureEnabled } from '../services/features.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { correlationOf } from '../services/people/employees.js';
import { pushEmployeeToReaders } from '../services/attendance/readerSync.js';
import { emit as emitWebhook, employeeEvent } from '../services/attendance/webhooks.js';
import { afterPeopleCommit } from '../utils/peoplePrisma.js';
import * as hiring from '../services/people/talent/hiring.js';
import * as growth from '../services/people/talent/growth.js';
import * as training from '../services/people/talent/training.js';

/**
 * Talent (docs/people/design-v1/TALENT-DECISIONS.md): hiring, growth and training.
 *
 * Gates: People on and bought; the Hiring module (`peopleHiring`) for hiring, Performance
 * (`peoplePerformance`) for goals, reviews, plans, one-on-ones and training. Rights: Recruitment
 * for openings and candidates (an interviewer without it reaches only their own interviews),
 * Performance for growth (the services decide who may act on whom: HR, the manager, the person),
 * Learning for training. Every change writes an audit row.
 */
export const peopleTalentRouter = Router();
const base = '/orgs/:orgId/people/talent';
peopleTalentRouter.use(base, requireAuth, requireTenantContext);

const R = { recruitment: 'Recruitment', performance: 'Performance', learning: 'Learning' };
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const module = (feature: 'peopleHiring' | 'peoplePerformance', label: string) => async (req: Request, res: Response, next: NextFunction) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await isFeatureEnabled(req.tenant!.accountId, req.tenant!.orgId, feature))) return res.status(403).json({ error: `${label} is switched off for this company. Switch it on in People → Settings → Modules.`, code: 'MODULE_OFF', feature });
  return next();
};
const hiringOn = module('peopleHiring', 'Hiring');
const growthOn = module('peoplePerformance', 'Performance');
const has = async (req: Request, action: string, resource: string) => !(await authorize(req, PEOPLE_MODULE, action as any, resource));
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId, source: 'FORM' as const, correlationId: correlationOf(req as any), reason: null });
async function viewer(req: Request): Promise<growth.Viewer> {
  const self = await peoplePrisma.employee.findFirst({ where: { orgId: req.tenant!.orgId, userId: req.auth!.userId }, select: { id: true } });
  return { accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId, selfEmployeeId: self?.id || null, hr: await has(req, 'EDIT', R.performance), scope: await teamScope(req), correlationId: correlationOf(req as any) };
}
const audit = (req: Request, entity: string, entityId: string, action: string, message: string, metadata?: Record<string, unknown>) => recordAudit(req, { entity, entityId, action, message, metadata }).catch(() => undefined);
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof hiring.TalentError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    console.error('[talent]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
const fileOf = (req: Request, types: Set<string>) => {
  const f = decodeDocument(req.body?.data, req.body?.mime);
  if ('error' in f) throw new hiring.TalentError(f.error);
  if (!types.has(f.mime)) throw new hiring.TalentError('That kind of file is not taken here.');
  return { name: String(req.body?.name || 'file').slice(0, 200), mime: f.mime, data: f.data };
};

/* ------------------------------------------------------------------ openings */

peopleTalentRouter.get(`${base}/openings`, hiringOn, can(PermissionAction.VIEW, R.recruitment), handle(async (req, res) => {
  res.json({ openings: await hiring.listOpenings(req.tenant!.orgId, { status: String(req.query.status || ''), q: String(req.query.q || '') }) });
}));
peopleTalentRouter.get(`${base}/openings/:id`, hiringOn, can(PermissionAction.VIEW, R.recruitment), handle(async (req, res) => {
  res.json({ opening: await hiring.openingOf(req.tenant!.orgId, String(req.params.id)) });
}));
peopleTalentRouter.post(`${base}/openings`, hiringOn, can(PermissionAction.CREATE, R.recruitment), handle(async (req, res) => {
  const row = await hiring.createOpening(who(req), req.body || {}, { canOpen: await has(req, 'EDIT', R.recruitment) });
  await audit(req, 'JobOpening', row.id, row.status === 'REQUESTED' ? 'REQUESTED' : 'CREATE', `${row.status === 'REQUESTED' ? 'Opening asked for' : 'Opening created'}: ${row.title}`);
  res.status(201).json({ opening: await hiring.openingOf(req.tenant!.orgId, row.id) });
}));
peopleTalentRouter.put(`${base}/openings/:id`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const row = await hiring.updateOpening(who(req), String(req.params.id), req.body || {});
  await audit(req, 'JobOpening', row.id, 'UPDATE', `Opening changed: ${row.title}`);
  res.json({ opening: await hiring.openingOf(req.tenant!.orgId, row.id) });
}));
peopleTalentRouter.post(`${base}/openings/:id/status`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const row = await hiring.setOpeningStatus(who(req), String(req.params.id), String(req.body?.status || ''), req.body?.reason);
  await audit(req, 'JobOpening', row.id, `STATUS_${row.status}`, `Opening ${row.status.toLowerCase().replace('_', ' ')}: ${row.title}`, { reason: row.closedReason });
  res.json({ opening: await hiring.openingOf(req.tenant!.orgId, row.id) });
}));
peopleTalentRouter.post(`${base}/openings/:id/apply-link`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const r = await hiring.setApplyLink(who(req), String(req.params.id), req.body?.on === true);
  await audit(req, 'JobOpening', String(req.params.id), r.applyOpen ? 'APPLY_LINK_ON' : 'APPLY_LINK_OFF', r.applyOpen ? 'Apply link made (a new one replaces any earlier link)' : 'Apply link turned off');
  res.json(r);
}));
peopleTalentRouter.delete(`${base}/openings/:id`, hiringOn, can(PermissionAction.DELETE, R.recruitment), handle(async (req, res) => {
  const row = await hiring.deleteOpening(who(req), String(req.params.id));
  await audit(req, 'JobOpening', row.id, 'DELETE', `Opening deleted: ${row.title}`);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- candidates */

peopleTalentRouter.get(`${base}/candidates`, hiringOn, can(PermissionAction.VIEW, R.recruitment), handle(async (req, res) => {
  res.json(await hiring.listCandidates(req.tenant!.orgId, { openingId: req.query.openingId ? String(req.query.openingId) : undefined, stage: String(req.query.stage || ''), q: String(req.query.q || '').slice(0, 100), limit: Number(req.query.limit) || 100, offset: Number(req.query.offset) || 0 }));
}));
/* A candidate: HR with Recruitment sees all; an interviewer on one of their interviews sees the brief and their part. */
peopleTalentRouter.get(`${base}/candidates/:id`, hiringOn, handle(async (req, res) => {
  res.json(await hiring.candidateOf(req.tenant!.orgId, String(req.params.id), { userId: req.auth!.userId, hr: await has(req, 'VIEW', R.recruitment) }));
}));
peopleTalentRouter.post(`${base}/candidates`, hiringOn, can(PermissionAction.CREATE, R.recruitment), handle(async (req, res) => {
  const c = await hiring.addCandidate(who(req), req.body || {});
  await audit(req, 'Candidate', c.id, 'CREATE', `Candidate added: ${c.name}`, { openingId: c.openingId });
  res.status(201).json({ candidate: { id: c.id } });
}));
peopleTalentRouter.put(`${base}/candidates/:id`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const c = await hiring.updateCandidate(who(req), String(req.params.id), req.body || {});
  await audit(req, 'Candidate', c.id, 'UPDATE', `Candidate changed: ${c.name}`);
  res.json({ ok: true });
}));
peopleTalentRouter.post(`${base}/candidates/:id/stage`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const c = await hiring.moveCandidate(who(req), String(req.params.id), String(req.body?.stage || ''), req.body?.reason);
  await audit(req, 'Candidate', c.id, `STAGE_${c.stage}`, `${c.name}: ${c.stage.toLowerCase()}`, { reason: c.closedReason });
  res.json({ ok: true, stage: c.stage });
}));
peopleTalentRouter.post(`${base}/candidates/:id/notes`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  await hiring.noteCandidate(who(req), String(req.params.id), req.body?.note);
  res.status(201).json({ ok: true });
}));
peopleTalentRouter.post(`${base}/candidates/:id/resume`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  await hiring.saveResume(who(req), String(req.params.id), fileOf(req, hiring.RESUME_TYPES));
  await audit(req, 'Candidate', String(req.params.id), 'RESUME', 'Résumé added');
  res.json({ ok: true });
}));
/* The résumé: HR, or an interviewer of this candidate. */
peopleTalentRouter.get(`${base}/candidates/:id/resume`, hiringOn, handle(async (req, res) => {
  const { orgId } = req.tenant!;
  const c = await peoplePrisma.candidate.findFirst({ where: { id: String(req.params.id), orgId, anonymisedAt: null }, select: { id: true, resumeData: true, resumeMime: true, resumeName: true } });
  if (!c) return res.status(404).json({ error: 'No such candidate.' });
  const interviewer = (await peoplePrisma.interview.findMany({ where: { orgId, candidateId: c.id }, select: { interviewerUserIds: true } })).some((i) => ((i.interviewerUserIds as string[]) || []).includes(req.auth!.userId));
  if (!interviewer && !(await has(req, 'VIEW', R.recruitment))) return res.status(404).json({ error: 'No such candidate.' });
  if (!c.resumeData) return res.status(404).json({ error: 'No résumé on file.' });
  res.setHeader('Content-Type', c.resumeMime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${String(c.resumeName || 'resume').replace(/["\r\n]/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(c.resumeData));
}));
/* Hire: needs Recruitment edit and the right to add employees. */
peopleTalentRouter.post(`${base}/candidates/:id/hire`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  if (!(await has(req, 'CREATE', 'Employees'))) return res.status(403).json({ error: 'Hiring makes an employee record: you need the right to add employees.' });
  const { orgId } = req.tenant!;
  const employee = await hiring.hireCandidate(who(req), String(req.params.id), req.body || {});
  afterPeopleCommit(() => { void pushEmployeeToReaders(orgId, employee, req.auth!.userId).catch(() => undefined); });
  afterPeopleCommit(() => emitWebhook(orgId, 'employee.created', employeeEvent(employee)));
  await audit(req, 'Employee', employee.id, 'HIRED', `Hired ${employee.name}`, { candidateId: String(req.params.id) });
  res.status(201).json({ employee: { id: employee.id, name: employee.name, code: employee.code } });
}));

/* ---------------------------------------------------------------- interviews */

peopleTalentRouter.post(`${base}/candidates/:id/interviews`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const i = await hiring.scheduleInterview(who(req), String(req.params.id), req.body || {});
  await audit(req, 'Interview', i.id, 'CREATE', 'Interview set', { candidateId: String(req.params.id) });
  res.status(201).json({ interview: { id: i.id } });
}));
peopleTalentRouter.put(`${base}/interviews/:id`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  const current = await peoplePrisma.interview.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId } });
  if (!current) return res.status(404).json({ error: 'No such interview.' });
  await hiring.scheduleInterview(who(req), current.candidateId, req.body || {}, current.id);
  await audit(req, 'Interview', current.id, 'UPDATE', 'Interview moved');
  res.json({ ok: true });
}));
peopleTalentRouter.post(`${base}/interviews/:id/cancel`, hiringOn, can(PermissionAction.EDIT, R.recruitment), handle(async (req, res) => {
  await hiring.cancelInterview(who(req), String(req.params.id));
  await audit(req, 'Interview', String(req.params.id), 'CANCEL', 'Interview cancelled');
  res.json({ ok: true });
}));
/* Interviews and feedback: open to every user; the service shows only the caller's own unless they hold Recruitment. */
peopleTalentRouter.get(`${base}/interviews`, hiringOn, handle(async (req, res) => {
  const hr = await has(req, 'VIEW', R.recruitment);
  res.json({ interviews: await hiring.interviewsFor(req.tenant!.orgId, { userId: req.auth!.userId, hr: hr && req.query.mine !== '1' }, { when: String(req.query.when || '') }), hr });
}));
peopleTalentRouter.post(`${base}/interviews/:id/feedback`, hiringOn, handle(async (req, res) => {
  await hiring.giveFeedback(who(req), String(req.params.id), req.body || {});
  await audit(req, 'Interview', String(req.params.id), 'FEEDBACK', 'Interview feedback given');
  res.json({ ok: true });
}));

/* --------------------------------------------------------------------- goals */

peopleTalentRouter.get(`${base}/goals`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  res.json({ goals: await growth.listGoals(await viewer(req), { employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined, status: String(req.query.status || ''), q: String(req.query.q || '') }) });
}));
peopleTalentRouter.get(`${base}/goals/:id`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  res.json(await growth.goalOf(await viewer(req), String(req.params.id)));
}));
peopleTalentRouter.post(`${base}/goals`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  const g = await growth.createGoal(await viewer(req), req.body || {});
  await audit(req, 'Goal', g.id, 'CREATE', `Goal set: ${g.title}`, { employeeId: g.employeeId });
  res.status(201).json({ goal: g });
}));
peopleTalentRouter.put(`${base}/goals/:id`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  const g = await growth.updateGoal(await viewer(req), String(req.params.id), req.body || {});
  await audit(req, 'Goal', g.id, 'UPDATE', `Goal changed: ${g.title}`, { status: g.status });
  res.json({ goal: g });
}));
peopleTalentRouter.post(`${base}/goals/:id/check-ins`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  const g = await growth.checkIn(await viewer(req), String(req.params.id), req.body || {});
  await audit(req, 'Goal', g.id, 'CHECK_IN', `Check-in: ${g.title} at ${g.progress}%`);
  res.status(201).json({ goal: g });
}));

/* ------------------------------------------------------------------- reviews */

peopleTalentRouter.get(`${base}/cycles`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  res.json({ cycles: await growth.listCycles(req.tenant!.orgId), hr: await has(req, 'EDIT', R.performance) });
}));
peopleTalentRouter.post(`${base}/cycles`, growthOn, can(PermissionAction.EDIT, R.performance), handle(async (req, res) => {
  const c = await growth.createCycle(await viewer(req), req.body || {});
  await audit(req, 'ReviewCycle', c.id, 'CREATE', `Review cycle: ${c.name}`);
  res.status(201).json({ cycle: c });
}));
peopleTalentRouter.post(`${base}/cycles/:id/move`, growthOn, can(PermissionAction.EDIT, R.performance), handle(async (req, res) => {
  const r = await growth.moveCycle(await viewer(req), String(req.params.id), String(req.body?.to || ''));
  await audit(req, 'ReviewCycle', String(req.params.id), `CYCLE_${r.status}`, `Review cycle ${r.status.toLowerCase()}`);
  res.json(r);
}));
peopleTalentRouter.get(`${base}/cycles/:id`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  res.json(await growth.cycleReviews(await viewer(req), String(req.params.id)));
}));
peopleTalentRouter.get(`${base}/cycles/:id/calibration`, growthOn, can(PermissionAction.EDIT, R.performance), handle(async (req, res) => {
  res.json(await growth.calibration(await viewer(req), String(req.params.id)));
}));
peopleTalentRouter.post(`${base}/reviews/:id/self`, growthOn, handle(async (req, res) => {
  await growth.writeSelf(await viewer(req), String(req.params.id), req.body || {});
  await audit(req, 'Review', String(req.params.id), 'SELF', 'Self-review written');
  res.json({ ok: true });
}));
peopleTalentRouter.post(`${base}/reviews/:id/manager`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  await growth.writeManager(await viewer(req), String(req.params.id), req.body || {});
  await audit(req, 'Review', String(req.params.id), 'MANAGER', 'Manager review written');
  res.json({ ok: true });
}));
peopleTalentRouter.post(`${base}/reviews/:id/final`, growthOn, can(PermissionAction.EDIT, R.performance), handle(async (req, res) => {
  const r = await growth.setFinal(await viewer(req), String(req.params.id), req.body || {});
  await audit(req, 'Review', r.id, 'FINAL', `Final rating ${r.finalRating}`, { reason: r.finalReason });
  res.json({ ok: true });
}));

/* ------------------------------------------------------- plans, one-on-ones */

peopleTalentRouter.get(`${base}/plans`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  res.json({ plans: await growth.listPlans(await viewer(req), { status: String(req.query.status || '') }) });
}));
peopleTalentRouter.post(`${base}/plans`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  const p = await growth.createPlan(await viewer(req), req.body || {});
  await audit(req, 'ImprovementPlan', p.id, 'CREATE', 'Improvement plan started', { employeeId: p.employeeId });
  res.status(201).json({ plan: p });
}));
peopleTalentRouter.post(`${base}/plans/:id/notes`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  await growth.planNote(await viewer(req), String(req.params.id), req.body?.note);
  res.status(201).json({ ok: true });
}));
peopleTalentRouter.post(`${base}/plans/:id/decide`, growthOn, can(PermissionAction.VIEW, R.performance), handle(async (req, res) => {
  const p = await growth.decidePlan(await viewer(req), String(req.params.id), req.body || {});
  await audit(req, 'ImprovementPlan', p.id, `PLAN_${p.status}`, `Improvement plan ${p.status.toLowerCase().replace('_', ' ')}`);
  res.json({ plan: p });
}));
/* One-on-ones need no Performance right: they are between a manager and a report, the service checks that. */
peopleTalentRouter.get(`${base}/one-on-ones`, growthOn, handle(async (req, res) => {
  res.json(await growth.listOneOnOnes(await viewer(req), { employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined }));
}));
peopleTalentRouter.post(`${base}/one-on-ones`, growthOn, handle(async (req, res) => {
  const r = await growth.saveOneOnOne(await viewer(req), req.body || {});
  res.status(201).json({ oneOnOne: r });
}));
peopleTalentRouter.put(`${base}/one-on-ones/:id`, growthOn, handle(async (req, res) => {
  res.json({ oneOnOne: await growth.saveOneOnOne(await viewer(req), req.body || {}, String(req.params.id)) });
}));

/* ------------------------------------------------------------------ training */

const scopeOf = (req: Request) => teamScope(req);
peopleTalentRouter.get(`${base}/trainings`, growthOn, can(PermissionAction.VIEW, R.learning), handle(async (req, res) => {
  const scope = await scopeOf(req);
  if (req.query.view === 'expiring') return res.json({ expiring: await training.expiring(req.tenant!.orgId, scope) });
  res.json({ trainings: await training.listTrainings(req.tenant!.orgId, scope, { status: String(req.query.status || ''), q: String(req.query.q || '') }) });
}));
peopleTalentRouter.get(`${base}/trainings/:id`, growthOn, can(PermissionAction.VIEW, R.learning), handle(async (req, res) => {
  res.json(await training.trainingOf(req.tenant!.orgId, String(req.params.id), await scopeOf(req)));
}));
peopleTalentRouter.post(`${base}/trainings`, growthOn, can(PermissionAction.CREATE, R.learning), handle(async (req, res) => {
  const t = await training.saveTraining(who(req), req.body || {});
  await audit(req, 'Training', t.id, 'CREATE', `Training: ${t.title}`);
  res.status(201).json({ training: t });
}));
peopleTalentRouter.put(`${base}/trainings/:id`, growthOn, can(PermissionAction.EDIT, R.learning), handle(async (req, res) => {
  const t = await training.saveTraining(who(req), req.body || {}, String(req.params.id));
  await audit(req, 'Training', t.id, 'UPDATE', `Training changed: ${t.title}`, { status: t.status });
  res.json({ training: t });
}));
peopleTalentRouter.delete(`${base}/trainings/:id`, growthOn, can(PermissionAction.DELETE, R.learning), handle(async (req, res) => {
  await training.deleteTraining(who(req), String(req.params.id));
  await audit(req, 'Training', String(req.params.id), 'DELETE', 'Training deleted');
  res.json({ ok: true });
}));
peopleTalentRouter.post(`${base}/trainings/:id/seats`, growthOn, can(PermissionAction.EDIT, R.learning), handle(async (req, res) => {
  const n = await training.assign(who(req), String(req.params.id), req.body?.employeeIds, await scopeOf(req));
  await audit(req, 'Training', String(req.params.id), 'ASSIGN', `${n} put on the training`);
  res.status(201).json({ added: n });
}));
async function seatInScope(req: Request) {
  const s = await peoplePrisma.trainingSeat.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId }, select: { id: true, employeeId: true } });
  const scope = await scopeOf(req);
  if (!s || !(scope.all || scope.ids.includes(s.employeeId))) throw new hiring.TalentError('No such attendee.', 404);
  return s;
}
peopleTalentRouter.put(`${base}/seats/:id`, growthOn, can(PermissionAction.EDIT, R.learning), handle(async (req, res) => {
  await seatInScope(req);
  const s = await training.markSeat(who(req), String(req.params.id), req.body || {}, req.body?.data ? fileOf(req, training.CERT_TYPES) : null);
  await audit(req, 'TrainingSeat', s.id, `SEAT_${s.status}`, `Attendee ${s.status.toLowerCase()}`, { expiresOn: s.expiresOn });
  res.json({ ok: true, expiresOn: s.expiresOn });
}));
peopleTalentRouter.delete(`${base}/seats/:id`, growthOn, can(PermissionAction.EDIT, R.learning), handle(async (req, res) => {
  await seatInScope(req);
  await training.removeSeat(who(req), String(req.params.id));
  res.json({ ok: true });
}));
peopleTalentRouter.get(`${base}/seats/:id/certificate`, growthOn, can(PermissionAction.VIEW, R.learning), handle(async (req, res) => {
  await seatInScope(req);
  const s = await peoplePrisma.trainingSeat.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId }, select: { certData: true, certMime: true, certName: true } });
  if (!s?.certData) return res.status(404).json({ error: 'No certificate on file.' });
  res.setHeader('Content-Type', s.certMime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${String(s.certName || 'certificate').replace(/["\r\n]/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(s.certData));
}));
