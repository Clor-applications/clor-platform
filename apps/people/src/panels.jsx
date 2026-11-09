import React from 'react';
import {
  BarChart3, Building2, CalendarDays, CalendarRange, ClipboardCheck, FileText, Gavel, Inbox, LifeBuoy, ListChecks, Lock, MapPin,
  Network, Scale, Settings2, Timer, Upload, UserCheck, Users, Workflow,
} from '@ui/components/ui/lineIcons';

import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { DateTile, SideAlert, SideBlock, SideClear, SideLine, SideTimeline } from '@ui/components/list/SidePanel';
import { Avatar } from '@ui/personnel/Employees';
import { listAllEmployees } from '@ui/personnel/api';
import { OWNER_WORD, pageTasks } from '@ui/lifecycle/api';
import { todayIst } from '@ui/timeOff/api';
import { listDesk } from './api/desk';
import { structureHistory } from './organization/api';
import { addDaysIso as plusDays } from '@ui/utils/dates';

/**
 * The side panels of People's lists (owner, 28 Oct 2026): beside each list,
 * what you want to know before acting on it. Each panel reads what the
 * server already gives the list pages, never more than the viewer may see;
 * a block with nothing in it is not drawn, and a block whose data the viewer
 * may not read fails quietly to nothing.
 */

/* No quick links and no date line any more (People plan 8 Nov 2026, §3 rule 3): the module panel already names the
   screens, and a column that only repeats it is filler. A panel is kept only where it says what the list cannot. */

/* Today in India, not on the device: a laptop set to another zone (or a
   late-night UTC clock) must not shift which leave counts as "this week". */
const todayIso = todayIst;
/* "3 Nov" this year, "3 Nov 2027" another. */
const day = (iso) => {
  const s = formatDate(String(iso || '').slice(0, 10));
  return s.endsWith(` ${new Date().getFullYear()}`) ? s.slice(0, -5) : s;
};
const quiet = (p) => p.catch(() => null);
const face = (name, photoUrl) => <Avatar person={{ name, photoUrl }} size={28} />;

const INBOX_KIND = { LEAVE: 'Leave', ATTENDANCE: 'Attendance requests', APPROVAL: 'People approvals', HELPDESK: 'Help desk' };

/* Employees: the week's joiners, leavers and birthdays; who needs something set; headcount by department (a department filters the list). */
export function EmployeesPanel({ openScreen }) {
  const req = useRequest(() => quiet(listAllEmployees({ status: 'CURRENT' }).then((r) => r?.employees || [])), []);
  const people = req.data || [];
  const today = todayIso();
  const soon = plusDays(today, 7);
  const md = (iso) => String(iso || '').slice(5, 10);
  const inWeek = (iso) => { if (!iso) return false; const m = md(iso); const a = md(today); const z = md(soon); return a <= z ? m >= a && m <= z : m >= a || m <= z; };
  const joining = people.filter((p) => p.dateOfJoining && p.dateOfJoining.slice(0, 10) >= today && p.dateOfJoining.slice(0, 10) <= soon);
  const leaving = people.filter((p) => p.dateOfLeaving && p.dateOfLeaving.slice(0, 10) >= today && p.dateOfLeaving.slice(0, 10) <= plusDays(today, 30));
  const birthdays = people.filter((p) => inWeek(p.dateOfBirth));
  const probation = people.filter((p) => p.probationEndDate && p.probationEndDate.slice(0, 10) >= today && p.probationEndDate.slice(0, 10) <= plusDays(today, 30));
  const noManager = people.filter((p) => !p.reportingManagerId).length;
  const noEmail = people.filter((p) => !p.workEmail && !p.email).length;
  const depts = {};
  for (const p of people) { const k = p.departmentId || ''; (depts[k] ||= { id: k, name: p.department || 'No department', n: 0 }).n += 1; }
  const deptRows = Object.values(depts).sort((a, b) => b.n - a.n);
  const peak = Math.max(1, ...deptRows.map((d) => d.n));
  const open = (p) => () => openScreen?.('employee', { id: p.id });
  const events = joining.length + leaving.length + birthdays.length + probation.length;
  return (
    <>
      <SideBlock title="This week" count={events}>
        {joining.map((p) => <SideLine key={`j-${p.id}`} lead={face(p.name, p.photoUrl)} title={p.name} sub={`Joins ${day(p.dateOfJoining)}`} meta="Joining" tone="pos" onClick={open(p)} />)}
        {leaving.map((p) => <SideLine key={`l-${p.id}`} lead={face(p.name, p.photoUrl)} title={p.name} sub={`Last day ${day(p.dateOfLeaving)}`} meta="Leaving" tone="warn" onClick={open(p)} />)}
        {birthdays.map((p) => <SideLine key={`b-${p.id}`} lead={face(p.name, p.photoUrl)} title={p.name} sub={day(`${today.slice(0, 4)}-${md(p.dateOfBirth)}`)} meta="Birthday" tone="info" onClick={open(p)} />)}
        {probation.map((p) => <SideLine key={`p-${p.id}`} lead={face(p.name, p.photoUrl)} title={p.name} sub={`Probation ends ${day(p.probationEndDate)}`} meta="Review" tone="warn" onClick={open(p)} />)}
        {req.data && !events ? <SideClear>No joiners, leavers or birthdays</SideClear> : null}
      </SideBlock>
      <SideBlock title="Needs setting up" count={noManager + noEmail} tone="warn">
        {noManager ? <SideAlert title={`${noManager} without a manager`} sub="Their leave has nobody to approve it" tone="warn" onClick={() => openScreen?.('dataHealth')} /> : null}
        {noEmail ? <SideAlert title={`${noEmail} without an email`} sub="They get no payslips or notices" tone="warn" onClick={() => openScreen?.('dataHealth')} /> : null}
      </SideBlock>
      <SideBlock title="By department" count={deptRows.length}>
        {deptRows.slice(0, 7).map((d) => (
          <SideLine key={d.id || 'none'} title={d.name} meta={d.n} tone="count" bar={(d.n / peak) * 100}
            onClick={d.id ? () => openScreen?.('employees', { dept: d.id }) : undefined} />
        ))}
      </SideBlock>
    </>
  );
}

/* Tasks (Joining & leaving): who joins or leaves with tasks open, and whose tasks are late. */
export function ChecklistsPanel({ openScreen }) {
  /* Every open Joining & leaving task in the caller's reach (Tasks screen, `open` view). */
  const req = useRequest(() => quiet(Promise.all([pageTasks({ view: 'open', limit: 100 }), pageTasks({ view: 'late', limit: 100 })])), []);
  const tasks = req.data?.[0]?.rows || [];
  const lateTasks = req.data?.[1]?.rows || [];
  const people = {};
  for (const t of tasks) (people[t.employee.id] ||= { e: t.employee, kind: t.kind, open: 0, late: 0 }).open += 1;
  for (const t of tasks) if (t.late) people[t.employee.id].late += 1;
  const list = Object.values(people).sort((a, b) => b.late - a.late || b.open - a.open);
  const byOwner = {};
  for (const t of lateTasks) byOwner[t.owner] = (byOwner[t.owner] || 0) + 1;
  const late = Object.values(byOwner).reduce((a, n) => a + n, 0);
  return (
    <>
      <SideBlock title="People with items open" count={list.length}>
        {list.slice(0, 6).map(({ e, kind, open, late: l }) => (
          <SideLine key={e.id} lead={face(e.name, e.photoUrl)} title={e.name} sub={`${kind === 'LEAVING' ? 'Leaving' : 'Joining'} · ${open} open`} meta={l ? `${l} late` : `${open} open`} tone={l ? 'neg' : 'info'}
            onClick={() => openScreen?.('employee', { id: e.id, tab: 'employment' })} />
        ))}
        {list.length > 6 ? <SideLine title={`${list.length - 6} more people`} /> : null}
        {req.data && !list.length ? <SideClear>Nothing open</SideClear> : null}
      </SideBlock>
      <SideBlock title="Late, by owner" count={late} tone="warn">
        {Object.entries(byOwner).sort((a, b) => b[1] - a[1]).map(([o, n]) => <SideLine key={o} title={OWNER_WORD[o] || o} meta={n} tone="neg" bar={(n / Math.max(1, late)) * 100} />)}
      </SideBlock>
      {/* Tasks is where People opens for someone without Home (an employee, an auditor): only links they may follow. */}
    </>
  );
}

/* Help desk: open requests by queue, what is late on its reply or fix. */
export function HelpDeskPanel() {
  const req = useRequest(() => quiet(listDesk({ status: '' })), []);
  const rows = (req.data?.requests || []).filter((r) => r.status !== 'RESOLVED' && r.status !== 'CLOSED');
  const byQueue = {};
  for (const r of rows) byQueue[r.queue || 'General'] = (byQueue[r.queue || 'General'] || 0) + 1;
  const late = rows.filter((r) => r.replyOverdue || r.resolveOverdue);
  return (
    <>
      <SideBlock title="Late" count={late.length}>
        {late.slice(0, 5).map((r) => <SideLine key={r.id} lead={face(r.employeeName, r.photoUrl)} title={r.subject} sub={r.employeeName} meta={r.replyOverdue ? 'Reply late' : 'Fix late'} tone="neg" />)}
      </SideBlock>
      <SideBlock title="Open, by queue" count={rows.length}>
        {Object.entries(byQueue).sort((a, b) => b[1] - a[1]).map(([q, n]) => <SideLine key={q} title={q} meta={n} tone="count" bar={(n / Math.max(1, rows.length)) * 100} />)}
        {req.data && !rows.length ? <SideClear>Nothing open</SideClear> : null}
      </SideBlock>
    </>
  );
}

/* Branches: where people work, and who has no branch yet. */
export function BranchesPanel({ openScreen }) {
  const req = useRequest(() => quiet(listAllEmployees({ status: 'CURRENT' }).then((r) => r?.employees || [])), []);
  const people = req.data || [];
  const none = people.filter((p) => !p.branchId).length;
  return (
    <>
      <SideBlock title="Needs a branch" count={none}>
        {none ? <SideAlert title={`${none} without a branch`} sub="Holidays and working week come from the branch" tone="warn" onClick={() => openScreen?.('employees', { branch: 'none' })} /> : null}
        {req.data && !none ? <SideClear>Everyone has a branch</SideClear> : null}
      </SideBlock>
    </>
  );
}

/* ── Panels for the lists that had none (owner, 29 Oct 2026: "research what info we can give in each page") ── */

const words = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const countBy = (rows, f) => rows.reduce((m, r) => { const k = f(r); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

/* Change history: how much changed lately, of what kind, and by whom. */
export function ChangesPanel() {
  const req = useRequest(() => quiet(structureHistory({ limit: 100 })), []);
  const entries = req.data?.entries;
  if (!entries) return null;
  /* A month back from today (IST), read off the date rather than the clock so the render stays pure. */
  const since = plusDays(todayIso(), -30);
  const recent = entries.filter((e) => String(e.at).slice(0, 10) >= since);
  const kinds = countBy(recent, (e) => e.kindLabel || words(e.kind));
  const who = countBy(recent, (e) => e.actorName || 'Someone');
  const peak = Math.max(1, ...kinds.values());
  return (
    <>
      <SideBlock title="Last 30 days" count={recent.length}>
        {[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => <SideLine key={k} title={k} meta={n} tone="count" bar={(n / peak) * 100} />)}
        {!recent.length ? <SideClear>Nothing changed this month</SideClear> : null}
      </SideBlock>
      <SideBlock title="Made by" count={who.size || null}>
        {[...who].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => <SideLine key={k} lead={face(k)} title={k} meta={`${n} change${n === 1 ? '' : 's'}`} />)}
      </SideBlock>
    </>
  );
}

/* The registers (benefits, announcements, events): where each stands and what is due. */
