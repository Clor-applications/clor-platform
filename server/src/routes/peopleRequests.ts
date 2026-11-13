import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { myEmployee } from '../services/attendance/days.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, hrOrAttendanceRouteOk, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import { teamScope } from '../services/people/scope.js';
import { FormError, TEMPLATES, createForm, fileFor, formsFor, listForms, myFormRequests, raise, replyOwn, report, updateForm, useTemplate, withdrawOwn } from '../services/people/requestForms.js';
import { MAX_SWAP_DAYS, MIN_REST_HOURS, SwapError, cancelSwap, listSwaps } from '../services/people/shiftSwaps.js';
import { z } from 'zod';
import { check, flag, idParams, jsonObject, list, noBody, q, rawText, text } from '../middleware/validate.js';

/**
 * Request types HR makes (gap 25) and shift swaps (gap 24), People's side.
 *
 *   HR: define request types (Approvals grant), switch on the ready-made
 *   ones, and report on them; see every shift swap and cancel an approved
 *   one before it starts.
 *   A manager: their team's shift swaps (deciding is in Approvals).
 *   Anyone with a sign-in and an employee file: fill in a request type and
 *   follow it (My attendance grant, as their own leave and days).
 *
 * Asking for a swap, and answering one, is the employee app's
 * (routes/peoplePortal.ts): swaps are between people on shifts, who use it.
 */
export const peopleRequestsRouter = Router();
peopleRequestsRouter.use(requireAuth, requireTenantContext);

const base = '/orgs/:orgId/people';
const A = PEOPLE_RESOURCE.approvals;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const self = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, ATTENDANCE_RESOURCE.self);
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null });

const fail = (res: Response, e: unknown) => {
  if (e instanceof FormError || e instanceof SwapError) return res.status(e.status).json({ error: e.message, code: e.code });
  const status = (e as { status?: number })?.status;
  if (status && status < 500) return res.status(status).json({ error: (e as Error).message, code: (e as { code?: string }).code });
  throw e;
};
const dateOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far
 * too long is refused with a 400; keys not named here are dropped. A missing name, too many fields, a choice
 * with one option, days out of range: those stay the service's (requestForms.ts cleanBody, cleanFields), in its
 * own words and with its codes.
 */
const FORM_FIELD = z.object({
  /* An existing field's key is kept only when it is exactly one, so it is left as typed. */
  key: rawText(200).nullish(), label: text(2000).nullish(), type: text(40).nullish(), required: flag.nullish(),
  /* A list, or one string with an option to a line. */
  options: z.union([list(z.union([z.string().max(2000), z.number()]), 1000), rawText(50_000)]).nullish(),
});
const FORM_TYPE_BODY = z.object({
  name: text(2000).nullish(), description: text(5000).nullish(), fields: list(FORM_FIELD, 500).nullish(),
  audience: text(40).nullish(), departmentIds: list(text(200), 5000).nullish(),
  /* A number, or the box's text; empty and null both mean the usual two days. */
  slaDays: z.union([z.number(), text(40)]).nullish(),
  approver: text(40).nullish(), active: flag.nullish(), template: text(80).nullish(),
});
const ASK_BODY = z.object({
  /* Keyed by the fields HR wrote for this form, so free-form here: the service checks each answer against its field. */
  answers: jsonObject(500).nullish(),
  /* Files as data URLs: the route's body may be 7 MB (app.ts). */
  files: z.record(z.string().max(200), z.object({ name: text(2000).nullish(), dataUrl: rawText(7_400_000).nullish() }).nullish()).nullish(),
  idempotencyKey: text(2000).nullish(),
});
const NOTE_BODY = z.object({ note: text(20_000).nullish() });
/* A status that is not one lists every status, and a day that is not one is left out (the handler's and the service's fallbacks): short text is all that is asked. */
const REPORT_QUERY = z.object({ formId: q(text(80)), status: q(text(40)), from: q(text(40)), to: q(text(40)), format: q(text(20)) });

// ---- Request types (HR) ------------------------------------------------------

peopleRequestsRouter.get(`${base}/request-forms`, can(PermissionAction.VIEW, A), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const forms = await listForms(req.tenant!.orgId);
  const used = new Set(forms.map((f) => f.template).filter(Boolean));
  res.json({ forms, templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description, fields: t.fields, approver: t.approver, on: used.has(key) && forms.some((f) => f.template === key && f.active) })) });
});

peopleRequestsRouter.post(`${base}/request-forms`, can(PermissionAction.EDIT, A), check({ body: FORM_TYPE_BODY }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ form: await createForm(who(req), req.body || {}) });
  } catch (e) {
    return fail(res, e);
  }
});

peopleRequestsRouter.put(`${base}/request-forms/:id`, can(PermissionAction.EDIT, A), check({ params: idParams, body: FORM_TYPE_BODY }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ form: await updateForm(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    return fail(res, e);
  }
});

/** Switch on a ready-made request type: ID card, salary certificate, asset request. */
peopleRequestsRouter.post(`${base}/request-forms/templates/:key`, can(PermissionAction.EDIT, A), check({ params: z.object({ key: text(80) }), body: noBody }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ form: await useTemplate(who(req), String(req.params.key)) });
  } catch (e) {
    return fail(res, e);
  }
});

/** Every request of HR's own types in a period, with a line per type. `?format=csv` for a spreadsheet. */
peopleRequestsRouter.get(`${base}/request-forms/report`, can(PermissionAction.VIEW, A), check({ query: REPORT_QUERY }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const out = await report(req.tenant!.orgId, { formId: typeof req.query.formId === 'string' ? req.query.formId : null, status: typeof req.query.status === 'string' ? req.query.status : null, from: dateOf(req.query.from), to: dateOf(req.query.to) });
  if (req.query.format !== 'csv') return res.json(out);
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    /* A cell starting with = + - @ is text, never a formula, in a spreadsheet. */
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['Request', 'Employee', 'Employee ID', 'Department', 'Asked', 'Status', 'Decided', 'Working days to decide', 'Overdue', 'Answers'];
  const lines = out.rows.map((r) => [r.formName, r.employeeName, r.employeeCode, r.department, r.askedAt.toISOString().slice(0, 10), r.status, r.decidedAt ? r.decidedAt.toISOString().slice(0, 10) : '', r.daysToDecide ?? '', r.overdue ? 'Yes' : '', r.lines.map((l) => `${l.label}: ${l.value}`).join('; ')].map(cell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="requests-report.csv"');
  res.send([head.join(','), ...lines].join('\n'));
});

/** A file on a request, for someone who decides it, or HR. */
peopleRequestsRouter.get(`${base}/request-forms/files/:id`, can(PermissionAction.VIEW, PEOPLE_RESOURCE.requests), check({ params: idParams }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const hr = !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, A));
    const f = await fileFor(req.tenant!.orgId, String(req.params.id), { userId: req.auth!.userId, hr });
    res.json({ file: { id: f.id, name: f.fileName, mime: f.mime, size: f.size, dataUrl: `data:${f.mime};base64,${Buffer.from(f.data).toString('base64')}` } });
  } catch (e) {
    return fail(res, e);
  }
});

// ---- My own requests (anyone with an employee file) ---------------------------

async function meOr404(req: Request, res: Response) {
  if (!(await hrOrAttendanceRouteOk(req, res))) return null;
  try {
    return await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
  } catch (e) {
    fail(res, e);
    return null;
  }
}
const mine = (req: Request, employeeId: string) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, employeeId, userId: req.auth!.userId, correlationId: correlationOf(req as any) });

peopleRequestsRouter.get(`${base}/my/request-forms`, self(PermissionAction.VIEW), async (req, res) => {
  const me = await meOr404(req, res);
  if (!me) return;
  const [forms, requests] = await Promise.all([formsFor(req.tenant!.orgId, me.id), myFormRequests(req.tenant!.orgId, me.id)]);
  res.json({ forms, requests });
});

peopleRequestsRouter.post(`${base}/my/request-forms/:id`, self(PermissionAction.CREATE), check({ params: idParams, body: ASK_BODY }), async (req, res) => {
  const me = await meOr404(req, res);
  if (!me) return;
  try {
    const r = await raise(mine(req, me.id), String(req.params.id), { ...(req.body || {}), idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotencyKey });
    res.status(r.existed ? 200 : 201).json({ request: r });
  } catch (e) {
    return fail(res, e);
  }
});

peopleRequestsRouter.post(`${base}/my/form-requests/:id/reply`, self(PermissionAction.CREATE), check({ params: idParams, body: NOTE_BODY }), async (req, res) => {
  const me = await meOr404(req, res);
  if (!me) return;
  try {
    res.json({ request: await replyOwn(mine(req, me.id), String(req.params.id), String(req.body?.note || '')) });
  } catch (e) {
    return fail(res, e);
  }
});

peopleRequestsRouter.post(`${base}/my/form-requests/:id/withdraw`, self(PermissionAction.CREATE), check({ params: idParams, body: noBody }), async (req, res) => {
  const me = await meOr404(req, res);
  if (!me) return;
  try {
    res.json({ request: await withdrawOwn(mine(req, me.id), String(req.params.id)) });
  } catch (e) {
    return fail(res, e);
  }
});

peopleRequestsRouter.get(`${base}/my/form-files/:id`, self(PermissionAction.VIEW), check({ params: idParams }), async (req, res) => {
  const me = await meOr404(req, res);
  if (!me) return;
  try {
    const f = await fileFor(req.tenant!.orgId, String(req.params.id), { employeeId: me.id });
    res.json({ file: { id: f.id, name: f.fileName, mime: f.mime, size: f.size, dataUrl: `data:${f.mime};base64,${Buffer.from(f.data).toString('base64')}` } });
  } catch (e) {
    return fail(res, e);
  }
});

// ---- Shift swaps (HR: everyone; a manager: their team) ----------------------

peopleRequestsRouter.get(`${base}/shift-swaps`, can(PermissionAction.VIEW, PEOPLE_RESOURCE.requests), check({ query: z.object({ status: q(text(40)) }) }), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const scope = await teamScope(req);
  const swaps = await listSwaps(req.tenant!.orgId, scope.all ? { all: true, ids: [] } : { all: false, ids: scope.ids }, { status: typeof req.query.status === 'string' ? req.query.status : null });
  const hr = !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees));
  res.json({ swaps, rules: { maxDays: MAX_SWAP_DAYS, minRestHours: MIN_REST_HOURS }, canCancel: hr && scope.all });
});

/** HR takes back an approved swap that has not started: the schedules go, and both are told. */
peopleRequestsRouter.post(`${base}/shift-swaps/:id/cancel`, can(PermissionAction.EDIT, PEOPLE_RESOURCE.employees), check({ params: idParams, body: NOTE_BODY }), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const scope = await teamScope(req);
  if (!scope.all) return res.status(403).json({ error: 'Only HR can cancel a swap.' });
  try {
    const note = String(req.body?.note || '').trim().slice(0, 300) || null;
    const swap = await cancelSwap({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId }, String(req.params.id), note);
    res.json({ swap: { id: swap.id, status: swap.status } });
  } catch (e) {
    return fail(res, e);
  }
});
