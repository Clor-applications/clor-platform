import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/** Income tax declarations and proofs, by financial year ("2026-27"). */

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

/** Pay earlier in the year, before CLOR ran payroll (opening year-to-date figures). */
const opening = () => `/orgs/${encodeURIComponent(orgId())}/payroll/opening-ytd`;
export const listOpeningYtd = (fy) => apiFetch(`${opening()}${fyq(fy)}`, opts);
export const getOpeningYtd = (employeeId, fy) => apiFetch(`${base()}/${encodeURIComponent(employeeId)}${fyq(fy)}`, opts).then((r) => r?.opening ?? null);
export const saveOpeningYtd = (employeeId, fy, body) =>
  apiFetch(`${opening()}/${encodeURIComponent(employeeId)}${fyq(fy)}`, { ...opts, method: 'PUT', body }).then((r) => r?.opening ?? null);
export const deleteOpeningYtd = (employeeId, fy) => apiFetch(`${opening()}/${encodeURIComponent(employeeId)}${fyq(fy)}`, { ...opts, method: 'DELETE' });
export const importOpeningYtd = (fy, csv) => apiFetch(`${opening()}/import${fyq(fy)}`, { ...opts, method: 'POST', body: { csv } });
export const setFirstPayrollYear = (fy, firstYear, reason) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/opening-ytd-first-year${fyq(fy)}`, { ...opts, method: 'PUT', body: { firstYear, reason } });

const reports = () => `/orgs/${encodeURIComponent(orgId())}/payroll/reports`;
/** Form 16 Part B figures for the year: one person, or everybody. */
export const getForm16 = (fy, employeeId) =>
  apiFetch(`${reports()}/form16?fy=${encodeURIComponent(fy)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ''}`, opts);
/** Form 24Q Annexure I rows for a quarter (1 = April–June). */
export const get24q = (fy, quarter) => apiFetch(`${reports()}/24q?fy=${encodeURIComponent(fy)}&quarter=${quarter}`, opts);
