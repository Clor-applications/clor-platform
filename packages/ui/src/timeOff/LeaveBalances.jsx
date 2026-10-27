import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import { usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import SuggestInput from '@ui/components/ui/SuggestInput';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { can, homeCrumbs } from './shared';
import { useSuggestions } from './suggestions';
import { addLeaveAdjustment, colorOf, deleteLeaveAdjustment, getLeaveBalances, getLeaveLedger, getLeaveSettings, grantCompOff, periodChoices, thisYear, todayIst } from './api';

/**
 * Time & Leave → Balances. Everyone's days for the leave period; open a
 * person for the ledger behind each number ("Why this number?") — earned,
 * carried, added or taken away by HR, paid out, taken, waiting — and change
 * it with a reason that stays on the record.
 */
const KIND = { CARRIED: 'Carried in', EARNED: 'Earned', CREDIT: 'Credited', UPCOMING: 'To be credited', ALLOCATED: 'Set for this person', ADJUST: 'Changed by HR', ENCASH: 'Reserved for payout', TAKEN: 'Approved', PENDING: 'Waiting' };
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

export default function LeaveBalances() {
  const perms = usePermissions();
  const canChange = can(perms, 'ATTENDANCE::Leave Requests::EDIT');
  const settings = useRequest(() => getLeaveSettings().catch(() => null), []);
  const [picked, setPicked] = useState(null);
  const year = picked ?? settings.data?.current?.year ?? (settings.loading ? null : thisYear());
  const req = useRequest(() => (year ? getLeaveBalances(year) : Promise.resolve(undefined)), [year]);
  const data = req.data;
  const [open, setOpen] = useState(null);
  const [compOff, setCompOff] = useState(null);
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
            {b.available ?? '—'}<span className="ui-caption block">{b.locked ? `locked until ${b.lockedUntil ? formatDate(b.lockedUntil) : 'confirmed'}` : `of ${b.allocated ?? '—'}`}</span>
          </span>
        );
      },
    })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={homeCrumbs()} title="Balances" />
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
          rowActions={(r) => [{ key: 'why', label: 'Why this number?', onSelect: () => setOpen(r) }, canChange ? { key: 'compoff', label: 'Grant comp-off', onSelect: () => setCompOff(r) } : null]}
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
      {compOff ? <CompOff person={compOff} onClose={() => setCompOff(null)} onDone={() => { setCompOff(null); req.reload(); }} /> : null}
    </div>
  );
}

const COMP_OFF = { workedOn: '', days: '1', reason: '' };

/**
 * Comp-off granted for a day worked (a holiday, a weekly off), for a company
 * where nobody punches: a dated credit of the comp-off leave type. The type
 * is chosen in Attendance's overtime rules; without one the server says so.
 */
function CompOff({ person, onClose, onDone }) {
  const [form, setForm] = useState(COMP_OFF);
  const [saving, setSaving] = useState(false);
  const reasons = useSuggestions('leaveReason');
  const ready = Boolean(form.workedOn) && form.reason.trim().length >= 3;
  const dirty = Boolean(form.workedOn || form.reason);
  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      await grantCompOff({ employeeId: person.employeeId, workedOn: form.workedOn, days: Number(form.days), reason: form.reason.trim() });
      notify.success(`Comp-off granted to ${person.name} for ${formatDate(form.workedOn)}.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not granted.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      widthClass="w-[min(36rem,96vw)]"
      title={`Comp-off for ${person.name}`}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="comp-off" className="ui-btn ui-btn-primary" disabled={!ready || saving}>{saving ? 'Saving…' : 'Grant'}</button>
      </>}
    >
      <form id="comp-off" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="co-on">Day worked *</span><DatePicker label="Day worked" describedBy="co-on" value={form.workedOn} max={todayIst()} onChange={(v) => setForm({ ...form, workedOn: v || '' })} /></div>
          <div><PopupSelect showValueSubtext={false} label="Earns" value={form.days} onChange={(v) => setForm({ ...form, days: v || '1' })} options={[{ value: '1', label: 'One day' }, { value: '0.5', label: 'Half a day' }]} /></div>
        </div>
        <label className="block">
          <span className="ui-label">What was worked *</span>
          <SuggestInput maxLength={300} value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} suggestions={reasons} />
        </label>
      </form>
    </Drawer>
  );
}

const BLANK = { leaveTypeId: '', how: 'ADD', days: '', reason: '' };

function Ledger({ person, year, label, onClose, onChanged }) {
  /* As of a date: the balance as it stands that day, credits landed by then. */
  const [asOf, setAsOf] = useState('');
  const req = useRequest(() => getLeaveLedger(person.employeeId, year, asOf || undefined), [person.employeeId, year, asOf]);
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
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="sm:w-48">
              <span className="ui-label" id="ledger-as-of">As of</span>
              <DatePicker label="As of" describedBy="ledger-as-of" value={asOf} placeholder="Today" min={data.period?.from} max={data.period?.to} onChange={(v) => setAsOf(v || '')} />
            </div>
            {asOf ? <button type="button" className="ui-link text-sm" onClick={() => setAsOf('')}>Today</button> : null}
          </div>
          {data.types.map(({ type, balance, projected, entries, explain }) => (
            <section key={type.id} aria-label={type.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="ui-t-sec inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(type) }} aria-hidden="true" />{type.name}</h3>
                {type.isPaid ? (
                  <span className="text-sm text-right">
                    <span className="block"><span className="tabular-nums font-medium">{balance.available}</span> available{asOf ? <span className="ui-muted tabular-nums"> on {formatDate(asOf)}</span> : null}</span>
                    {balance.locked ? <span className="block ui-caption ui-text-warn">Locked until confirmed{balance.lockedUntil ? ` (${formatDate(balance.lockedUntil)})` : ''}</span> : null}
                    {projected && data.period?.to ? <span className="block ui-caption tabular-nums">Projected to {formatDate(data.period.to)}: {projected.available}</span> : null}
                  </span>
                ) : <span className="ui-caption">Unpaid: <span className="tabular-nums">{balance.used || 0}</span> taken</span>}
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
              {explain?.length ? (
                <details className="text-sm">
                  <summary className="ui-link cursor-pointer">How is this worked out?</summary>
                  <ul className="mt-1 space-y-1 ui-caption">{explain.map((line) => <li key={line}>{line}</li>)}</ul>
                </details>
              ) : null}
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
