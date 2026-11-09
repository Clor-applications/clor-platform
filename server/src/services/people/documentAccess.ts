import type { Request } from 'express';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction, type PermissionAction as PermissionActionType } from '../../constants/enums.js';
import { permKey } from '../../constants/permissionCatalog.js';
import { COMPANY_WIDE, resolveAccess } from '../access.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';
import { teamOf, teamScope, type TeamScope } from './scope.js';

/**
 * Who can open a document on an employee's file (docs/people/02-PRD.md DOC-01; review R-01; audit 7 Nov 2026 #1).
 *
 *   EMPLOYEE_VISIBLE   Documents VIEW
 *   HR_ONLY            Documents VIEW and HR-only Documents VIEW, company-wide (a read-only Viewer goes without; owner, 8 Nov 2026)
 *   RESTRICTED         Documents EDIT, company-wide
 *   CONFIDENTIAL       Confidential Documents VIEW, company-wide (its own grant)
 *
 * A team-scoped role (a Team Manager: "own records only") opens only what the person themself can see, inside its
 * team, and never a payslip but the reader's own. HR-level reading is the company-wide grant, never the team one.
 * Every surface that lists, opens, names or restores a file asks this one rule: the register, the record, the file,
 * its versions and acceptances, Activity, the profile's permits, the recycle bin and the expiring-documents report.
 */
export const DOC_CLASSIFICATIONS = ['EMPLOYEE_VISIBLE', 'HR_ONLY', 'RESTRICTED', 'CONFIDENTIAL'] as const;
export type DocClass = (typeof DOC_CLASSIFICATIONS)[number];

/** What a reader may open: the classifications, whose payslips ('ALL', one person's id, or nobody's), and whose files (null: everyone's). */
export type DocAccess = { classes: DocClass[]; payslipsOf: 'ALL' | string | null; employeeIds: string[] | null };

export type DocLike = { classification?: string | null; kind?: string | null; employeeId?: string | null };

type Grants = { view: boolean; hrOnly: boolean; edit: boolean; confidential: boolean };

function shape(grants: Grants, scope: TeamScope): DocAccess {
  if (!scope.all) return { classes: grants.view ? ['EMPLOYEE_VISIBLE'] : [], payslipsOf: scope.selfId, employeeIds: scope.ids };
  const classes: DocClass[] = [];
  if (grants.view) classes.push('EMPLOYEE_VISIBLE');
  if (grants.view && grants.hrOnly) classes.push('HR_ONLY');
  if (grants.edit) classes.push('RESTRICTED');
  if (grants.confidential) classes.push('CONFIDENTIAL');
  return { classes, payslipsOf: 'ALL', employeeIds: null };
}

/** The signed-in reader's access. */
export async function docAccess(req: Request): Promise<DocAccess> {
  const view = !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.documents));
  const hrOnly = !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.hrOnlyDocuments));
  const edit = !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.documents));
  const confidential = !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.confidentialDocuments));
  return shape({ view, hrOnly, edit, confidential }, await teamScope(req));
}

/**
 * A user's access away from a request (a scheduled report goes out as the person who set it up). Company-wide roles
 * only, so a branch role never widens a mail nobody is signed in to read; no roles is no access.
 */
export async function docAccessOfUser(accountId: string, orgId: string, userId: string | null | undefined): Promise<DocAccess> {
  const none: DocAccess = { classes: [], payslipsOf: null, employeeIds: [] };
  if (!userId) return none;
  const access = await resolveAccess(accountId, orgId, userId, COMPANY_WIDE);
  if (!access.roleIds.length) return none;
  const has = (action: string, resource: string) => access.isAdmin || access.permissions.has(permKey(PEOPLE_MODULE, resource, action));
  const grants: Grants = { view: has(PermissionAction.VIEW, PEOPLE_RESOURCE.documents), hrOnly: has(PermissionAction.VIEW, PEOPLE_RESOURCE.hrOnlyDocuments), edit: has(PermissionAction.EDIT, PEOPLE_RESOURCE.documents), confidential: has(PermissionAction.VIEW, PEOPLE_RESOURCE.confidentialDocuments) };
  return shape(grants, access.ownDocumentsOnly ? await teamOf(orgId, userId) : { all: true });
}

/** What both readers may open (the stricter of two): a report sent now by one person on a schedule another set up. */
export function docAccessOfBoth(a: DocAccess, b: DocAccess): DocAccess {
  const classes = a.classes.filter((c) => b.classes.includes(c));
  const payslipsOf = a.payslipsOf === 'ALL' ? b.payslipsOf : b.payslipsOf === 'ALL' ? a.payslipsOf : a.payslipsOf === b.payslipsOf ? a.payslipsOf : null;
  const employeeIds = a.employeeIds === null ? b.employeeIds : b.employeeIds === null ? a.employeeIds : a.employeeIds.filter((id) => b.employeeIds!.includes(id));
  return { classes, payslipsOf, employeeIds };
}

/** The `where` for a document query under this access (an AND, so it never overwrites the caller's own employeeId). */
export const docWhere = (a: DocAccess) => ({
  AND: [
    { classification: { in: a.classes } },
    ...(a.payslipsOf === 'ALL' ? [] : [{ OR: [{ kind: { not: 'PAYSLIP' } }, ...(a.payslipsOf ? [{ employeeId: a.payslipsOf }] : [])] }]),
    ...(a.employeeIds ? [{ employeeId: { in: a.employeeIds } }] : []),
  ],
});

/** Whether one document (or what is known of it) opens under this access. Unknown classification opens for no one. */
export const docOpens = (a: DocAccess, d: DocLike) =>
  Boolean(d.classification) &&
  a.classes.includes(d.classification as DocClass) &&
  (a.payslipsOf === 'ALL' || d.kind !== 'PAYSLIP' || (Boolean(d.employeeId) && d.employeeId === a.payslipsOf)) &&
  (!a.employeeIds || (Boolean(d.employeeId) && a.employeeIds.includes(d.employeeId as string)));

/** The grant a write (upload, replace, delete, restore, purge) on a document of this classification needs. */
export const writeGrantFor = (classification: string, action: PermissionActionType): [string, PermissionActionType, string] =>
  classification === 'CONFIDENTIAL' ? [PEOPLE_MODULE, action, PEOPLE_RESOURCE.confidentialDocuments] : [PEOPLE_MODULE, action, PEOPLE_RESOURCE.documents];

/** The name shown for a file the reader may not open. */
export const HIDDEN_DOCUMENT = 'A restricted document';
