import { buildLedgerStatement } from '../../data/db';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';

const lower = value => String(value || '').trim().toLowerCase();
const round = value => Math.round((Number(value) || 0) * 100) / 100;
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const monthBounds = key => {
  const [year, month] = String(key).split('-').map(Number);
  return { start: iso(new Date(year, month - 1, 1)), end: iso(new Date(year, month, 0)) };
};

export const offsetMonth = (key, offset) => {
  const [year, month] = String(key).split('-').map(Number);
  return iso(new Date(year, month - 1 + offset, 1)).slice(0, 7);
};

export const previousPeriod = range => {
  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);
  const days = Math.round((end - start) / 86400000) + 1;
  const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd); priorStart.setDate(priorStart.getDate() - days + 1);
  return { start: iso(priorStart), end: iso(priorEnd) };
};

export const priorYearPeriod = range => {
  const shift = value => { const date = new Date(`${value}T12:00:00`); date.setFullYear(date.getFullYear() - 1); return iso(date); };
  return { start: shift(range.start), end: shift(range.end) };
};

const emptySections = () => ({ sales: [], openingStock: [], purchases: [], directExpenses: [], closingStock: [], indirectIncome: [], indirectExpenses: [] });

const classify = (account, groupNames) => {
  const chain = groupNames.map(lower);
  const belongs = pattern => chain.some(name => pattern.test(name));
  const name = lower(account.name);
  if (belongs(/closing stock/)) return 'closingStock';
  if (belongs(/opening stock/)) return 'openingStock';
  if (belongs(/sales account|sales group/)) return 'sales';
  if (belongs(/purchase account|purchases/)) return 'purchases';
  if (belongs(/indirect income|indirect incomes/)) return 'indirectIncome';
  if (belongs(/indirect expense/)) return 'indirectExpenses';
  if (belongs(/\bdirect expense/)) return 'directExpenses';
  if (/closing stock/.test(name)) return 'closingStock';
  if (/opening stock/.test(name)) return 'openingStock';
  if (account._class === 'income') return /interest|other income|indirect/.test(name) ? 'indirectIncome' : 'sales';
  return /purchase/.test(name) ? 'purchases' : 'indirectExpenses';
};

const stockValues = (db, companyId, range) => {
  const stock = computeInventorySummaryByItemId({ db, companyId, fromDate: range.start, toDate: range.end });
  let opening = 0; let closing = 0;
  for (const item of db.items || []) {
    if (String(item.companyId) !== String(companyId) || !isStockItem(item)) continue;
    const rate = Number(item.purchasePrice || 0);
    const row = stock.get(String(item.id));
    opening += Number(row?.openingQty || 0) * rate;
    closing += Number(row?.closingQty || 0) * rate;
  }
  return { opening: round(opening), closing: round(closing) };
};

export const buildProfitLoss = (db, companyId, currentRange, comparisonRange) => {
  const groups = new Map((db.accountGroups || []).filter(group => String(group.companyId) === String(companyId)).map(group => [String(group.id), group]));
  const types = new Map((db.accountTypes || []).filter(type => String(type.companyId) === String(companyId)).map(type => [String(type.id), type]));
  const sections = emptySections();
  const groupChain = groupId => {
    const names = []; const visited = new Set(); let group = groups.get(String(groupId));
    while (group && !visited.has(String(group.id))) { names.push(group.name); visited.add(String(group.id)); group = groups.get(String(group.parentGroupId)); }
    return names;
  };
  for (const account of db.chartOfAccounts || []) {
    if (String(account.companyId) !== String(companyId)) continue;
    const group = groups.get(String(account.groupId));
    const type = types.get(String(group?.typeId));
    const accountClass = lower(type?.accountClass || account.type);
    const main = lower(type?.main || account.main);
    if (!['income', 'expense'].includes(accountClass) || main && main !== 'p&l') continue;
    const key = classify({ ...account, _class: accountClass }, groupChain(account.groupId));
    const postings = buildLedgerStatement(db, companyId, account.id).rows;
    const value = range => round(postings.reduce((sum, row) => {
      const date = String(row.date || '').slice(0, 10);
      if (date < range.start || date > range.end) return sum;
      const debit = Number(row.debit || 0); const credit = Number(row.credit || 0);
      return sum + (accountClass === 'income' || key === 'closingStock' ? credit - debit : debit - credit);
    }, 0));
    sections[key].push({ id: account.id, code: account.code || '', name: account.name, current: value(currentRange), previous: value(comparisonRange), source: 'ledger' });
  }
  const currentStock = stockValues(db, companyId, currentRange);
  const previousStock = stockValues(db, companyId, comparisonRange);
  if (currentStock.opening || previousStock.opening) sections.openingStock.unshift({ id: 'stock-opening', name: 'Inventory at start of period', current: currentStock.opening, previous: previousStock.opening, source: 'stock' });
  if (currentStock.closing || previousStock.closing) sections.closingStock.unshift({ id: 'stock-closing', name: 'Inventory at end of period', current: currentStock.closing, previous: previousStock.closing, source: 'stock' });
  for (const rows of Object.values(sections)) rows.sort((a, b) => a.name.localeCompare(b.name));
  const sum = (key, field) => round(sections[key].reduce((total, row) => total + row[field], 0));
  const totals = field => {
    const sales = sum('sales', field);
    const openingStock = sum('openingStock', field);
    const purchases = sum('purchases', field);
    const directExpenses = sum('directExpenses', field);
    const closingStock = sum('closingStock', field);
    const cogs = round(openingStock + purchases + directExpenses - closingStock);
    const grossProfit = round(sales - cogs);
    const indirectIncome = sum('indirectIncome', field);
    const indirectExpenses = sum('indirectExpenses', field);
    return { sales, openingStock, purchases, directExpenses, closingStock, cogs, grossProfit, indirectIncome, indirectExpenses, netProfit: round(grossProfit + indirectIncome - indirectExpenses) };
  };
  return { sections, current: totals('current'), previous: totals('previous') };
};
