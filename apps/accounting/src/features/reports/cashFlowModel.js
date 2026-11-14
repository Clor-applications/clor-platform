import { buildLedgerStatement } from '../../data/db';
import { cashBankIndex } from '../cashBank/transactions';

const lower = value => String(value || '').trim().toLowerCase();
const round = value => Math.round((Number(value) || 0) * 100) / 100;
const sum = (rows, field) => round(rows.reduce((total, row) => total + (Number(row[field]) || 0), 0));

const sectionFor = (account, groupNames, label, direction) => {
  const name = lower(account?.name || label);
  const chain = groupNames.map(lower).join(' / ');
  const accountClass = lower(account?.accountClass || account?.type);
  if (/interest paid|finance cost|borrowing cost/.test(name)) return 'financing';
  if (/interest received|dividend received|investment income/.test(name)) return 'investing';
  if (/capital|equity|reserve|share premium|loan|borrow|debenture|mortgage|overdraft|cash credit/.test(`${name} ${chain}`) && !/loan to employee|trade receivable/.test(name)) return 'financing';
  if (/fixed asset|property|plant|equipment|investment|intangible|land|building|vehicle|machinery|asset disposal|asset purchase/.test(`${name} ${chain}`)) return 'investing';
  if (accountClass === 'equity') return 'financing';
  if (accountClass === 'asset' && /non.current|long.term/.test(chain)) return 'investing';
  if (accountClass === 'liability' && /non.current|long.term/.test(chain)) return 'financing';
  if (/fixed asset|investment|loan proceeds|loan repayment|capital introduced|drawings/.test(lower(label))) return /loan|capital|drawings/.test(lower(label)) ? 'financing' : 'investing';
  void direction;
  return 'operating';
};

export function buildCashFlow(db, companyId, range) {
  const groups = new Map((db.accountGroups || []).filter(row => String(row.companyId) === String(companyId)).map(row => [String(row.id), row]));
  const types = new Map((db.accountTypes || []).filter(row => String(row.companyId) === String(companyId)).map(row => [String(row.id), row]));
  const accounts = (db.chartOfAccounts || []).filter(row => String(row.companyId) === String(companyId));
  const byName = new Map(accounts.map(account => [lower(account.name), account]));
  const cashAccounts = cashBankIndex(db, companyId).accounts;
  const cashIds = new Set(cashAccounts.map(account => String(account.id)));
  const cashNames = new Set(cashAccounts.map(account => lower(account.name)));
  const journals = new Map((db.journalEntries || []).filter(row => String(row.companyId) === String(companyId)).map(row => [String(row.id), row]));
  const groupNames = account => {
    const names = []; const visited = new Set(); let group = groups.get(String(account?.groupId || ''));
    while (group && !visited.has(String(group.id))) { names.push(group.name); visited.add(String(group.id)); group = groups.get(String(group.parentGroupId)); }
    return names;
  };
  const entries = [];
  const cashBalances = [];
  let opening = 0;
  let closing = 0;
  for (const account of cashAccounts) {
    const statement = buildLedgerStatement(db, companyId, account.id);
    let before = round(Number(statement.openingBalance || 0) * (lower(account.openingBalanceType) === 'cr' ? -1 : 1));
    let inPeriod = 0;
    for (const row of statement.rows || []) {
      const date = String(row.date || '').slice(0, 10);
      if (!date || date > range.end) continue;
      const movement = round((Number(row.debit) || 0) - (Number(row.credit) || 0));
      if (date < range.start) { before += movement; continue; }
      inPeriod += movement;
      let counterpartName = String(row.particulars || '').trim();
      let counterpart = byName.get(lower(counterpartName));
      if (row.voucherKey === 'journalEntry') {
        const journal = journals.get(String(row.voucherId));
        const otherLines = (journal?.lines || []).filter(line => String(line.accountId) !== String(account.id));
        const nonCash = otherLines.map(line => accounts.find(candidate => String(candidate.id) === String(line.accountId))).filter(candidate => candidate && !cashIds.has(String(candidate.id)));
        if (!nonCash.length && otherLines.length) continue;
        if (nonCash.length) { counterpart = nonCash[0]; counterpartName = counterpart.name; }
      }
      const transfer = cashNames.has(lower(counterpartName)) || (counterpart && cashIds.has(String(counterpart.id)));
      if (transfer) continue;
      const accountType = types.get(String(groups.get(String(counterpart?.groupId))?.typeId));
      const section = sectionFor({ ...counterpart, accountClass: accountType?.accountClass }, groupNames(counterpart), counterpartName || row.voucherType, movement);
      entries.push({ id: `${account.id}:${entries.length}`, section, label: counterpartName || 'Unclassified cash movement', ledgerId: counterpart ? String(counterpart.id) : '', cashAccountId: String(account.id), date, cashAccount: account.name, voucherType: row.voucherType || '', voucherNo: row.voucherNo || '', narration: row.narration || '', amount: movement });
    }
    cashBalances.push({ id: String(account.id), name: account.name, opening: round(before), closing: round(before + inPeriod) });
    opening += round(before);
    closing += round(before + inPeriod);
  }
  opening = round(opening); closing = round(closing);
  const sections = Object.fromEntries(['operating', 'investing', 'financing'].map(section => {
    const lines = new Map();
    for (const entry of entries.filter(row => row.section === section)) {
      const key = entry.ledgerId || `unlinked:${entry.label}`;
      const current = lines.get(key) || { ledgerId: entry.ledgerId, label: entry.label, amount: 0, entries: [] };
      current.amount = round(current.amount + entry.amount);
      current.entries.push(entry);
      lines.set(key, current);
    }
    return [section, [...lines.values()].sort((a, b) => a.label.localeCompare(b.label))];
  }));
  const totals = Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, sum(lines, 'amount')]));
  const net = round(closing - opening);
  const classified = round(totals.operating + totals.investing + totals.financing);
  const reconciliation = round(net - classified);
  const sectionLedgers = Object.fromEntries(['operating', 'investing', 'financing'].map(section => [section, accounts.filter(account => !cashIds.has(String(account.id)) && sectionFor({ ...account, accountClass: types.get(String(groups.get(String(account.groupId))?.typeId))?.accountClass }, groupNames(account), account.name) === section).map(account => ({ id: String(account.id), name: account.name })).sort((a, b) => a.name.localeCompare(b.name))]));
  return { cashAccounts, cashBalances, entries, sections, sectionLedgers, totals, opening, closing, net, reconciliation, transfersExcluded: cashAccounts.length > 1 };
}
