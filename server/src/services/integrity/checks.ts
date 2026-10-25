import { prisma } from '../../utils/prisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { ownerExists } from '../credentialReview.js';
import { revokeCredential, SYSTEM } from '../credentials.js';
import { fileStore } from '../fileStore.js';

/**
 * GAP-010: find, and where it is safe, repair, names one database keeps of
 * another's records that point at nothing.
 *
 * Repaired: access that names a warehouse, customer, vendor or cost centre
 * that is gone (nothing is lost — the access already grants nothing), and a
 * machine credential whose owner is gone (revoked, as the nightly sweep would).
 * Reported, never touched: Payroll's own records — a profile, assignment,
 * component, posting or payment naming an employee, cost centre, ledger or
 * journal that is gone or reversed. Those are pay history; a person decides.
 */

export type Finding = { link: string; sourceId: string; target: string; repair: 'REPAIRED' | 'REPORT' };
type Company = { accountId: string; orgId: string };

const ids = <T extends { id: string }>(rows: T[]) => new Set(rows.map((r) => r.id));

export async function checkCompany({ accountId, orgId }: Company, opts: { repair?: boolean } = {}): Promise<Finding[]> {
  const out: Finding[] = [];
  const where = { accountId, orgId };
  return runInTenant(orgId, async () => {
    const [warehouses, parties, costCentres, ledgers, journals, employees, runs] = await Promise.all([
      prisma.warehouse.findMany({ where, select: { id: true } }).then(ids),
      prisma.party.findMany({ where, select: { id: true } }).then(ids),
      prisma.orgMaster.findMany({ where: { ...where, kind: 'COST_CENTER' }, select: { id: true } }).then(ids),
      prisma.ledgerAccount.findMany({ where: { ...where, isActive: true }, select: { id: true } }).then(ids),
      prisma.journalEntry.findMany({ where: { ...where, status: 'POSTED' }, select: { id: true } }).then(ids),
      peoplePrisma.employee.findMany({ where, select: { id: true } }).then(ids),
      payrollPrisma.payrollRun.findMany({ where, select: { id: true } }).then(ids),
    ]);

    /* ---- Platform access naming Accounting records: repairable. ---- */
    for (const a of await platformPrisma.userWarehouseAccess.findMany({ where, select: { id: true, warehouseId: true } })) {
      if (warehouses.has(a.warehouseId)) continue;
      if (opts.repair) await platformPrisma.userWarehouseAccess.delete({ where: { id: a.id } });
      out.push({ link: 'platform.UserWarehouseAccess.warehouseId → accounting.Warehouse', sourceId: a.id, target: a.warehouseId, repair: opts.repair ? 'REPAIRED' : 'REPORT' });
    }
    for (const p of await platformPrisma.userPermission.findMany({ where: { ...where, entityType: { in: ['CUSTOMER', 'VENDOR', 'COST_CENTRE'] } }, select: { id: true, entityType: true, entityId: true } })) {
      const there = p.entityType === 'COST_CENTRE' ? costCentres.has(p.entityId) : parties.has(p.entityId);
      if (there) continue;
      if (opts.repair) await platformPrisma.userPermission.delete({ where: { id: p.id } });
      out.push({ link: `platform.UserPermission(${p.entityType}).entityId → accounting.${p.entityType === 'COST_CENTRE' ? 'OrgMaster' : 'Party'}`, sourceId: p.id, target: p.entityId, repair: opts.repair ? 'REPAIRED' : 'REPORT' });
    }

    /* ---- Machine credentials whose owner is gone: repairable (revoked). ---- */
    for (const c of await platformPrisma.credential.findMany({ where: { ...where, status: { not: 'REVOKED' } }, select: { id: true, kind: true, ownerId: true } })) {
      if (await ownerExists(c.kind, c.ownerId)) continue;
      if (opts.repair) await revokeCredential(c.id, orgId, SYSTEM, 'owner_missing');
      out.push({ link: `platform.Credential(${c.kind}).ownerId → its owner`, sourceId: c.id, target: c.ownerId, repair: opts.repair ? 'REPAIRED' : 'REPORT' });
    }

    /*
     * ---- R2 plan, S4: files in object storage. ----
     * An object no row needs (and no recycle-bin snapshot may still restore) is
     * deleted; a row whose object is missing is reported.
     */
    const store = fileStore();
    if (store) {
      const [docs, photos, evidence, bin] = await Promise.all([
        peoplePrisma.employeeDocument.findMany({ where: { ...where, storageKey: { not: null } }, select: { id: true, storageKey: true } }),
        peoplePrisma.punchPhoto.findMany({ where: { ...where, storageKey: { not: null } }, select: { id: true, storageKey: true } }),
        peoplePrisma.complianceTask.findMany({ where: { ...where, evidenceKey: { not: null } }, select: { id: true, evidenceKey: true } }),
        peoplePrisma.deletedItem.findMany({ where: { orgId }, select: { snapshot: true } }),
      ]);
      const rowKeys = new Map<string, string>([...docs.map((d) => [d.storageKey!, d.id] as const), ...photos.map((p) => [p.storageKey!, p.id] as const), ...evidence.map((e) => [e.evidenceKey!, e.id] as const)]);
      const binKeys = new Set(bin.flatMap((b) => JSON.stringify(b.snapshot).match(new RegExp(`org/${orgId}/[a-z-]+/[A-Za-z0-9_-]+`, 'g')) || []));
      const objects = await store.list(orgId);
      const present = new Set(objects);
      for (const key of objects) {
        if (rowKeys.has(key) || binKeys.has(key)) continue;
        if (opts.repair) await store.delete(orgId, key);
        out.push({ link: 'object storage → a file row (none needs it)', sourceId: key, target: '(no row)', repair: opts.repair ? 'REPAIRED' : 'REPORT' });
      }
      for (const [key, id] of rowKeys) if (!present.has(key)) out.push({ link: 'people file row → its object in storage', sourceId: id, target: key, repair: 'REPORT' });
    }

    /* ---- Payroll history: reported only. ---- */
    const report = (link: string, sourceId: string, target: string) => out.push({ link, sourceId, target, repair: 'REPORT' });
    for (const p of await payrollPrisma.employeePayrollProfile.findMany({ where, select: { id: true, employeeId: true, costCenterId: true } })) {
      if (!employees.has(p.employeeId)) report('payroll.EmployeePayrollProfile.employeeId → people.Employee', p.id, p.employeeId);
      if (p.costCenterId && !costCentres.has(p.costCenterId)) report('payroll.EmployeePayrollProfile.costCenterId → accounting.OrgMaster(COST_CENTER)', p.id, p.costCenterId);
    }
    for (const a of await payrollPrisma.salaryAssignment.findMany({ where: { ...where, costCenterId: { not: null } }, select: { id: true, costCenterId: true } })) {
      if (!costCentres.has(a.costCenterId!)) report('payroll.SalaryAssignment.costCenterId → accounting.OrgMaster(COST_CENTER)', a.id, a.costCenterId!);
    }
    for (const c of await payrollPrisma.salaryComponent.findMany({ where, select: { id: true, expenseLedgerId: true, liabilityLedgerId: true } })) {
      for (const l of [c.expenseLedgerId, c.liabilityLedgerId]) if (l && !ledgers.has(l)) report('payroll.SalaryComponent.ledgerId → accounting.LedgerAccount (active)', c.id, l);
    }
    for (const p of await payrollPrisma.payrollPosting.findMany({ where: { ...where, status: 'POSTED' }, select: { id: true, journalEntryId: true } })) {
      if (!p.journalEntryId || !journals.has(p.journalEntryId)) report('payroll.PayrollPosting.journalEntryId → accounting.JournalEntry (posted)', p.id, p.journalEntryId || '(none)');
    }
    for (const p of await payrollPrisma.payrollPayment.findMany({ where: { ...where, status: 'POSTED', journalEntryId: { not: null } }, select: { id: true, journalEntryId: true } })) {
      if (!journals.has(p.journalEntryId!)) report('payroll.PayrollPayment.journalEntryId → accounting.JournalEntry (posted)', p.id, p.journalEntryId!);
    }
    for (const l of await peoplePrisma.leaveAdjustment.findMany({ where: { ...where, paidInRunId: { not: null } }, select: { id: true, paidInRunId: true } })) {
      if (!runs.has(l.paidInRunId!)) report('people.LeaveAdjustment.paidInRunId → payroll.PayrollRun', l.id, l.paidInRunId!);
    }
    return out;
  });
}

/** Every company, once: the nightly job. Repairs what is safe; logs a count per link for the rest. */
export async function checkAllCompanies(opts: { repair?: boolean } = { repair: true }) {
  const orgs = await outsideTenant('integrity: every company', () => platformPrisma.org.findMany({ select: { id: true, accountId: true } }));
  const totals = new Map<string, { repaired: number; reported: number }>();
  for (const o of orgs) {
    const found = await checkCompany({ accountId: o.accountId, orgId: o.id }, opts).catch((e) => {
      console.error(`[integrity] ${o.id}:`, e instanceof Error ? e.message : e);
      return [] as Finding[];
    });
    for (const f of found) {
      const t = totals.get(f.link) || { repaired: 0, reported: 0 };
      if (f.repair === 'REPAIRED') t.repaired += 1;
      else t.reported += 1;
      totals.set(f.link, t);
    }
  }
  for (const [link, t] of totals) console.log(`[integrity] ${link}: ${t.repaired} repaired, ${t.reported} to look at`);
  return Object.fromEntries(totals);
}

export function startIntegrityChecks({ intervalMs = 24 * 3_600_000, startupDelayMs = 900_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('integrity.crossStore', leaseFor(intervalMs), () => checkAllCompanies({ repair: true }), { idempotent: true }).catch((e) =>
      console.error('[integrity] nightly check failed:', e instanceof Error ? e.message : e)
    );
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
