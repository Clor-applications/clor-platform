import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * Weekly wages (round 66): daily rates, weekly or fortnightly wage sheets,
 * the bank file and the month's summary for the returns. Account numbers
 * arrive only in the bank file download, never in what the screen holds.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/weekly-wages`;
const opts = { skipWarehouseHeader: true };
const id = (v) => encodeURIComponent(v);

export async function listWageRates(payGroupId = '') {
  const { rates } = await apiFetch(`${base()}/rates${payGroupId ? `?payGroupId=${id(payGroupId)}` : ''}`, opts);
  return Array.isArray(rates) ? rates : [];
}

export async function saveWageRate(payload) {
  const { rate } = await apiFetch(`${base()}/rates`, { ...opts, method: 'PUT', body: payload });
  return rate;
}

export async function listWageSheets({ payGroupId = '', month = '' } = {}) {
  const q = new URLSearchParams();
  if (payGroupId) q.set('payGroupId', payGroupId);
  if (month) q.set('month', month);
  const { sheets } = await apiFetch(`${base()}/sheets${q.toString() ? `?${q}` : ''}`, opts);
  return Array.isArray(sheets) ? sheets : [];
}

export async function nextSheetStart(payGroupId) {
  const { startDate } = await apiFetch(`${base()}/next-start?payGroupId=${id(payGroupId)}`, opts);
  return startDate || null;
}

const sheetOf = async (p) => (await p).sheet;

export const getWageSheet = (sheetId) => sheetOf(apiFetch(`${base()}/sheets/${id(sheetId)}`, opts));
export const makeWageSheet = (payload) => sheetOf(apiFetch(`${base()}/sheets`, { ...opts, method: 'POST', body: payload }));
export const editWageLine = (sheetId, lineId, patch) => sheetOf(apiFetch(`${base()}/sheets/${id(sheetId)}/lines/${id(lineId)}`, { ...opts, method: 'PATCH', body: patch }));
export const refreshWageSheet = (sheetId) => sheetOf(apiFetch(`${base()}/sheets/${id(sheetId)}/refresh`, { ...opts, method: 'POST', body: {} }));
export const approveWageSheet = (sheetId) => sheetOf(apiFetch(`${base()}/sheets/${id(sheetId)}/approve`, { ...opts, method: 'POST', body: {} }));
export const reopenWageSheet = (sheetId) => sheetOf(apiFetch(`${base()}/sheets/${id(sheetId)}/reopen`, { ...opts, method: 'POST', body: {} }));
export const markWageSheetPaid = (sheetId, body) => sheetOf(apiFetch(`${base()}/sheets/${id(sheetId)}/paid`, { ...opts, method: 'POST', body }));
export const deleteWageSheet = (sheetId) => apiFetch(`${base()}/sheets/${id(sheetId)}`, { ...opts, method: 'DELETE' });

/** Counts and who is paid in cash; the file itself is `downloadBankFile`. */
export const bankFileSummary = (sheetId) => apiFetch(`${base()}/sheets/${id(sheetId)}/bank-file`, opts);
export const bankFileCsv = (sheetId) => apiFetch(`${base()}/sheets/${id(sheetId)}/bank-file?format=csv`, { ...opts, asText: true });

export const wageSlip = (sheetId, employeeId) => apiFetch(`${base()}/sheets/${id(sheetId)}/slips/${id(employeeId)}`, opts);

export const wageMonth = (month) => apiFetch(`${base()}/months/${id(month)}`, opts);
export const wageMonthFile = (month, format) => apiFetch(`${base()}/months/${id(month)}?format=${format}`, { ...opts, asText: true });

/** Save text the server built as a file. */
export function saveText(text, fileName, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
