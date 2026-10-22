import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { addLeaveAdjustment, colorOf, deleteLeaveAdjustment, getLeaveBalances, getLeaveLedger, getLeaveSettings, periodChoices, thisYear } from './api';

/**
 * People → Leave & Attendance → Leave Balances. Everyone's days for the
 * year; open a person for the ledger behind each number — earned, carried,
 * added or taken away by HR, paid out, taken, waiting — and change it with a
 * reason that stays on the record.
 */
const KIND = { CARRIED: 'Carried in', EARNED: 'Earned', CREDIT: 'Credited', UPCOMING: 'To be credited', ALLOCATED: 'Set for this person', ADJUST: 'Changed by HR', ENCASH: 'Reserved for payout', TAKEN: 'Approved', PENDING: 'Waiting' };

export default function LeaveBalances() {
  const [year, setYear] = useState(null);
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    getLeaveSettings().then((s) => { setSettings(s); setYear(s.current.year); }).catch(() => setYear(thisYear()));
  }, []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const load = useCallback(() => {
    if (!year) return;
    getLeaveBalances(year).then((r) => { setData(r); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load balances.')));
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const types = useMemo(() => (data?.types || []).filter((t) => t.isPaid), [data]);
  const search = useListSearch(data?.rows || [], ['name', 'code', 'department']);
  useResetPage(setPage, [search.query, perPage, year]);
  const { pageRows, safePage, pageCount } = usePaged(search.filtered, perPage, page);
  const choices = settings ? periodChoices(settings) : [thisYear() + 1, thisYear(), thisYear() - 1].map((y) => ({ year: y, label: String(y) }));

  return (
    <DocumentListShell
      entity="leave"
      title="Leave Balances"
      description="Days available to each person this year. Open a person to see why, or to add, take away or pay out days."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search balances' }}
      headerExtras={
        <select className="ui-select" value={year || ''} onChange={(e) => setYear(Number(e.target.value))} aria-label="Leave period">
          {choices.map((c) => <option key={c.year} value={c.year}>{c.label}</option>)}
        </select>
      }
    >
      {error ? <p role="alert" className="p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : !types.length ? (
        <EmptyState title="No paid leave types yet" description="Add them in Settings → Leave Policy; every balance comes from there." />
      ) : !search.filtered.length ? (
        <EmptyState kind="filtered" title="Nobody matches" description="Change the search." />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  {types.map((t) => (
                    <th key={t.id} scope="col" className="ui-num" title={t.name}>
                      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf(t) }} aria-hidden="true" />{t.code || t.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="ui-rows">
                {pageRows.map((r) => (
                  <tr key={r.employeeId} className="ui-row-click" onClick={() => setOpen(r)}>
                    <td className="ui-col-entity">{r.name}<span className="ui-caption block">{[r.code, r.department].filter(Boolean).join(', ')}</span></td>
                    {types.map((t) => {
                      const b = r.balances[t.id] || {};
                      return (
                        <td key={t.id} className={`ui-num ${b.available < 0 ? 'text-[rgb(var(--neg))]' : ''}`}>
                          {b.available ?? '—'}
                          <span className="ui-caption block">of {b.allocated ?? '—'}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={search.filtered.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} />
        </>
      )}
      {open ? <Ledger person={open} year={year} label={choices.find((c) => c.year === year)?.label || year} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </DocumentListShell>
  );
}

function Ledger({ person, year, label, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ leaveTypeId: '', how: 'ADD', days: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getLeaveLedger(person.employeeId, year).then((r) => { setData(r); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load the ledger.')));
  }, [person.employeeId, year]);
  useEffect(() => { load(); }, [load]);

  const paid = (data?.types || []).filter((t) => t.type.isPaid);
  const chosen = paid.find((t) => t.type.id === form.leaveTypeId);

  const save = async (e) => {
    e.preventDefault();
    const days = Number(form.days);
    setSaving(true);
    try {
      await addLeaveAdjustment({
        employeeId: person.employeeId,
        leaveTypeId: form.leaveTypeId,
        year,
        kind: form.how === 'ENCASH' ? 'ENCASH' : 'ADJUST',
        days: form.how === 'TAKE' ? -days : days,
        reason: form.reason,
      });
      notify.success(form.how === 'ENCASH' ? 'Days reserved. In Payroll → Adjustments, select this leave encashment and enter its payout amount.' : 'Balance changed.');
      setForm({ leaveTypeId: form.leaveTypeId, how: 'ADD', days: '', reason: '' });
      load();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (entry) => {
    const ok = await confirmDialog({ title: 'Remove this line?', message: `${entry.days > 0 ? '+' : ''}${entry.days} days: ${entry.note}. It goes to the recycle bin for 30 days.`, confirmLabel: 'Yes, remove' });
    if (!ok) return;
    try {
      await deleteLeaveAdjustment(entry.id);
      load();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  return (
    <Drawer open onClose={onClose} widthClass="w-[min(40rem,96vw)]" title={`${person.name}: leave, ${label}`}>
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      {!data ? (error ? null : <SkeletonCard lines={6} />) : (
        <div className="space-y-5">
          {data.types.map(({ type, balance, entries }) => (
            <section key={type.id} aria-label={type.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="ui-t-sec inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(type) }} aria-hidden="true" />{type.name}</h3>
                {type.isPaid ? <span className="text-sm"><strong>{balance.available}</strong> available</span> : <span className="ui-caption">Unpaid: {balance.used || 0} taken</span>}
              </div>
              {entries.length ? (
                <table className="ui-table w-full text-sm">
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={`${e.kind}-${e.id || i}`} className={e.kind === 'UPCOMING' ? 'ui-muted' : ''}>
                        <td className="ui-col-meta whitespace-nowrap w-28">{e.date}</td>
                        <td>{KIND[e.kind] || e.kind}<span className="ui-caption block">{e.note}</span></td>
                        <td className="ui-num w-20">{e.days > 0 ? '+' : ''}{e.days}</td>
                        <td className="w-10">
                          {['ADJUST', 'ENCASH'].includes(e.kind) ? <button type="button" className="ui-icon-btn" aria-label="Remove this line" onClick={() => remove(e)}><Trash2 size={14} /></button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="ui-caption">Nothing this year.</p>}
            </section>
          ))}

          {paid.length ? (
            <form onSubmit={save} className="ui-card p-4 grid gap-3 sm:grid-cols-2" aria-label="Change the balance">
              <h3 className="ui-t-sec sm:col-span-2">Change the balance</h3>
              <label className="block">
                <span className="ui-label">Leave type</span>
                <select className="ui-select w-full" required value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
                  <option value="">Choose…</option>
                  {paid.map((t) => <option key={t.type.id} value={t.type.id}>{t.type.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="ui-label">What</span>
                <select className="ui-select w-full" value={form.how} onChange={(e) => setForm({ ...form, how: e.target.value })}>
                  <option value="ADD">Add days</option>
                  <option value="TAKE">Take days away</option>
                  {chosen?.type.encashable ? <option value="ENCASH">Pay out days</option> : null}
                </select>
              </label>
              <label className="block">
                <span className="ui-label">Days</span>
                <input type="number" min={0.5} max={366} step={0.5} required className="ui-input w-full" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
              </label>
              <label className="block">
                <span className="ui-label">Reason</span>
                <input className="ui-input w-full" required minLength={3} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Opening balance from the old system" />
              </label>
              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                <span className="ui-caption">Kept on the ledger with your name and the date.</span>
                <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
