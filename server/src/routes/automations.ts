import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { recordAudit } from '../services/auditTrail.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { teamScope } from '../services/people/scope.js';
import '../services/people/engagement/index.js';
import { AutomationError, automationHistory, companyUsers, listAutomations, recipesOf, saveAutomations, RECIPE, type AutomationModule } from '../services/people/engagement/automations.js';

/**
 * Settings → Automations for any module (the registry in services/people/engagement/automations.ts):
 *
 *   GET  /orgs/:orgId/automations?module=people          the module's recipes, with what this company chose
 *   PUT  /orgs/:orgId/automations?module=people          { automations: { [key]: { on?, n?, to?, channels? } } }
 *   GET  /orgs/:orgId/automations/:key/history           what one recipe sent, day by day
 *
 * Read by whoever may read the module's settings, changed by whoever may change them: People by HR (Employees
 * edit, whole company), Attendance by whoever may edit shifts and rules, Payroll by whoever may edit payroll
 * settings. Who a recipe told, and the users to choose from, are the editor's alone. Every change is audited.
 * The old People path (/people/automations) answers with the same handlers.
 */
export const automationsRouter = Router();
const base = '/orgs/:orgId/automations';
automationsRouter.use(base, requireAuth, requireTenantContext);

type Access = { ok: (req: Request, res: Response) => Promise<boolean>; module: string; resource: string; wholeCompany?: boolean; refusal: string };
const ACCESS: Partial<Record<AutomationModule, Access>> = {
  people: { ok: peopleRouteOk, module: PEOPLE_MODULE, resource: PEOPLE_RESOURCE.employees, wholeCompany: true, refusal: 'Only HR, for the whole company, can do this.' },
  attendance: { ok: attendanceRouteOk, module: ATTENDANCE_MODULE, resource: ATTENDANCE_RESOURCE.shifts, refusal: 'Only whoever sets attendance rules can change these.' },
  payroll: { ok: payrollRouteOk, module: PAYROLL_MODULE, resource: PAYROLL_RESOURCE.settings, refusal: 'Only whoever sets up payroll can change these.' },
};

const allowed = async (req: Request, a: Access, action: 'VIEW' | 'EDIT') => {
  if (await authorize(req, a.module, PermissionAction[action] as any, a.resource)) return false;
  return action === 'VIEW' || !a.wholeCompany || (await teamScope(req)).all;
};

/** The module asked for, its app switched on, and the reader allowed; else it has replied and returns null. */
async function gate(req: Request, res: Response, module: string, action: 'VIEW' | 'EDIT') {
  const a = ACCESS[module as AutomationModule];
  if (!a) {
    res.status(404).json({ error: 'There are no automations for that app.' });
    return null;
  }
  if (!(await a.ok(req, res))) return null;
  if (!(await allowed(req, a, 'VIEW'))) {
    res.status(403).json({ error: 'You cannot see these automations.' });
    return null;
  }
  const canEdit = await allowed(req, a, 'EDIT');
  if (action === 'EDIT' && !canEdit) {
    res.status(403).json({ error: a.refusal });
    return null;
  }
  return { module: module as AutomationModule, canEdit };
}

const failed = (res: Response, e: any) => {
  if (e instanceof AutomationError || (e?.status && e.status < 500)) return res.status(e.status || 400).json({ error: e.message });
  console.error('[automations]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
};

/** The users "a named person" may be, for an editor of a module that offers one. */
const usersToChoose = async (orgId: string, module: AutomationModule) =>
  recipesOf(module).some((r) => r.recipients?.options.includes('PERSON')) ? (await companyUsers(orgId)).map((u) => ({ id: u.id, name: u.fullName })) : [];

export async function getAutomations(req: Request, res: Response, module: string) {
  try {
    const g = await gate(req, res, module, 'VIEW');
    if (!g) return;
    const orgId = req.tenant!.orgId;
    res.json({ module: g.module, automations: await listAutomations(orgId, { module: g.module, showRuns: g.canEdit }), canEdit: g.canEdit, users: g.canEdit ? await usersToChoose(orgId, g.module) : [] });
  } catch (e) {
    failed(res, e);
  }
}

const words = (a: Awaited<ReturnType<typeof listAutomations>>[number]) =>
  [a.on ? 'on' : 'off', a.n != null ? `(${a.n})` : '', a.to ? `to ${a.to.map((t) => t.label || t.value).join(', ')}` : '', a.channelOptions ? `by ${a.channels.join(', ')}` : ''].filter(Boolean).join(' ');

export async function putAutomations(req: Request, res: Response, module: string) {
  try {
    const g = await gate(req, res, module, 'EDIT');
    if (!g) return;
    const orgId = req.tenant!.orgId;
    const before = await listAutomations(orgId, { module: g.module, showRuns: true });
    await saveAutomations({ accountId: req.tenant!.accountId, orgId, userId: req.auth!.userId }, req.body, g.module);
    const after = await listAutomations(orgId, { module: g.module, showRuns: true });
    const changed = after.filter((a) => { const b = before.find((x) => x.key === a.key); return b && words(b) !== words(a); });
    if (changed.length) {
      await recordAudit(req, {
        entity: 'EngagementSettings', entityId: orgId, action: 'UPDATE',
        message: `Automations changed: ${changed.map((c) => `${c.key} ${words(c)}`).join(', ')}`.slice(0, 480),
        metadata: { module: g.module, changed: changed.map((c) => ({ key: c.key, on: c.on, n: c.n, to: c.to?.map((t) => t.value) ?? null, channels: c.channels })) },
      });
    }
    res.json({ module: g.module, automations: after, canEdit: true, users: await usersToChoose(orgId, g.module) });
  } catch (e) {
    failed(res, e);
  }
}

const moduleOf = (req: Request) => String(req.query.module || 'people');

automationsRouter.get(base, (req, res) => getAutomations(req, res, moduleOf(req)));
automationsRouter.put(base, (req, res) => putAutomations(req, res, moduleOf(req)));

/** One recipe's history: the editor's, since it names who was told. Its module is the recipe's own. */
automationsRouter.get(`${base}/:key/history`, async (req, res) => {
  try {
    const r = RECIPE.get(String(req.params.key));
    if (!r) return res.status(404).json({ error: 'There is no such automation.' });
    const g = await gate(req, res, r.module, 'EDIT');
    if (!g) return;
    res.json({ key: r.id, history: await automationHistory(req.tenant!.orgId, r.id, Number(req.query.limit) || 30) });
  } catch (e) {
    failed(res, e);
  }
});
