// Branch accounts are internal clearing ledgers. Their balances sum to zero
// for the company while showing what each branch owes or is due individually.
export const ensureBranchAccounts = (db, companyId, branches) => {
  const rows = (Array.isArray(branches) ? branches : []).filter(branch => branch?.id);
  if (!rows.length || !companyId) return db;
  const accounts = Array.isArray(db?.chartOfAccounts) ? db.chartOfAccounts : [];
  const groups = Array.isArray(db?.accountGroups) ? db.accountGroups : [];
  const types = Array.isArray(db?.accountTypes) ? db.accountTypes : [];
  const assetType = types.find(type => String(type.companyId) === String(companyId) && String(type.accountClass).toLowerCase() === 'asset');
  if (!assetType) return db;
  let branchGroup = groups.find(group => String(group.companyId) === String(companyId) && String(group.name).toLowerCase() === 'branch' && String(group.typeId) === String(assetType.id));
  const nextGroups = [...groups];
  if (!branchGroup) {
    const parent = groups.find(group => String(group.companyId) === String(companyId) && String(group.name).toLowerCase() === 'current assets' && String(group.typeId) === String(assetType.id));
    branchGroup = { id: Math.max(0, ...groups.map(group => Number(group.id) || 0)) + 1, companyId, typeId: assetType.id, name: 'Branch', parentGroupId: parent?.id ?? null, groupCategory: 'General', isSystem: true };
    nextGroups.push(branchGroup);
  }
  const nextAccounts = [...accounts];
  let nextId = Math.max(0, ...accounts.map(account => Number(account.id) || 0));
  let changed = nextGroups.length !== groups.length;
  for (const branch of rows) {
    const existing = nextAccounts.find(account => String(account.companyId) === String(companyId) && String(account.branchClearingId || '') === String(branch.id));
    if (existing) continue;
    nextAccounts.push({ id: ++nextId, companyId, code: `BR-${String(branch.branchCode || branch.id).slice(0, 15)}`, name: `Branch · ${branch.branchName || branch.name || branch.id}`, groupId: branchGroup.id, type: 'Asset', main: 'Balance Sheet', openingBalance: 0, branchClearingId: String(branch.id), isActive: true });
    changed = true;
  }
  return changed ? { ...db, accountGroups: nextGroups, chartOfAccounts: nextAccounts } : db;
};

export const branchTransferValue = transfer => {
  const amount = Number(transfer?.total || 0);
  if (amount > 0) return amount;
  return Math.round((Array.isArray(transfer?.lines) ? transfer.lines : []).reduce((sum, line) => sum + Number(line?.qty || 0) * Number(line?.rate || 0), 0) * 100) / 100;
};
