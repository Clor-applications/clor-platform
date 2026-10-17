import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { formatDateIn } from '@ui/utils/dates';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  approveSettlement,
  cancelSettlement,
  listSettlements,
  markSettlementPaid,
  recalculateSettlement,
  startSettlement,
  updateSettlement,
} from '../api/payrollSettlements';

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

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const netOf = (lines) => lines.reduce((t, l) => t + (l.kind === 'EARNING' ? Number(l.amount) || 0 : l.kind === 'DEDUCTION' ? -(Number(l.amount) || 0) : 0), 0);

/**
 * Full and final settlement for people who have left: gratuity, leave
 * encashment, loans still owed and notice pay, proposed from the records and
 * checked by HR line by line. Due within two working days of the leaving date.
 */
export default function FinalSettlements() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);

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

  return (
    <div className="space-y-6">
      <PageHeader
        entity="payroll"
        title="Full & final"
        description="What is still owed to, or by, people who have left. Due within two working days of their last day."
      />
      {error ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="alert">
          <span style={{ color: 'rgb(var(--neg))' }}>{error}</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={load}>Try again</button>
        </div>
      ) : null}
      {!data ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <>
          {data.waiting.length ? (
            <div className="ui-card overflow-hidden">
              <div className="ui-sec-head px-4 pt-4">Leaving, not settled yet</div>
              <div className="overflow-x-auto ui-table-scroll ui-table-fit">
                <table className="ui-table w-full">
                  <thead>
                    <tr>
                      <th scope="col" className="ui-th">Employee</th>
                      <th scope="col" className="ui-th">Last day</th>
                      <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.waiting.map((p) => (
                      <tr key={p.id}>
                        <td className="ui-col-entity">
                          {p.name}
                          {p.code ? <span className="ui-caption"> · {p.code}</span> : null}
                        </td>
                        <td className="whitespace-nowrap text-sm">
                          {formatDateIn(p.dateOfLeaving)}
                          {p.status === 'ON_NOTICE' ? <span className="ui-caption block">on notice</span> : null}
                        </td>
                        <td className="whitespace-nowrap text-end">
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === p.id} onClick={() => start(p)}>
                            <Plus size={14} aria-hidden="true" /> Work it out
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!data.settlements.length ? (
            <EmptyState
              title="No settlements yet"
              description={data.waiting.length ? 'Start with somebody above.' : 'Set a date of leaving on an employee and they appear here.'}
            />
          ) : (
            <div className="ui-card overflow-hidden">
              <div className="ui-sec-head px-4 pt-4">Settlements</div>
              <div className="overflow-x-auto ui-table-scroll ui-table-fit">
                <table className="ui-table w-full">
                  <thead>
                    <tr>
                      <th scope="col" className="ui-th">Employee</th>
                      <th scope="col" className="ui-th">Last day</th>
                      <th scope="col" className="ui-th">Due</th>
                      <th scope="col" className="ui-th ui-col-h-amount">Net</th>
                      <th scope="col" className="ui-th ui-col-h-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.settlements.map((s) => (
                      <tr key={s.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                        <td className="ui-col-entity">
                          <button type="button" className="text-start" onClick={() => setOpen(s)}>
                            {s.employeeName || '—'}
                            {s.employeeCode ? <span className="ui-caption"> · {s.employeeCode}</span> : null}
                          </button>
                        </td>
                        <td className="whitespace-nowrap text-sm">{formatDateIn(s.leavingDate)}</td>
                        <td className="whitespace-nowrap text-sm">
                          {formatDateIn(s.dueDate)}
                          {s.overdue ? <span className="ui-pill ui-pill-neg ms-2">Overdue</span> : null}
                        </td>
                        <td className="ui-col-amount">{money(s.netPayable)}</td>
                        <td className="ui-col-h-center">
                          <span className={`ui-pill ${STATUS[s.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[s.status]?.label || s.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {open ? <Settlement key={`${open.id}:${open.updatedAt}`} settlement={open} onClose={() => setOpen(null)} onChanged={changed} /> : null}
    </div>
  );
}

function Settlement({ settlement, onClose, onChanged }) {
  const [lines, setLines] = useState(settlement.lines);
  const [notes, setNotes] = useState(settlement.notes || '');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = settlement.status === 'DRAFT';
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
  const approve = async () => {
    const ok = await confirmDialog({
      title: `Approve ${money(settlement.netPayable)} for ${settlement.employeeName || 'them'}?`,
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
      widthClass="w-[min(48rem,96vw)]"
      title={`Full & final · ${settlement.employeeName || ''}`}
      description={`Last day ${formatDateIn(settlement.leavingDate)} · due ${formatDateIn(settlement.dueDate)}${settlement.overdue ? ' · overdue' : ''}`}
      actions={
        draft ? (
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
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => run(() => markSettlementPaid(settlement.id, reference || null), 'Marked paid.')}>
              Mark paid
            </button>
          </>
        ) : null
      }
    >
      <div className="space-y-6">
        <div className="overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Item</th>
                <th scope="col" className="ui-th">Kind</th>
                <th scope="col" className="ui-th ui-col-h-amount">Amount</th>
                {draft ? <th scope="col" className="ui-th"><span className="sr-only">Remove</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {draft ? (
                      <input className="ui-input w-full" aria-label="Item" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} />
                    ) : (
                      <span className="text-sm">{l.label}</span>
                    )}
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
            Paid {formatDateIn(String(settlement.paidAt).slice(0, 10))}
            {settlement.paidReference ? ` · ${settlement.paidReference}` : ''}
          </p>
        ) : null}
        <p className="ui-caption">
          Gratuity, encashment and recovery are proposals from the records. Check them against your policy and the law in force before approving; the salary for the last
          month is paid by that month's pay run.
        </p>
      </div>
    </Drawer>
  );
}
