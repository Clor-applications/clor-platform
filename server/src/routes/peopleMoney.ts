import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../services/payroll/guards.js';
import { correlationOf } from '../services/people/employees.js';
import {
  MoneyError, billFile, categories, claimForStaff, closeAdvance, detailForRequest, exportCsv, listAdvances, listClaims, markRecorded, payAdvance, payClaim, report, sanction, saveCategory, type Staff,
} from '../services/people/money/expenses.js';
import { listAsks, sendAgain } from '../services/people/money/salaryAdvance.js';

/**
 * Expenses, advances and salary advances for HR, owners and approvers
 * (WORKFLOW-GAP-RESEARCH 4.1, 4.2). Seeing and paying everyone's needs
 * People › Expenses; an approver opens what waits on them through Requests,
 * and the service checks that it does. The person's own side is in the
 * employee app (routes/peopleMoneyPortal.ts).
 */
export const peopleMoneyRouter = Router();
peopleMoneyRouter.use(requireAuth, requireTenantContext);

const base = '/orgs/:orgId/people/money';
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const EXPENSES = PEOPLE_RESOURCE.expenses;
const REQUESTS = PEOPLE_RESOURCE.requests;

const staffOf = (req: Request): Staff => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId, correlationId: correlationOf(req as any) });
const holds = async (req: Request, module: string, action: string, resource: string) => !(await authorize(req, module, action as any, resource));
const fail = (res: Response, e: unknown) => {
  if (e instanceof MoneyError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  const id = (res.req as any)?.id || (res.getHeader('x-request-id') as string) || '';
  console.error('[people-money]', id, e instanceof Error ? e.message : e); // eslint-disable-line no-console
  return res.status(500).json({ error: `Something went wrong. Try again${id ? ` (request ${id})` : ''}.` });
};
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await fn(req, res);
  } catch (e) {
    fail(res, e);
  }
};

// ---- Categories -------------------------------------------------------------

peopleMoneyRouter.get(`${base}/categories`, can(PermissionAction.VIEW, EXPENSES), run(async (req, res) => {
  res.json({ categories: await categories(req.tenant!.accountId, req.tenant!.orgId, { all: true }) });
}));

peopleMoneyRouter.post(`${base}/categories`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  res.status(201).json({ category: await saveCategory(req.tenant!, req.body || {}) });
}));

peopleMoneyRouter.put(`${base}/categories/:id`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  res.json({ category: await saveCategory(req.tenant!, { ...(req.body || {}), id: String(req.params.id) }) });
}));

// ---- Claims -----------------------------------------------------------------

peopleMoneyRouter.get(`${base}/claims`, can(PermissionAction.VIEW, EXPENSES), run(async (req, res) => {
  res.json({ claims: await listClaims(req.tenant!.orgId, { status: String(req.query.status || '') || undefined, employeeId: String(req.query.employeeId || '') || undefined }) });
}));

peopleMoneyRouter.get(`${base}/claims/:id`, can(PermissionAction.VIEW, EXPENSES), run(async (req, res) => {
  res.json({ claim: await claimForStaff(req.tenant!.orgId, String(req.params.id)) });
}));

/** Allow less on some bills, with the reason the person reads: for whoever the claim waits on now. */
peopleMoneyRouter.post(`${base}/claims/:id/sanction`, can(PermissionAction.APPROVE, REQUESTS), run(async (req, res) => {
  res.json({ claim: await sanction(staffOf(req), String(req.params.id), req.body || {}) });
}));

/** Pay with salary (a draft earning in Payroll: needs the right to add payroll adjustments) or paid now. */
peopleMoneyRouter.post(`${base}/claims/:id/pay`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  if (String(req.body?.mode || '').toUpperCase() === 'SALARY' && !(await holds(req, PAYROLL_MODULE, PermissionAction.CREATE, PAYROLL_RESOURCE.adjustments))) {
    return res.status(403).json({ error: 'Paying with salary adds a line to Payroll, and you may not add payroll adjustments. Mark it paid now, or ask whoever runs payroll.', code: 'NO_PAYROLL_RIGHT' });
  }
  res.json({ claim: await payClaim(staffOf(req), String(req.params.id), req.body || {}) });
}));

/** Paid-now claims and advances entered in Books by hand. */
peopleMoneyRouter.post(`${base}/books-recorded`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  res.json(await markRecorded(req.tenant!.orgId, req.body || {}));
}));

// ---- Advances ---------------------------------------------------------------

peopleMoneyRouter.get(`${base}/advances`, can(PermissionAction.VIEW, EXPENSES), run(async (req, res) => {
  res.json({ advances: await listAdvances(req.tenant!.orgId) });
}));

peopleMoneyRouter.post(`${base}/advances/:id/pay`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  res.json({ advance: await payAdvance(staffOf(req), String(req.params.id), req.body || {}) });
}));

peopleMoneyRouter.post(`${base}/advances/:id/returned`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  res.json(await closeAdvance(staffOf(req), String(req.params.id), 'RETURNED', req.body || {}));
}));

peopleMoneyRouter.post(`${base}/advances/:id/recover`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  if (!(await holds(req, PAYROLL_MODULE, PermissionAction.CREATE, PAYROLL_RESOURCE.adjustments))) {
    return res.status(403).json({ error: 'Taking it from salary adds a line to Payroll, and you may not add payroll adjustments. Ask whoever runs payroll.', code: 'NO_PAYROLL_RIGHT' });
  }
  res.json(await closeAdvance(staffOf(req), String(req.params.id), 'RECOVER'));
}));

// ---- Salary advances ----------------------------------------------------------

peopleMoneyRouter.get(`${base}/salary-advances`, can(PermissionAction.VIEW, EXPENSES), run(async (req, res) => {
  res.json({ asks: await listAsks(req.tenant!.orgId) });
}));

/** An approved salary advance Payroll could not take yet, sent again. Writing a loan needs Payroll's own right. */
peopleMoneyRouter.post(`${base}/salary-advances/:id/send-to-payroll`, can(PermissionAction.EDIT, EXPENSES), run(async (req, res) => {
  if (!(await holds(req, PAYROLL_MODULE, PermissionAction.CREATE, PAYROLL_RESOURCE.loans))) {
    return res.status(403).json({ error: 'Only someone who may add payroll loans can send it to Payroll.', code: 'NO_PAYROLL_RIGHT' });
  }
  res.json(await sendAgain(staffOf(req), String(req.params.id)));
}));

// ---- Approvers, reports, files -------------------------------------------------

/** The record behind a money request in the Approvals inbox: for the people it waits on or who decided it, and HR. */
peopleMoneyRouter.get(`${base}/requests/:requestId`, can(PermissionAction.VIEW, REQUESTS), run(async (req, res) => {
  const all = await holds(req, PEOPLE_MODULE, PermissionAction.VIEW, EXPENSES);
  res.json(await detailForRequest(req.tenant!.orgId, String(req.params.requestId), req.auth!.userId, all));
}));

/** A bill's photo or PDF, sent as itself with the type its bytes proved at upload; never run in the page. */
peopleMoneyRouter.get(`${base}/bills/:id`, can(PermissionAction.VIEW, REQUESTS), run(async (req, res) => {
  const all = await holds(req, PEOPLE_MODULE, PermissionAction.VIEW, EXPENSES);
  const f = await billFile(req.tenant!.orgId, String(req.params.id), { userId: req.auth!.userId, mayViewAll: all });
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.data);
}));

peopleMoneyRouter.get(`${base}/report`, can(PermissionAction.VIEW, EXPENSES), run(async (req, res) => {
  res.json(await report(req.tenant!.orgId, { from: String(req.query.from || ''), to: String(req.query.to || '') }));
}));

peopleMoneyRouter.get(`${base}/export.csv`, can(PermissionAction.EXPORT, EXPENSES), run(async (req, res) => {
  const kind = req.query.kind === 'books' ? 'books' : 'claims';
  const body = await exportCsv(req.tenant!.orgId, kind, { from: String(req.query.from || ''), to: String(req.query.to || '') });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind === 'books' ? 'to-record-in-books' : 'expense-claims'}.csv"`);
  res.send(`﻿${body}`);
}));
