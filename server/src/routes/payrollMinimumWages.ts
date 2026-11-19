import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { recordAudit } from '../services/auditTrail.js';
import { stateLabel } from '../constants/stateLevies.js';
import { todayIst } from '../utils/istDate.js';
import { CSV_COLUMNS, listRates, parseRatesCsv, revisionReminder, SKILL_LABELS, validateRate, type RateInput, type Skill } from '../services/payroll/minimumWage.js';

/**
 * Minimum wages per state (round 66): the rates HR enters or imports from the
 * state's notification. CLOR ships none. Read with Payroll settings view;
 * changed with settings edit.
 */
export const payrollMinimumWagesRouter = Router();
payrollMinimumWagesRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings);
const EDIT = requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, PAYROLL_RESOURCE.settings);

const shape = (r: any) => ({
  id: r.id,
  state: r.state,
  stateLabel: stateLabel(r.state),
  zone: r.zone || '',
  skill: r.skill,
  skillLabel: SKILL_LABELS[r.skill as Skill] || r.skill,
  effectiveFrom: r.effectiveFrom,
  monthlyRate: Number(r.monthlyRate),
  note: r.note || '',
});

/** States somebody in payroll works in (the state on their payroll details). */
async function statesInUse(orgId: string) {
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, payrollStatus: 'IN_PAYROLL' }, select: { professionalTaxState: true } });
  return profiles.map((p) => p.professionalTaxState || '').filter(Boolean);
}

payrollMinimumWagesRouter.get('/orgs/:orgId/payroll/minimum-wages', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const rows = await listRates(orgId);
  const reminder = revisionReminder(todayIst(), rows, await statesInUse(orgId));
  res.json({ rates: rows.map(shape), reminder, columns: CSV_COLUMNS });
});

/** The same state, zone, skill and date already on file: replaced, so an import can be run again. */
async function save(req: any, row: RateInput) {
  const { accountId, orgId } = req.tenant!;
  const same = await payrollPrisma.payrollMinimumWage.findFirst({
    where: { orgId, state: row.state, zone: row.zone, skill: row.skill, effectiveFrom: row.effectiveFrom, deletedAt: null },
    select: { id: true },
  });
  if (same) {
    await payrollPrisma.payrollMinimumWage.update({ where: { id: same.id }, data: { monthlyRate: row.monthlyRate, note: row.note } });
    return { id: same.id, replaced: true };
  }
  const created = await payrollPrisma.payrollMinimumWage.create({ data: { accountId, orgId, ...row, createdByUserId: req.auth!.userId } });
  return { id: created.id, replaced: false };
}

payrollMinimumWagesRouter.post('/orgs/:orgId/payroll/minimum-wages', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const checked = validateRate(req.body || {});
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const r = checked.row;
  const saved = await save(req, r);
  await recordAudit(req, {
    entity: 'PAYROLL_MINIMUM_WAGE',
    entityId: saved.id,
    action: saved.replaced ? 'UPDATE' : 'CREATE',
    message: `Minimum wage for ${stateLabel(r.state)}${r.zone ? ` (${r.zone})` : ''}, ${SKILL_LABELS[r.skill]} from ${r.effectiveFrom}: ₹${r.monthlyRate} a month`,
    metadata: { ...r },
  });
  res.status(saved.replaced ? 200 : 201).json({ id: saved.id, replaced: saved.replaced });
});

payrollMinimumWagesRouter.post('/orgs/:orgId/payroll/minimum-wages/import', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const csv = String(req.body?.csv ?? '');
  if (!csv.trim()) return res.status(400).json({ error: 'Choose a CSV file of rates.' });
  if (csv.length > 500_000) return res.status(400).json({ error: 'The file is too large: up to 500 KB of rates at a time.' });
  const { rows, errors } = parseRatesCsv(csv);
  /* All or nothing: half a table of rates is worse than the old one. */
  if (errors.length) return res.status(400).json({ error: `Nothing was saved: ${errors.length === 1 ? 'one line needs' : `${errors.length} lines need`} fixing.`, errors: errors.slice(0, 50) });
  if (rows.length > 2000) return res.status(400).json({ error: 'Up to 2,000 rates at a time.' });
  let added = 0;
  let replaced = 0;
  for (const row of rows) {
    const s = await save(req, row);
    if (s.replaced) replaced++;
    else added++;
  }
  await recordAudit(req, {
    entity: 'PAYROLL_MINIMUM_WAGE',
    entityId: 'import',
    action: 'IMPORT',
    message: `Minimum wages imported: ${added} added, ${replaced} replaced`,
    metadata: { added, replaced, states: [...new Set(rows.map((r) => r.state))] },
  });
  res.json({ added, replaced });
});

payrollMinimumWagesRouter.delete('/orgs/:orgId/payroll/minimum-wages/:id', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const row = await payrollPrisma.payrollMinimumWage.findFirst({ where: { orgId, id: String(req.params.id), deletedAt: null } });
  if (!row) return res.status(404).json({ error: 'No such rate.' });
  await payrollPrisma.payrollMinimumWage.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  await recordAudit(req, {
    entity: 'PAYROLL_MINIMUM_WAGE',
    entityId: row.id,
    action: 'DELETE',
    message: `Minimum wage for ${stateLabel(row.state)}${row.zone ? ` (${row.zone})` : ''}, ${SKILL_LABELS[row.skill as Skill] || row.skill} from ${row.effectiveFrom} removed`,
  });
  res.json({ ok: true });
});
