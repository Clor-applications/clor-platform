import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Download, Lock, Unlock } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { usePermissions } from '@ui/permissions/usePermissions';
import HeldPunches from '../components/HeldPunches';
import { closeMonth, dayLabel, getMonthReadiness, getMonthSnapshot, setAttendanceStartDate, todayIst } from '../api/attendance';
import ReopenMonth from '../components/ReopenMonth';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Payroll readiness: before a month is closed, everything that would make its
 * payable days wrong — days with no check-out, corrections and leave still
 * waiting, reader IDs that match nobody, working days with no attendance,
 * overtime not approved, days not validated. Closing with items open needs a
 * deliberate acknowledgement, and every close keeps a numbered snapshot of the
 * figures Payroll takes.
 */
const lastMonth = () => {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
/* The kinds a person can have open, each a filter on the list. */
const KINDS = [
  { value: '', label: 'All' },
  { value: 'missingOut', label: 'No check-out' },
  { value: 'noRecord', label: 'No attendance' },
  { value: 'unapprovedOvertime', label: 'Overtime to approve' },
  { value: 'unvalidated', label: 'Not validated' },
];
const hasOpen = (p) => p.missingOut || p.noRecord || p.unapprovedOvertime || p.unvalidated;
const days = (n) => `${Number(n).toLocaleString('en-IN')} working day${n === 1 ? '' : 's'}`;
/* A person's no-record days as a short run: "3, 4, 7 Oct" or the first few and how many more. */
const dateList = (dates = []) => {
  const shown = dates.slice(0, 6).map((d) => String(Number(d.slice(8, 10))));
  const month = dates[0] ? new Date(`${dates[0]}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) : '';
  return `${shown.join(', ')}${dates.length > 6 ? ` and ${dates.length - 6} more` : ''} ${month}`.trim();
};

/**
 * Working days with no record are docked from pay as unpaid absence once the month closes (audit 7 Nov
 * 2026, #5). Closing over them needs its own, explicit confirmation that names whose days they are, and
 * the server takes the close only with that exact number back.
 */
function NoRecordConfirm({ people, count, checked, onChange }) {
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, 8);
  return (
    <div className="space-y-2" role="group" aria-labelledby="norec-h">
      <h3 id="norec-h" className="text-sm font-semibold">{days(count)} with no record will be docked as unpaid absence</h3>
      <ul className="text-sm space-y-1">
        {shown.map((p) => (
          <li key={p.employeeId} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{p.name}</span>
            <span className="ui-caption">{p.noRecord} day{p.noRecord === 1 ? '' : 's'}: {dateList(p.noRecordDates)}</span>
          </li>
        ))}
      </ul>
      {people.length > 8 ? (
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${people.length.toLocaleString('en-IN')} people`}</button>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="ui-checkbox mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>Dock these {days(count)} from pay as unpaid absence.</span>
      </label>
    </div>
  );
}

/** When the company started keeping attendance on CLOR: days before it with no record are not counted. */
function StartDate({ value, canChange, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(value || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDate(value || ''); }, [value]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await setAttendanceStartDate(date || null);
      notify.success(date ? `Days before ${dayLabel(date)} with no record are not counted.` : 'Start date cleared.');
      setEditing(false);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <form className="flex flex-wrap items-end gap-2" onSubmit={save}>
        <label className="block">
          <span className="ui-label">Attendance on CLOR from</span>
          <input type="date" className="ui-input !w-auto" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy}>Save</button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => { setDate(value || ''); setEditing(false); }}>Cancel</button>
      </form>
    );
  }
  return (
    <p className="ui-caption flex flex-wrap items-center gap-x-2">
      <span>{value ? `Attendance kept on CLOR from ${dayLabel(value)}. Days before it with no record are not counted.` : 'No start date: every working day since joining counts.'}</span>
      {canChange ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setEditing(true)}>{value ? 'Change' : 'Set start date'}</button> : null}
    </p>
  );
}
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function MonthClose({ openScreen, params }) {
  const [month, setMonth] = useState(params?.month || lastMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [lopOk, setLopOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const perms = usePermissions();
  const canClose = Boolean(perms?.isAdmin) || Boolean(perms?.permissions?.has?.('ATTENDANCE::Attendance Records::APPROVE'));

  const load = useCallback(() => {
    getMonthReadiness(month)
      .then((d) => { setData(d); setError(''); setAck(false); setLopOk(false); })
      .catch((e) => setError(String(e?.message || 'Could not check the month.')));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const openItems = (data?.checks || []).filter((c) => c.count > 0);
  /* Docked as unpaid absence on close: never an "all clear", and confirmed on its own. */
  const noRecordDays = data?.noRecordDays || 0;
  /* `ready` is false while days would be docked; what is red to settle is `blocking`. */
  const blocked = (data?.blocking || 0) > 0;
  /* Reader punches held for this month: the server refuses the close until each is counted or discarded. */
  const held = (data?.checks || []).find((c) => c.key === 'held')?.count || 0;
  const noRecordPeople = (data?.people || []).filter((p) => p.noRecord > 0);
  /* A team-scoped role sees its own team's days; the month is closed by someone who sees the company. */
  const teamOnly = data?.scope === 'team';
  const filters = useColumnFilters();
  /* Everyone with something open, however many: the list pages, it never cuts. */
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const openPeople = (data?.people || []).filter(hasOpen);
  const kindCounts = KINDS.reduce((c, k) => ({ ...c, [k.value]: k.value ? openPeople.filter((p) => p[k.value] > 0).length : openPeople.length }), {});
  const inKind = kind ? openPeople.filter((p) => p[kind] > 0) : openPeople;
  const people = filters.applyFilters(inKind, { employee: (p) => `${p.name}${p.code ? ` · ${p.code}` : ''}` });
  const { pageCount, safePage, pageRows } = usePaged(people, perPage, page);
  useResetPage(setPage, [kind, month, filters.filters ?? null]);
  /* Arrow keys, Home and End move between the kinds, as a tab list does. */
  const tabKeys = (e) => {
    const at = KINDS.findIndex((k) => k.value === kind);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: KINDS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = KINDS[(to + KINDS.length) % KINDS.length].value;
    setKind(next);
    document.getElementById(`kind-tab-${next || 'all'}`)?.focus();
  };
  const close = async () => {
    setBusy(true);
    try {
      const r = await closeMonth(month, openItems.length > 0, noRecordDays ? data.noRecordConfirm : undefined);
      notify.success(`${monthName(month)} closed. Snapshot ${r.snapshot?.version ?? ''} kept for Payroll.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not closed.'));
    } finally {
      setBusy(false);
    }
  };
  const [reopening, setReopening] = useState(false);
  const reopen = () => setReopening(true);
  const downloadSnapshot = async (version) => {
    try {
      const s = await getMonthSnapshot(month, version);
      downloadCsv({
        fileName: `Attendance ${month} snapshot ${version}`,
        columns: [
          { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' },
          { key: 'payableDays', label: 'Payable days' }, { key: 'lossOfPayDays', label: 'Loss of pay' }, { key: 'present', label: 'Present' },
          { key: 'halfDays', label: 'Half days' }, { key: 'absent', label: 'Absent' }, { key: 'incompleteDays', label: 'No check-out' },
          { key: 'leave', label: 'Leave' }, { key: 'unpaidLeaveDays', label: 'Unpaid leave' }, { key: 'approvedOvertimeMinutes', label: 'Approved OT (min)' }, { key: 'weightedOvertimeMinutes', label: 'OT at the rate (min)' }, { key: 'overCapOvertimeMinutes', label: 'OT over the cap (min)' },
        ],
        rows: s.rows,
      });
    } catch (e) {
      notify.error(String(e?.message || 'Could not download.'));
    }
  };
  const go = (c) => {
    if (!openScreen) return;
    const end = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
    if (c.screen === 'records') openScreen('records', { from: `${month}-01`, to: end, ...(c.key === 'unvalidated' ? { validated: 'false' } : {}), ...(c.key === 'trustCheck' ? { trust: 'CHECK' } : {}) });
    else openScreen(c.screen);
  };

  return (
    <div className="space-y-3">
      <PageHeader
        entity="report"
        title="Month close"
        description="Check the month before Payroll takes it. Closing makes its days final and keeps a snapshot of the figures."
        actions={<input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      />
      <div className="pb-8 space-y-6">
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={8} />
      ) : (
        <>
          <section className={`ui-card ui-readiness ${data.closed ? 'is-closed' : blocked ? 'is-blocked' : noRecordDays ? 'is-warn' : 'is-ready'}`} aria-live="polite">
            <div className="flex items-start gap-3">
              {data.closed ? <Lock size={22} aria-hidden="true" /> : !blocked && !noRecordDays ? <CheckCircle2 size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <h2 className="ui-t-sec">
                  {data.closed
                    ? `${monthName(month)} is closed`
                    : !data.ended
                      ? `${monthName(month)} has not ended yet`
                      : blocked
                        ? `${data.blocking} thing${data.blocking === 1 ? '' : 's'} to settle before ${monthName(month)} closes`
                        : noRecordDays
                          ? `${days(noRecordDays)} with no record would be docked as unpaid absence`
                          : !data.toCheck
                            ? `${monthName(month)} is ready to close`
                            : `${monthName(month)} can close; ${data.toCheck} thing${data.toCheck === 1 ? '' : 's'} to check`}
                </h2>
                <p className="ui-caption mt-0.5">
                  {data.closed
                    ? `Closed ${new Date(data.closed.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. Its days are final until it is reopened.`
                    : !blocked && noRecordDays
                      ? `${noRecordPeople.length.toLocaleString('en-IN')} ${noRecordPeople.length === 1 ? 'person has' : 'people have'} days with no punch, mark or leave. Correct them, or set when attendance started on CLOR, before closing.`
                      : 'Settle the red items first. The others are worth a look; payable days are worked out from what is there.'}
                </p>
                {!data.closed && !teamOnly ? <div className="mt-2"><StartDate value={data.attendanceStartDate} canChange={canClose} onSaved={load} /></div> : null}
              </div>
              {data.closed && !teamOnly ? (
                <button type="button" className="ui-btn ui-btn-secondary" onClick={reopen}><Unlock size={16} aria-hidden="true" /> Reopen</button>
              ) : null}
            </div>
          </section>

          <section className="ui-card overflow-hidden" aria-labelledby="checks-h">
            <h2 id="checks-h" className="ui-t-sec px-4 pt-4 pb-2">Checklist</h2>
            <ul className="divide-y">
              {data.checks.map((c) => (
                <li key={c.key} className="ui-check-row" data-state={c.count === 0 ? 'ok' : c.severity}>
                  <span className="ui-check-mark" aria-hidden="true">{c.count === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="ui-caption">{c.count === 0 ? 'Nothing here.' : c.hint}</span>
                  </span>
                  <span className="ui-check-count tabular-nums" aria-label={`${c.count} ${c.count === 1 ? 'item' : 'items'}`}>{c.count}</span>
                  {c.count && openScreen ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => go(c)}>Open</button> : <span className="w-[3.75rem]" />}
                </li>
              ))}
            </ul>
          </section>

          {held && !data.closed ? <HeldPunches canDecide={canClose} onChanged={load} month={month} key={month} /> : null}

          {teamOnly ? (
            <p className="ui-caption px-1" role="note">These are your team’s days. Closing or reopening the month is done by someone who sees the whole company.</p>
          ) : null}

          {!data.closed && data.ended && !teamOnly ? (
            <section className="ui-card p-4 space-y-3" aria-labelledby="close-h">
              <h2 id="close-h" className="ui-t-sec">Close {monthName(month)}</h2>
              <p className="text-sm ui-muted">Corrections, leave, manual changes and late reader uploads can no longer change its days. Payroll takes the figures as they are now; a snapshot is kept.</p>
              {held ? <p className="text-sm ui-text-neg" role="note">{held} reader punch{held === 1 ? ' is' : 'es are'} held for a look in this month. Count or discard {held === 1 ? 'it' : 'them'} under Held for a look before closing.</p> : null}
              {noRecordDays ? <NoRecordConfirm people={noRecordPeople} count={noRecordDays} checked={lopOk} onChange={setLopOk} /> : null}
              {openItems.length ? (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="ui-checkbox mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>I have seen the {openItems.length} open item{openItems.length === 1 ? '' : 's'} above and want to close the month as it is.</span>
                </label>
              ) : null}
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy || held > 0 || (openItems.length > 0 && !ack) || (noRecordDays > 0 && !lopOk)} onClick={close}>
                <Lock size={16} aria-hidden="true" /> {busy ? 'Closing…' : 'Close the month'}
              </button>
            </section>
          ) : null}

          <section className="ui-card overflow-hidden" aria-labelledby="people-h">
            <div className="px-4 pt-4 pb-2 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 id="people-h" className="ui-t-sec">By person</h2>
                <span className="ui-caption tabular-nums">{openPeople.length === 1 ? '1 person has' : `${openPeople.length.toLocaleString('en-IN')} people have`} something open</span>
              </div>
              {openPeople.length ? (
                <div className="ui-segmented max-w-full overflow-x-auto" role="tablist" aria-label="What is open" onKeyDown={tabKeys}>
                  {KINDS.map((k) => (
                    <button
                      key={k.value || 'all'}
                      id={`kind-tab-${k.value || 'all'}`}
                      type="button"
                      role="tab"
                      aria-selected={kind === k.value}
                      aria-controls="people-panel"
                      tabIndex={kind === k.value ? 0 : -1}
                      className="ui-segment"
                      onClick={() => setKind(k.value)}
                    >
                      {k.label}
                      {/* People, not days: the checklist above counts days. */}
                      <span className="ui-segment-count tabular-nums" data-on={kindCounts[k.value] > 0 ? 'true' : undefined}>
                        {kindCounts[k.value].toLocaleString('en-IN')} {kindCounts[k.value] === 1 ? 'person' : 'people'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="ui-table-scroll" id="people-panel" role="tabpanel" aria-labelledby={`kind-tab-${kind || 'all'}`}>
              <table className="ui-table ui-table-sticky w-full">
                <thead>
                  <tr>
                    <ColumnHeader label="Employee" col="employee" state={filters}  className="ui-col-grow" />
                    <th scope="col" className="ui-num">No check-out</th>
                    <th scope="col" className="ui-num">No attendance</th>
                    <th scope="col" className="ui-num">Overtime to approve</th>
                    <th scope="col" className="ui-num">Not validated</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {!people.length ? (
                    <tr>
                      <td colSpan={6}>
                        {inKind.length ? (
                          <EmptyState kind="filtered" totalCount={inKind.length} title="Nobody matches" description="Nobody matches the column filter." />
                        ) : openPeople.length ? (
                          <EmptyState icon={CheckCircle2} title="Nobody has this open" description="Pick another kind, or All." />
                        ) : (
                          <EmptyState icon={CheckCircle2} title="Everyone’s days are complete" />
                        )}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((p) => (
                      <tr key={p.employeeId}>
                        <td className="ui-col-entity">{p.name}{p.code ? <span className="ui-caption"> · {p.code}</span> : null}</td>
                        <td className="ui-num">{p.missingOut ? <strong style={{ color: 'rgb(var(--neg))' }}>{p.missingOut}</strong> : '—'}</td>
                        <td className="ui-num">{p.noRecord || '—'}</td>
                        <td className="ui-num">{p.unapprovedOvertime || '—'}</td>
                        <td className="ui-num">{p.unvalidated || '—'}</td>
                        <td className="ui-col-meta">{openScreen ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openScreen('records', { employeeId: p.employeeId, from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}` })}><CalendarDays size={14} aria-hidden="true" /> Days</button> : null}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {people.length ? <Pagination total={people.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun={people.length === 1 ? 'person' : 'people'} /> : null}
          </section>

          {data.snapshots?.length ? (
            <section className="ui-card overflow-hidden" aria-labelledby="snap-h">
              <h2 id="snap-h" className="ui-t-sec px-4 pt-4 pb-2">What Payroll took</h2>
              <ul className="divide-y">
                {data.snapshots.map((s) => (
                  <li key={s.version} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-medium">Snapshot {s.version}</span>
                    <span className="ui-caption flex-1">{new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {s.by}</span>
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => downloadSnapshot(s.version)}><Download size={14} aria-hidden="true" /> CSV</button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      </div>
      {reopening ? <ReopenMonth month={month} label={monthName(month)} onClose={() => setReopening(false)} onDone={() => { setReopening(false); load(); }} /> : null}
    </div>
  );
}
