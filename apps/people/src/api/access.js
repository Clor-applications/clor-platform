import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/*
 * Access a role does not give (People audit, 30 Oct 2026, gap 5): a live auditor
 * grant opens Audit evidence, and being named on a case or sitting on a committee
 * opens Confidential cases. The shell reads these keys next to the person's
 * permissions (manifest `access`), so the menu shows what the routes let in.
 */
export const AUDIT_GRANT = 'PEOPLE::Audit grant::VIEW';
export const CASE_SEAT = 'PEOPLE::Case committee::VIEW';
/* HR without Payroll access, when the owner lets HR read salary revisions (Settings → Company choices). */
export const SALARY_READ = 'PEOPLE::Salary revisions read::VIEW';

export const myPeopleAccess = async () => {
  const r = await apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/my-access`, { skipWarehouseHeader: true });
  return [r?.auditEvidence ? AUDIT_GRANT : null, r?.privateCases ? CASE_SEAT : null, r?.salaryRevisions ? SALARY_READ : null].filter(Boolean);
};
