import { MASTER_KIND, createOrgMaster, deleteOrgMaster, updateOrgMaster } from '../api/masters';
import { hasApiSession } from '../api/purchaseDocs';
import { notify } from '../components/ui/notify';

/**
 * Write-through for the reference lists.
 *
 * Units, item categories, price lists, discount rules, cost centres, account
 * groups and GST rates were held in one browser while every document that uses
 * them lived on the server. Each screen needs the same three lines, and the rule they all
 * follow is the one the salesman master already set: the row is kept locally
 * whatever the server says, so nothing typed is ever lost, and a refusal is
 * reported rather than swallowed.
 *
 * Returns the patch to spread onto the local row — `{ backendMasterId }` when
 * the server took it, `{}` when it did not.
 */
export const saveMaster = async (collection, name, data = {}) => {
  const kind = MASTER_KIND[collection];
  if (!kind || !hasApiSession()) return {};
  try {
    const created = await createOrgMaster(kind, name, data);
    const id = created?.master?.id;
    return id ? { backendMasterId: String(id) } : {};
  } catch (e) {
    notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    return {};
  }
};

/** The same, for an edit. Silent when the row was never on the server. */
export const patchMaster = async (row, patch) => {
  const id = String(row?.backendMasterId || '').trim();
  if (!id || !hasApiSession()) return;
  try {
    await updateOrgMaster(id, patch);
  } catch (e) {
    notify.error(`Changed on this device only — the server refused it: ${String(e?.message || e)}`);
  }
};

/**
 * Removal, server first.
 *
 * Nothing points at one of these by id — a document records the unit it was
 * entered in and the rate it was priced at, not a reference to the list the
 * value came from — so these are genuinely deleted rather than deactivated.
 */
export const removeMaster = async (row) => {
  const id = String(row?.backendMasterId || '').trim();
  if (!id || !hasApiSession()) return;
  try {
    await deleteOrgMaster(id);
  } catch (e) {
    notify.error(`Removed on this device only — the server refused it: ${String(e?.message || e)}`);
  }
};

/**
 * A local row as the server should store it.
 *
 * Identity lives in the server's own columns, so the payload must not carry a
 * second copy of it — a stored `id` would come back on hydration and fight the
 * local numbering.
 */
const IDENTITY_KEYS = ['id', 'companyId', 'backendMasterId', 'name', 'hydratedFromServer'];
export const masterDataOf = (row) =>
  Object.fromEntries(Object.entries(row || {}).filter(([k]) => !IDENTITY_KEYS.includes(k)));

/** An edited row, pushed whole. Used where a screen patches field by field. */
export const pushMaster = (row) => patchMaster(row, { name: row?.name, data: masterDataOf(row) });
