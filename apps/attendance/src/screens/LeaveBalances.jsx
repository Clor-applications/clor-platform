import React, { useCallback, useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { explainLeave, getLeaveBalances, setAllocation, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import LeaveExplain from '../components/LeaveExplain';

/**
 * Days left per person and type. Click a paid type's figure to give someone a
 * different number of days for the year (a joiner, a carry-over); clear it to
 * put them back on the type's days.
 */
export default function LeaveBalances() {
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
  const exportCsv = () =>
    downloadCsv({
      fileName: `Leave balances ${year}`,
      columns: [
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
      ],
      rows: data.rows,
    });

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Leave balances"
        description="Left of allotted, per person. Click a figure to change someone's days for the year."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹</button>
              <span className="min-w-[4ch] text-center font-medium tabular-nums">{year}</span>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">›</button>
            </div>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!data?.rows?.length} onClick={exportCsv}>Export</button>
          </div>
        }
      />
      <LoadFailed message={loadError} onRetry={load} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={6} />
      ) : !types.length ? (
        <EmptyState title="No leave types" description="Create leave types first (Leave types)." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  {types.map((t) => (
                    <th key={t.id} scope="col" className="ui-th text-end">{t.name}{t.isPaid ? '' : ' (unpaid)'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td className="ui-col-entity">{r.name}{r.code ? <span className="ui-caption"> · {r.code}</span> : null}</td>
                    {types.map((t) => {
                      const b = r.balances[t.id] || {};
                      const isEditing = editing?.employeeId === r.employeeId && editing?.leaveTypeId === t.id;
                      if (!t.isPaid) return <td key={t.id} className="text-end tabular-nums">{b.used ? `${b.used} taken` : '—'}</td>;
                      return (
                        <td key={t.id} className="text-end tabular-nums whitespace-nowrap">
                          {isEditing ? (
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={366}
                                step={0.5}
                                autoFocus
                                className="ui-input !w-20"
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
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-caption px-4 py-2">* set for that person; others get the type's days. Blank and save to go back to the type's days.</p>
        </div>
      )}
      <LeaveExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
    </div>
  );
}
