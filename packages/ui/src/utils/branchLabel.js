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
export const branchLabel = (b) => {
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

export default branchLabel;
