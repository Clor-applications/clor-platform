/**
 * Everything that moved money through a cash or bank account.
 *
 * The old screen showed imported bank rows and, beside them, whichever
 * payments happened to match the selected account — two half-lists under one
 * heading. What a book-keeper wants is the account's actual movements,
 * whatever entered them: a payment made, a receipt taken, money moved between
 * the company's own accounts, and the statement rows imported from the bank.
 *
 * Three types and no more, which is the whole of §4: a movement either takes
 * money out (Payment), brings it in (Receipt), or moves it between two of the
 * company's own accounts (Contra). Anything else is not a cash-book entry.
 */

const safeArray = (v) => (Array.isArray(v) ? v : []);
const lower = (s) => String(s || '').trim().toLowerCase();
const day = (v) => String(v || '').slice(0, 10);
const CASH_BANK_ROOTS = new Set(['bank', 'banks', 'bank account', 'bank accounts', 'cash', 'cash-in-hand', 'cash in hand', 'cash & bank', 'cash and bank', 'cash / bank', 'cash/bank']);

/** Whether a group, or anything above it, is named `rootLowerName`. */
const isUnderNamedRoot = (groupById, groupId, rootLowerName) => {
  let cur = groupById.get(String(groupId || '')) || null;
  const seen = new Set();
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id));
    if (lower(cur.name) === rootLowerName) return true;
    const pid = cur.parentGroupId;
    if (pid === null || pid === undefined || pid === '') return false;
    cur = groupById.get(String(pid)) || null;
  }
  return false;
};

/**
 * The cash and bank ledgers, indexed every way a stored row might name one.
 *
 * A payment records the *server's* ledger id, an imported row records the
 * local chart row, and a journal line records the local id again. One map,
 * three keys, rather than three lookups that each miss a different case.
 */
export const cashBankIndex = (db, companyId) => {
  const cid = Number(companyId);
  const groups = safeArray(db?.accountGroups).filter((g) => Number(g?.companyId) === cid);
  const groupById = new Map(groups.map((g) => [String(g.id), g]));

  const accounts = safeArray(db?.chartOfAccounts)
    .filter((a) => Number(a?.companyId) === cid)
    .filter((a) => {
      const explicitKind = [a?.controlKind, a?.ledgerCategory, a?.accountType, a?.type].map(lower);
      const explicitlyCashBank = explicitKind.some((value) =>
        value === 'cash' || value === 'bank' || value === 'cash_in_hand' || value === 'cash-in-hand' || value === 'bank_account'
      );
      return explicitlyCashBank || [...CASH_BANK_ROOTS].some((root) => isUnderNamedRoot(groupById, a.groupId, root));
    });

  const byKey = new Map();
  for (const a of accounts) {
    byKey.set(String(a.id), a);
    for (const key of [a.serverLedgerAccountId, a.backendLedgerId, a.backendAccountId, a.ledgerAccountId, a.uuid]) {
      const value = String(key || '').trim();
      if (value) byKey.set(value, a);
    }
  }
  return { accounts, byKey };
};

/** What a row is called in the Ledger Name column. */
const partyOf = (p) =>
  String(p?.partyName || p?.vendorName || p?.customerName || p?.ledgerName || '').trim();

/**
 * One row per movement, newest first.
 *
 * `accountId` narrows to a single account (the local chart row's id); `from`
 * and `to` are inclusive ISO dates. Nothing is invented: a row exists because
 * a payment, a journal or an imported statement line exists.
 */
export const cashBankTransactions = (db, companyId, { accountId = '', from = '', to = '' } = {}) => {
  const cid = Number(companyId);
  const { accounts, byKey } = cashBankIndex(db, cid);
  const want = String(accountId || '').trim();

  const inWindow = (d) => {
    const v = day(d);
    if (from && (!v || v < day(from))) return false;
    if (to && (!v || v > day(to))) return false;
    return true;
  };

  const rows = [];

  /* Payments and receipts, as entered on their own forms. */
  for (const p of safeArray(db?.payments)) {
    if (Number(p?.companyId) !== cid) continue;
    /* A voucher raised from a statement line is represented by that statement
       line below. Showing both would turn one bank movement into two rows. */
    if (p?.sourceBankTransactionId !== null && p?.sourceBankTransactionId !== undefined && String(p.sourceBankTransactionId) !== '') continue;
    const accountKeys = [p?.ledgerAccountId, p?.cashBankAccountId, p?.bankAccountId, p?.accountId, p?.modeAccountId];
    let account = accountKeys.map((key) => byKey.get(String(key || '').trim())).find(Boolean) || null;
    if (!account) {
      const wantedName = lower(p?.accountName || p?.cashBankAccountName || p?.bankName);
      if (wantedName) account = accounts.find((candidate) => lower(candidate?.name) === wantedName) || null;
    }
    // Receipt/payment forms auto-select the only cash/bank ledger. Older rows
    // did not always persist that selection, but the accounting answer is
    // unambiguous when the company has exactly one such account.
    if (!account && accounts.length === 1) account = accounts[0];
    if (!account) continue;
    if (want && String(account.id) !== want) continue;
    if (!inWindow(p.date)) continue;
    rows.push({
      id: `pay-${p.id}`,
      kind: 'payment',
      sourceId: p.id,
      date: day(p.date),
      accountId: String(account.id),
      accountName: String(account.name || ''),
      ledgerName: partyOf(p) || '—',
      type: lower(p.voucherType) === 'receipt' ? 'Receipt' : 'Payment',
      amount: Math.abs(Number(p.amount ?? 0)),
      /* Which way the cash moved, for balance arithmetic downstream. */
      flow: lower(p.voucherType) === 'receipt' ? 'IN' : 'OUT',
      status: 'Categorised',
      reconciled: p.reconciled === true,
      number: String(p.number || ''),
      bankDate: day(p.bankDate) || '',
    });
  }

  /*
   * Money moved between two of the company's own accounts.
   *
   * There is no contra voucher of its own yet; a transfer is written as a
   * journal, and what makes it a contra is that BOTH sides are cash or bank.
   * A journal with one cash leg is a payment or a receipt by another name and
   * is left to whichever screen owns it, rather than counted twice here.
   */
  for (const j of safeArray(db?.journalEntries)) {
    if (Number(j?.companyId) !== cid) continue;
    if (!inWindow(j.date)) continue;
    const lines = safeArray(j.lines);
    if (lines.length < 2) continue;
    const resolved = lines.map((l) => byKey.get(String(l?.accountId || '').trim()) || null);
    if (resolved.some((a) => !a)) continue;

    /* Out of the credited account, into the debited one. */
    const fromIdx = lines.findIndex((l) => Number(l?.credit || 0) > 0);
    const toIdx = lines.findIndex((l) => Number(l?.debit || 0) > 0);
    if (fromIdx < 0 || toIdx < 0) continue;
    const source = resolved[fromIdx];
    const target = resolved[toIdx];
    if (want && String(source.id) !== want && String(target.id) !== want) continue;

    const shown = want && String(target.id) === want ? target : source;
    const other = shown === source ? target : source;
    rows.push({
      id: `jrn-${j.id}`,
      kind: 'contra',
      sourceId: j.id,
      date: day(j.date),
      accountId: String(shown.id),
      accountName: String(shown.name || ''),
      ledgerName: String(other.name || ''),
      type: 'Contra',
      amount: Math.abs(Number(lines[fromIdx]?.credit || 0)),
      /* From the shown account's side: the debited account received. */
      flow: shown === target ? 'IN' : 'OUT',
      status: 'Categorised',
      reconciled: j.reconciled === true,
      number: String(j.number || ''),
      bankDate: day(j.bankDate) || '',
    });
  }

  /*
   * Imported statement lines.
   *
   * They stay Unallocated until somebody says which ledger they belong to —
   * §5: an imported row must not become an accounting entry on its own.
   *
   * A line that has since been ANSWERED by a voucher — a payment or receipt
   * created from it, carrying sourceBankTransactionId — steps aside: the
   * voucher row above already shows the movement with its party and number,
   * and one movement must be one row, not the fact and its echo.
   */
  for (const t of safeArray(db?.bankTransactions)) {
    if (Number(t?.companyId) !== cid) continue;
    const account = byKey.get(String(t?.cashBankAccountId || '').trim());
    if (!account) continue;
    if (want && String(account.id) !== want) continue;
    if (!inWindow(t.date)) continue;
    const ledger = safeArray(db?.chartOfAccounts).find((a) => String(a.id) === String(t.ledgerId || ''));
    const linkedPayment = safeArray(db?.payments).find(
      (p) => String(p?.id) === String(t?.linkedPaymentId || '') || String(p?.sourceBankTransactionId || '') === String(t?.id)
    );
    const isContra = ['CONTRA', 'TRANSFER', 'INTER-BANK TRANSFER', 'INTER BANK TRANSFER'].includes(
      String(t.transactionType || t.type || '').trim().toUpperCase()
    ) || Boolean(t.linkedJournalEntryId || t.contraJournalEntryId);
    const allocated = Boolean(
      t.ledgerId || t.linkedPaymentId || t.linkedJournalEntryId || t.contraJournalEntryId || t.allocationJournalId || linkedPayment
    );
    rows.push({
      id: `bank-${t.id}`,
      kind: 'statement',
      sourceId: t.id,
      date: day(t.date),
      accountId: String(account.id),
      accountName: String(account.name || ''),
      ledgerName: String(ledger?.name || linkedPayment?.partyName || linkedPayment?.vendorName || linkedPayment?.customerName || t.description || '—'),
      type: isContra ? 'Contra' : String(t.direction || '').toUpperCase() === 'IN' ? 'Receipt' : 'Payment',
      amount: Math.abs(Number(t.amount ?? 0)),
      flow: String(t.direction || '').toUpperCase() === 'IN' ? 'IN' : 'OUT',
      bankDate: day(t.bankDate) || '',
      /* Allocated to a ledger, and reconciled against the bank, are two
         different questions — a row can be the first without the second. */
      status: allocated ? 'Categorised' : 'Uncategorised',
      reconciled: t.reconciled === true,
      linkedVoucherId: t.linkedPaymentId || t.linkedJournalEntryId || t.contraJournalEntryId || linkedPayment?.id || null,
      number: String(t.refNo || ''),
    });
  }

  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(b.id).localeCompare(String(a.id));
  });
};

/** The four figures above the list. */
export const cashBankTotals = (rows) => {
  const sum = (type) =>
    safeArray(rows)
      .filter((r) => r.type === type)
      .reduce((t, r) => t + Number(r.amount || 0), 0);
  return {
    payments: sum('Payment'),
    receipts: sum('Receipt'),
    contra: sum('Contra'),
    count: safeArray(rows).length,
  };
};

/** Payment red, Receipt green, Contra blue — §4, and nowhere else decides. */
export const TYPE_TONE = { Payment: 'neg', Receipt: 'pos', Contra: 'info' };
