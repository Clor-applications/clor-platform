import React, { useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { approveJoiningStatutory, joiningStatutory, rejectJoiningStatutory } from './api';

/*
 * The statutory half of a joiner's form (HR-VIEW gap 2): PAN, UAN, ESIC,
 * bank and PF nominees. Masked until HR opens the approval view, which is
 * logged; approving sends them to Payroll's record (or keeps them in People
 * until Payroll is on). Payroll decides a changed bank account itself.
 */

const FIELDS = [
  ['pan', 'PAN'], ['uan', 'UAN'], ['esicNumber', 'ESIC number'],
  ['bankAccountName', 'Name on the account'], ['bankAccountNumber', 'Account number'], ['bankIfsc', 'IFSC'], ['bankName', 'Bank'],
];
const STATUS_WORDS = {
  SENT: 'Sent, not checked',
  HELD: 'Approved; kept in People until Payroll is switched on',
  APPLIED: 'Approved and on the Payroll record',
  REJECTED: 'Not accepted',
};
const BANK_WORDS = { PENDING: 'The bank account differs from the one on file, so it waits for approval in Payroll → Bank changes.', APPLIED: 'Bank details are the first on file and apply now.' };

export default function JoiningStatutory({ invite, canView, canApprove, onDecided }) {
  const [summary, setSummary] = useState(invite.statutory);
  const [full, setFull] = useState(null);
  const [edits, setEdits] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!summary) return null;
  const values = full?.values || summary.values || {};
  const open = async () => {
    setBusy(true);
    try {
      setFull(await joiningStatutory(invite.id));
    } catch (e) {
      notify.error(String(e?.message || 'Could not open them.'));
    } finally {
      setBusy(false);
    }
  };
  const decide = async (approve) => {
    setBusy(true);
    try {
      const r = approve ? await approveJoiningStatutory(invite.id, Object.keys(edits).length ? edits : null) : { statutory: (await rejectJoiningStatutory(invite.id, note)).statutory };
      const s = r.statutory;
      setSummary(s);
      setFull(null);
      notify.success(approve ? (r.payroll === 'SENT' ? `On the Payroll record.${s.bankOutcome === 'PENDING' ? ' The bank change waits for approval in Payroll.' : ''}` : 'Approved. Kept in People until Payroll is switched on.') : 'Marked as not accepted.');
      onDecided?.(s);
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const waiting = summary.status === 'SENT';
  const shown = FIELDS.filter(([k]) => values[k]);
  return (
    <section className="space-y-2 border-t pt-3" aria-label="PAN, PF, ESI and bank">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">PAN, PF, ESI and bank</h4>
        <span className="ui-caption">{STATUS_WORDS[summary.status] || summary.status}</span>
      </div>
      {summary.bankOutcome && BANK_WORDS[summary.bankOutcome] ? <p className="ui-caption">{BANK_WORDS[summary.bankOutcome]}</p> : null}
      {summary.note ? <p className="ui-caption">Reason: {summary.note}</p> : null}
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {shown.map(([k, label]) => (
            <tr key={k}>
              <td className="py-1.5 pr-2 ui-muted w-44">{label}</td>
              <td className="py-1.5">
                {full && !full.masked && canApprove && waiting
                  ? <input className="ui-input w-full tabular-nums" aria-label={label} value={edits[k] !== undefined ? edits[k] : values[k] || ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                  : <span className="tabular-nums">{values[k]}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {values.nominees?.length ? (
        <div>
          <p className="ui-label">PF nominees</p>
          <ul className="text-sm divide-y" aria-label="PF nominees">
            {values.nominees.map((n, i) => (
              <li key={`${n.name}-${i}`} className="flex justify-between gap-3 py-1.5">
                <span>{n.name} <span className="ui-muted">({String(n.relation).toLowerCase()})</span></span>
                <span className="tabular-nums">{n.sharePercent}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {waiting && canView && !full ? (
        <div className="flex justify-end"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={open}>Show in full to check</button></div>
      ) : null}
      {waiting && full && canApprove ? (
        <div className="space-y-2">
          <p className="ui-caption">Check them against the PAN card, the bank proof and the old PF statement. Your opening of them is recorded.</p>
          <label className="block">
            <span className="ui-label">Reason, if not accepting</span>
            <input className="ui-input w-full" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !note.trim()} onClick={() => decide(false)}>Not accepted</button>
            <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy} onClick={() => decide(true)}>{busy ? 'Saving…' : 'Approve for payroll'}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
