import { Router, type Request } from 'express';
import { authenticate } from './portal.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { policiesFor, versionForPerson } from '../services/people/policies.js';
import { AckError, accept, pendingFor } from '../services/people/acknowledgements.js';
import { DeskError, categoriesOf, employeeReply, listRequests, raiseRequest, reopenRequest, requestDetail } from '../services/people/desk.js';
import { SELF_FIELDS, SelfServiceError, answerFromApp, myDetails, requestChange, withdrawFromApp } from '../services/people/selfService.js';
import { correlationOf } from '../services/people/employees.js';
import { ResignError, resignFromApp } from '../services/people/lifecycle/leaving.js';
import { CaseError, intake } from '../services/people/privateCases.js';
import { CaseKeyMissing } from '../services/people/caseBox.js';
import { isFeatureEnabled } from '../services/features.js';
import { tickRefusal } from '../services/people/checklists.js';
import { writeChangeLog } from '../services/people/changeLog.js';
import * as growth from '../services/people/talent/growth.js';
import { TalentError } from '../services/people/talent/hiring.js';
import { MAX_SWAP_DAYS, MIN_REST_HOURS, SwapError, answerSwap, askSwap, colleaguesFor, shapeSwaps, swapsOf, withdrawSwap } from '../services/people/shiftSwaps.js';
import { FormError, fileFor, formsFor, myFormRequests, raise, replyOwn, withdrawOwn } from '../services/people/requestForms.js';
import { LetterError, askFromApp, myLetterRequests } from '../services/people/letters.js';
import { z } from 'zod';
import { check, id, idParams, jsonObject, list, noBody, q, rawText, text, ymd } from '../middleware/validate.js';

/**
 * People's own employee-facing routes, behind the employee app's sign-in
 * (routes/portal.ts `authenticate`, which also enters the person's company):
 * the policies that apply to me, and what I have been asked to accept.
 */
export const peoplePortalRouter = Router();
peoplePortalRouter.use(authenticate);

const me = (req: Request) => ({ accountId: req.portal!.accountId, orgId: req.portal!.orgId, employeeId: req.portal!.employeeId });

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far
 * too long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words
 * for it, stay the service's. Lengths are well above what a service keeps (it cuts to its own). Where a service
 * has its own words for too long (a private case's account, a photo), the limit here is the body's own 1 MB.
 */
const BODY_MAX = 1_100_000;
/* Request forms take files as base64: their route's body may be 7 MB (app.ts). */
const FORMS_MAX = 7_400_000;
const NOTE_BODY = z.object({ note: text(20_000).nullish() });
const ATTACHMENT = z.object({ title: text(2000).nullish(), data: rawText(BODY_MAX).nullish(), mime: text(200).nullish() }).nullish();
/* A number, or one typed into a field: the service reads it with Number() and has the words for one out of range. */
const NUMBERISH = z.union([z.number(), text(40)]).nullish();
const DESK_BODY = z.object({ category: text(80).nullish(), subject: text(2000).nullish(), description: text(20_000).nullish(), urgency: text(40).nullish(), replyChannel: text(40).nullish(), changeRef: rawText(2000).nullish(), attachment: ATTACHMENT });
/* My details: the fields the service lets a person change (it has the words for a bad e-mail, date or PIN code), and a photo as a data URL. */
const DETAILS_BODY = z.object({ ...Object.fromEntries(SELF_FIELDS.map((k) => [k, text(2000).nullish()])), photoUrl: rawText(BODY_MAX).nullish() });
const CASE_BODY = z.object({ kind: text(40).nullish(), summary: text(BODY_MAX).nullish(), incidentOn: ymd('Give the date it happened (YYYY-MM-DD), not in the future.').nullish(), respondentEmployeeIds: list(text(200), 500).nullish() });
/* The days are the service's to refuse (its refusal carries a code the app reads). */
const SWAP_BODY = z.object({ colleagueEmployeeId: text(80).nullish(), fromDate: text(40).nullish(), toDate: text(40).nullish(), reason: text(5000).nullish() });
const FORM_BODY = z.object({
  /* Keyed by the fields HR wrote for this form, so free-form here: the service checks each answer against its field. */
  answers: jsonObject(500).nullish(),
  files: z.record(z.string().max(200), z.object({ name: text(2000).nullish(), dataUrl: rawText(FORMS_MAX).nullish() }).nullish()).nullish(),
  idempotencyKey: text(2000).nullish(),
});

/** The policies that apply to me on a day (POL-01, POL-03): published ones only, never a draft. */
peoplePortalRouter.get('/policies', check({ query: z.object({ asOf: q(text(40)) }) }), async (req, res) => {
  const { orgId, employeeId } = me(req);
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.json({ policies: await policiesFor(orgId, employeeId, asOf) });
});

/** One version, to read: its text, or the document on my file it points at. */
peoplePortalRouter.get('/policies/:versionId', check({ params: z.object({ versionId: id }), query: z.object({ lang: q(text(40)) }) }), async (req, res) => {
  const { orgId, employeeId } = me(req);
  const v = await versionForPerson(orgId, employeeId, String(req.params.versionId));
  if (!v) return res.status(404).json({ error: 'No such policy.' });
  let document: { id: string; title: string; mime: string; dataUrl: string } | null = null;
  if (v.documentId) {
    /* Only a document meant for employees to read: an HR-only file pointed at by mistake stays HR's. */
    const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: v.documentId, orgId, visibleToEmployee: true, classification: 'EMPLOYEE_VISIBLE' } });
    if (d) document = { id: d.id, title: d.title, mime: d.mime, dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` };
  }
  /* PRV-01: the same text in a language the company offers, when asked for and written; English otherwise. */
  const lang = String(req.query.lang || '').toLowerCase();
  const translated = lang && v.translations[lang] ? v.translations[lang] : null;
  res.json({ policy: { id: v.id, policyId: v.policyId, title: v.title, category: v.category, purpose: v.purpose, version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, body: translated || v.body, language: translated ? lang : 'en', languages: ['en', ...Object.keys(v.translations)], needsAcceptance: v.needsAcceptance, document } });
});

/** What I still have to accept (DOC-05, POL-04). */
peoplePortalRouter.get('/acknowledgements', async (req, res) => {
  const { orgId, employeeId } = me(req);
  res.json({ pending: await pendingFor(orgId, employeeId) });
});

peoplePortalRouter.post('/acknowledgements/:id/accept', check({ params: idParams, body: noBody }), async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    const row = await accept(orgId, employeeId, String(req.params.id));
    res.json({ acknowledgement: { id: row.id, targetType: row.targetType, targetId: row.targetId, acceptedAt: row.acceptedAt } });
  } catch (e) {
    if (e instanceof AckError) return res.status(e.status).json({ error: e.message });
    console.error('[people-portal]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

/* Ask HR (DESK-01..04): my requests, a new one, the thread without internal notes, a reply, a reopen within seven days. */
const deskError = (res: any, e: unknown) => {
  if (e instanceof DeskError) return res.status(e.status).json({ error: e.message });
  console.error('[people-portal desk]', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'Something went wrong.' });
};

peoplePortalRouter.get('/desk', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  const [requests, categories, available] = await Promise.all([listRequests(orgId, { employeeId }), categoriesOf(accountId, orgId), isFeatureEnabled(accountId, orgId, 'peopleEngage')]);
  /* Who wrote last on each, internal notes left out: the app badges a request where HR spoke and the person has not answered. */
  const last = requests.length
    ? await peoplePrisma.deskMessage.findMany({ where: { orgId, requestId: { in: requests.map((r) => r.id) }, internal: false }, orderBy: { createdAt: 'desc' }, distinct: ['requestId'], select: { requestId: true, authorEmployeeId: true, createdAt: true } })
    : [];
  const lastBy = new Map(last.map((m) => [m.requestId, m]));
  const hrWroteLast = (r: { id: string; status: string }) => r.status !== 'MOVED' && (r.status === 'WAITING_EMPLOYEE' || (lastBy.has(r.id) && !lastBy.get(r.id)!.authorEmployeeId && r.status !== 'RESOLVED'));
  res.json({ available, requests: requests.map((r) => ({ ...r, description: r.status === 'MOVED' ? '' : r.description, hrWroteLast: hrWroteLast(r) })), categories: categories.filter((c) => c.isActive).map((c) => ({ key: c.key, label: c.label, replyHours: c.replyHours, resolveDays: c.resolveDays })) });
});

peoplePortalRouter.post('/desk', check({ body: DESK_BODY }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.status(201).json({ request: await raiseRequest({ accountId, orgId, userId: null, employeeId }, employeeId, req.body || {}) });
  } catch (e) {
    deskError(res, e);
  }
});

peoplePortalRouter.get('/desk/:id', check({ params: idParams }), async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    res.json({ request: await requestDetail(orgId, String(req.params.id), { forEmployeeId: employeeId }) });
  } catch (e) {
    deskError(res, e);
  }
});

peoplePortalRouter.post('/desk/:id/messages', check({ params: idParams, body: z.object({ body: text(20_000).nullish(), attachment: ATTACHMENT }) }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.status(201).json({ message: await employeeReply({ accountId, orgId, userId: null }, employeeId, String(req.params.id), req.body || {}) });
  } catch (e) {
    deskError(res, e);
  }
});

peoplePortalRouter.post('/desk/:id/reopen', check({ params: idParams, body: noBody }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.json({ request: await reopenRequest({ accountId, orgId, userId: null }, String(req.params.id), { employeeId }) });
  } catch (e) {
    deskError(res, e);
  }
});

/* My details (CORE-03): what I may see and change about myself; contact details save at once, the rest waits for HR, by the company setting (D-02). */
peoplePortalRouter.get('/me/details', async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    res.json(await myDetails(orgId, employeeId));
  } catch (e) {
    if (e instanceof SelfServiceError) return res.status(e.status).json({ error: e.message });
    console.error('[people-portal me]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

peoplePortalRouter.post('/me/change-request', check({ body: DETAILS_BODY }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    const r = await requestChange({ accountId, orgId, employeeId, userId: req.portal!.employee.userId || null, correlationId: correlationOf(req as any) }, req.body && typeof req.body === 'object' ? req.body : {});
    res.status(r.request ? 202 : 200).json(r);
  } catch (e) {
    selfServiceError(res, e);
  }
});

const selfServiceError = (res: any, e: unknown) => {
  if (e instanceof SelfServiceError) return res.status(e.status).json({ error: e.message });
  /* A 4xx carries words meant for the person; a 5xx's message is internal and stays in the log (audit 7 Nov 2026 #24). */
  if ((e as any)?.status && (e as any).status < 500) return res.status((e as any).status).json({ error: (e as Error).message });
  console.error('[people-portal me]', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'Something went wrong.' });
};

/* My own requests (E5): answer HR when they ask for more, or withdraw one still open. Only requests I made about myself. */
peoplePortalRouter.post('/me/requests/:id/reply', check({ params: idParams, body: NOTE_BODY }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.json(await answerFromApp({ accountId, orgId, employeeId, correlationId: correlationOf(req as any) }, String(req.params.id), typeof req.body?.note === 'string' ? req.body.note : ''));
  } catch (e) {
    selfServiceError(res, e);
  }
});

peoplePortalRouter.post('/me/requests/:id/withdraw', check({ params: idParams, body: noBody }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.json(await withdrawFromApp({ accountId, orgId, employeeId, correlationId: correlationOf(req as any) }, String(req.params.id)));
  } catch (e) {
    selfServiceError(res, e);
  }
});

/*
 * Letters and copies of documents (People plan 8 Nov 2026, step 6): what I may ask for and what I asked;
 * asking makes a LETTER_REQUEST or DOCUMENT_REQUEST that HR approves, and an approved letter lands in My documents.
 */
const letterError = (res: any, e: unknown) => {
  if (e instanceof LetterError) return res.status(e.status).json({ error: e.message });
  if ((e as any)?.status && (e as any).status < 500) return res.status((e as any).status).json({ error: (e as Error).message });
  console.error('[people-portal letters]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
peoplePortalRouter.get('/me/letters', async (req, res) => {
  try {
    res.json(await myLetterRequests(me(req)));
  } catch (e) {
    letterError(res, e);
  }
});
peoplePortalRouter.post('/me/letters', check({ body: z.object({ kind: text(40).nullish(), what: text(2000).nullish(), note: text(5000).nullish() }) }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    res.status(201).json(await askFromApp({ accountId, orgId, employeeId, userId: req.portal!.employee.userId || null, correlationId: correlationOf(req as any) }, { kind: body.kind, what: body.what, note: body.note }));
  } catch (e) {
    letterError(res, e);
  }
});

/* Resigning from the app (LIFE-05): a LEAVING request the manager and HR decide; the last day goes on the record when it is approved. */
peoplePortalRouter.post('/me/resign', check({ body: z.object({ lastDay: ymd('Say your last working day (YYYY-MM-DD).').nullish(), reason: text(20_000).nullish() }) }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.status(202).json(await resignFromApp({ accountId, orgId, employeeId, userId: req.portal!.employee.userId || null, correlationId: correlationOf(req as any) }, req.body || {}));
  } catch (e) {
    if (e instanceof ResignError) return res.status(e.status).json({ error: e.message });
    if ((e as any)?.status && (e as any).status < 500) return res.status((e as any).status).json({ error: (e as Error).message });
    console.error('[people-portal resign]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

/*
 * My growth (Talent, TALENT-DECISIONS.md): my goals and their check-ins, my reviews (writing my
 * self-review while a cycle is open; reading the outcome once HR shares it), my improvement plan
 * if there is one, my one-on-one notes, and my trainings with their certificate dates.
 */
const meAsViewer = (req: Request): growth.Viewer => {
  const { accountId, orgId, employeeId } = me(req);
  const userId = req.portal!.employee.userId || `portal:${employeeId}`;
  return { accountId, orgId, userId, selfEmployeeId: employeeId, hr: false, scope: { all: false, ids: [employeeId], selfId: employeeId }, correlationId: correlationOf(req as any) };
};
const talentError = (res: any, e: unknown) => {
  if (e instanceof TalentError) return res.status(e.status).json({ error: e.message });
  console.error('[people-portal talent]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
peoplePortalRouter.get('/me/growth', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  if (!(await isFeatureEnabled(accountId, orgId, 'peoplePerformance'))) return res.json({ on: false, goals: [], reviews: [], plans: [], oneOnOnes: [], trainings: [] });
  const [goals, reviews, plans, oneOnOnes, seats] = await Promise.all([
    peoplePrisma.goal.findMany({ where: { orgId, employeeId, status: { in: ['ACTIVE', 'DONE'] } }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 100 }),
    peoplePrisma.review.findMany({ where: { orgId, employeeId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    peoplePrisma.improvementPlan.findMany({ where: { orgId, employeeId, status: { not: 'CANCELLED' } }, orderBy: { startDate: 'desc' }, take: 5 }),
    peoplePrisma.oneOnOne.findMany({ where: { orgId, employeeId }, orderBy: { date: 'desc' }, take: 20 }),
    peoplePrisma.trainingSeat.findMany({ where: { orgId, employeeId }, select: { id: true, trainingId: true, status: true, completedOn: true, expiresOn: true }, take: 200 }),
  ]);
  const cycles = new Map((await peoplePrisma.reviewCycle.findMany({ where: { orgId, id: { in: reviews.map((r) => r.cycleId) } } })).map((c) => [c.id, c]));
  const trainings = new Map((await peoplePrisma.training.findMany({ where: { orgId, id: { in: seats.map((s) => s.trainingId) } }, select: { id: true, title: true, startDate: true, endDate: true, status: true } })).map((t) => [t.id, t]));
  res.json({
    on: true,
    goals: goals.map((g) => ({ id: g.id, title: g.title, measure: g.measure, dueDate: g.dueDate, progress: g.progress, health: g.health, status: g.status })),
    reviews: reviews.filter((r) => cycles.get(r.cycleId)?.status !== 'DRAFT').map((r) => {
      const c = cycles.get(r.cycleId)!;
      /* Until HR shares it, I see only what I wrote. */
      return { id: r.id, cycle: c.name, period: `${c.periodFrom} – ${c.periodTo}`, selfDue: c.selfDue, canWriteSelf: c.status === 'OPEN', selfRating: r.selfRating, selfText: r.selfText, selfAt: r.selfAt, shared: Boolean(r.sharedAt), finalRating: r.sharedAt ? r.finalRating : null, managerText: r.sharedAt ? r.managerText : null, acknowledgedAt: r.acknowledgedAt };
    }),
    plans: plans.map((p) => ({ id: p.id, expectations: p.expectations, startDate: p.startDate, endDate: p.endDate, status: p.status, outcomeNote: ['COMPLETED', 'NOT_MET', 'EXTENDED'].includes(p.status) ? p.outcomeNote : null })),
    oneOnOnes: oneOnOnes.map((o) => ({ id: o.id, date: o.date, notes: o.notes, actions: o.actions })),
    trainings: seats.filter((s) => trainings.has(s.trainingId) && trainings.get(s.trainingId)!.status !== 'CANCELLED').map((s) => ({ id: s.id, title: trainings.get(s.trainingId)!.title, startDate: trainings.get(s.trainingId)!.startDate, status: s.status, completedOn: s.completedOn, expiresOn: s.expiresOn })),
  });
});
peoplePortalRouter.post('/me/goals/:id/check-ins', check({ params: idParams, body: z.object({ progress: NUMBERISH, health: rawText(40).nullish(), note: text(20_000).nullish() }) }), async (req, res) => {
  try {
    const g = await growth.checkIn(meAsViewer(req), String(req.params.id), req.body || {}, 'SELF_SERVICE');
    res.status(201).json({ goal: { id: g.id, progress: g.progress, health: g.health } });
  } catch (e) {
    talentError(res, e);
  }
});
peoplePortalRouter.post('/me/reviews/:id/self', check({ params: idParams, body: z.object({ selfRating: NUMBERISH, selfText: text(50_000).nullish() }) }), async (req, res) => {
  try {
    await growth.writeSelf(meAsViewer(req), String(req.params.id), req.body || {});
    res.json({ ok: true });
  } catch (e) {
    talentError(res, e);
  }
});
peoplePortalRouter.post('/me/reviews/:id/acknowledge', check({ params: idParams, body: noBody }), async (req, res) => {
  try {
    await growth.acknowledge(meAsViewer(req), String(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    talentError(res, e);
  }
});

peoplePortalRouter.get('/me/leaving', async (req, res) => {
  const { orgId, employeeId } = me(req);
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { status: true, dateOfLeaving: true, leavingType: true } });
  const waiting = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, subjectEmployeeId: employeeId, requestType: 'LEAVING', status: { in: ['WAITING', 'MORE_INFO'] } }, select: { id: true, title: true, status: true, createdAt: true } });
  res.json({ status: e?.status || null, lastDay: e?.dateOfLeaving || null, leavingType: e?.leavingType || null, waiting });
});

/*
 * My joining or leaving (Joining & Leaving): the steps that are mine to do,
 * which I tick here, and the company things I hand back before my last day
 * (read only: IT or HR ticks them when they have them). Never HR's other
 * steps or their notes.
 */
const isReturn = (t: { title: string }) => /^Return /.test(t.title);
peoplePortalRouter.get('/me/journey', async (req, res) => {
  const { orgId, employeeId } = me(req);
  const tasks = await peoplePrisma.checklistTask.findMany({ where: { orgId, employeeId, kind: { in: ['JOINING', 'LEAVING'] }, OR: [{ owner: 'EMPLOYEE' }, { kind: 'LEAVING', title: { startsWith: 'Return ' } }] }, orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] });
  const shape = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, dueDate: t.dueDate, done: Boolean(t.doneAt), mine: t.owner === 'EMPLOYEE', needsNote: t.needsNote });
  /* Only the open plan of each kind, and the done ones beside it from the same plan: an earlier stint's tasks are history. */
  const recent = (kind: string) => tasks.filter((t) => t.kind === kind && (!t.doneAt || Date.now() - t.doneAt.getTime() < 60 * 86_400_000));
  res.json({ joining: recent('JOINING').filter((t) => t.owner === 'EMPLOYEE').map(shape), leaving: recent('LEAVING').map(shape), handBack: recent('LEAVING').filter(isReturn).map(shape) });
});

peoplePortalRouter.post('/me/journey/tasks/:id/done', check({ params: idParams, body: NOTE_BODY }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  const task = await peoplePrisma.checklistTask.findFirst({ where: { id: String(req.params.id), orgId, employeeId } });
  /* Only my own steps: HR's, IT's and the hand-back items are theirs to tick. */
  if (!task || task.owner !== 'EMPLOYEE') return res.status(404).json({ error: 'No such task.' });
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  const refused = tickRefusal(task, { done: true, note });
  if (refused) return res.status(refused.status).json({ error: refused.error });
  if (task.doneAt) return res.json({ id: task.id, done: true });
  await peoplePrisma.$transaction(async (tx) => {
    const r = await tx.checklistTask.updateMany({ where: { id: task.id, doneAt: null }, data: { doneAt: new Date(), doneByUserId: req.portal!.employee.userId || null, ...(note ? { note } : {}) } });
    if (r.count) await writeChangeLog(tx, { accountId, orgId, userId: req.portal!.employee.userId || null, source: 'SELF_SERVICE', correlationId: correlationOf(req as any), reason: 'Done in the employee app' }, { kind: 'ChecklistTask', id: task.id, employeeId }, [{ field: 'done', before: 'no', after: 'yes', redacted: false }]);
  });
  res.json({ id: task.id, done: true });
});

/* A private complaint from the app (PRIV-02): it goes to the committee chosen; the person gets the reference only, and nothing about it is listed back here. */
peoplePortalRouter.post('/private-cases', check({ body: CASE_BODY }), async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    const c = await intake({ accountId, orgId, userId: req.portal!.employee.userId || null, employeeId }, { ...(req.body || {}), complainantEmployeeId: employeeId, onBehalf: false });
    res.status(201).json({ reference: c.reference, receivedOn: c.receivedOn, inquiryDue: c.inquiryDue });
  } catch (e) {
    if (e instanceof CaseError) return res.status(e.status).json({ error: e.message });
    if (e instanceof CaseKeyMissing) return res.status(503).json({ error: e.message });
    console.error('[people-portal case]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

/*
 * Shift swaps (gap 24): ask a colleague on another shift to swap a day or a few, answer one asked of me,
 * withdraw mine before it is decided. Approval is the manager's, in People's Approvals.
 */
const swapError = (res: any, e: unknown) => {
  if (e instanceof SwapError) return res.status(e.status).json({ error: e.message, code: e.code });
  console.error('[people-portal swap]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
const swapper = (req: Request) => ({ ...me(req), userId: req.portal!.employee.userId || null, correlationId: correlationOf(req as any) });

peoplePortalRouter.get('/swaps', async (req, res) => {
  const { orgId, employeeId } = me(req);
  res.json({ ...(await swapsOf(orgId, employeeId)), rules: { maxDays: MAX_SWAP_DAYS, minRestHours: MIN_REST_HOURS } });
});

/** Who I may ask for these days: working each of them on another shift, with the rest rule kept. Names and those shifts only. */
peoplePortalRouter.get('/swaps/colleagues', check({ query: z.object({ from: q(text(40)), to: q(text(40)) }) }), async (req, res) => {
  const { orgId, employeeId } = me(req);
  const from = String(req.query.from || '');
  const to = String(req.query.to || req.query.from || '');
  res.json({ colleagues: await colleaguesFor(orgId, employeeId, from, to) });
});

peoplePortalRouter.post('/swaps', check({ body: SWAP_BODY }), async (req, res) => {
  try {
    const swap = await askSwap(swapper(req), req.body || {});
    res.status(201).json({ swap: (await shapeSwaps(swap.orgId, [swap]))[0] });
  } catch (e) {
    swapError(res, e);
  }
});

/** The colleague's answer: accepted, it goes for approval; declined, it closes. */
const answer = (accept: boolean) => async (req: Request, res: any) => {
  try {
    const swap = await answerSwap(swapper(req), String(req.params.id), accept, typeof req.body?.note === 'string' ? req.body.note : null);
    res.json({ swap: (await shapeSwaps(swap.orgId, [swap]))[0] });
  } catch (e) {
    swapError(res, e);
  }
};
peoplePortalRouter.post('/swaps/:id/accept', check({ params: idParams, body: NOTE_BODY }), answer(true));
peoplePortalRouter.post('/swaps/:id/decline', check({ params: idParams, body: NOTE_BODY }), answer(false));

peoplePortalRouter.post('/swaps/:id/withdraw', check({ params: idParams, body: noBody }), async (req, res) => {
  try {
    const swap = await withdrawSwap(swapper(req), String(req.params.id));
    res.json({ swap: (await shapeSwaps(swap.orgId, [swap]))[0] });
  } catch (e) {
    swapError(res, e);
  }
});

/*
 * Requests HR set up (gap 25): the forms open to me, mine with what was said, filling one in (files
 * as base64, ≤ 2 MB each), answering when HR asks for more, withdrawing, and my own files.
 */
const formError = (res: any, e: unknown) => {
  if (e instanceof FormError) return res.status(e.status).json({ error: e.message, code: e.code });
  console.error('[people-portal forms]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};

peoplePortalRouter.get('/forms', async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    const [forms, requests] = await Promise.all([formsFor(orgId, employeeId), myFormRequests(orgId, employeeId)]);
    res.json({ forms, requests });
  } catch (e) {
    formError(res, e);
  }
});

peoplePortalRouter.post('/forms/:id', check({ params: idParams, body: FORM_BODY }), async (req, res) => {
  try {
    const r = await raise(swapper(req), String(req.params.id), { ...(req.body || {}), idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotencyKey });
    res.status(r.existed ? 200 : 201).json({ request: r });
  } catch (e) {
    formError(res, e);
  }
});

peoplePortalRouter.post('/forms/requests/:id/reply', check({ params: idParams, body: NOTE_BODY }), async (req, res) => {
  try {
    res.json({ request: await replyOwn(swapper(req), String(req.params.id), String(req.body?.note || '')) });
  } catch (e) {
    formError(res, e);
  }
});

peoplePortalRouter.post('/forms/requests/:id/withdraw', check({ params: idParams, body: noBody }), async (req, res) => {
  try {
    res.json({ request: await withdrawOwn(swapper(req), String(req.params.id)) });
  } catch (e) {
    formError(res, e);
  }
});

peoplePortalRouter.get('/forms/files/:id', check({ params: idParams }), async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    const f = await fileFor(orgId, String(req.params.id), { employeeId });
    res.json({ file: { id: f.id, name: f.fileName, mime: f.mime, size: f.size, dataUrl: `data:${f.mime};base64,${Buffer.from(f.data).toString('base64')}` } });
  } catch (e) {
    formError(res, e);
  }
});
