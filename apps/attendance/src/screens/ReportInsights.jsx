import React, { useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, StatTile, EmptyState } from '@ui/components/ui/Primitives';
import { getReportInsights, listReports } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const fmt = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);

/** One small bar chart: a value per month, scaled to the highest (or to 100 for a rate). */
function Trend({ title, caption, points, unit = '', tone, max }) {
  const top = max ?? Math.max(1, ...points.map((p) => Number(p.value) || 0));
  return (
    <section className="ui-card p-4 space-y-3" aria-label={title}>
      <div>
        <h2 className="ui-t-sec">{title}</h2>
        {caption ? <p className="ui-caption">{caption}</p> : null}
      </div>
      <ol className="ui-trend">
        {points.map((p) => (
          <li key={p.month} aria-label={`${monthName(p.month)}: ${fmt(p.value, unit)}`} title={`${monthName(p.month)}: ${fmt(p.value, unit)}`}>
            <span className="ui-trend-value tabular-nums" aria-hidden="true">{fmt(p.value, unit)}</span>
            <span className="ui-trend-bar" data-tone={tone} aria-hidden="true">
              <span style={{ height: `${Math.min(100, ((Number(p.value) || 0) / top) * 100)}%` }} />
            </span>
            <span className="ui-trend-label" aria-hidden="true">{monthName(p.month)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Reports → Insights: how attendance is going, before anyone opens a table.
 * The last months' attendance and absenteeism rates, late days and approved
 * overtime, then this month by department and the people most often late or
 * absent (each opens their days). Same figures as the Monthly Attendance
 * Summary, so the two never disagree.
 */
export default function ReportInsights({ openScreen }) {
  const [filters, setFilters] = useState({ months: 6, departmentId: '', areaId: '', contractorId: '' });
  const [lists, setLists] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    listReports().then(setLists).catch(() => setLists({ departments: [], areas: [], contractors: [] }));
  }, []);
  useEffect(() => {
    let live = true;
    getReportInsights(filters)
      .then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => { if (live) setError(String(e?.message || 'Could not load insights.')); });
    return () => { live = false; };
  }, [filters, attempt]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const now = data?.trend?.[data.trend.length - 1];
  const before = data?.trend?.[data.trend.length - 2];
  const change = (k) => (now && before && now[k] != null && before[k] != null ? Math.round((now[k] - before[k]) * 10) / 10 : null);
  const delta = (k, unit) => {
    const d = change(k);
    if (d == null || d === 0) return 'same as last month';
    return `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit} vs last month`;
  };
  const openPerson = (p) => (openScreen ? () => openScreen('records', { employeeId: p.employeeId, from: `${data.current}-01`, to: new Date().toISOString().slice(0, 10) }) : undefined);

  return (
    <div className="space-y-3">
      <PageHeader entity="report" title="Attendance insights" description="How attendance is going this month and over recent months. Figures are the Monthly Attendance Summary's." />
      <div className="pb-8 space-y-4">
        <section className="ui-card flex flex-wrap items-end gap-3 p-4" aria-label="Filters">
          <div className="ui-segmented" role="tablist" aria-label="Months">
            {[3, 6, 12].map((m) => (
              <button key={m} type="button" role="tab" className="ui-segment" aria-selected={Number(filters.months) === m} onClick={() => setFilters((f) => ({ ...f, months: m }))}>{m} months</button>
            ))}
          </div>
          {lists?.departments?.length ? (
            <label className="block"><span className="ui-label">Department</span>
              <select className="ui-select" value={filters.departmentId} onChange={set('departmentId')}>
                <option value="">All</option>
                {lists.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          ) : null}
          {lists?.areas?.length ? (
            <label className="block"><span className="ui-label">Location</span>
              <select className="ui-select" value={filters.areaId} onChange={set('areaId')}>
                <option value="">All</option>
                {lists.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          ) : null}
          {lists?.contractors?.length ? (
            <label className="block"><span className="ui-label">Contractor</span>
              <select className="ui-select" value={filters.contractorId} onChange={set('contractorId')}>
                <option value="">All</option>
                {lists.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : null}
        </section>

        <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
        {!data ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="This month">
              <StatTile label="Attendance rate" value={fmt(now?.attendanceRate, '%')} hint={delta('attendanceRate', ' pts')} tone="pos" />
              <StatTile label="Absenteeism" value={fmt(now?.absenteeismRate, '%')} hint={delta('absenteeismRate', ' pts')} tone={now?.absenteeismRate ? 'neg' : 'neutral'} />
              <StatTile label="Late days" value={fmt(now?.lateDays)} hint={delta('lateDays', '')} tone={now?.lateDays ? 'warn' : 'neutral'} />
              <StatTile label="Late 3+ times" value={fmt(data.repeatLate)} hint="people this month" tone={data.repeatLate ? 'neg' : 'neutral'} />
              <StatTile label="Overtime" value={fmt(now?.overtimeHours, ' h')} hint="approved, this month" />
              <StatTile label="Loss of pay days" value={fmt(now?.lossOfPayDays)} hint="this month so far" tone={now?.lossOfPayDays ? 'warn' : 'neutral'} />
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <Trend title="Attendance rate" caption={data.definitions?.attendanceRate} points={data.trend.map((t) => ({ month: t.month, value: t.attendanceRate }))} unit="%" max={100} />
              <Trend title="Absenteeism" caption={data.definitions?.absenteeismRate} points={data.trend.map((t) => ({ month: t.month, value: t.absenteeismRate }))} unit="%" tone="warn" max={Math.max(10, ...data.trend.map((t) => t.absenteeismRate || 0))} />
              <Trend title="Late days" caption="Days someone came in after their shift's grace." points={data.trend.map((t) => ({ month: t.month, value: t.lateDays }))} tone="warn" />
              <Trend title="Approved overtime" caption="Hours, as payroll pays them." points={data.trend.map((t) => ({ month: t.month, value: t.overtimeHours }))} unit=" h" tone="neutral" />
            </div>

            <section className="ui-card overflow-hidden" aria-labelledby="dept-h">
              <div className="px-4 pt-4 pb-2">
                <h2 id="dept-h" className="ui-t-sec">This month by department</h2>
                <p className="ui-caption">Highest absenteeism first.</p>
              </div>
              {data.byDepartment.length ? (
                <div className="ui-table-scroll">
                  <table className="ui-table w-full">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th className="ui-num">People</th>
                        <th className="ui-num">Attendance</th>
                        <th>Absenteeism</th>
                        <th className="ui-num">Absent days</th>
                        <th className="ui-num">Late days</th>
                        <th className="ui-num">Overtime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byDepartment.map((d) => (
                        <tr key={d.department}>
                          <td>{d.department}</td>
                          <td className="ui-num">{d.people}</td>
                          <td className="ui-num">{fmt(d.attendanceRate, '%')}</td>
                          <td>
                            <span className="flex items-center gap-2">
                              <span className="ui-meter flex-1" aria-hidden="true"><span style={{ width: `${Math.min(100, (d.absenteeismRate || 0) * 4)}%` }} /></span>
                              <span className="tabular-nums text-sm">{fmt(d.absenteeismRate, '%')}</span>
                            </span>
                          </td>
                          <td className="ui-num">{d.absentDays}</td>
                          <td className="ui-num">{d.lateDays}</td>
                          <td className="ui-num">{fmt(d.overtimeHours, ' h')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 pb-4"><EmptyState title="No attendance this month yet" /></div>
              )}
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              {[
                ['Most often late', data.mostLate, 'late days'],
                ['Most often absent', data.mostAbsent, 'absent days'],
              ].map(([title, list, noun]) => (
                <section key={title} className="ui-card p-4 space-y-2" aria-label={title}>
                  <h2 className="ui-t-sec">{title}</h2>
                  <p className="ui-caption">This month. Open a name to see their days.</p>
                  {list.length ? (
                    <ul className="divide-y">
                      {list.map((p) => (
                        <li key={p.employeeId} className="flex items-center justify-between gap-3 py-2 text-sm">
                          {openPerson(p) ? (
                            <button type="button" className="ui-link text-left" onClick={openPerson(p)}>{p.name}{p.code ? ` · ${p.code}` : ''}</button>
                          ) : (
                            <span>{p.name}</span>
                          )}
                          <span className="ui-caption tabular-nums shrink-0">{p.days} {noun}{p.department ? `, ${p.department}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ui-muted text-sm">Nobody this month.</p>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
