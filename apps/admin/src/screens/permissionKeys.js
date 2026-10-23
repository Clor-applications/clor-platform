/** `MODULE::Resource::ACTION` — the wire format the server and /permissions/me use. */
export const permissionKey = (module, resource, action) => `${module}::${resource}::${action}`;

/** All wire keys a catalogue module's resources declare. */
export const moduleKeys = (mod) => mod.resources.flatMap((r) => r.actions.map((a) => permissionKey(mod.key, r.key, a)));

/** Every key in the catalogue, for filtering out grants the catalogue has retired. */
export const catalogKeys = (modules) => new Set((modules || []).flatMap(moduleKeys));

/** "Sales › Invoices: View", from the catalogue's own labels. */
export const permissionLabel = (modules, wireKey) => {
  const [m, r, a] = String(wireKey).split('::');
  const mod = (modules || []).find((x) => x.key === m);
  const res = mod?.resources.find((x) => x.key === r);
  const action = a ? a.charAt(0) + a.slice(1).toLowerCase() : '';
  return `${mod?.label || m} › ${res?.label || r}: ${action}`;
};
