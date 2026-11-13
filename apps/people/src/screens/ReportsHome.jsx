import React, { useMemo, useState } from 'react';
import { ChevronRight } from '@ui/components/ui/lineIcons';

import ListHeader from '@ui/components/list/ListHeader';
import SearchField from '@ui/components/ui/SearchField';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import useRequest from '@ui/components/ui/useRequest';
import { listHrReports } from '../api/hrReports';
import { listReports as listAttendanceReports } from '../../../attendance/src/api/attendance';

/*
 * Reports home (platform audit, 11 Nov 2026): every People and Time report on
 * one page, in plain groups, each row opening its report full page.
 *
 * Three sources, one list: People's own reports (the server names the ones
 * this reader may open), the report screens already on the menu (only those
 * the shell kept for this person: `navItems`), and Attendance's reports, which
 * a People company reaches here without opening the Attendance app.
 * A group with nothing in it is not drawn.
 */
const GROUPS = ['Workforce', 'Joining and leaving', 'Time and attendance', 'Leave', 'Documents and compliance', 'Requests'];

/** The report screens the menu already has, and the group each sits in. */
const SCREENS = [
  ['reports', 'Joining and leaving', 'Headcount, joiners, leavers and attrition month by month, and why people leave'],
  ['summary', 'Time and attendance', 'Each person’s month: present, absent, leave, holidays and payable days'],
  ['register', 'Time and attendance', 'Everyone’s in and out for a day'],
  ['leaveRegister', 'Leave', 'Leave taken, person by person'],
  ['leaveSummary', 'Leave', 'Leave taken by department and leave type'],
  ['registers', 'Documents and compliance', 'The registers an inspector asks for, in the form the law sets'],
  ['requestsReport', 'Requests', 'Every request of the types HR set up: who asked, where it stands, days to decide'],
];

/** Where each of Attendance's reports sits here: by its id first, then by Attendance's own group. */
const ATTENDANCE_GROUP = { Attendance: 'Time and attendance', Workforce: 'Time and attendance', Devices: 'Time and attendance', 'Statutory Registers': 'Documents and compliance', People: 'Workforce' };
const ATTENDANCE_BY_ID = { leave: 'Leave' };
/* Two leave registers: People's own screen, and the statutory form Attendance prints. Each says which it is. */
const ATTENDANCE_NAME = { leave: 'Leave register, statutory form' };
/* People's own "Documents expiring" covers the same files with more filters; the Attendance one stays under All attendance reports. */
const ATTENDANCE_SKIP = new Set(['documents']);
/** Sentence case, as the rest of People is written: "Late Arrivals & Early Exits" reads "Late arrivals & early exits". */
const sentence = (name) => String(name || '').replace(/(?!^)\b[A-Z](?=[a-z])/g, (c) => c.toLowerCase());

export default function ReportsHome({ openScreen, navItems = [] }) {
  const [q, setQ] = useState('');
  const byKey = useMemo(() => new Map(navItems.filter((i) => i.key).map((i) => [i.key, i])), [navItems]);
  const own = useRequest(() => listHrReports().catch(() => ({ reports: [] })), []);
  const hasAttendance = byKey.has('attendanceReports');
  const attendance = useRequest(() => (hasAttendance ? listAttendanceReports().catch(() => ({ reports: [] })) : Promise.resolve({ reports: [] })), [hasAttendance]);

  const rows = useMemo(() => {
    const out = [];
    for (const r of own.data?.reports || []) out.push({ key: `hr:${r.id}`, group: r.group, label: r.name, note: r.description, open: () => openScreen?.('hrReport', { report: r.id }) });
    for (const [key, group, note] of SCREENS) {
      const item = byKey.get(key);
      if (item) out.push({ key, group, label: item.label, note, open: () => openScreen?.(key) });
    }
    for (const r of attendance.data?.reports || []) {
      if (ATTENDANCE_SKIP.has(r.id)) continue;
      out.push({ key: `att:${r.id}`, group: ATTENDANCE_BY_ID[r.id] || ATTENDANCE_GROUP[r.group] || 'Time and attendance', label: ATTENDANCE_NAME[r.id] || sentence(r.name), note: r.description, open: () => openScreen?.('attendanceReports', { report: r.id }) });
    }
    if (hasAttendance) out.push({ key: 'attendanceReports', group: 'Time and attendance', label: byKey.get('attendanceReports').label, note: 'Pick any attendance report, set its filters, and schedule it by email', open: () => openScreen?.('attendanceReports') });
    return out;
  }, [own.data, attendance.data, byKey, hasAttendance, openScreen]);

  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((title) => ({ title, rows: rows.filter((r) => r.group === title && (!needle || `${r.label} ${r.note} ${title}`.toLowerCase().includes(needle))) })).filter((g) => g.rows.length);
  const loading = own.loading || attendance.loading;

  return (
    <div className="space-y-6 pb-8">
      <ListHeader
        breadcrumb={[{ label: 'People' }, { label: 'Reports' }]}
        title="Reports"
        description="Every People and Time report. Open one to set its dates and filters, see the chart and export the rows."
        entity="report"
        toolbar={<SearchField value={q} onSearch={setQ} delay={150} placeholder="Search reports" label="Search reports" className="w-full sm:w-80" />}
      />
      {loading && !rows.length ? <SkeletonCard lines={8} /> : null}
      {!loading && !groups.length ? <p className="ui-muted text-sm">{needle ? `No report matches “${q}”.` : 'No report is open to your role.'}</p> : null}
      {groups.map((g) => (
        <section key={g.title} className="space-y-2" aria-labelledby={`rep-${g.title}`}>
          <h2 id={`rep-${g.title}`} className="ui-t-sec">{g.title}</h2>
          {/* Plain rows on the page ground under one hairline, as Settings draws its pages. */}
          <ul className="ui-settings-rows">
            {g.rows.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={r.open} className="ui-settings-row">
                  <span className="ui-settings-row-icon" aria-hidden="true" />
                  <span className="ui-settings-row-label">{r.label}</span>
                  <span className="ui-settings-row-note">{r.note}</span>
                  <ChevronRight size={16} aria-hidden="true" className="ui-settings-row-go" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
