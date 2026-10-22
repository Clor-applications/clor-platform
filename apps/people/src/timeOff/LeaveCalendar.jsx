import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { STATUS_LABEL, colorOf, listHolidays, listLeaveRequests } from './api';

/**
 * People → Leave & Attendance → Leave Calendar: who is away this month, one
 * line a person, with the holidays. Waiting requests show lighter, so a
 * manager sees a clash before approving into it.
 */
const pad = (n) => String(n).padStart(2, '0');
const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const shift = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  return monthOf(new Date(y, m - 1 + by, 1));
};
const daysIn = (month) => {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`);
};
const weekday = (date) => new Date(`${date}T00:00:00`).getDay();
const title = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export default function LeaveCalendar() {
  const [month, setMonth] = useState(monthOf(new Date()));
  const [requests, setRequests] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [dept, setDept] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([listLeaveRequests({ month }), listHolidays(month.slice(0, 4))])
      .then(([r, h]) => { setRequests(r.filter((x) => ['APPROVED', 'PENDING'].includes(x.status))); setHolidays(h); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not load the calendar.')));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const days = daysIn(month);
  const today = new Date().toISOString().slice(0, 10);
  const holidayOn = useMemo(() => new Map(holidays.filter((h) => h.date.startsWith(month) && !h.isOptional).map((h) => [h.date, h.name])), [holidays, month]);
  const departments = useMemo(() => [...new Set((requests || []).map((r) => r.department).filter(Boolean))].sort(), [requests]);
  const people = useMemo(() => {
    const byPerson = new Map();
    for (const r of requests || []) {
      if (dept && r.department !== dept) continue;
      if (!byPerson.has(r.employeeId)) byPerson.set(r.employeeId, { id: r.employeeId, name: r.employeeName, department: r.department, leave: [] });
      byPerson.get(r.employeeId).leave.push(r);
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, dept]);
  const awayOn = (date) => people.filter((p) => p.leave.some((r) => r.fromDate <= date && date <= r.toDate && r.status === 'APPROVED')).length;
  const types = useMemo(() => {
    const m = new Map();
    for (const r of requests || []) m.set(r.leaveTypeId, { name: r.leaveTypeName, color: r.leaveTypeColor });
    return [...m.values()];
  }, [requests]);

  return (
    <div className="space-y-3 pb-8">
      <PageHeader
        entity="leave"
        title="Leave Calendar"
        description="Who is away this month. Waiting requests are lighter."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {departments.length ? (
              <select className="ui-select w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
                <option value="">Every department</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            ) : null}
            <div className="inline-flex items-center gap-1">
              <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} /></button>
              <span className="min-w-36 text-center font-medium">{title(month)}</span>
              <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight size={16} /></button>
            </div>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMonth(monthOf(new Date()))}>This month</button>
          </div>
        }
      />
      {error ? <p role="alert" className="ui-card p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!requests ? (error ? null : <SkeletonCard lines={6} />) : (
        <div className="ui-card overflow-hidden">
          <div className="ui-table-scroll">
            <table className="w-full border-collapse text-xs" aria-label={`Leave in ${title(month)}`}>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-[rgb(var(--surface))] p-2 text-left text-sm font-medium min-w-44">Person</th>
                  {days.map((d) => {
                    const off = weekday(d) === 0 || holidayOn.has(d);
                    return (
                      <th key={d} scope="col" title={holidayOn.get(d) || undefined} className={`p-0.5 text-center font-normal min-w-6 ${off ? 'bg-[rgb(var(--surface-sunken))] ui-muted' : ''} ${d === today ? 'text-[rgb(var(--brand))] font-semibold' : ''}`}>
                        <div>{'SMTWTFS'[weekday(d)]}</div>
                        <div>{Number(d.slice(8))}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                    <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--surface))] p-2 text-left text-sm font-normal">
                      {p.name}{p.department ? <span className="ui-caption block">{p.department}</span> : null}
                    </th>
                    {days.map((d) => {
                      const r = p.leave.find((x) => x.fromDate <= d && d <= x.toDate);
                      const off = weekday(d) === 0 || holidayOn.has(d);
                      return (
                        <td key={d} className={`p-0.5 text-center ${off ? 'bg-[rgb(var(--surface-sunken))]' : ''}`}>
                          {r ? (
                            <span
                              className="block h-5 rounded-sm"
                              style={{ background: colorOf({ color: r.leaveTypeColor, name: r.leaveTypeName }), opacity: r.status === 'PENDING' ? 0.4 : 1 }}
                              title={`${r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}${r.halfDay ? ', half day' : ''}`}
                            />
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                  <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--surface))] p-2 text-left text-sm font-medium">Away</th>
                  {days.map((d) => <td key={d} className="p-1 text-center ui-muted">{awayOn(d) || ''}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          {!people.length ? <p className="p-4 text-sm ui-muted">Nobody is away in {title(month)}{dept ? ` in ${dept}` : ''}.</p> : null}
          <div className="flex flex-wrap gap-4 border-t p-3 text-xs" style={{ borderColor: 'rgb(var(--border))' }}>
            {types.map((t) => <span key={t.name} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(t) }} aria-hidden="true" />{t.name}</span>)}
            {[...holidayOn.entries()].map(([d, n]) => <span key={d} className="ui-muted">{Number(d.slice(8))}: {n}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
