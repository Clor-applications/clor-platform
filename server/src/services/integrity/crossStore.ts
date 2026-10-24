import { prisma } from '../../utils/prisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';

/**
 * GAP-010: links between the four databases.
 *
 * A record in one database names a record in another by id, with no foreign
 * key behind it. The writes here keep those names honest at the moment they
 * could go wrong — a delete, a reversal, a new grant — and `crossStoreCheck`
 * (checks.ts) finds and repairs whatever got past them. The inventory of
 * every such link is in the upgrade folder (evidence/GAP-010/links.md).
 */

type Company = { accountId: string; orgId: string };

/** Per-person access names one of these (platform `UserPermission.entityType`). */
export const ENTITY_TYPES = ['CUSTOMER', 'VENDOR', 'COST_CENTRE', 'ITEM_GROUP'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Payroll rows that name this cost centre: profiles, assignments, payslip and posting lines. */
export async function payrollUsesCostCentre({ accountId, orgId }: Company, costCenterId: string) {
  const where = { accountId, orgId, costCenterId };
  const [profiles, assignments, slipLines, postingLines] = await Promise.all([
    payrollPrisma.employeePayrollProfile.count({ where }),
    payrollPrisma.salaryAssignment.count({ where }),
    payrollPrisma.salarySlipLine.count({ where }),
    payrollPrisma.payrollPostingLine.count({ where }),
  ]);
  return profiles + assignments + slipLines + postingLines;
}

/** Whether a customer, vendor or cost centre is this company's (ITEM_GROUP has no record of its own to check). */
export async function entityExists({ accountId, orgId }: Company, entityType: string, entityId: string) {
  if (entityType === 'CUSTOMER' || entityType === 'VENDOR') {
    return !!(await prisma.party.findFirst({ where: { id: entityId, accountId, orgId, partyType: { in: [entityType, 'BOTH'] } }, select: { id: true } }));
  }
  if (entityType === 'COST_CENTRE') {
    return !!(await prisma.orgMaster.findFirst({ where: { id: entityId, accountId, orgId, kind: 'COST_CENTER' }, select: { id: true } }));
  }
  return true;
}

/** A record has gone: so has every person's access that named it. */
export async function forgetEntityAccess({ accountId, orgId }: Company, entityTypes: EntityType[], entityId: string) {
  const r = await platformPrisma.userPermission.deleteMany({ where: { accountId, orgId, entityType: { in: entityTypes }, entityId } });
  return r.count;
}

/** A warehouse has gone: so has the access to it. */
export async function forgetWarehouseAccess({ accountId, orgId }: Company, warehouseId: string) {
  const r = await platformPrisma.userWarehouseAccess.deleteMany({ where: { accountId, orgId, warehouseId } });
  return r.count;
}

/** Journals Payroll posts carry one of these; Payroll, not Accounting, undoes them. */
export const PAYROLL_SOURCES = new Set(['PAYROLL_RUN', 'PAYROLL_PAYMENT']);
