import { useMemo, useRef, useState } from 'react';
import { Banknote, CreditCard, Landmark, ListChecks, MoreVertical, PieChart, Plus } from 'lucide-react';

import DocumentListShell from '@ui/components/list/DocumentListShell';
import { EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import Modal from '@ui/components/ui/Modal';
import { notify } from '@ui/components/ui/notify';
import Popover from '@ui/components/ui/Popover';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { buildLedgerStatement } from '../../data/db';
import { formatMoney } from '@ui/utils/money';

/**
 * Where the money is.
 *
 * The module's first screen, and deliberately a master rather than a second
 * ledger system: every row here IS a ledger in the chart of accounts, under
 * Bank Accounts or Cash-in-Hand. Nothing is stored twice — the name, the bank
 * details and the branch are the ledger's own, and the balance is what the
 * ledger says it is, built from the same statement the Ledgers screen shows.
 *
 * That is the whole reason this screen can be trusted: there is no separate
 * "bank balance" that can drift from the books.
 */

const lower = (s) => String(s || '').trim().toLowerCase();

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
 * The accounts this module is about, with what each one is worth.
 *
 * Cash and bank are told apart by the group the ledger sits under, not by a
 * flag on the row: the chart is where a company already said which is which,
 * and a second answer here is a second answer to disagree with.
 */
export const cashBankAccounts = (db, companyId) => {
  const cid = Number(companyId);
  const groups = (Array.isArray(db?.accountGroups) ? db.accountGroups : []).filter(
    (g) => Number(g?.companyId) === cid
  );
  const groupById = new Map(groups.map((g) => [String(g.id), g]));

  return (Array.isArray(db?.chartOfAccounts) ? db.chartOfAccounts : [])
    .filter((a) => Number(a?.companyId) === cid)
    .map((a) => {
      const bank = isUnderNamedRoot(groupById, a.groupId, 'bank accounts');
      const cash = isUnderNamedRoot(groupById, a.groupId, 'cash-in-hand');
      if (!bank && !cash) return null;
      const statement = buildLedgerStatement(db, cid, a.id);
      const rows = Array.isArray(statement?.rows) ? statement.rows : [];
      const balance = rows.length
        ? Number(rows[rows.length - 1]?.runningBalance || 0)
        : Number(statement?.openingBalance || 0);
      const accountType = String(a.bankDetails?.accountType || a.bankAccountType || a.accountSubType || '').trim();
      const isOdCashCredit = bank && /(overdraft|cash\s*credit|(^|\W)od(\W|$)|(^|\W)cc(\W|$))/i.test(accountType);
      return {
        id: a.id,
        name: String(a.name || '').trim(),
        type: isOdCashCredit ? 'OD / Cash Credit' : bank ? 'Bank' : 'Cash',
        /* The ledger master keeps these under `bankDetails`; older rows kept
           them flat, and both are still in the wild. */
        bankName: String(a.bankDetails?.bankName || a.bankName || '').trim(),
        accountNumber: String(a.bankDetails?.accountNumber || a.bankAccountNumber || '').trim(),
        branch: String(a.bankDetails?.branch || a.bankDetails?.branchAddress || '').trim(),
        balance,
        isActive: a.isActive !== false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
};

const TABS = [
  { value: 'all', label: 'All', tone: 'all' },
  { value: 'bank', label: 'Bank Accounts', tone: 'sent' },
  { value: 'cash', label: 'Cash Accounts', tone: 'paid' },
  { value: 'odcc', label: 'OD / Cash Credit', tone: 'outstanding' },
  { value: 'inactive', label: 'Inactive', tone: 'draft' },
];

export default function BankCashAccounts({
  db,
  setDb = null,
  currentCompany,
  onAddAccount = null,
  onOpenAccount = null,
  onEditAccount = null,
}) {
  const [tab, setTab] = useState('all');
  /* Which row's menu hangs open, and off which button. */
  const [menuFor, setMenuFor] = useState(null);

  const menuBtnRef = useRef(null);

  /*
   * Retiring an account is a ledger fact, not a banking one: the row IS a
   * ledger, so the flag lives on the chart row and every other screen that
   * reads it agrees. Nothing else about the ledger moves.
   */
  const setAccountActive = (ledgerId, nextActive) => {
    if (typeof setDb !== 'function') return;
    setDb((prev) => ({
      ...prev,
      chartOfAccounts: (prev.chartOfAccounts || []).map((a) =>
        a.companyId === currentCompany?.id && String(a.id) === String(ledgerId)
          ? { ...a, isActive: nextActive }
          : a
      ),
    }));
  };

  const accounts = useMemo(() => cashBankAccounts(db, currentCompany?.id), [db, currentCompany?.id]);

  const summary = useMemo(() => {
    const live = accounts.filter((a) => a.isActive);
    return {
      bank: live.filter((a) => a.type === 'Bank' || a.type === 'OD / Cash Credit').reduce((t, a) => t + a.balance, 0),
      cash: live.filter((a) => a.type === 'Cash').reduce((t, a) => t + a.balance, 0),
      odcc: live.filter((a) => a.type === 'OD / Cash Credit').reduce((t, a) => t + a.balance, 0),
      total: accounts.length,
      active: live.length,
    };
  }, [accounts]);

  const counts = useMemo(
    () => ({
      all: accounts.length,
      bank: accounts.filter((a) => a.isActive && a.type === 'Bank').length,
      cash: accounts.filter((a) => a.isActive && a.type === 'Cash').length,
      odcc: accounts.filter((a) => a.isActive && a.type === 'OD / Cash Credit').length,
      inactive: accounts.filter((a) => !a.isActive).length,
    }),
    [accounts]
  );

  /*
   * The one Cash & Bank configuration: the ledger a residual allocation
   * difference may be resolved onto. The allocation dialog READS
   * profile.cashBank.adjustmentLedgerId and offers its shortcut only where
   * this names a ledger — until now nothing in the product could write it.
   */
  const [adjustOpen, setAdjustOpen] = useState(false);
  const savedAdjustId = String(currentCompany?.profile?.cashBank?.adjustmentLedgerId || '');
  const [adjustDraft, setAdjustDraft] = useState(savedAdjustId);
  const adjustCandidates = useMemo(
    () =>
      (db?.chartOfAccounts || [])
        .filter((a) => a.companyId === currentCompany?.id && a.isActive !== false)
        .filter((a) => !accounts.some((b) => String(b.id) === String(a.id)))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [db?.chartOfAccounts, currentCompany?.id, accounts]
  );
  const saveAdjustment = () => {
    setDb((prev) => ({
      ...prev,
      companies: (prev.companies || []).map((c) => {
        if (Number(c.id) !== Number(currentCompany?.id)) return c;
        const profile = c?.profile && typeof c.profile === 'object' ? c.profile : {};
        return {
          ...c,
          profile: {
            ...profile,
            cashBank: { ...(profile.cashBank || {}), adjustmentLedgerId: String(adjustDraft || '').trim() },
          },
        };
      }),
    }));
    notify.success(adjustDraft ? 'Adjustment ledger saved.' : 'Adjustment shortcut switched off.');
    setAdjustOpen(false);
  };

  /* The three live tabs show live accounts only — a closed account belongs
     under Inactive, not in the middle of the list of places money is. */
  const rows = useMemo(() => {
    if (tab === 'inactive') return accounts.filter((a) => !a.isActive);
    const live = accounts.filter((a) => a.isActive);
    if (tab === 'bank') return live.filter((a) => a.type === 'Bank');
    if (tab === 'cash') return live.filter((a) => a.type === 'Cash');
    if (tab === 'odcc') return live.filter((a) => a.type === 'OD / Cash Credit');
    return live;
  }, [accounts, tab]);

  return (
    <DocumentListShell
      entity="bankAccount"
      title="Bank & Cash Accounts"
      company={currentCompany}
      primary={
        onAddAccount ? (
          <button type="button" onClick={() => onAddAccount()} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> Add Account
          </button>
        ) : null
      }
      cards={[
        { label: 'Bank balance', value: summary.bank, tone: 'sent', Icon: Landmark },
        { label: 'Cash balance', value: summary.cash, tone: 'paid', Icon: Banknote },
        { label: 'OD / Cash Credit', value: summary.odcc, tone: 'outstanding', Icon: CreditCard },
        { label: 'Accounts', value: summary.total, count: true, tone: 'draft', Icon: ListChecks },
        { label: 'Active accounts', value: summary.active, count: true, tone: 'all', Icon: PieChart },
      ]}
      denseCards
      tight
      tabs={TABS}
      tabsLabel="Accounts"
      statusInHeader
      statusValue={tab}
      statusCounts={counts}
      onStatusChange={setTab}
      /* The menu hands back the key that was chosen; it does not call a
         callback hung off the item. This screen used to pass `onSelect` on the
         item itself, which `MoreButton` never reads — so choosing "Difference
         adjustment ledger" closed the menu and did nothing at all.

         Export comes first because it does on every other list in the product;
         this one was the only master you could not get out of the screen. */
      moreItems={[
        exportMenuItem('Export accounts'),
        ...(setDb ? [{ key: 'adjustmentLedger', label: 'Difference adjustment ledger…' }] : []),
      ]}
      onMoreSelect={(key) => {
        if (key === 'adjustmentLedger') {
          setAdjustDraft(savedAdjustId);
          setAdjustOpen(true);
          return;
        }
        const format = exportFormatFromKey(key);
        if (!format) return;
        /* What is on screen, in the order it is on screen — the tab's filter
           included, because exporting "Inactive" and getting everything is a
           different list than the one that was asked for. */
        runListExport({
          format,
          title: 'Bank & cash accounts',
          fileName: `Bank_and_cash_accounts_${currentCompany?.name || 'company'}`,
          label: 'account(s)',
          columns: [
            { key: 'name', label: 'Account name' },
            { key: 'type', label: 'Type' },
            { key: 'bankName', label: 'Bank name', value: (a) => a.bankName || '' },
            { key: 'accountNumber', label: 'Account number', value: (a) => a.accountNumber || '' },
            { key: 'branch', label: 'Branch', value: (a) => a.branch || '' },
            { key: 'balance', label: 'Current balance', value: (a) => Number(a.balance || 0) },
            { key: 'status', label: 'Status', value: (a) => (a.isActive ? 'Active' : 'Inactive') },
          ],
          rows,
        });
      }}
    >
      {adjustOpen ? (
        <Modal onClose={() => setAdjustOpen(false)} title="Difference adjustment ledger" maxWidthClass="max-w-lg">
          <div className="space-y-4">
            <p className="ui-caption">
              When a bank allocation is left with a small residual, this is the one ledger it may be resolved onto
              with a click — as a visible row through the same journal, never a silent write-off. Leave it empty and
              the shortcut is not offered at all.
            </p>
            <div>
              <label className="ui-label" htmlFor="cb-adjust-ledger">Adjustment ledger</label>
              <select
                id="cb-adjust-ledger"
                className="ui-select w-full"
                value={adjustDraft}
                onChange={(e) => setAdjustDraft(e.target.value)}
              >
                <option value="">— none (no shortcut) —</option>
                {adjustCandidates.map((l) => (
                  <option key={l.id} value={String(l.id)}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setAdjustOpen(false)}>Cancel</button>
              <button type="button" className="ui-btn ui-btn-primary" onClick={saveAdjustment}>Save</button>
            </div>
          </div>
        </Modal>
      ) : null}
      <div className="ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 11.5rem)' }}>
        <table className={`ui-table ui-table-wide ui-table-sticky ${rows.length ? '' : 'cash-bank-empty-table'}`}>
          <thead>
            <tr>
              <th scope="col">Account name</th>
              <th scope="col">Type</th>
              <th scope="col">Bank name</th>
              <th scope="col">Account number</th>
              <th scope="col">Branch</th>
              <th scope="col" className="text-end">Current balance</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-end"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
      title="No accounts here yet"
                    message="A bank or cash account is a ledger under Bank Accounts or Cash-in-Hand. Add one and it appears here with its balance."
                  />
                </td>
              </tr>
            ) : (
              rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    {onOpenAccount ? (
                      <button
                        type="button"
                        onClick={() => onOpenAccount(a.id)}
                        className="text-start underline-offset-2 hover:underline"
                        style={{ color: 'rgb(var(--brand-ink))' }}
                      >
                        {a.name}
                      </button>
                    ) : (
                      a.name
                    )}
                  </td>
                  <td>
                    <StatusPill status={a.type} />
                  </td>
                  <td>{a.bankName || '—'}</td>
                  {/* An account number is read digit by digit against a
                      cheque book, so it is set in the same face as the money. */}
                  <td className="ui-mono">{a.accountNumber || '—'}</td>
                  <td>{a.branch || '—'}</td>
                  <td className="ui-money">{formatMoney(a.balance, currentCompany)}</td>
                  <td>
                    <StatusPill status={a.isActive ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      ref={String(menuFor) === String(a.id) ? menuBtnRef : undefined}
                      onClick={(e) => {
                        menuBtnRef.current = e.currentTarget;
                        setMenuFor((cur) => (String(cur) === String(a.id) ? null : a.id));
                      }}
                      className="ui-icon-btn !h-8 !w-8"
                      aria-label={`Actions for ${a.name}`}
                      aria-haspopup="menu"
                      aria-expanded={String(menuFor) === String(a.id)}
                    >
                      <MoreVertical size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {menuFor !== null ? (() => {
        const row = accounts.find((a) => String(a.id) === String(menuFor));
        if (!row) return null;
        const items = [
          onOpenAccount
            ? { key: 'open', label: 'Open ledger', onSelect: () => onOpenAccount(row.id) }
            : null,
          onEditAccount
            ? { key: 'edit', label: 'Edit account', onSelect: () => onEditAccount(row.id) }
            : null,
          setDb
            ? {
                key: 'active',
                label: row.isActive ? 'Mark inactive' : 'Mark active',
                onSelect: () => setAccountActive(row.id, !row.isActive),
              }
            : null,
        ].filter(Boolean);
        return (
          <Popover anchorRef={menuBtnRef} onClose={() => setMenuFor(null)} minWidth={200}>
            <div className="py-1" role="menu">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuFor(null);
                    item.onSelect();
                  }}
                  className="ui-hover-sunken block w-full px-3 py-2 text-left text-sm"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </Popover>
        );
      })() : null}
    </DocumentListShell>
  );
}
