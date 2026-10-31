import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Handshake, PauseCircle, Plus, RotateCcw, Trash2, UserMinus, Wallet } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SuggestInput from '@ui/components/ui/SuggestInput';
import Drawer from '@ui/components/ui/Drawer';
import { formatDateIn } from '@ui/utils/dates';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  approveSettlement,
  cancelSettlement,
  closeSettlementSources,
  listSettlements,
  markSettlementPaid,
  recalculateSettlement,
  releaseSettlementHold,
  startSettlement,
  updateSettlement,
} from '../api/payrollSettlements';
import LoadFailed from '../components/LoadFailed';

const STATUS = {
  DRAFT: { label: 'Draft', pill: 'ui-pill-neutral' },
  APPROVED: { label: 'Approved', pill: 'ui-pill-warn' },
  PAID: { label: 'Paid', pill: 'ui-pill-pos' },
};
const KINDS = [
  { id: 'EARNING', label: 'Pay' },
  { id: 'DEDUCTION', label: 'Recover' },
  { id: 'INFO', label: 'Note' },
];

const money = (n) => `${Number(n) < 0 ? '− ' : ''}₹${Math.abs(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
/* Where a line comes from, in words: the record paying it closes. */
const SOURCE_WORDS = { LOAN: 'Payroll loan', ADVANCE: 'Expense advance in People', CLAIM: 'Expense claim in People', CARRY: 'Waiting in Payroll' };
const sourceWords = (s) => {
  if (!s) return '';
  if (s.type === 'CARRY') return s.advanceId && s.ref ? `Advance ${s.ref}, waiting in Payroll` : SOURCE_WORDS.CARRY;
  return `${SOURCE_WORDS[s.type] || 'Record'}${s.ref ? ` ${s.ref}` : ''}`;
};
const closedInPeople = (s) => s === 'ADVANCE' || s === 'CLAIM';
/* A loan, an expense advance or a recovery waiting in Payroll, coming off the final pay (held to the share of final wages). */
const isRecovery = (l) => l.kind === 'DEDUCTION' && ['LOAN', 'ADVANCE', 'CARRY'].includes(l.source?.type);
/* "₹4,000 of ₹6,000 recovered here; ₹2,000 stays owed." on a recovery the limit or HR left part of. */
const heldWords = (l) => {
  const due = Number(l.recover?.due);
  if (!isRecovery(l) || !(due > 0) || due - Number(l.amount) < 0.005) return null;
  const why = Number(l.recover.capped) > 0.005 ? ' The limit on recovery holds it back.' : '';
  return `${money(l.amount)} of ${money(due)} recovered here; ${money(due - Number(l.amount))} stays owed.${why}`;
};
const netOf = (lines) => lines.reduce((t, l) => t + (l.kind === 'EARNING' ? Number(l.amount) || 0 : l.kind === 'DEDUCTION' ? -(Number(l.amount) || 0) : 0), 0);

/**
 * Full and final settlement for people who have left: gratuity, leave
 * encashment, loans still owed and notice pay, proposed from the records and
 * checked by HR line by line. Due within two working days of the leaving date.
 */
const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'DRAFT', label: 'Draft', tone: 'outstanding' },
  { value: 'APPROVED', label: 'Approved', tone: 'sent' },
  { value: 'PAID', label: 'Paid', tone: 'paid' },
  { value: 'HELD', label: 'Held', tone: 'outstanding' },
];
const inTabOf = (x, status) => !status || (status === 'HELD' ? Boolean(x.hold) : x.status === status);
const COLUMNS = {
  employee: (s) => s.employeeName || '—',
};
const EXPORT_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Code' },
  { key: 'leavingDate', label: 'Last day' },
  { key: 'dueDate', label: 'Due' },
  { key: 'netPayable', label: 'Net', value: (s) => Number(s.netPayable || 0) },
  { key: 'status', label: 'Status', value: (s) => STATUS[s.status]?.label || s.status },
  { key: 'held', label: 'Held', value: (s) => (s.hold ? 'Yes' : '') },
  { key: 'overdue', label: 'Overdue', value: (s) => (s.overdue ? 'Yes' : '') },
];

export default function FinalSettlements() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    listSettlements()
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load settlements.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const start = async (person) => {
    setBusy(person.id);
    try {
      const s = await startSettlement(person.id);
      load();
      setOpen(s);
    } catch (e) {
      notify.error(String(e?.message || 'Could not start it.'));
    } finally {
      setBusy('');
    }
  };

  const changed = (s) => {
    load();
    setOpen(s && s.status !== 'CANCELLED' ? s : null);
  };

  const settlements = useMemo(() => data?.settlements || [], [data]);
  const waiting = data?.waiting || [];
  const counts = useMemo(() => {
    const n = (st) => settlements.filter((x) => x.status === st).length;
    return { '': settlements.length, DRAFT: n('DRAFT'), APPROVED: n('APPROVED'), PAID: n('PAID'), HELD: settlements.filter((x) => x.hold).length };
  }, [settlements]);
  const figures = useMemo(
    () => ({
      overdue: settlements.filter((x) => x.overdue && x.status !== 'PAID').length,
      toPay: settlements.filter((x) => x.status === 'APPROVED' && !x.hold).reduce((a, x) => a + Number(x.netPayable || 0), 0),
    }),
    [settlements]
  );
  const inTab = useMemo(() => settlements.filter((x) => inTabOf(x, status)), [settlements, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  return (
    <div className="ui-touch-44">
    <DocumentListShell
      entity="settlement"
      title="Full & final"
      description="What is still owed to, or by, people who have left. Due within two working days of their last day."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search settlements' }}
      moreItems={settlements.length ? [exportMenuItem('Export settlements')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Full & final settlements', fileName: 'Full and final settlements', label: 'settlement/settlements', columns: EXPORT_COLUMNS, rows });
      }}
      cards={[
        { label: 'Not started', value: waiting.length, count: true, tone: 'partial', Icon: UserMinus },
        { label: 'Overdue', value: figures.overdue, count: true, tone: 'overdue', Icon: AlertTriangle },
        { label: 'To pay', value: figures.toPay, tone: 'sent', Icon: Wallet, onSelect: () => setStatus('APPROVED') },
        { label: 'Paid', value: counts.PAID, count: true, tone: 'paid', Icon: Check, onSelect: () => setStatus('PAID') },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Settlement status"
      above={
        waiting.length ? (
          <section className="ui-card overflow-hidden" aria-labelledby="ff-waiting-h">
            <h2 id="ff-waiting-h" className="ui-sec-head px-4 pt-3">Leaving, not settled yet</h2>
            <div className="ui-table-scroll">
              <table className="ui-table ui-table-sticky w-full">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Last day</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {waiting.map((p) => (
                    <tr key={p.id}>
                      <td className="ui-col-entity">
                        {p.name}
                        {p.code ? <span className="ui-caption"> · {p.code}</span> : null}
                      </td>
                      <td className="ui-col-date whitespace-nowrap">
                        {formatDateIn(p.dateOfLeaving)}
                        {p.status === 'ON_NOTICE' ? <span className="ui-caption block">on notice</span> : null}
                        {p.held ? <span className="ui-pill ui-pill-info ms-2">Held</span> : null}
                      </td>
                      <td className="whitespace-nowrap text-end">
                        {data?.you?.selfEmployeeId === p.id ? (
                          <span className="ui-caption">Yours: another approver works it out</span>
                        ) : (
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === p.id} onClick={() => start(p)}>
                            <Plus size={14} aria-hidden="true" /> Work it out
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <th scope="col">Last day</th>
                <th scope="col">Due</th>
                <th scope="col" className="ui-num">Net</th>
                <th scope="col" className="ui-col-h-center">Status</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={5}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No settlements match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Handshake}
                        title={status === 'HELD' ? 'Nothing on hold' : status ? `No ${STATUS[status]?.label.toLowerCase()} settlements` : 'No settlements yet'}
                        description={waiting.length ? 'Start with somebody above.' : 'Set a date of leaving on an employee and they appear here.'}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((x) => (
                  <tr key={x.id} className="ui-row-click" onClick={() => setOpen(x)}>
                    <td className="ui-col-entity">
                      {x.employeeName || '—'}
                      {x.employeeCode ? <span className="ui-caption"> · {x.employeeCode}</span> : null}
                    </td>
                    <td className="ui-col-date whitespace-nowrap">{formatDateIn(x.leavingDate)}</td>
                    <td className="ui-col-date whitespace-nowrap">
                      {formatDateIn(x.dueDate)}
                      {x.overdue && x.status !== 'PAID' ? <span className="ui-pill ui-pill-neg ms-2">Overdue</span> : null}
                    </td>
                    <td className="ui-num">{money(x.netPayable)}</td>
                    <td className="ui-col-h-center">
                      {x.hold ? <span className="ui-pill ui-pill-info">Held</span> : <span className={`ui-pill ${STATUS[x.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[x.status]?.label || x.status}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {open ? <Settlement key={`${open.id}:${open.updatedAt}`} settlement={open} you={data?.you} onClose={() => setOpen(null)} onChanged={changed} /> : null}
    </DocumentListShell>
    </div>
  );
}

/** The India day of a moment: a hold made at 01:50 IST on 31 Oct is held since 31 Oct, not the UTC 30th. */
const indiaDay = (iso) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

const OWN_WORDS = 'This is your own full and final. Another HR or payroll approver, or the owner, works it out, approves and pays it.';

function Settlement({ settlement, you, onClose, onChanged }) {
  const [lines, setLines] = useState(settlement.lines);
  const [notes, setNotes] = useState(settlement.notes || '');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  /* Your own: shown, never worked out, approved or paid by you (the server refuses too). */
  const own = Boolean(you?.selfEmployeeId) && settlement.employeeId === you.selfEmployeeId;
  const draft = settlement.status === 'DRAFT' && !own;
  const dirty = JSON.stringify(lines) !== JSON.stringify(settlement.lines) || notes !== (settlement.notes || '');

  const setLine = (i, patch) => setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const run = async (fn, done) => {
    setBusy(true);
    try {
      const s = await fn();
      if (done) notify.success(done);
      onChanged(s);
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => updateSettlement(settlement.id, { lines: lines.map((l) => ({ ...l, amount: Number(l.amount) || 0 })), notes }), 'Saved.');
  /* Owed to them, or owed by them: said in words, never as a minus sign (QA of #82, F7). */
  const who = settlement.employeeName || 'They';
  const net = Number(settlement.netPayable || 0);
  const owesWords = net < 0 ? `${who} owes ${money(-net)}` : net > 0 ? `${money(net)} to pay ${who}` : `Nothing either way for ${who}`;
  const approve = async () => {
    const ok = await confirmDialog({
      title: `${owesWords}. Approve this settlement?`,
      message: 'Check each line against your policy and the law first. An approved settlement can no longer be changed.',
      confirmLabel: 'Approve',
      tone: 'default',
    });
    if (ok) run(() => approveSettlement(settlement.id), 'Approved.');
  };
  const cancel = async () => {
    const ok = await confirmDialog({ title: 'Cancel this settlement?', message: 'You can work it out again afterwards.', confirmLabel: 'Cancel settlement' });
    if (ok) run(() => cancelSettlement(settlement.id), 'Cancelled.');
  };

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(48rem,96vw)] ui-touch-44"
      title={`Full & final · ${settlement.employeeName || ''}`}
      description={`Last day ${formatDateIn(settlement.leavingDate)} · due ${formatDateIn(settlement.dueDate)}${settlement.overdue ? ' · overdue' : ''}`}
      actions={
        own ? null : draft ? (
          <>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={cancel}>Cancel settlement</button>
            {dirty ? (
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={save}>Save</button>
            ) : (
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={approve}>
                <Check size={14} aria-hidden="true" /> Approve
              </button>
            )}
          </>
        ) : settlement.status === 'APPROVED' ? (
          <>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={cancel}>Cancel settlement</button>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={busy || Boolean(settlement.hold)}
              title={settlement.hold ? 'Held: lift the hold first' : undefined}
              onClick={async () => {
                /* Money moves on this: asked first (DESIGN.md). */
                const ok = await confirmDialog({
                  title: net < 0 ? `Mark ${money(-net)} received from ${who}?` : `Mark ${money(net)} paid to ${who}?`,
                  message: 'This closes the loans, advances and claims it settles. It cannot be undone here.',
                  confirmLabel: net < 0 ? 'Mark received' : 'Mark paid',
                  tone: 'default',
                });
                if (ok) run(() => markSettlementPaid(settlement.id, reference || null), 'Marked paid.');
              }}
            >
              Mark paid
            </button>
          </>
        ) : null
      }
    >
      <div className="space-y-4">
        {own ? <p className="ui-caption" role="note">{OWN_WORDS}</p> : null}
        {settlement.hold ? <HoldPanel settlement={settlement} busy={busy} run={run} stepUp={Boolean(you?.stepUp)} canLift={!own && you?.liftHold !== false} whyNot={own ? 'This is your own hold. Another HR user or the owner lifts it.' : you?.liftHoldWhy} /> : null}
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Kind</th>
                <th scope="col" className="ui-col-h-right">Amount</th>
                {draft ? <th scope="col"><span className="sr-only">Remove</span></th> : null}
              </tr>
            </thead>
            <tbody className="ui-rows">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {draft ? (
                      <input className="ui-input w-full" aria-label="Item" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} />
                    ) : (
                      <span className="text-sm">{l.label}</span>
                    )}
                    {l.source ? <span className="ui-caption block mt-1">From: {sourceWords(l.source)}</span> : null}
                    {heldWords(l) ? <span className="ui-caption block mt-1">{heldWords(l)}</span> : null}
                    {l.explanation ? <span className="ui-caption block mt-1">{l.explanation}</span> : null}
                  </td>
                  <td className="whitespace-nowrap">
                    {draft ? (
                      <select className="ui-select w-28" aria-label="Kind" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })}>
                        {KINDS.map((k) => (
                          <option key={k.id} value={k.id}>{k.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm">{KINDS.find((k) => k.id === l.kind)?.label}</span>
                    )}
                  </td>
                  <td className="ui-col-amount">
                    {draft && l.kind !== 'INFO' ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="ui-input ui-num w-32"
                        aria-label="Amount"
                        value={l.amount}
                        onChange={(e) => setLine(i, { amount: e.target.value })}
                      />
                    ) : l.kind === 'INFO' ? (
                      '—'
                    ) : (
                      `${l.kind === 'DEDUCTION' ? '− ' : ''}${money(l.amount)}`
                    )}
                  </td>
                  {draft ? (
                    <td className="text-end">
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${l.label}`} onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              <tr>
                <td className="font-semibold" colSpan={2}>Net payable</td>
                <td className="ui-col-amount font-semibold">{money(netOf(lines))}</td>
                {draft ? <td /> : null}
              </tr>
            </tbody>
          </table>
        </div>
        {lines.some(isRecovery) ? <RecoveryCap settlement={settlement} who={who} unsaved={dirty} /> : null}

        {draft ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={() => setLines((all) => [...all, { code: `OTHER_${all.length + 1}`, label: '', kind: 'EARNING', amount: 0, explanation: '' }])}
            >
              <Plus size={14} aria-hidden="true" /> Add a line
            </button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => run(() => recalculateSettlement(settlement.id), 'Worked out again from the records.')}>
              <RotateCcw size={14} aria-hidden="true" /> Work out again
            </button>
          </div>
        ) : null}

        <div>
          <label className="ui-label" htmlFor="ff-notes">Notes</label>
          <textarea id="ff-notes" className="ui-input w-full" rows={3} value={notes} disabled={!draft} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {settlement.status === 'APPROVED' ? (
          <div>
            <label className="ui-label" htmlFor="ff-ref">Payment reference</label>
            <input id="ff-ref" className="ui-input w-full" placeholder="UTR or cheque number" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        ) : null}
        {settlement.status === 'PAID' ? (
          <p className="ui-caption">
            Paid {formatDateIn(indiaDay(settlement.paidAt))}
            {settlement.paidReference ? ` · ${settlement.paidReference}` : ''}
          </p>
        ) : null}
        {/* Paid, but People did not take the update: the advances and claims still read as open until this is finished. */}
        {settlement.status === 'PAID' && !settlement.sourcesClosedAt && lines.some((l) => closedInPeople(l.source?.type)) ? (
          <div className="flex flex-wrap items-center gap-3" role="status">
            <p className="ui-caption min-w-0 flex-1">The advances and claims this settled are still open in People.</p>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => run(() => closeSettlementSources(settlement.id), 'Closed in People.')}>
              Close them now
            </button>
          </div>
        ) : null}
        <p className="ui-caption">
          Gratuity, encashment and recovery are proposals from the records. Check them against your policy and the law in force before approving; the salary for the last
          month is paid by that month's pay run.
        </p>
      </div>
    </Drawer>
  );
}

/**
 * Loans and advances held to the company's share of the final wages (Code on
 * Wages 2019 s.18(3); owner, 31 Oct 2026), in figures and words: what could
 * come off, what did, and what stays owed by the person. A settlement made
 * before the limit says how to apply it.
 */
function RecoveryCap({ settlement, who, unsaved }) {
  const cap = settlement.recoveryCap;
  if (!cap) {
    if (settlement.status === 'PAID') return null;
    return (
      <p className="ui-caption max-w-[65ch]" role="note">
        Worked out before loans and advances were held to a share of the final wages.{' '}
        {settlement.status === 'DRAFT' ? 'Save it or work it out again to apply the limit.' : 'If it recovers more than the limit allows, cancel it and work it out again.'}
      </p>
    );
  }
  const rows = [
    { label: 'Final wages', value: cap.finalWages, note: cap.slip ? `Days worked ${money(cap.slip.wages)}${cap.slip.ref ? ` (payslip ${cap.slip.ref})` : ''}, with notice pay, leave encashment and other earnings here` : 'Notice pay, leave encashment and other earnings here' },
    { label: `Most that can be recovered (${cap.percent}%)`, value: cap.limit },
    ...(cap.otherDeductions > 0 ? [{ label: 'Other deductions, taken first', value: -cap.otherDeductions, note: cap.slip?.deducted > 0 ? `Includes ${money(cap.slip.deducted)} already taken on the payslip` : null }] : []),
    { label: 'Loans and advances owed', value: cap.due },
    { label: 'Recovered here', value: cap.recovered, strong: true },
    { label: `Stays owed by ${who}`, value: cap.owed, strong: true },
  ];
  return (
    <section className="space-y-2" aria-labelledby="ff-cap-h">
      <h3 id="ff-cap-h" className="text-sm font-medium">Loans and advances</h3>
      <dl className="max-w-[32rem] text-sm divide-y">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 py-1.5">
            <dt className={r.strong ? 'font-medium' : undefined}>
              {r.label}
              {r.note ? <span className="ui-caption block">{r.note}</span> : null}
            </dt>
            <dd className={`ui-num tabular-nums text-right whitespace-nowrap${r.strong ? ' font-medium' : ''}`}>{money(r.value)}</dd>
          </div>
        ))}
      </dl>
      {unsaved ? <p className="ui-caption" role="status">Save to see the limit worked out on your changes.</p> : null}
      {!cap.slip && settlement.status === 'DRAFT' ? (
        <p className="ui-caption max-w-[65ch]">Salary for days worked counts once the leaving month's payroll is approved. Work it out again then.</p>
      ) : null}
      <p className="ui-caption max-w-[65ch]">
        Loans and advances come off the final pay up to {cap.percent}% of the final wages (Code on Wages 2019, s.18(3)); gratuity and reimbursements never count.{' '}
        {cap.owed > 0
          ? `The ${money(cap.owed)} left is not written off: it stays on the loan or advance, shown in People, and HR collects it outside payroll.`
          : 'Nothing is left owed.'}
      </p>
    </section>
  );
}

/**
 * An absconding case holds this settlement. Paying waits until the hold is
 * lifted, with a reason; the same release HR makes in People, recorded there
 * and here. A hold only pauses payment.
 */
function HoldPanel({ settlement, busy, run, canLift = true, whyNot, stepUp = false }) {
  const [reason, setReason] = useState('');
  const why = reason.trim();
  return (
    <section className="space-y-3" aria-labelledby="ff-hold-h">
      <div className="flex items-start gap-2">
        <PauseCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--info))' }} />
        <div className="min-w-0">
          <h3 id="ff-hold-h" className="text-sm font-medium">
            Held{settlement.hold.since ? ` since ${formatDateIn(indiaDay(settlement.hold.since))}` : ''}
          </h3>
          {settlement.hold.reason ? <p className="ui-caption">{settlement.hold.reason}</p> : null}
        </div>
      </div>
      <p className="ui-caption max-w-[65ch]">
        Nothing is forfeited. Earned wages stay owed, and the law gives no right to keep them back. Once you end their employment, wages are due within two working days (Code on Wages 2019, s.17(2)), so take advice before holding longer.
      </p>
      {/* Who may lift it, and what they will be asked (QA of #82, F8). */}
      <p className="ui-caption max-w-[65ch]">
        HR with People edit and Payroll approval, or the owner, lifts it with a reason; never the person held. {stepUp ? 'They are asked for their authenticator code.' : 'Where the company asks for authenticator codes on payroll, they enter one.'}
      </p>
      {!canLift ? (
        <p className="ui-caption" role="note">{whyNot || 'You cannot lift this hold.'}</p>
      ) : (
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[14rem] flex-1">
          <span className="ui-label">Why is the hold lifted?</span>
          <SuggestInput value={reason} onChange={setReason} maxLength={300} placeholder="e.g. Came in to settle, 4 Nov" suggestions={[]} />
        </label>
        <button type="button" className="ui-btn ui-btn-secondary" disabled={busy || why.length < 3} onClick={() => run(() => releaseSettlementHold(settlement.id, why), 'Hold lifted.')}>
          Lift the hold
        </button>
      </div>
      )}
    </section>
  );
}
