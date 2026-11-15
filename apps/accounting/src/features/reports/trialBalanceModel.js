import { buildLedgerStatement } from '../../data/db';

const round = value => Math.round((Number(value) || 0) * 100) / 100;
const lower = value => String(value || '').trim().toLowerCase();
const sum = (rows, key) => round(rows.reduce((total, row) => total + (Number(row[key]) || 0), 0));

export function buildTrialBalance(db, companyId, range) {
  const groups = (db.accountGroups || []).filter(group => String(group.companyId) === String(companyId));
  const groupById = new Map(groups.map(group => [String(group.id), group]));
  const types = new Map((db.accountTypes || []).filter(type => String(type.companyId) === String(companyId)).map(type => [String(type.id), type]));
  const ledgers = (db.chartOfAccounts || []).filter(account => String(account.companyId) === String(companyId)).map(account => {
    const group = groupById.get(String(account.groupId));
    const accountClass = lower(types.get(String(group?.typeId))?.accountClass || account.type);
    const debitNature = accountClass === 'asset' || accountClass === 'expense';
    const statement = buildLedgerStatement(db, companyId, account.id);
    const openingSign = lower(account.openingBalanceType) === 'dr' ? 1 : lower(account.openingBalanceType) === 'cr' ? -1 : debitNature ? 1 : -1;
    let opening = round((Number(statement.openingBalance) || 0) * openingSign);
    let debit = 0;
    let credit = 0;
    for (const row of statement.rows || []) {
      const date = String(row.date || '').slice(0, 10);
      if (!date || date > range.end) continue;
      const dr = Number(row.debit) || 0;
      const cr = Number(row.credit) || 0;
      if (date < range.start) opening += dr - cr;
      else { debit += dr; credit += cr; }
    }
    opening = round(opening);
    debit = round(debit);
    credit = round(credit);
    return { id: String(account.id), name: account.name || 'Unnamed ledger', code: account.code || '', groupId: group ? String(group.id) : '', opening, debit, credit, closing: round(opening + debit - credit), kind: 'ledger' };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const makeGroup = (group, ancestry = new Set()) => {
    if (ancestry.has(String(group.id))) return null;
    const next = new Set(ancestry); next.add(String(group.id));
    const children = groups.filter(candidate => String(candidate.parentGroupId || '') === String(group.id)).map(child => makeGroup(child, next)).filter(Boolean);
    children.push(...ledgers.filter(ledger => ledger.groupId === String(group.id)));
    if (!children.length) return null;
    return { id: `group:${group.id}`, name: group.name || 'Unnamed group', kind: 'group', children, opening: sum(children, 'opening'), debit: sum(children, 'debit'), credit: sum(children, 'credit'), closing: sum(children, 'closing') };
  };
  const roots = groups.filter(group => !group.parentGroupId || !groupById.has(String(group.parentGroupId))).map(group => makeGroup(group)).filter(Boolean);
  const ungrouped = ledgers.filter(ledger => !ledger.groupId);
  if (ungrouped.length) roots.push({ id: 'group:ungrouped', name: 'Ungrouped ledgers', kind: 'group', children: ungrouped, opening: sum(ungrouped, 'opening'), debit: sum(ungrouped, 'debit'), credit: sum(ungrouped, 'credit'), closing: sum(ungrouped, 'closing') });
  return { roots, ledgers, totals: { opening: sum(ledgers, 'opening'), debit: sum(ledgers, 'debit'), credit: sum(ledgers, 'credit'), closing: sum(ledgers, 'closing') } };
}
