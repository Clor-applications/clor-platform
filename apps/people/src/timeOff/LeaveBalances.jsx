import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import { usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { addLeaveAdjustment, colorOf, deleteLeaveAdjustment, getLeaveBalances, getLeaveLedger, getLeaveSettings, periodChoices, thisYear } from './api';

/**
 * Time & Leave → Balances. Everyone's days for the leave period; open a
 * person for the ledger behind each number ("Why this number?") — earned,
 * carried, added or taken away by HR, paid out, taken, waiting — and change
 * it with a reason that stays on the record.
 */
const KIND = { CARRIED: 'Carried in', EARNED: 'Earned', CREDIT: 'Credited', UPCOMING: 'To be credited', ALLOCATED: 'Set for this person', ADJUST: 'Changed by HR', ENCASH: 'Reserved for payout', TAKEN: 'Approved', PENDING: 'Waiting' };
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

export default function LeaveBalances() {
  const settings = useRequest(() => getLeaveSettings().catch(() => null), []);
  const [picked, setPicked] = useState(null);
  const year = picked ?? settings.data?.current?.year ?? (settings.loading ? null : thisYear());
  const req = useRequest(() => (year ? getLeaveBalances(year) : Promise.resolve(undefined)), [year]);
  const data = req.data;
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);

  const types = useMemo(() => (data?.types || []).filter((t) => t.isPaid), [data]);
  const search = useListSearch(data?.rows || [], ['name', 'code', 'department']);
  useResetPage(setPage, [search.query, size, year]);
  const { pageRows: rows, safePage } = usePaged(search.filtered, size, page);
  const choices = settings.data ? periodChoices(settings.data) : [thisYear() + 1, thisYear(), thisYear() - 1].map((y) => ({ year: y, label: String(y) }));
  const label = choices.find((c) => c.year === year)?.label || year;

  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (r) => (
      <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{[r.code, r.department].filter(Boolean).join(' · ')}</span></span>
    ) },
    ...types.map((t) => ({
      key: t.id,
      /* The type's own name, not its code; wide enough that "10 of 12" never wraps. */
      label: t.name,
      align: 'right',
      width: '8.5rem',
      render: (r) => {
        const b = r.balances[t.id] || {};
        return (
          <span className={`tabular-nums whitespace-nowrap ${b.available < 0 ? 'ui-text-neg' : ''}`}>
            {b.available ?? '—'}<span className="ui-caption block">of {b.allocated ?? '—'}</span>
          </span>
        );
      },
    })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Time & Leave' }]} title="Balances" />
      {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} /> : !data ? <SkeletonCard lines={6} /> : !types.length ? (
        <EmptyState title="No paid leave types yet" description="Add them in Settings → Leave Policy." />
      ) : (
        <DataTable
          label="Leave balances"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.employeeId}
          total={search.filtered.length}
          page={safePage}
          pageSize={size}
          noun="people"
          onPage={setPage}
          onPageSize={setSize}
          onRowClick={(r) => setOpen(r)}
          rowActions={(r) => [{ key: 'why', label: 'Why this number?', onSelect: () => setOpen(r) }]}
          refreshing={req.refreshing}
          card={(r) => (
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block ui-caption tabular-nums">{types.map((t) => `${t.code || t.name} ${r.balances[t.id]?.available ?? '—'}`).join(' · ')}</span>
            </span>
          )}
          toolbar={<>
            <SearchField value={search.query} onSearch={search.setQuery} placeholder="Search name, employee ID or department" label="Search balances" className="w-full sm:w-80" />
            {choices.length > 1 ? (
              <div className="w-full sm:w-48">
                <PopupSelect showValueSubtext={false} ariaLabel="Leave period" value={String(year || '')} onChange={(v) => v && setPicked(Number(v))} options={choices.map((c) => ({ value: String(c.year), label: c.label }))} />
              </div>
            ) : null}
          </>}
          empty={search.query ? <EmptyState kind="filtered" title="Nobody matches" onClearFilters={() => search.setQuery('')} /> : <EmptyState title="Nobody employed in this period" />}
        />
      )}
      {open ? <Ledger person={open} year={year} label={label} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
    </div>
  );
}

const BLANK = { leaveTypeId: '', how: 'ADD', days: '', reason: '' };

function Ledger({ person, year, label, onClose, onChanged }) {
  const req = useRequest(() => getLeaveLedger(person.employeeId, year), [person.employeeId, year]);
  const data = req.data;
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const paid = (data?.types || []).filter((t) => t.type.isPaid);
  const chosen = paid.find((t) => t.type.id === form.leaveTypeId);
  const days = Number(form.days);
  const ready = Boolean(form.leaveTypeId) && days > 0 && days <= 366 && Math.round(days * 2) === days * 2 && form.reason.trim().length >= 3;
  const dirty = Boolean(form.days || form.reason);

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      await addLeaveAdjustment({
        employeeId: person.employeeId,
        leaveTypeId: form.leaveTypeId,
        year,
        kind: form.how === 'ENCASH' ? 'ENCASH' : 'ADJUST',
        days: form.how === 'TAKE' ? -days : days,
        reason: form.reason.trim(),
      });
      notify.success(form.how === 'ENCASH' ? 'Days reserved. In Payroll → Adjustments, select this leave encashment and enter its payout amount.' : 'Balance changed.');
      setForm({ ...BLANK, leaveTypeId: form.leaveTypeId });
      req.reload();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (entry) => {
    const ok = await confirmDialog({ title: 'Remove this line?', message: `${signed(entry.days)} days: ${entry.note}. It goes to the recycle bin for 30 days.`, confirmLabel: 'Yes, remove' });
    if (!ok) return;
    try {
      await deleteLeaveAdjustment(entry.id);
      req.reload();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      widthClass="w-[min(36rem,96vw)]"
      title={`${person.name}, ${label}`}
      footer={paid.length ? <>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
        <button type="submit" form="leave-adjust" className="ui-btn ui-btn-primary" disabled={!ready || saving}>{saving ? 'Saving…' : 'Save change'}</button>
      </> : null}
    >
      {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !data ? <SkeletonCard lines={6} /> : (
        <div className="space-y-6">
          {data.types.map(({ type, balance, entries }) => (
            <section key={type.id} aria-label={type.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="ui-t-sec inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(type) }} aria-hidden="true" />{type.name}</h3>
                {type.isPaid ? <span className="text-sm"><span className="tabular-nums font-medium">{balance.available}</span> available</span> : <span className="ui-caption">Unpaid: <span className="tabular-nums">{balance.used || 0}</span> taken</span>}
              </div>
              {entries.length ? (
                <table className="ui-table w-full text-sm">
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={`${e.kind}-${e.id || i}`} className={e.kind === 'UPCOMING' ? 'ui-muted' : ''}>
                        <td className="ui-col-meta whitespace-nowrap w-28 tabular-nums">{formatDate(e.date) || e.date}</td>
                        <td>{KIND[e.kind] || e.kind}{e.note ? <span className="ui-caption block">{e.note}</span> : null}</td>
                        <td className="ui-num w-20 tabular-nums">{signed(e.days)}</td>
                        <td className="w-10">
                          {['ADJUST', 'ENCASH'].includes(e.kind) ? <button type="button" className="ui-icon-btn" aria-label="Remove this line" onClick={() => remove(e)}><Trash2 size={14} aria-hidden="true" /></button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="ui-caption">Nothing in this period.</p>}
            </section>
          ))}

          {paid.length ? (
            <form id="leave-adjust" onSubmit={save} className="grid gap-4 border-t pt-4 sm:grid-cols-2" style={{ borderColor: 'rgb(var(--border))' }} aria-labelledby="leave-adjust-h">
              <h3 id="leave-adjust-h" className="ui-t-sec sm:col-span-2">Change the balance</h3>
              <div>
                <PopupSelect showValueSubtext={false} label="Leave type *" value={form.leaveTypeId} placeholder="Choose…"
                  onChange={(v) => setForm({ ...form, leaveTypeId: v || '', how: form.how === 'ENCASH' && !paid.find((t) => t.type.id === v)?.type.encashable ? 'ADD' : form.how })}
                  options={paid.map((t) => ({ value: t.type.id, label: t.type.name }))} />
              </div>
              <div>
                <PopupSelect showValueSubtext={false} label="What" value={form.how} onChange={(v) => setForm({ ...form, how: v || 'ADD' })}
                  options={[{ value: 'ADD', label: 'Add days' }, { value: 'TAKE', label: 'Take days away' }, ...(chosen?.type.encashable ? [{ value: 'ENCASH', label: 'Pay out days' }] : [])]} />
              </div>
              <label className="block">
                <span className="ui-label">Days *</span>
                <input type="number" inputMode="decimal" min={0.5} max={366} step={0.5} className="ui-input w-full tabular-nums" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
              </label>
              <label className="block">
                <span className="ui-label">Reason *</span>
                <input className="ui-input w-full" minLength={3} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </label>
            </form>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
