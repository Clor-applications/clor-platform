import { API_BASE, apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Expenses, advances and salary advances (server: routes/peopleMoney.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/money`;
const opts = { skipWarehouseHeader: true };
const id = (v) => encodeURIComponent(v);
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

/* The claims, carrying the reimbursement line Payroll pays them on (`.reimbursement`: name, taxed). */
export const listClaims = (status) => apiFetch(`${base()}/claims${status ? `?status=${id(status)}` : ''}`, opts).then((r) => Object.assign(r?.claims || [], { reimbursement: r?.reimbursement || null }));
export const payClaim = (claimId, body) => send(`/claims/${id(claimId)}/pay`, 'POST', body).then((r) => r?.claim);
export const sanctionClaim = (claimId, lines) => send(`/claims/${id(claimId)}/sanction`, 'POST', { lines }).then((r) => r?.claim);
export const markRecorded = (body) => send('/books-recorded', 'POST', body);

export const listAdvances = () => apiFetch(`${base()}/advances`, opts).then((r) => r?.advances || []);
export const payAdvance = (advanceId, body) => send(`/advances/${id(advanceId)}/pay`, 'POST', body);
export const advanceReturned = (advanceId, amount) => send(`/advances/${id(advanceId)}/returned`, 'POST', amount ? { amount } : {});
export const recoverAdvance = (advanceId) => send(`/advances/${id(advanceId)}/recover`, 'POST', {});

export const listSalaryAdvances = () => apiFetch(`${base()}/salary-advances`, opts).then((r) => r?.asks || []);
export const sendToPayroll = (askId) => send(`/salary-advances/${id(askId)}/send-to-payroll`, 'POST', {});

/** The record behind a money request in the Approvals inbox. */
export const moneyRequest = (requestId) => apiFetch(`${base()}/requests/${id(requestId)}`, opts);
export const getReport = (from, to) => apiFetch(`${base()}/report?from=${id(from || '')}&to=${id(to || '')}`, opts);

export const listCategories = () => apiFetch(`${base()}/categories`, opts).then((r) => r?.categories || []);
export const saveCategory = (body) => (body.id ? send(`/categories/${id(body.id)}`, 'PUT', body) : send('/categories', 'POST', body)).then((r) => r?.category);

async function fetchFile(path) {
  let token = '';
  try { token = String(localStorage.getItem('token') || '').trim(); } catch { /* private window */ }
  const res = await fetch(`${API_BASE}${base()}${path}`, { credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'x-org-id': orgId() } });
  if (!res.ok) {
    let message = 'Could not open the file.';
    try { message = (await res.json())?.error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return { name: /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'file', blob: await res.blob() };
}

/** A bill's photo or PDF in a new tab. */
export async function openBill(billId) {
  const { blob } = await fetchFile(`/bills/${id(billId)}`);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** kind: books (paid now, not yet entered in Books) | claims (every decided claim in the range). */
export async function downloadCsv(kind, from, to) {
  const { name, blob } = await fetchFile(`/export.csv?kind=${id(kind)}&from=${id(from || '')}&to=${id(to || '')}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
