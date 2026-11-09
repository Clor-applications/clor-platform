import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Landmark, UserRound, X } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { formatDateIn } from '@ui/utils/dates';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { approveBankChange, listBankChanges, rejectBankChange } from '../api/payrollPeople';
import LoadFailed from '@ui/components/ui/LoadFailed';

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
const TABS = [
  { value: 'PENDING', label: 'Waiting', tone: 'outstanding' },
  { value: 'APPROVED', label: 'Approved', tone: 'paid' },
  { value: 'REJECTED', label: 'Rejected', tone: 'overdue' },
  { value: '', label: 'All', tone: 'all' },
];
const COLUMNS = {
  employee: (r) => r.employeeName || '—',
};
const EXPORT_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Code' },
  { key: 'from', label: 'From', value: (r) => account(r.oldAccount, r.oldIfsc, r.oldBankName) },
  { key: 'to', label: 'To', value: (r) => account(r.newAccount, r.newIfsc, r.newBankName) },
  { key: 'requestedAt', label: 'Asked', value: (r) => String(r.requestedAt || '').slice(0, 10) },
  { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label || r.status },
];

export default function BankChanges() {
  const [status, setStatus] = useState('PENDING');
  const [all, setAll] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    listBankChanges({ status: 'ALL' })
      .then((r) => {
        setAll(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load bank changes.')));
  }, []);
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

  const counts = useMemo(() => {
    const list = all || [];
    const n = (st) => list.filter((r) => r.status === st).length;
    return { '': list.length, PENDING: n('PENDING'), APPROVED: n('APPROVED'), REJECTED: n('REJECTED') };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || r.status === status), [all, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'newAccount', 'oldAccount']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const mineWaiting = useMemo(() => (all || []).filter((r) => r.status === 'PENDING' && r.mine).length, [all]);

  return (
    <DocumentListShell
      entity="bankChange"
      title="Bank changes"
      description="Changes to where people are paid wait for a second person's approval."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search bank changes…', label: 'Search bank changes' }}
      moreItems={all?.length ? [exportMenuItem('Export bank changes')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Bank changes', fileName: 'Bank changes', label: 'change/changes', columns: EXPORT_COLUMNS, rows });
      }}
      cards={[
        { label: 'Waiting', value: counts.PENDING, count: true, tone: 'outstanding', Icon: Clock, onSelect: () => setStatus('PENDING') },
        { label: 'Entered by you', value: mineWaiting, count: true, tone: 'partial', Icon: UserRound },
        { label: 'Approved', value: counts.APPROVED, count: true, tone: 'paid', Icon: Check, onSelect: () => setStatus('APPROVED') },
        { label: 'Rejected', value: counts.REJECTED, count: true, tone: 'overdue', Icon: X, onSelect: () => setStatus('REJECTED') },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Approval"
    >
      <LoadFailed message={error} onRetry={load} />
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Asked</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No bank changes match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Landmark}
                        title={status === 'PENDING' ? 'Nothing waiting' : status ? `No ${STATUS[status]?.label.toLowerCase()} changes` : 'No bank changes yet'}
                        description="When someone's bank details change on their payroll profile, the change waits here for a second person's approval."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">
                      {r.employeeName || '—'}
                      {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                    </td>
                    <td className="ui-mono text-sm">{account(r.oldAccount, r.oldIfsc, r.oldBankName)}</td>
                    <td className="ui-mono text-sm">{account(r.newAccount, r.newIfsc, r.newBankName)}</td>
                    <td className="ui-col-date whitespace-nowrap">
                      {formatDateIn(String(r.requestedAt).slice(0, 10))}
                      {r.mine ? <span className="ui-caption block">by you</span> : null}
                    </td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${STATUS[r.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span>
                    </td>
                    <td className="whitespace-nowrap text-end">
                      {r.status === 'PENDING' ? (
                        <span className="inline-flex gap-1">
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
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}
