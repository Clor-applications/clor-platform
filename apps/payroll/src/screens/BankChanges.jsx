import React, { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { formatDateIn } from '@ui/utils/dates';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { approveBankChange, listBankChanges, rejectBankChange } from '../api/payrollPeople';

const STATUS = {
  PENDING: { label: 'Waiting', pill: 'ui-pill-warn' },
  APPROVED: { label: 'Approved', pill: 'ui-pill-pos' },
  REJECTED: { label: 'Rejected', pill: 'ui-pill-neg' },
  CANCELLED: { label: 'Replaced', pill: 'ui-pill-neutral' },
};

const account = (num, ifsc, bank) => [num, ifsc, bank].filter(Boolean).join(' · ') || '—';

/**
 * Changes to where people are paid. A change to bank details already on file
 * waits here until somebody other than the person who entered it approves it
 * (or that person, a day later); pay goes to the account on file until then.
 */
export default function BankChanges() {
  const [show, setShow] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    listBankChanges({ status: show })
      .then((r) => {
        setRows(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load bank changes.')));
  }, [show]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, approve) => {
    if (approve) {
      const ok = await confirmDialog({
        title: `Pay ${row.employeeName || 'this person'} into ${row.newAccount}?`,
        message: 'Confirm the new account with them by phone or in person first — not by replying to an e-mail. Salary goes to the new account from the next payment.',
        confirmLabel: 'Approve',
        tone: 'default',
      });
      if (!ok) return;
    }
    setBusy(row.id);
    try {
      await (approve ? approveBankChange(row.id) : rejectBankChange(row.id, null));
      notify.success(approve ? 'Approved. The new account is used from the next payment.' : 'Rejected. Pay stays with the account on file.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        entity="payroll"
        title="Bank changes"
        description="Changes to where people are paid wait for a second person's approval."
        actions={
          <select className="ui-select" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
            <option value="PENDING">Waiting</option>
            <option value="ALL">All changes</option>
          </select>
        }
      />
      {error ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="alert">
          <span style={{ color: 'rgb(var(--neg))' }}>{error}</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={load}>Try again</button>
        </div>
      ) : null}
      {!rows ? (
        error ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title={show === 'PENDING' ? 'Nothing waiting' : 'No bank changes yet'} description={show === 'PENDING' ? 'Bank detail changes waiting for approval appear here.' : ''} />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">From</th>
                  <th scope="col" className="ui-th">To</th>
                  <th scope="col" className="ui-th">Asked</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">
                      {r.employeeName || '—'}
                      {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                    </td>
                    <td className="ui-mono text-sm">{account(r.oldAccount, r.oldIfsc, r.oldBankName)}</td>
                    <td className="ui-mono text-sm">{account(r.newAccount, r.newIfsc, r.newBankName)}</td>
                    <td className="whitespace-nowrap text-sm">
                      {formatDateIn(String(r.requestedAt).slice(0, 10))}
                      {r.mine ? <span className="ui-caption block">by you</span> : null}
                    </td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${STATUS[r.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span>
                    </td>
                    <td className="whitespace-nowrap text-end">
                      {r.status === 'PENDING' ? (
                        <span className="inline-flex gap-2">
                          <button type="button" data-permission="PAYROLL::Payroll Runs::APPROVE" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === r.id} onClick={() => decide(r, true)}>
                            <Check size={14} aria-hidden="true" /> Approve
                          </button>
                          <button type="button" data-permission="PAYROLL::Payroll Runs::APPROVE" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === r.id} onClick={() => decide(r, false)}>
                            <X size={14} aria-hidden="true" /> Reject
                          </button>
                        </span>
                      ) : r.note ? (
                        <span className="ui-caption">{r.note}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
