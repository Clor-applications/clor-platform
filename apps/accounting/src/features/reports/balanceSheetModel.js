import { buildLedgerStatement } from '../../data/db';
import { buildProfitLoss } from './profitLossModel';

const lower = value => String(value || '').trim().toLowerCase();
const round = value => Math.round((Number(value) || 0) * 100) / 100;

const fiscalYearStart = end => {
  const date = new Date(`${end}T12:00:00`);
  const year = date.getMonth() < 3 ? date.getFullYear() - 1 : date.getFullYear();
  return `${year}-04-01`;
};

export const buildBalanceSheet = (db, companyId, currentRange, comparisonRange) => {
  const groups = new Map((db.accountGroups || []).filter(row => String(row.companyId) === String(companyId)).map(row => [String(row.id), row]));
  const types = new Map((db.accountTypes || []).filter(row => String(row.companyId) === String(companyId)).map(row => [String(row.id), row]));
  const sections = { assets: [], liabilities: [], equity: [] };
  const reportGroups = { assets: [], liabilities: [], equity: [] };
  const ancestry = group => {
    const path = [];
    const seen = new Set();
    for (let node = group; node && !seen.has(String(node.id)); node = groups.get(String(node.parentGroupId))) {
      seen.add(String(node.id));
      path.unshift(node);
    }
    return path;
  };
  const sectionFor = (type, fallback) => {
    const main = lower(type?.main || fallback?.main);
    if (main && main !== 'balance sheet') return null;
    const accountClass = lower(type?.accountClass || fallback?.type);
    return accountClass === 'asset' ? 'assets' : accountClass === 'liability' ? 'liabilities' : accountClass === 'equity' ? 'equity' : null;
  };
  for (const group of groups.values()) {
    const path = ancestry(group);
    const type = [...path].reverse().map(node => types.get(String(node.typeId))).find(Boolean);
    const section = sectionFor(type);
    if (!section) continue;
    const parent = path.length > 1 ? path[path.length - 2] : null;
    reportGroups[section].push({ id: String(group.id), name: group.name, parentGroupId: parent ? String(parent.id) : null });
  }
  const balanceAt = (account, end) => {
    const statement = buildLedgerStatement(db, companyId, account.id);
    const debitNature = lower(account._class) === 'asset';
    return round(Number(statement.openingBalance || 0) + (statement.rows || []).reduce((sum, row) => {
      if (String(row.date || '').slice(0, 10) > end) return sum;
      const debit = Number(row.debit || 0); const credit = Number(row.credit || 0);
      return sum + (debitNature ? debit - credit : credit - debit);
    }, 0));
  };

  for (const account of db.chartOfAccounts || []) {
    if (String(account.companyId) !== String(companyId)) continue;
    const group = groups.get(String(account.groupId));
    const path = ancestry(group);
    const type = [...path].reverse().map(node => types.get(String(node.typeId))).find(Boolean);
    const accountClass = lower(type?.accountClass || account.type);
    const key = sectionFor(type, account);
    if (!key) continue;
    const groupPath = path.filter(node => reportGroups[key].some(item => item.id === String(node.id))).map(node => String(node.id));
    sections[key].push({ id: account.id, code: account.code || '', name: account.name, group: group?.name || 'Other', groupId: groupPath.at(-1) || null, groupPath, current: balanceAt({ ...account, _class: accountClass }, currentRange.end), previous: balanceAt({ ...account, _class: accountClass }, comparisonRange.end), source: 'ledger' });
  }

  const currentPnl = buildProfitLoss(db, companyId, { start: fiscalYearStart(currentRange.end), end: currentRange.end }, { start: fiscalYearStart(comparisonRange.end), end: comparisonRange.end });
  const reserves = reportGroups.equity.find(group => /reserves|surplus|retained earnings/i.test(group.name));
  const profitGroup = reserves || { id: 'calculated-profit', name: 'Reserves & Surplus', parentGroupId: null };
  if (!reserves) reportGroups.equity.push(profitGroup);
  const profitPath = ancestry(groups.get(profitGroup.id)).map(group => String(group.id));
  sections.equity.push({ id: 'current-profit', code: '', name: 'Current Year Profit / (Loss)', group: profitGroup.name, groupId: profitGroup.id, groupPath: profitPath.length ? profitPath : [profitGroup.id], current: currentPnl.current.netProfit, previous: currentPnl.previous.netProfit, source: 'calculated' });
  for (const rows of Object.values(sections)) rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const sum = (key, field) => round(sections[key].reduce((total, row) => total + Number(row[field] || 0), 0));
  const totals = field => {
    const assets = sum('assets', field); const liabilities = sum('liabilities', field); const equity = sum('equity', field);
    return { assets, liabilities, equity, liabilitiesAndEquity: round(liabilities + equity), difference: round(assets - liabilities - equity) };
  };
  return { sections, groups: reportGroups, current: totals('current'), previous: totals('previous') };
};
