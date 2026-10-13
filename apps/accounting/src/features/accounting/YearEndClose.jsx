import React, { useMemo, useState } from 'react';
import { Lock, Unlock, CalendarCheck } from 'lucide-react';
import { PageHeader } from '@ui/components/ui/Primitives';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { formatMoney } from '@ui/utils/money';
import { fyRange } from '@ui/utils/tdsTcs';
import { setBookLockOnServer } from '@ui/utils/bookLockSync';

/**
 * Year-end close: the clean cut-over every April.
 *
 * 1. The FY's income and expense totals are computed from documents and
 *    prefill the net profit (editable — the CA may adjust).
 * 2. "Draft closing journal" books P&L → Capital Account.
 * 3. "Lock the year" freezes it: new invoices, bills and journal entries
 *    dated inside a locked period are refused at save time.
 */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const isDateLocked = (db, companyId, date) => {
  const lock = (db?.fyLocks || []).find((l) => l.companyId === companyId);
  return Boolean(lock && String(date || '').slice(0, 10) <= lock.upTo);
};

export default function YearEndClose({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  // The year being closed is the PREVIOUS FY once we're past April, but the
  // operator picks — default to the FY containing "one year ago today".
  const lastYearDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const [fyDate, setFyDate] = useState(lastYearDate);
  const fy = useMemo(() => fyRange(fyDate), [fyDate]);

  const totals = useMemo(() => {
    const inFy = (d) => {
      const x = String(d || '').slice(0, 10);
      return x >= fy.from && x <= fy.to;
    };
    const live = (d) => !['draft', 'cancelled'].includes(String(d.status || '').toLowerCase());
    const income =
      (db.invoices || []).filter((d) => d.companyId === companyId && live(d) && inFy(d.date)).reduce((s, d) => s + num(d.subtotal) + num(d.otherChargesTotal), 0) -
      (db.creditNotes || []).filter((d) => d.companyId === companyId && inFy(d.date)).reduce((s, d) => s + num(d.subtotal), 0);
    const expense =
      (db.bills || []).filter((d) => d.companyId === companyId && live(d) && inFy(d.date)).reduce((s, d) => s + num(d.subtotal), 0) +
      (db.expenses || []).filter((d) => d.companyId === companyId && live(d) && inFy(d.date)).reduce((s, d) => s + num(d.taxableTotal ?? d.subtotal ?? d.amount), 0) -
      (db.debitNotes || []).filter((d) => d.companyId === companyId && inFy(d.date)).reduce((s, d) => s + num(d.subtotal), 0);
    return { income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100 };
  }, [db, companyId, fy]);

  const [netOverride, setNetOverride] = useState('');
  // On by default: a year that carries on from the last one's count is the
  // unusual choice, not the normal one.
  const [restartNumbering, setRestartNumbering] = useState(true);
  const net = netOverride === '' ? Math.round((totals.income - totals.expense) * 100) / 100 : Number(netOverride) || 0;

  const lock = (db.fyLocks || []).find((l) => l.companyId === companyId) || null;
  const money = (v) => formatMoney(Number(v || 0), currentCompany);

  const draftClosingJournal = () => {
    if (!net) {
      notify.error('Net result is zero — nothing to transfer.');
      return;
    }
    const profit = net > 0;
    const amount = Math.abs(net);
    const lines = [
      { accountId: '', accountCode: '', accountName: 'Profit & Loss A/c', debit: profit ? amount : 0, credit: profit ? 0 : amount },
      { accountId: '', accountCode: '', accountName: 'Capital Account', debit: profit ? 0 : amount, credit: profit ? amount : 0 },
    ];
    const nextId = (db.journalEntries || []).reduce((m, j) => Math.max(m, Number(j.id) || 0), 0) + 1;
    setDb((prev) => ({
      ...prev,
      journalEntries: [
        ...(prev.journalEntries || []),
        {
          id: nextId,
          companyId,
          number: `JE-CLOSE-${nextId}`,
          date: fy.to,
          narration: `${fy.label} closing: net ${profit ? 'profit' : 'loss'} transferred to Capital Account`,
          lines,
          totalDebit: amount,
          totalCredit: amount,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    notify.success(`Closing journal JE-CLOSE-${nextId} drafted — net ${profit ? 'profit' : 'loss'} ${money(amount)} to Capital.`);
  };

  const lockYear = async () => {
    const ok = await confirmDialog({
      title: `Lock ${fy.label}`,
      message: `Freeze all books up to ${fy.to}? New invoices, bills and journal entries dated on or before that day will be refused. You can unlock later.`,
      confirmLabel: 'Lock the year',
    });
    if (!ok) return;

    /*
     * The server is what refuses a posting into a closed year. Locked here
     * alone, the year is closed for this browser and open to everybody else.
     */
    if (!(await setBookLockOnServer({ fyDate: fy.to, lockedThrough: fy.to })).ok) return;

    setDb((prev) => {
      const next = {
        ...prev,
        fyLocks: [
          ...(prev.fyLocks || []).filter((l) => l.companyId !== companyId),
          { companyId, upTo: fy.to, lockedAt: new Date().toISOString() },
        ],
      };

      if (!restartNumbering) return next;

      /**
       * A new year starts its documents at one again.
       *
       * Every series keeps the prefix, suffix and width it was already using —
       * the shape of a company's invoice number is its own decision and a year
       * end is no reason to change it — and only the counter goes back to 1.
       * Nothing is renumbered: documents already raised keep the numbers they
       * went out with.
       */
      next.companies = (prev.companies || []).map((c) => {
        if (c.id !== companyId) return c;
        const doc = c?.docSettings && typeof c.docSettings === 'object' ? c.docSettings : {};
        const numbering = doc?.numbering && typeof doc.numbering === 'object' ? doc.numbering : {};
        const restarted = {};
        for (const [key, cfg] of Object.entries(numbering)) {
          restarted[key] = { ...(cfg || {}), nextNumber: 1 };
        }

        // Branch series restart with them, or a branch would carry on from
        // last year's count while head office started again.
        const byBranch = doc?.numberingByBranch && typeof doc.numberingByBranch === 'object' ? doc.numberingByBranch : {};
        const restartedByBranch = {};
        for (const [branchId, cfgs] of Object.entries(byBranch)) {
          const out = {};
          for (const [key, cfg] of Object.entries(cfgs || {})) {
            out[key] = { ...(cfg || {}), nextNumber: 1 };
          }
          restartedByBranch[branchId] = out;
        }

        return {
          ...c,
          docSettings: { ...doc, numbering: restarted, numberingByBranch: restartedByBranch },
        };
      });

      return next;
    });
    notify.success(
      restartNumbering
        ? `Books locked up to ${fy.to}. Numbering restarts at 1 for the new year.`
        : `Books locked up to ${fy.to}.`
    );
  };

  /**
   * Closing a period, which is the same act on a shorter stretch.
   *
   * Reports for August go out on the fifth of September, and from that moment
   * August has to stop moving. Only the year end could be closed before, so
   * the month somebody had just reported stayed open for another seven months.
   * One date shuts everything on or before it, whether that date is the end of
   * a month or the end of a year.
   */
  const [closeUpto, setCloseUpto] = useState(() => {
    const d = new Date();
    // The end of last month — what closing on the fifth actually means.
    const end = new Date(d.getFullYear(), d.getMonth(), 0);
    return end.toISOString().slice(0, 10);
  });

  const closePeriod = async () => {
    const upTo = String(closeUpto || '').slice(0, 10);
    if (!upTo) {
      notify.error('Pick the last date to close.');
      return;
    }
    const ok = await confirmDialog({
      title: `Close books up to ${upTo}`,
      message: `Everything dated on or before ${upTo} is frozen for every user. Documents dated inside it cannot be created, edited or removed until the period is reopened.`,
      confirmLabel: 'Close the books',
    });
    if (!ok) return;
    if (!(await setBookLockOnServer({ fyDate: upTo, lockedThrough: upTo })).ok) return;
    setDb((prev) => ({
      ...prev,
      fyLocks: [
        ...(prev.fyLocks || []).filter((l) => l.companyId !== companyId),
        { companyId, upTo, lockedAt: new Date().toISOString() },
      ],
    }));
    notify.success(`Books closed up to ${upTo}.`);
  };

  const unlockYear = async () => {
    const ok = await confirmDialog({ title: 'Unlock books', message: `Remove the lock at ${lock.upTo}?`, confirmLabel: 'Unlock' });
    if (!ok) return;
    // Reopened on the server first, for the same reason: a year the server
    // still holds shut is shut whatever this screen says.
    if (!(await setBookLockOnServer({ fyDate: lock.upTo, lockedThrough: null })).ok) return;
    setDb((prev) => ({ ...prev, fyLocks: (prev.fyLocks || []).filter((l) => l.companyId !== companyId) }));
    notify.success('Books unlocked.');
  };

  return (
    <div className="space-y-6">
      <PageHeader entity="journal" title="Financial Year" description="Close a month once it has been reported, or a whole year once its result has been transferred to capital. Nothing back-dates into closed books." />

      <div className="ui-card space-y-3 p-4">
        <div>
          <div className="text-sm font-semibold">Close a period</div>
          <div className="ui-caption">
            For sharing last month's reports: close it, and nothing dated inside it can move again until you reopen it.
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="ui-label" htmlFor="close-upto">Close everything up to</label>
            <input
              id="close-upto"
              type="date"
              value={closeUpto}
              onChange={(e) => setCloseUpto(e.target.value)}
              className="ui-input"
            />
          </div>
          {lock ? (
            <>
              <button type="button" onClick={closePeriod} className="ui-btn ui-btn-secondary">
                <Lock size={14} aria-hidden="true" /> Move the close date
              </button>
              <button type="button" onClick={unlockYear} className="ui-btn ui-btn-secondary">
                <Unlock size={14} aria-hidden="true" /> Reopen the books
              </button>
              <span className="ui-badge-warn rounded-full px-2 py-1 text-xs">Closed up to {lock.upTo}</span>
            </>
          ) : (
            <button type="button" onClick={closePeriod} className="ui-btn ui-btn-primary">
              <Lock size={14} aria-hidden="true" /> Close the books
            </button>
          )}
        </div>
      </div>

      <div className="ui-card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="ui-label" htmlFor="yearendclose-close-the-fy-containing">Close the FY containing</label>
          <input id="yearendclose-close-the-fy-containing" type="date" value={fyDate} onChange={(e) => setFyDate(e.target.value)} className="ui-input" />
        </div>
        <div className="pb-2 text-sm font-medium">{fy.label} · {fy.from} → {fy.to}</div>
        {lock ? (
          <div className="pb-2 text-sm">
            <span className="ui-badge-warn rounded-full px-2 py-1 text-xs">Books locked up to {lock.upTo}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="ui-card p-4">
          <div className="ui-caption">Income ({fy.label})</div>
          <div className="ui-money-lg ui-amount-pos">{money(totals.income)}</div>
          <div className="ui-caption mt-0.5">Invoice + other-charge values, net of credit notes.</div>
        </div>
        <div className="ui-card p-4">
          <div className="ui-caption">Expenses</div>
          <div className="ui-money-lg">{money(totals.expense)}</div>
          <div className="ui-caption mt-0.5">Bills + expenses, net of debit notes.</div>
        </div>
        <div className="ui-card p-4">
          <div className="ui-caption">Net {net >= 0 ? 'profit' : 'loss'} to transfer</div>
          <div className={`ui-money-lg ${net >= 0 ? 'ui-amount-pos' : 'ui-amount-neg'}`}>{money(Math.abs(net))}</div>
          <input
            type="number"
            step="0.01"
            value={netOverride}
            onChange={(e) => setNetOverride(e.target.value)}
            className="ui-input mt-1 w-40 px-2 text-sm ui-ctl-compact"
            placeholder="Override (CA adjusted)"
          />
        </div>
      </div>

      <div className="ui-card space-y-3 p-5">
        <div className="text-sm font-semibold">Close-out steps</div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Book depreciation first (Fixed Assets → Draft depreciation journal), then any CA adjustments as journal entries.
          </li>
          <li>
            <button type="button" onClick={draftClosingJournal} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
              <CalendarCheck size={14} aria-hidden="true" /> Draft closing journal ({money(Math.abs(net))})
            </button>
            <span className="ui-muted ml-2">P&amp;L → Capital Account, dated {fy.to}.</span>
          </li>
          <li>
            {lock ? (
              <button type="button" onClick={unlockYear} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                <Unlock size={14} aria-hidden="true" /> Unlock books
              </button>
            ) : (
              <button type="button" onClick={lockYear} className="ui-btn ui-btn-primary ui-btn-sm text-xs">
                <Lock size={14} aria-hidden="true" /> Lock the year (freeze up to {fy.to})
              </button>
            )}
            <span className="ui-muted ml-2">New documents dated inside a locked period are refused.</span>
            {lock ? null : (
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={restartNumbering}
                  onChange={(e) => setRestartNumbering(e.target.checked)}
                />
                Restart every numbering series at 1 for the new year, keeping each prefix and width
              </label>
            )}
          </li>
        </ol>
      </div>
    </div>
  );
}
