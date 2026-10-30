import { API_BASE } from '@platform/http';

import { SignedOut, portalToken, setPortalToken } from './portalApi';

/**
 * The employee app's money calls (server: routes/peopleMoneyPortal.ts): bills
 * spent for work, claims, advances and salary advances. Same token and the
 * same "signed out" handling as portalApi's own transport.
 */
async function call(path, { method = 'GET', body } = {}) {
  const token = portalToken();
  let res;
  try {
    res = await fetch(`${API_BASE}/portal/people/money${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && data?.code === 'PORTAL_SIGNIN') {
    setPortalToken('');
    throw new SignedOut(data.error);
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Something went wrong (${res.status}).`), { code: data?.code, status: res.status });
  return data;
}

const id = (v) => encodeURIComponent(v);

export const getMoney = () => call('');
export const addBill = (body) => call('/lines', { method: 'POST', body });
export const removeBill = (lineId) => call(`/lines/${id(lineId)}`, { method: 'DELETE' });
export const sendClaim = (claimId, body) => call(`/claims/${id(claimId)}/submit`, { method: 'POST', body });
export const reopenClaim = (claimId) => call(`/claims/${id(claimId)}/reopen`, { method: 'POST' });
export const askAdvance = (body) => call('/advances', { method: 'POST', body });
export const previewSalaryAdvance = (body) => call('/salary-advance/preview', { method: 'POST', body });
export const askSalaryAdvance = (body) => call('/salary-advance', { method: 'POST', body });
/** kind: claims | advances | salary-advance */
export const withdrawMoney = (kind, rowId) => call(`/${kind}/${id(rowId)}/withdraw`, { method: 'POST' });
export const answerMoney = (kind, rowId, note) => call(`/${kind}/${id(rowId)}/reply`, { method: 'POST', body: { note } });

/** A bill's own file, as a blob URL to show or open; the caller revokes it. */
export async function billUrl(billId) {
  const token = portalToken();
  const res = await fetch(`${API_BASE}/portal/people/money/bills/${id(billId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Could not open the bill.');
  return URL.createObjectURL(await res.blob());
}

/**
 * A phone photo made small enough to send: the long side at most 1600 px, as
 * JPEG. A PDF goes as it is. Reads as a data URL either way.
 */
export async function billData(file) {
  const asDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
  if (file.type === 'application/pdf' || !/^image\//.test(file.type)) return asDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ? asDataUrl(blob) : asDataUrl(file);
  } catch {
    return asDataUrl(file);
  }
}
