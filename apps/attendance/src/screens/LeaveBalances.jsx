import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, HelpCircle, UserCog, Upload, Users, Wallet } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { explainLeave, getLeaveBalances, setAllocation, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import LeaveExplain from '../components/LeaveExplain';

const COLUMNS = { employee: (r) => r.name };

/**
 * Days left per person and type. Click a paid type's figure to give someone a
 * different number of days for the year (a joiner, a carry-over); clear it to
 * put them back on the type's days.
 */
export default function LeaveBalances({ openScreen } = {}) {
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [explaining, setExplaining] = useState(null);
  const explainLoad = useCallback(() => explainLeave(explaining?.employeeId, explaining?.leaveTypeId, explaining?.year), [explaining]);
  const [editing, setEditing] = useState(null); // { employeeId, leaveTypeId, value }

  const load = useCallback(() => {
    getLeaveBalances(year).then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load balances.')));
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const v = String(editing.value).trim();
    try {
      await setAllocation({ employeeId: editing.employeeId, leaveTypeId: editing.leaveTypeId, year, days: v === '' ? null : Number(v) });
      setEditing(null);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  const types = data?.types || [];
  const exportColumns = [
    { key: 'code', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    ...types.flatMap((t) =>
      t.isPaid
        ? [
            { key: `${t.id}-c`, label: `${t.name} carried in`, value: (r) => r.balances[t.id]?.carriedIn ?? '' },
            { key: `${t.id}-a`, label: `${t.name} allotted`, value: (r) => r.balances[t.id]?.allocated },
            { key: `${t.id}-u`, label: `${t.name} taken`, value: (r) => r.balances[t.id]?.used },
            { key: `${t.id}-l`, label: `${t.name} left`, value: (r) => r.balances[t.id]?.available },
          ]
        : [{ key: `${t.id}-u`, label: `${t.name} taken`, value: (r) => r.balances[t.id]?.used }]
    ),
  ];
  const search = useListSearch(data?.rows, ['name', 'code']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useResetPage(setPage, [search.query, year]);
  const figures = useMemo(() => {
    const all = data?.rows || [];
    const paid = (data?.types || []).filter((t) => t.isPaid);
    let taken = 0;
    let custom = 0;
    for (const r of all) {
      for (const t of paid) {
        const b = r.balances[t.id] || {};
        taken += Number(b.used || 0);
        if (b.allocationId) custom += 1;
      }
    }
    return { people: all.length, paidTypes: paid.length, taken, custom };
  }, [data]);

  return (
    <DocumentListShell
      entity="leave"
      title="Leave balances"
      description="Left of allotted, per person. Click a figure to change someone's days for the year."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search leave balances' }}
      headerExtras={
        <div className="flex items-center gap-1">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹</button>
          <span className="min-w-[4ch] text-center font-medium tabular-nums">{year}</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">›</button>
        </div>
      }
      moreItems={[...(data?.rows?.length ? [exportMenuItem('Export leave balances')] : []), ...(openScreen ? [{ key: 'import', label: 'Import opening balances', Icon: Upload }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'import') return openScreen('dataImport', { kind: 'leaveBalances' });
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: `Leave balances ${year}`, fileName: `Leave balances ${year}`, label: 'person/people', columns: exportColumns, rows: data.rows });
      }}
      cards={[
        { label: 'People', value: figures.people, count: true, tone: 'all', Icon: Users },
        { label: 'Paid leave types', value: figures.paidTypes, count: true, tone: 'paid', Icon: Wallet },
        { label: 'Paid days taken', value: figures.taken, count: true, tone: 'sent', Icon: CalendarCheck },
        { label: 'Set for one person', value: figures.custom, count: true, tone: 'outstanding', Icon: UserCog },
      ]}
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={6} />
      ) : !types.length ? (
        <EmptyState icon={Wallet} title="No leave types" description="Create leave types first (Leave types)." />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  {types.map((t) => (
                    <th key={t.id} scope="col" className="ui-num">{t.name}{t.isPaid ? '' : ' (unpaid)'}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={types.length + 1}>
                      {data.rows.length ? (
                        <EmptyState kind="filtered" totalCount={data.rows.length} title="No one matches" description="Nobody matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={Wallet}
                          title={`No balances in ${year}`}
                          description="Left of allotted, per person. Click a figure to change someone's days for the year."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="ui-col-entity">{r.name}{r.code ? <span className="ui-caption"> · {r.code}</span> : null}</td>
                      {types.map((t) => {
                        const b = r.balances[t.id] || {};
                        const isEditing = editing?.employeeId === r.employeeId && editing?.leaveTypeId === t.id;
                        if (!t.isPaid) return <td key={t.id} className="ui-num">{b.used ? `${b.used} taken` : '—'}</td>;
                        return (
                          <td key={t.id} className="ui-num whitespace-nowrap">
                            {isEditing ? (
                              <span className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={366}
                                  step={0.5}
                                  autoFocus
                                  className="ui-input ui-ctl-compact !w-20"
                                  aria-label={`${t.name} days for ${r.name} in ${year}`}
                                  placeholder={`${t.annualDays}`}
                                  value={editing.value}
                                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') save();
                                    if (e.key === 'Escape') setEditing(null);
                                  }}
                                />
                                <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={save}>Save</button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="ui-btn ui-btn-ghost ui-btn-sm"
                                title={b.allocationId ? 'Set for this person' : `${b.earned ?? b.allocated} earned so far${b.carriedIn ? ` + ${b.carriedIn} carried in` : ''}; ${b.fullYear ?? b.allocated} by 31 December`}
                                aria-label={`${r.name}: ${b.available} of ${b.allocated} ${t.name} left; change allotted days`}
                                onClick={() => setEditing({ employeeId: r.employeeId, leaveTypeId: t.id, value: b.allocationId ? String(b.allocated) : '' })}
                              >
                                {b.available}<span className="ui-caption"> / {b.allocated}{b.allocationId ? '*' : ''}</span>
                                {b.carriedIn ? <span className="ui-caption block">{b.carriedIn} carried in</span> : null}
                              </button>
                            )}
                            {isEditing ? null : (
                              <button type="button" className="ui-icon-btn ui-icon-btn-xs" title="How is this worked out?" aria-label={`How ${r.name}'s ${t.name} balance is worked out`} onClick={() => setExplaining({ employeeId: r.employeeId, leaveTypeId: t.id, year })}>
                                <HelpCircle size={14} aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="people" />
          <p className="ui-caption px-4 py-2">* set for that person; others get the type's days. Blank and save to go back to the type's days.</p>
        </>
      )}
      <LeaveExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
    </DocumentListShell>
  );
}
