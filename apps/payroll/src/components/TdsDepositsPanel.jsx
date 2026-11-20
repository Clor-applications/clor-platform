import React, { useCallback, useEffect, useState } from 'react';
import { fyLabel } from '@ui/picks/round34';
import { Plus, Receipt, Trash2 } from '@ui/components/ui/lineIcons';
import Drawer from '@ui/components/ui/Drawer';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { formatDateIn } from '@ui/utils/dates';
import { wholeRupees as money, moneyCell } from '@ui/utils/money';
import { addTdsChallan, getTdsChallans, removeTdsChallan } from '../api/payrollReports';
import { leftWords } from './filingChecks';
import { errorWords } from '@ui/utils/errorWords';

/**
 * Salary TDS deposits (round 27 pick): a row per month of the year with the
 * tax deducted, the challans paid against it and what is left, each with
 * "Add challan". The 24Q download carries each month's BSR code, serial and
 * date from here.
 */
export default function TdsDepositsPanel({ fy }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(true)}>
        <Receipt size={14} aria-hidden="true" /> TDS deposits
      </button>
      {open ? <Panel fy={fy} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthWords = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function Panel({ fy, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');

  const load = useCallback(() => {
    getTdsChallans(fy)
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load the deposits')));
  }, [fy]);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (c) => {
    const ok = await confirmDialog({ title: 'Remove this challan?', message: `Challan ${c.bsrCode} / ${c.challanSerial} of ${formatDateIn(c.depositDate)} comes off ${monthWords(c.month)}.`, confirmLabel: 'Remove challan', tone: 'danger' });
    if (!ok) return;
    try {
      await removeTdsChallan(c.id);
      notify.success('Challan removed.');
      load();
    } catch (e) {
      notify.error(errorWords(e, 'remove that challan'));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(48rem,96vw)]"
      title={`TDS deposits · ${fyLabel(fy)}`}
      description="Salary tax deducted each month, and the challans that paid it in. Due by the 7th of the next month; March's by 30 April."
    >
      {error ? <p className="ui-caption" role="alert">{error}</p> : null}
      {!data && !error ? <SkeletonCard lines={6} /> : null}
      {data ? (
        <div className="space-y-3">
          <p className="ui-caption">
            Deducted {money(data.totals.tds)} · deposited {money(data.totals.deposited)}
            {data.totals.left > 0 ? ` · ${money(data.totals.left)} still to deposit` : ''}
          </p>
          <div className="ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="ui-col-h-right">Deducted</th>
                  <th scope="col" className="ui-col-h-right">Deposited</th>
                  <th scope="col" className="ui-col-h-right">Left</th>
                  <th scope="col" className="ui-col-h-center">Due</th>
                  <th scope="col"><span className="sr-only">Challans</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {data.months.map((m) => (
                  <React.Fragment key={m.month}>
                    <tr>
                      <td className="ui-col-meta">{monthWords(m.month)}</td>
                      <td className="ui-col-amount">{m.tds ? money(m.tds) : '—'}</td>
                      <td className="ui-col-amount">{m.deposited ? money(m.deposited) : '—'}</td>
                      <td className="ui-col-amount">
                        {m.left ? money(Math.abs(m.left)) : '—'}
                        {m.left ? <span className="ui-caption block">{leftWords(m.left)}</span> : null}
                      </td>
                      <td className="ui-col-date ui-col-h-center">
                        {formatDateIn(m.due)}
                        {m.late ? <span className="ui-pill ui-pill-warn ml-1">Late</span> : null}
                      </td>
                      <td className="text-right">
                        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setAdding(adding === m.month ? '' : m.month)} aria-expanded={adding === m.month}>
                          <Plus size={14} aria-hidden="true" /> Add challan
                        </button>
                      </td>
                    </tr>
                    {m.challans.map((c) => (
                      <tr key={c.id} className="ui-tds-challan-row">
                        <td colSpan={2} className="ui-caption">
                          <span className="ui-mono">{c.bsrCode} / {c.challanSerial}</span> · paid {formatDateIn(c.depositDate)}
                        </td>
                        <td className="ui-col-amount">{moneyCell(c.amount)}</td>
                        <td colSpan={2} />
                        <td className="text-right">
                          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => remove(c)} aria-label={`Remove challan ${c.challanSerial}`}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {adding === m.month ? (
                      <tr>
                        <td colSpan={6}>
                          <ChallanForm
                            fy={fy}
                            month={m.month}
                            amount={m.left > 0 ? m.left : ''}
                            onCancel={() => setAdding('')}
                            onSaved={() => {
                              setAdding('');
                              load();
                            }}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function ChallanForm({ fy, month, amount, onCancel, onSaved }) {
  const [form, setForm] = useState({ bsrCode: '', challanSerial: '', depositDate: '', amount: amount === '' ? '' : String(amount) });
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const id = `challan-${month}`;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await addTdsChallan({ financialYear: fy, month, ...form, amount: Number(form.amount) });
      notify.success(`Challan added to ${monthWords(month)}.`);
      onSaved();
    } catch (err) {
      notify.error(errorWords(err, 'add that challan'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2" aria-label={`Add a challan for ${monthWords(month)}`}>
      <div>
        <label className="ui-label" htmlFor={`${id}-bsr`}>BSR code</label>
        <input id={`${id}-bsr`} className="ui-input ui-mono w-full" inputMode="numeric" maxLength={7} required value={form.bsrCode} onChange={(e) => set({ bsrCode: e.target.value.replace(/\D/g, '') })} />
      </div>
      <div>
        <label className="ui-label" htmlFor={`${id}-serial`}>Challan serial</label>
        <input id={`${id}-serial`} className="ui-input ui-mono w-full" inputMode="numeric" maxLength={5} required value={form.challanSerial} onChange={(e) => set({ challanSerial: e.target.value.replace(/\D/g, '') })} />
      </div>
      <div>
        <label className="ui-label" htmlFor={`${id}-date`}>Paid on</label>
        <input id={`${id}-date`} type="date" className="ui-input w-full" required min={`${month}-01`} value={form.depositDate} onChange={(e) => set({ depositDate: e.target.value })} />
      </div>
      <div>
        <label className="ui-label" htmlFor={`${id}-amount`}>Amount</label>
        <input id={`${id}-amount`} className="ui-input w-full tabular-nums text-right" inputMode="decimal" required value={form.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} />
      </div>
      <div className="col-span-2 sm:col-span-4 flex justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Add challan'}</button>
      </div>
    </form>
  );
}
