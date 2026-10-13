import { API_BASE, apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/** Staged document import — requirements 15 and 16. */

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

export const listImportSpecs = () => apiFetch(`${base()}/imports/specs`, opts);

export const listImports = () => apiFetch(`${base()}/imports`, opts).then((d) => d?.imports || []);

export const getImport = (batchId) => apiFetch(`${base()}/imports/${encodeURIComponent(batchId)}`, opts);

export const stageImport = ({ docType, csv, fileName }) =>
  apiFetch(`${base()}/imports`, { method: 'POST', body: { docType, csv, fileName }, ...opts });

export const validateImport = (batchId) =>
  apiFetch(`${base()}/imports/${encodeURIComponent(batchId)}/validate`, { method: 'POST', ...opts });

export const commitImport = (batchId) =>
  apiFetch(`${base()}/imports/${encodeURIComponent(batchId)}/commit`, { method: 'POST', ...opts });

/**
 * Downloads the CSV template.
 *
 * Fetched directly rather than through apiFetch because the response is a file,
 * not JSON, and the auth headers still have to travel with it.
 */
export async function downloadTemplate(docType) {
  const token = String(localStorage.getItem('token') || '');
  const res = await fetch(`${API_BASE}${base()}/imports/template/${encodeURIComponent(docType)}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-org-id': orgId(),
      'x-branch-id': String(localStorage.getItem('activeBranchId') || ''),
    },
  });
  if (!res.ok) {
    let message = `Could not download the ${docType} template.`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep the generic message when the failure was not JSON.
    }
    throw new Error(message);
  }
  return res.text();
}
