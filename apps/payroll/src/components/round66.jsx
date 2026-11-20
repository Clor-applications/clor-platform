import React, { useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { wholeRupees as money } from '@ui/utils/money';
import { holdable, latePayNote } from '@ui/picks/round66';
import { holdSlipPay, releaseSlipPay } from '../api/payrollPayments';
import { errorWords } from '@ui/utils/errorWords';

const PAYING = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];

/** Round 66 "payontime": a payroll paid after the 7th of the next month says so. */
export function LatePayNote({ run }) {
  const words = latePayNote(run);
  if (!words || run?.status === 'CANCELLED') return null;
  return <p role="note" className="ui-caption ui-text-warn">{words}</p>;
}

/**
 * Round 66 "holdpay": hold one person's salary with a reason. The payslip stays;
 * the bank file leaves them out, and they stay listed here until released.
 */
export function HoldPayPanel({ run, slips, byEmployee, onChanged }) {
  const [open, setOpen] = useState(false);
  const [slipId, setSlipId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  if (!run || !PAYING.includes(run.status)) return null;
  const { held, open: free } = holdable(slips);
  if (!held.length && !free.length) return null;
  const nameOf = (s) => byEmployee?.get(s.employeeId)?.employee?.name || s.number;

  const hold = async () => {
    if (!slipId || !reason.trim()) return;
    setBusy('hold');
    try {
      await holdSlipPay(run.id, slipId, reason.trim());
      const s = slips.find((x) => x.id === slipId);
      notify.success(`${s ? `${nameOf(s)}’s` : 'This'} salary is held. It stays out of the bank file until you release it.`);
      setOpen(false);
      setSlipId('');
      setReason('');
      onChanged?.();
    } catch (e) {
      notify.error(errorWords(e, 'hold this pay'));
    } finally {
      setBusy('');
    }
  };
  const release = async (s) => {
    setBusy(s.id);
    try {
      await releaseSlipPay(run.id, s.id);
      notify.success(`${nameOf(s)}’s salary is released. It goes in the next payment.`);
      onChanged?.();
    } catch (e) {
      notify.error(errorWords(e, 'release this pay'));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="ui-hold-pay space-y-2" aria-label="Held pay">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="ui-sec-head">{held.length ? `Held pay (${held.length})` : 'Held pay'}</div>
        {free.length && !open ? (
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOpen(true)}>Hold one person's pay</button>
        ) : null}
      </div>
      {held.length ? (
        <ul className="ui-hold-list">
          {held.map((s) => (
            <li key={s.id} className="ui-hold-row">
              <span className="min-w-0">
                <span className="font-medium">{nameOf(s)}</span>
                <span className="ui-caption block">{s.heldReason || 'No reason given'}</span>
              </span>
              <span className="tabular-nums text-right">{money(s.netPay)}</span>
              <button type="button" className="ui-btn ui-btn-secondary" disabled={busy === s.id} onClick={() => release(s)}>Release</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-caption">Nobody's pay is held. A held salary stays out of the bank file until released.</p>
      )}
      {open ? (
        <div className="ui-hold-form grid gap-2 sm:grid-cols-[1fr_2fr_auto] items-end">
          <label className="block">
            <span className="ui-label">Person</span>
            <select className="ui-input w-full" value={slipId} onChange={(e) => setSlipId(e.target.value)}>
              <option value="">Choose…</option>
              {free.map((s) => <option key={s.id} value={s.id}>{nameOf(s)} · {money(s.netPay)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="ui-label">Reason</span>
            <input className="ui-input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Absconding, waiting for the handover" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!slipId || !reason.trim() || busy === 'hold'} onClick={hold}>Hold pay</button>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
