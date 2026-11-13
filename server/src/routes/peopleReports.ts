import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { recordAudit } from '../services/auditTrail.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { seesPersonal, teamScope } from '../services/people/scope.js';
import { seesLeavings } from '../services/people/companyChoices.js';
import { docAccess } from '../services/people/documentAccess.js';
import { HR_REPORTS, ReportError, reportCsv, reportFilters, runReport, type ReportCtx } from '../services/people/reports.js';

/**
 * People's reports (services/people/reports.ts): the list, one report with
 * the filters on screen, and the same rows as CSV.
 *
 * Open to whoever may read the employee list. Every figure is cut to the
 * reader's team scope: a team manager's headcount is their own line's.
 * Gender and age figures under five are hidden from everyone but
 * whole-company HR. Joiners and leavers is kept from whoever the company
 * keeps the Leaving list from (companyChoices.ts).
 */
export const peopleReportsRouter = Router();
const base = '/orgs/:orgId/people/hr-reports';
peopleReportsRouter.use(base, requireAuth, requireTenantContext);

const view = requirePermission(PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.employees);

async function ctxOf(req: Request): Promise<ReportCtx> {
  const scope = await teamScope(req);
  return { orgId: req.tenant!.orgId, scope, hr: scope.all && (await seesPersonal(req)), docs: await docAccess(req) };
}

/** The report asked for, or the refusal already sent. */
async function reportFor(req: Request, res: Response) {
  const id = String(req.params.id);
  if (id === 'movement' && !(await seesLeavings(req))) {
    res.status(403).json({ error: 'Your role does not show who is leaving, so this report is not open to you.' });
    return null;
  }
  try {
    return await runReport(await ctxOf(req), id, req.query);
  } catch (e) {
    if (e instanceof ReportError) {
      res.status(e.status).json({ error: e.message });
      return null;
    }
    throw e;
  }
}

peopleReportsRouter.get(base, view, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const leavingsOk = await seesLeavings(req);
  res.json({ reports: HR_REPORTS.filter((r) => leavingsOk || r.id !== 'movement'), filters: await reportFilters(await ctxOf(req)) });
});

peopleReportsRouter.get(`${base}/:id`, view, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const report = await reportFor(req, res);
  if (report) res.json(report);
});

/** The rows on screen, as a file. Logged: who took which report, and how many rows. */
peopleReportsRouter.get(`${base}/:id/export.csv`, view, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const report = await reportFor(req, res);
  if (!report) return;
  await recordAudit(req, { entity: 'PEOPLE_REPORTS', entityId: report.id, action: 'EXPORT', message: `Exported the report “${report.title}” (${report.rows.length} ${report.rows.length === 1 ? 'row' : 'rows'})`, metadata: { report: report.id, rows: report.rows.length, from: report.from, to: report.to, by: report.by, filters: ['departmentId', 'branchId', 'employeeTypeId', 'gradeId'].filter((k) => req.query[k]) } });
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${report.id}-${report.from ? `${report.from}-to-` : ''}${report.to}.csv"`).set('Cache-Control', 'no-store');
  res.send(reportCsv(report));
});
