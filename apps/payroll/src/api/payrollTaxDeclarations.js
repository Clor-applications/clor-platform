import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/** Income tax declarations and proofs, by financial year ("2026-27"). */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/tax-declarations`;
const opts = { skipWarehouseHeader: true };
const fyq = (fy) => (fy ? `?fy=${encodeURIComponent(fy)}` : '');
const one = (r) => r?.declaration;

export const listTaxDeclarations = (fy) => apiFetch(`${base()}${fyq(fy)}`, opts);
export const getTaxDeclaration = (employeeId, fy) => apiFetch(`${base()}/${encodeURIComponent(employeeId)}${fyq(fy)}`, opts).then(one);
export const saveTaxDeclaration = (employeeId, fy, body) =>
  apiFetch(`${base()}/${encodeURIComponent(employeeId)}${fyq(fy)}`, { ...opts, method: 'PUT', body }).then(one);
export const verifyTaxDeclaration = (employeeId, fy) =>
  apiFetch(`${base()}/${encodeURIComponent(employeeId)}/verify${fyq(fy)}`, { ...opts, method: 'POST' }).then(one);
export const reopenTaxDeclaration = (employeeId, fy) =>
  apiFetch(`${base()}/${encodeURIComponent(employeeId)}/reopen${fyq(fy)}`, { ...opts, method: 'POST' }).then(one);

const reports = () => `/orgs/${encodeURIComponent(orgId())}/payroll/reports`;
/** Form 16 Part B figures for the year: one person, or everybody. */
export const getForm16 = (fy, employeeId) =>
  apiFetch(`${reports()}/form16?fy=${encodeURIComponent(fy)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ''}`, opts);
/** Form 24Q Annexure I rows for a quarter (1 = April–June). */
export const get24q = (fy, quarter) => apiFetch(`${reports()}/24q?fy=${encodeURIComponent(fy)}&quarter=${quarter}`, opts);
