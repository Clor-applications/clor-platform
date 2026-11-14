/**
 * What a branch is called.
 *
 * The server sends `branchName` and `branchCode`; several screens read `name`,
 * which is always undefined, so every branch fell back to its own id and the
 * picker showed "Branch cmtbcow5700d4fjoo4ooy9q99". One helper so the next
 * screen cannot get it wrong, and so a rename of the server field is one edit.
 *
 * The id is the last resort rather than the first: a cuid tells nobody which
 * branch they are looking at, but it is still better than an empty control.
 */
export const branchLabel = (b, ...lists) => {
  // Called with the branch (and warehouse) lists, the first argument is a
  // document and the question is which branch it belongs to.
  if (lists.length) return documentBranchLabel(b, ...lists);
  if (!b) return '';
  const name = String(b.branchName || b.name || b.label || '').trim();
  if (name) return name;
  const code = String(b.branchCode || b.code || '').trim();
  if (code) return code;
  const id = String(b.id || '').trim();
  return id ? `Branch ${id.slice(0, 6)}…` : '';
};

/** "HO · Head Office" where both exist — the code is what people say out loud. */
export const branchLabelWithCode = (b) => {
  if (!b) return '';
  const name = String(b.branchName || b.name || b.label || '').trim();
  const code = String(b.branchCode || b.code || '').trim();
  if (name && code) return `${code} · ${name}`;
  return branchLabel(b);
};

/**
 * The branch a document belongs to, by name.
 *
 * A document carries a branch id, or only a warehouse id from which the branch
 * follows. Falls back to the name saved on the document, then to a dash, so a
 * list column is never blank.
 */
export function documentBranchLabel(record, branches = [], warehouses = []) {
  const warehouse = (warehouses || []).find((row) => String(row?.id) === String(record?.warehouseId || ''));
  const id = String(record?.branchId || warehouse?.branchId || '').trim();
  const branch = id ? (branches || []).find((row) => String(row?.id) === id) : null;
  return (branch ? branchLabel(branch) : '') || record?.branchName || '—';
}

export default branchLabel;
