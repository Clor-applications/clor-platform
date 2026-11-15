const key = (value) => String(value || '').trim().toLowerCase();

/** Reconcile server-assigned codes with the browser's existing numeric-id rows. */
export const reconcilePartyCodes = (db, companyId, customers = [], vendors = []) => {
  const ledgerCodes = new Map();
  let changed = false;
  const sync = (collection, serverRows) => {
    const locals = db[collection] || [];
    const scoped = locals.filter((row) => String(row.companyId) === String(companyId));
    const nameCounts = new Map();
    for (const row of scoped) nameCounts.set(key(row.name || row.displayName), (nameCounts.get(key(row.name || row.displayName)) || 0) + 1);
    const byId = new Map(scoped.filter((row) => row.backendPartyId).map((row) => [String(row.backendPartyId), row]));
    const byName = new Map(scoped.filter((row) => nameCounts.get(key(row.name || row.displayName)) === 1).map((row) => [key(row.name || row.displayName), row]));
    const updates = new Map();
    for (const server of serverRows) {
      if (!server?.id || !server?.code) continue;
      const local = byId.get(String(server.id)) || byName.get(key(server.name));
      if (!local || (local.backendPartyId && String(local.backendPartyId) !== String(server.id))) continue;
      if (local.code !== server.code || String(local.backendPartyId || '') !== String(server.id)) {
        updates.set(local.id, { code: server.code, backendPartyId: String(server.id) });
        if (local.accountId) ledgerCodes.set(String(local.accountId), server.code);
      }
    }
    if (!updates.size) return locals;
    changed = true;
    return locals.map((row) => updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row);
  };
  const nextCustomers = sync('customers', customers);
  const nextVendors = sync('vendors', vendors);
  if (!changed) return db;
  return {
    ...db,
    customers: nextCustomers,
    vendors: nextVendors,
    chartOfAccounts: (db.chartOfAccounts || []).map((row) => ledgerCodes.has(String(row.id)) && String(row.companyId) === String(companyId) ? { ...row, code: ledgerCodes.get(String(row.id)) } : row),
  };
};
