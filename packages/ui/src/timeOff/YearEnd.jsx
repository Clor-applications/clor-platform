import React, { useState } from 'react';
import { Banknote } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { can, homeCrumbs } from './shared';
import { daysText, getLeaveSettings, getYearEnd, periodChoices, runYearEnd, thisYear, undoYearEnd } from './api';

/**
 * Settings → Year end (TIME-LEAVE-DECISIONS.md, advanced build). The engine
 * carries forward and lapses by itself; a run pays out the days that would
 * lapse, for the types that allow it, as adjustments Payroll lists. Shown per
 * person and type first; run once a period; undone until Payroll pays any of
 * it. The previous period is the one that usually needs it.
 */
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const stamp = (at) => formatDate(new Date(new Date(at).getTime() + 330 * 60_000).toISOString().slice(0, 10));

export default function YearEnd() {
  const perms = usePermissions();
  /* Year end is run for the whole company: a team-scoped role sees it, the server refuses its run. */
  const canRun = can(perms, 'ATTENDANCE::Leave Requests::EDIT') && !perms?.ownDocumentsOnly;
  const settings = useRequest(() => getLeaveSettings().catch(() => null), []);
  const [picked, setPicked] = useState(null);
  /* Settings that could not load fall back to last calendar year, as Balances does, rather than a spinner that never ends. */
  const year = picked ?? settings.data?.previous?.year ?? (settings.data?.current ? settings.data.current.year - 1 : settings.loading ? null : thisYear() - 1);
  const req = useRequest(() => (year ? getYearEnd(year) : Promise.resolve(undefined)), [year]);
  const [busy, setBusy] = useState(false);
  const d = req.data;
  const choices = settings.data ? periodChoices(settings.data) : [];
  const live = (d?.runs || []).find((r) => !r.undoneAt);

  const run = async () => {
    if (busy || !d) return;
    const paid = d.rows.filter((r) => r.payOut > 0);
    const ok = await confirmDialog({
      title: `Pay out lapsing days for ${d.period.label}?`,
      message: `${daysText(d.totals.payOut)} for ${paid.length} ${paid.length === 1 ? 'person' : 'people'} go to Payroll → Adjustments as leave encashment. ${daysText(d.totals.carry)} carry forward by themselves; ${daysText(Math.round((d.totals.lapse - d.totals.payOut) * 100) / 100)} lapse. It can be undone until Payroll pays any of it.`,
      confirmLabel: 'Pay out',
      tone: 'default',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const out = await runYearEnd(year);
      notify.success(`Year end run: ${out.paidOut} pay-out${out.paidOut === 1 ? '' : 's'}, ${daysText(out.totals.payOut)}.`);
      req.reload();
    } catch (err) {
      notify.error(String(err?.message || 'Not run.'));
    } finally {
      setBusy(false);
    }
  };
  const undo = async (r) => {
    const ok = await confirmDialog({ title: 'Undo this year end?', message: 'The pay-outs it made are removed; the days go back to lapsing.', confirmLabel: 'Undo' });
    if (!ok) return;
    try {
      await undoYearEnd(r.id);
      notify.success('Year end undone.');
      req.reload();
    } catch (err) {
      notify.error(String(err?.message || 'Not undone.'));
    }
  };

  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span>{r.code ? <span className="block truncate ui-caption">{r.code}</span> : null}</span> },
    { key: 'leaveType', label: 'Leave type', render: (r) => r.leaveType },
    { key: 'closing', label: 'Closing', align: 'right', render: (r) => <span className="tabular-nums">{r.closing}</span> },
    { key: 'carry', label: 'Carries forward', align: 'right', render: (r) => <span className="tabular-nums">{r.carry}</span> },
    { key: 'payOut', label: 'Paid out', align: 'right', render: (r) => <span className="tabular-nums">{r.payOut}</span> },
    { key: 'lapse', label: 'Lapses', align: 'right', render: (r) => <span className="tabular-nums">{Math.round((r.lapse - r.payOut) * 100) / 100}</span> },
  ];

  const header = (
    <PageHeader
      breadcrumb={homeCrumbs()}
      title="Leave year end"
      actions={<>
        {choices.length > 1 ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave period" value={String(year || '')} onChange={(v) => v && setPicked(Number(v))} options={choices.map((c) => ({ value: String(c.year), label: c.label }))} /></div> : null}
        {canRun && d?.ended && !live && d.totals.payOut > 0 ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={run}><Banknote size={16} aria-hidden="true" /> Pay out lapsing days</button> : null}
      </>}
    />
  );

  if (req.error && !d) return <div className="space-y-6">{header}<ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!d) return <div className="space-y-6" aria-busy="true">{header}<SkeletonCard lines={6} /></div>;

  const lapses = Math.round((d.totals.lapse - d.totals.payOut) * 100) / 100;
  return (
    <div className="space-y-6">
      {header}
      {!d.ended ? (
        <p className="text-sm">{d.period.label} has not ended; the year end can run from <span className="tabular-nums">{formatDate(addDays(d.period.to, 1))}</span>.</p>
      ) : live ? (
        <p className="text-sm">Run on <span className="tabular-nums">{stamp(live.ranAt)}</span>{live.ranBy ? ` by ${live.ranBy}` : ''}.</p>
      ) : null}

      <div className="ui-metric-strip" role="list" aria-label="Year end totals">
        {[['carry', 'Carries forward', d.totals.carry], ['payOut', 'Paid out', d.totals.payOut], ['lapse', 'Lapses', lapses]].map(([k, label, value]) => (
          <div key={k} role="listitem"><div className="ui-metric"><span><span className="ui-metric-value tabular-nums">{value}</span><span className="ui-metric-label">{label}</span></span></div></div>
        ))}
      </div>

      <DataTable
        label="Year end by person"
        columns={columns}
        rows={d.rows}
        rowKey={(r) => `${r.employeeId}:${r.leaveTypeId}`}
        total={d.rows.length}
        page={1}
        pageSize={Math.max(25, d.rows.length)}
        noun="lines"
        refreshing={req.refreshing}
        card={(r) => (
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.name} · {r.leaveType}</span>
            <span className="block ui-caption tabular-nums">Closing {r.closing} · carries {r.carry} · paid out {r.payOut} · lapses {Math.round((r.lapse - r.payOut) * 100) / 100}</span>
          </span>
        )}
        empty={<EmptyState title={`Nobody has days left at the end of ${d.period.label}`} />}
      />

      {d.runs.length ? (
        <section className="space-y-1" aria-label="Runs">
          <h2 className="ui-t-sec">Runs</h2>
          <ul className="divide-y border-t text-sm">
            {d.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="tabular-nums">{stamp(r.ranAt)}</span>
                <span className="min-w-0 flex-1">{r.ranBy ? `by ${r.ranBy}` : ''}{r.summary?.totals ? <span className="ui-caption block tabular-nums">{r.summary.paidOut ?? 0} pay-out{(r.summary.paidOut ?? 0) === 1 ? '' : 's'}, {daysText(r.summary.totals.payOut ?? 0)}</span> : null}</span>
                {r.undoneAt ? <span className="ui-pill ui-pill-neutral">Undone {stamp(r.undoneAt)}</span> : canRun ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => undo(r)}>Undo</button> : <span className="ui-pill ui-pill-pos">Run</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
