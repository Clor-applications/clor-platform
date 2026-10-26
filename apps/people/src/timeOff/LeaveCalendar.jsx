import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { PRIVATE_LABEL, STATUS_LABEL, colorOf, getWorkingWeek, listHolidays, listLeaveRequests, todayIst } from './api';

/**
 * Time & Leave → Calendar: who is away in a month, one line a person, with
 * the holidays and the company's weekly offs shaded. Waiting requests show
 * lighter, so a manager sees a clash before approving into it. Private leave
 * reaches a reader without the right to see it as "Private leave": no type
 * colour, one neutral tone.
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
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const title = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const isPrivate = (r) => r.reasonHidden || r.leaveTypeName === PRIVATE_LABEL;
const toneOf = (r) => (isPrivate(r) ? { className: 'ui-dot-quiet' } : { style: { background: colorOf({ color: r.leaveTypeColor, name: r.leaveTypeName }) } });
/** The company's working week (Settings → Working week); Sunday alone when it cannot be read. */
const offTest = (week) => {
  const offs = new Set(String(week?.weeklyOffDays ?? '0').split(',').filter(Boolean).map(Number));
  const sats = new Set(String(week?.offSaturdays ?? '').split(',').filter(Boolean).map(Number));
  return (date) => {
    const w = weekday(date);
    return offs.has(w) || (w === 6 && sats.has(Math.ceil(Number(date.slice(8)) / 7)));
  };
};

export default function LeaveCalendar() {
  const today = todayIst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dept, setDept] = useState('');
  const req = useRequest(
    () => Promise.all([listLeaveRequests({ month }), listHolidays(month.slice(0, 4)), getWorkingWeek().catch(() => null)])
      .then(([r, h, week]) => ({ requests: r.filter((x) => ['APPROVED', 'PENDING'].includes(x.status)), holidays: h, week })),
    [month],
  );
  const requests = req.data?.requests;

  const days = daysIn(month);
  const isOffDay = useMemo(() => offTest(req.data?.week), [req.data?.week]);
  const holidayOn = useMemo(() => new Map((req.data?.holidays || []).filter((h) => h.date.startsWith(month) && !h.isOptional).map((h) => [h.date, h.name])), [req.data, month]);
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
  const legend = useMemo(() => {
    const m = new Map();
    for (const r of requests || []) {
      const key = isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeId;
      if (!m.has(key)) m.set(key, { key, name: isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName, row: r });
    }
    return [...m.values()].sort((a, b) => (a.key === PRIVATE_LABEL) - (b.key === PRIVATE_LABEL) || a.name.localeCompare(b.name));
  }, [requests]);
  const shaded = (d) => isOffDay(d) || holidayOn.has(d);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Time & Leave' }]}
        title="Calendar"
        actions={<>
          <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
            <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="min-w-36 text-center font-medium" aria-live="polite">{title(month)}</span>
            <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          {month !== today.slice(0, 7) ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMonth(today.slice(0, 7))}>This month</button> : null}
        </>}
      />

      {departments.length > 1 ? (
        <div className="w-full sm:w-56">
          <PopupSelect showValueSubtext={false} ariaLabel="Department" value={dept} onChange={(v) => setDept(v || '')} placeholder="Every department"
            options={[{ value: '', label: 'Every department' }, ...departments.map((d) => ({ value: d, label: d }))]} />
        </div>
      ) : null}

      {req.error && !requests ? <ErrorState error={req.error} onRetry={req.reload} /> : !requests ? <SkeletonCard lines={6} /> : !people.length ? (
        <EmptyState title={`Nobody is away in ${title(month)}${dept ? ` in ${dept}` : ''}`} />
      ) : (
        <section className="space-y-3" aria-label={`Leave in ${title(month)}`}>
          <div className="ui-table-scroll border-t" style={{ borderColor: 'rgb(var(--border))' }}>
            <table className="w-full border-collapse text-xs" aria-label={`Leave in ${title(month)}`}>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-medium min-w-44">Employee</th>
                  {days.map((d) => (
                    <th key={d} scope="col" title={holidayOn.get(d) || undefined} className={`p-0.5 text-center font-normal min-w-6 tabular-nums ${shaded(d) ? 'bg-[rgb(var(--border)/0.45)] ui-muted' : ''} ${d === today ? 'text-[rgb(var(--brand-ink))] font-medium' : ''}`}>
                      <div>{'SMTWTFS'[weekday(d)]}</div>
                      <div>{Number(d.slice(8))}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                    <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-normal">
                      {p.name}{p.department ? <span className="ui-caption block">{p.department}</span> : null}
                    </th>
                    {days.map((d) => {
                      const r = p.leave.find((x) => x.fromDate <= d && d <= x.toDate);
                      const tone = r ? toneOf(r) : null;
                      return (
                        <td key={d} className={`p-0.5 text-center ${shaded(d) ? 'bg-[rgb(var(--border)/0.45)]' : ''}`}>
                          {r ? (
                            <span
                              className={`block h-5 ${tone.className || ''}`}
                              style={{ ...(tone.style || {}), opacity: r.status === 'PENDING' ? 0.4 : 1 }}
                              title={`${isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}${r.halfDay ? ', half day' : ''}`}
                              aria-label={`${d}: ${isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}`}
                            />
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                  <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-medium">Away</th>
                  {days.map((d) => <td key={d} className="p-1 text-center ui-muted tabular-nums">{awayOn(d) || ''}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Key">
            {legend.map((t) => {
              const tone = toneOf(t.row);
              return <li key={t.key} className="inline-flex items-center gap-1.5"><span className={`inline-block h-2.5 w-2.5 rounded-full ${tone.className || ''}`} style={tone.style} aria-hidden="true" />{t.name}</li>;
            })}
            <li className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full ui-dot-quiet" style={{ opacity: 0.4 }} aria-hidden="true" />Waiting</li>
            {[...holidayOn.entries()].map(([d, n]) => <li key={d} className="ui-muted tabular-nums">{Number(d.slice(8))}: {n}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
