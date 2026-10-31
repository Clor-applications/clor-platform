import React from 'react';
import {
  BarChart3, Building2, CalendarDays, CalendarRange, ClipboardCheck, FileText, Gavel, Inbox, LifeBuoy, ListChecks, Lock, MapPin,
  Network, Scale, Settings2, Timer, Upload, UserCheck, Users, Workflow,
} from '@ui/components/ui/lineIcons';

import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { DateTile, SideAlert, SideBlock, SideClear, SideLine, SideLinks, SideTimeline } from '@ui/components/list/SidePanel';
import { Avatar } from '@ui/personnel/Employees';
import { listAllEmployees, listCompanyDocuments } from '@ui/personnel/api';
import { OWNER_WORD, pageTasks } from '@ui/lifecycle/api';
import { getLeaveBalances, getTimeOverview, listHolidays, listLeaveRequests, todayIst } from '@ui/timeOff/api';
import { getInbox } from './api/approvals';
import { listDesk } from './api/desk';
import { listItems, structureHistory } from './organization/api';
import { listRecords } from './api/workspace';
import { listSalaryRevisions } from '../../payroll/src/api/payrollRevisions';

/**
 * The side panels of People's lists (owner, 28 Oct 2026): beside each list,
 * what you want to know before acting on it. Each panel reads what the
 * server already gives the list pages, never more than the viewer may see;
 * a block with nothing in it is not drawn, and a block whose data the viewer
 * may not read fails quietly to nothing.
 */

/* Today in India, not on the device: a laptop set to another zone (or a
   late-night UTC clock) must not shift which leave counts as "this week". */
const todayIso = todayIst;
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/* "3 Nov" this year, "3 Nov 2027" another. */
const day = (iso) => {
  const s = formatDate(String(iso || '').slice(0, 10));
  return s.endsWith(` ${new Date().getFullYear()}`) ? s.slice(0, -5) : s;
};
const span = (from, to) => (!to || from === to ? day(from) : `${day(from)} – ${day(to)}`);
const quiet = (p) => p.catch(() => null);
const face = (name, photoUrl) => <Avatar person={{ name, photoUrl }} size={28} />;
const daysSince = (at) => Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
const waited = (at) => { const d = daysSince(at); return d === 0 ? 'today' : `${d}d`; };

/* Leave requests: who is away this week and where that leaves a team thin, the next holidays, what changed lately. */
export function LeaveRequestsPanel({ openScreen }) {
  const today = todayIso();
  const end = plusDays(today, 6);
  const req = useRequest(() => Promise.all([
    quiet(listLeaveRequests({ from: today, to: end })),
    quiet(listHolidays(Number(today.slice(0, 4)))),
    quiet(listLeaveRequests({ year: Number(today.slice(0, 4)) })),
  ]), [today]);
  const [week, holidays, year] = req.data || [];
  const away = (week || []).filter((r) => r.status === 'APPROVED' || r.status === 'PENDING');
  /* Two or more of one department off on the same day is worth a look before approving a third. */
  const clashes = [];
  for (let i = 0; i < 7; i += 1) {
    const d = plusDays(today, i);
    const byDept = {};
    for (const r of away) if (r.department && r.fromDate <= d && r.toDate >= d) (byDept[r.department] ||= new Set()).add(r.employeeId);
    for (const [dept, ids] of Object.entries(byDept)) if (ids.size >= 2 && !clashes.some((c) => c.dept === dept)) clashes.push({ dept, n: ids.size, d });
  }
  const next = (holidays || []).filter((h) => String(h.date).slice(0, 10) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 3);
  const recent = (year || [])
    .map((r) => ({ r, at: r.reviewedAt || r.createdAt, what: r.status === 'APPROVED' ? 'Approved' : r.status === 'REJECTED' ? 'Rejected' : r.status === 'CANCELLED' ? 'Cancelled' : 'Asked for' }))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 5);
  return (
    <>
      <SideBlock title="Away this week" count={away.length} action={{ label: 'Calendar', onClick: () => openScreen?.('leaveCalendar') }}>
        {clashes.map((c) => <SideAlert key={`c-${c.dept}`} tone="warn" title={`${c.dept} is short on ${day(c.d)}`} sub={`${c.n} people off the same day`} />)}
        {away.slice(0, 5).map((r) => (
          <SideLine key={r.id} lead={face(r.employeeName, r.photoUrl)} title={r.employeeName} sub={`${r.leaveTypeName} · ${span(r.fromDate, r.toDate)}`}
            meta={r.status === 'PENDING' ? 'Waiting' : 'Off'} tone={r.status === 'PENDING' ? 'warn' : 'info'} />
        ))}
        {away.length > 5 ? <SideLine title={`${away.length - 5} more this week`} onClick={() => openScreen?.('leaveCalendar')} /> : null}
        {week && !away.length ? <SideClear>Nobody is off this week</SideClear> : null}
      </SideBlock>
      <SideBlock title="Next holidays" action={next.length ? { label: 'All', onClick: () => openScreen?.('holidays') } : null}>
        {next.map((h) => <SideLine key={h.id || h.date} lead={<DateTile iso={h.date} />} title={h.name} sub={new Date(`${String(h.date).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })} />)}
      </SideBlock>
      <SideBlock title="Recent activity">
        <SideTimeline items={recent.map(({ r, at, what }) => ({
          key: `${r.id}-${what}`, at, title: r.employeeName, sub: `${what} ${r.leaveTypeName.toLowerCase()} · ${span(r.fromDate, r.toDate)}`,
          tone: what === 'Approved' ? 'pos' : what === 'Rejected' ? 'neg' : what === 'Cancelled' ? undefined : 'info',
        }))} />
      </SideBlock>
      <SideLinks links={[
        { label: 'Calendar', icon: CalendarRange, onClick: () => openScreen?.('leaveCalendar') },
        { label: 'Balances', icon: Scale, onClick: () => openScreen?.('leaveBalances') },
        { label: 'Policy', icon: Gavel, onClick: () => openScreen?.('leaveTypes') },
        { label: 'Holidays', icon: CalendarDays, onClick: () => openScreen?.('holidays') },
      ]} />
    </>
  );
}

const INBOX_KIND = { LEAVE: 'Leave', ATTENDANCE: 'Attendance requests', APPROVAL: 'People approvals', HELPDESK: 'Help desk' };

/* Approvals: what has waited longest, and how the pile splits by kind (a kind narrows the list). */
export function ApprovalsPanel({ openScreen }) {
  const req = useRequest(() => quiet(getInbox()), []);
  const items = req.data?.items || [];
  const counts = req.data?.counts || {};
  const oldest = [...items].sort((a, b) => new Date(a.since) - new Date(b.since)).slice(0, 4);
  const stale = items.filter((i) => i.overdue || daysSince(i.since) >= 3).length;
  return (
    <>
      <SideBlock title="Waiting longest" count={items.length} tone="warn">
        {stale ? <SideAlert title={`${stale} waiting 3 days or more`} sub="Oldest first in the list" tone="warn" /> : null}
        {oldest.map((i) => (
          <SideLine key={i.key} lead={face(i.employeeName, i.photoUrl)} title={i.employeeName} sub={i.what} meta={waited(i.since)}
            tone={i.overdue || daysSince(i.since) >= 3 ? 'neg' : daysSince(i.since) >= 1 ? 'warn' : 'info'} />
        ))}
        {req.data && !items.length ? <SideClear>Nothing waiting for you</SideClear> : null}
      </SideBlock>
      <SideBlock title="By kind">
        {Object.keys(INBOX_KIND).filter((k) => counts[k]).map((k) => (
          <SideLine key={k} title={INBOX_KIND[k]} meta={counts[k]} tone="count" bar={(counts[k] / Math.max(1, counts.all || items.length)) * 100} onClick={() => openScreen?.('approvals', { kind: k })} />
        ))}
      </SideBlock>
      <SideLinks links={[
        { label: 'Leave', icon: CalendarDays, onClick: () => openScreen?.('leaveRequests') },
        { label: 'Delegates', icon: UserCheck, onClick: () => openScreen?.('standIns') },
        { label: 'Rules', icon: Workflow, onClick: () => openScreen?.('approvalRules') },
        { label: 'Help desk', icon: LifeBuoy, onClick: () => openScreen?.('helpdesk') },
      ]} />
    </>
  );
}

/* Attendance requests: who is away or working elsewhere today, and the leave still waiting. */
export function AttendanceRequestsPanel({ openScreen }) {
  const req = useRequest(() => quiet(getTimeOverview()), []);
  const o = req.data || {};
  const away = o.awayToday || [];
  const elsewhere = o.workingAwayToday || [];
  return (
    <>
      <SideBlock title="Away today" count={away.length}>
        {away.slice(0, 5).map((r) => <SideLine key={r.id || r.employeeId} lead={face(r.employeeName, r.photoUrl)} title={r.employeeName} sub={r.leaveTypeName} meta="Off" tone="info" />)}
        {req.data && !away.length ? <SideClear>Everyone is in today</SideClear> : null}
      </SideBlock>
      <SideBlock title="Working elsewhere today" count={elsewhere.length}>
        {elsewhere.slice(0, 5).map((r) => <SideLine key={r.id || r.employeeId} lead={face(r.employeeName, r.photoUrl)} title={r.employeeName} sub={r.kindName || r.kind} />)}
      </SideBlock>
      <SideBlock title="Leave waiting">
        {o.waiting?.count ? <SideLine title="Leave requests" sub={o.waiting.olderThan3Days ? `${o.waiting.olderThan3Days} older than 3 days` : 'All asked recently'} meta={o.waiting.count} tone={o.waiting.olderThan3Days ? 'neg' : 'count'} onClick={() => openScreen?.('leaveRequests')} /> : null}
      </SideBlock>
      <SideLinks links={[
        { label: 'Attendance', icon: Timer, onClick: () => openScreen?.('attendance') },
        { label: 'Approvals', icon: Inbox, onClick: () => openScreen?.('approvals') },
        { label: 'Rules', icon: Workflow, onClick: () => openScreen?.('requestRules') },
        { label: 'Leave', icon: CalendarDays, onClick: () => openScreen?.('leaveRequests') },
      ]} />
    </>
  );
}

/* Leave balances: who is nearly out of a leave, and what lapses at the period end. */
export function LeaveBalancesPanel({ openScreen }) {
  const year = new Date().getFullYear();
  const req = useRequest(() => Promise.all([quiet(getLeaveBalances(year)), quiet(getTimeOverview())]), [year]);
  const [b, o] = req.data || [];
  const types = (b?.types || []).filter((t) => t.isPaid);
  const low = [];
  for (const r of b?.rows || []) {
    for (const t of types) {
      const x = r.balances?.[t.id];
      if (x && !x.locked && typeof x.available === 'number' && x.allocated > 0 && x.available <= Math.max(1, x.allocated * 0.15)) low.push({ r, t, x });
    }
  }
  low.sort((a, c) => a.x.available - c.x.available);
  const lapsing = o?.lapsing?.rows || [];
  return (
    <>
      <SideBlock title="Running low" count={low.length}>
        {low.slice(0, 5).map(({ r, t, x }) => (
          <SideLine key={`${r.id}-${t.id}`} lead={face(r.name, r.photoUrl)} title={r.name} sub={t.name} meta={`${x.available} left`} tone={x.available <= 0 ? 'neg' : 'warn'} />
        ))}
        {b && !low.length ? <SideClear>Nobody is running low</SideClear> : null}
      </SideBlock>
      <SideBlock title={o?.lapsing?.periodEnd ? `Lapses on ${day(o.lapsing.periodEnd)}` : 'Lapsing'} count={lapsing.length}>
        {lapsing.slice(0, 4).map((x, i) => <SideLine key={x.employeeId || i} title={x.employeeName || x.name} sub={x.leaveTypeName} meta={x.days ?? x.lapsing} tone="warn" />)}
      </SideBlock>
      {/* Only pages outside this module's menu (Reports, Settings), under their menu names; Leave requests is one click away already. */}
      <SideLinks links={[
        { label: 'Leave register', icon: BarChart3, onClick: () => openScreen?.('leaveRegister') },
        { label: 'Leave year end', icon: CalendarRange, onClick: () => openScreen?.('leaveYearEnd') },
        { label: 'Leave policy', icon: Gavel, onClick: () => openScreen?.('leaveTypes') },
      ]} />
    </>
  );
}

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
      <SideLinks links={[
        { label: 'Org chart', icon: Network, onClick: () => openScreen?.('orgChart') },
        { label: 'Onboarding', icon: ListChecks, onClick: () => openScreen?.('checklists') },
        { label: 'Import', icon: Upload, onClick: () => openScreen?.('employeeImport') },
        { label: 'Departments', icon: Building2, onClick: () => openScreen?.('departments') },
      ]} />
    </>
  );
}

/* Tasks (Joining & leaving): who joins or leaves with tasks open, and whose tasks are late. */
export function ChecklistsPanel({ openScreen, navItems }) {
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
      <SideLinks navItems={navItems} links={[
        { label: 'Employees', icon: Users, screen: 'employees', onClick: () => openScreen?.('employees') },
        { label: 'Documents', icon: FileText, screen: 'documents', onClick: () => openScreen?.('documents') },
        { label: 'Assets', icon: ClipboardCheck, screen: 'assets', onClick: () => openScreen?.('assets') },
        { label: 'Letters', icon: FileText, screen: 'letterTemplates', onClick: () => openScreen?.('letterTemplates') },
      ]} />
    </>
  );
}

/* Documents: what expires in the next 30 days, and what already has. */
export function DocumentsPanel({ openScreen }) {
  const req = useRequest(() => quiet(listCompanyDocuments()), []);
  const today = todayIso();
  const docs = (req.data || []).filter((d) => d.expiresOn);
  const soon = docs.filter((d) => d.expiresOn.slice(0, 10) >= today && d.expiresOn.slice(0, 10) <= plusDays(today, 30)).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const gone = docs.filter((d) => d.expiresOn.slice(0, 10) < today);
  return (
    <>
      <SideBlock title="Expiring in 30 days" count={soon.length}>
        {gone.length ? <SideAlert title={`${gone.length} already expired`} sub="Ask for renewed copies" onClick={() => openScreen?.('documents', { tab: 'expired' })} /> : null}
        {soon.slice(0, 6).map((d) => <SideLine key={d.id} lead={<DateTile iso={d.expiresOn} />} title={d.title || d.kind} sub={d.employeeName} meta="Soon" tone="warn" onClick={d.employeeId ? () => openScreen?.('employee', { id: d.employeeId, tab: 'documents' }) : undefined} />)}
        {req.data && !soon.length && !gone.length ? <SideClear>Nothing expires this month</SideClear> : null}
      </SideBlock>
      <SideLinks links={[
        { label: 'Letters', icon: FileText, onClick: () => openScreen?.('letterTemplates') },
        { label: 'Onboarding', icon: ListChecks, onClick: () => openScreen?.('checklists') },
        { label: 'Employees', icon: Users, onClick: () => openScreen?.('employees') },
        { label: 'Policies', icon: Gavel, onClick: () => openScreen?.('policies') },
      ]} />
    </>
  );
}

/* Help desk: open requests by queue, what is late on its reply or fix. */
export function HelpDeskPanel({ openScreen }) {
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
      <SideLinks links={[
        { label: 'Private', icon: Lock, onClick: () => openScreen?.('privateCases') },
        { label: 'Settings', icon: Settings2, onClick: () => openScreen?.('helpDeskSettings') },
        { label: 'Approvals', icon: Inbox, onClick: () => openScreen?.('approvals') },
        { label: 'Policies', icon: Gavel, onClick: () => openScreen?.('policies') },
      ]} />
    </>
  );
}

/* Departments: the ones without a head, and the biggest, as bars. */
export function DepartmentsPanel({ openScreen }) {
  const req = useRequest(() => quiet(listItems('departments')), []);
  const items = (req.data || []).filter((r) => r.isActive !== false);
  const headless = items.filter((r) => !r.headName || r.headLeft);
  const peak = Math.max(1, ...items.map((r) => r.employeeCount || 0));
  return (
    <>
      <SideBlock title="Headcount" count={items.reduce((a, r) => a + (r.employeeCount || 0), 0)}>
        {headless.length ? <SideAlert title={`${headless.length} without a head`} sub={headless.slice(0, 3).map((r) => r.name).join(', ') + (headless.length > 3 ? '…' : '')} tone="warn" /> : null}
        {[...items].sort((a, b) => (b.employeeCount || 0) - (a.employeeCount || 0)).slice(0, 7).map((r) => (
          <SideLine key={r.id} title={r.name} sub={r.headName ? `Head: ${r.headName}` : undefined} meta={r.employeeCount || 0} tone="count" bar={((r.employeeCount || 0) / peak) * 100}
            onClick={() => openScreen?.('employees', { dept: r.id })} />
        ))}
      </SideBlock>
      <SideLinks links={[
        { label: 'Org chart', icon: Network, onClick: () => openScreen?.('orgChart') },
        { label: 'Roles', icon: Users, onClick: () => openScreen?.('jobPositions') },
        { label: 'Branches', icon: MapPin, onClick: () => openScreen?.('branches') },
        { label: 'Changes', icon: Workflow, onClick: () => openScreen?.('orgChanges') },
      ]} />
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
      <SideLinks links={[
        { label: 'Departments', icon: Building2, onClick: () => openScreen?.('departments') },
        { label: 'Holidays', icon: CalendarDays, onClick: () => openScreen?.('holidays') },
        { label: 'Org chart', icon: Network, onClick: () => openScreen?.('orgChart') },
        { label: 'Employees', icon: Users, onClick: () => openScreen?.('employees') },
      ]} />
    </>
  );
}

/* ── Panels for the lists that had none (owner, 29 Oct 2026: "research what info we can give in each page") ── */

const words = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const countBy = (rows, f) => rows.reduce((m, r) => { const k = f(r); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
const daysTo = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) - new Date(`${todayIso()}T00:00:00Z`)) / 86_400_000);

/* Assets: what is free to give out, what is away for repair, and what is due back. */
export function AssetsPanel({ openScreen }) {
  const req = useRequest(() => Promise.all([quiet(listRecords('assets')), quiet(listAllEmployees({ status: 'ALL' }).then((r) => r?.employees || []))]), []);
  const [rows, people] = req.data || [];
  if (!rows) return null;
  const name = new Map((people || []).map((p) => [p.id, p.name]));
  const by = countBy(rows, (r) => r.status);
  const free = rows.filter((r) => r.status === 'AVAILABLE' || r.status === 'RETURNED');
  const repair = rows.filter((r) => r.status === 'REPAIR');
  const dueBack = rows.filter((r) => r.status === 'ASSIGNED' && r.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const types = countBy(rows.filter((r) => r.status !== 'RETIRED'), (r) => r.details?.category || 'Other');
  const peak = Math.max(1, ...types.values());
  return (
    <>
      <SideBlock title="Due back" count={dueBack.length}>
        {dueBack.slice(0, 4).map((r) => <SideLine key={r.id} title={r.title} sub={name.get(r.employeeId) || 'Not assigned'} meta={daysTo(r.dueDate) < 0 ? 'Overdue' : day(r.dueDate)} tone={daysTo(r.dueDate) < 0 ? 'neg' : 'warn'} />)}
      </SideBlock>
      <SideBlock title="Ready to give out" count={free.length}>
        {free.slice(0, 4).map((r) => <SideLine key={r.id} title={r.title} sub={r.details?.assetTag || words(r.status)} meta={words(r.status)} />)}
        {!free.length ? <SideClear>Nothing spare right now</SideClear> : null}
      </SideBlock>
      <SideBlock title="In repair" count={repair.length}>
        {repair.slice(0, 3).map((r) => <SideLine key={r.id} title={r.title} sub={r.details?.condition || r.details?.assetTag} tone="warn" />)}
      </SideBlock>
      <SideBlock title="By kind" count={rows.length - (by.get('RETIRED') || 0)}>
        {[...types].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => <SideLine key={k} title={k} meta={n} tone="count" bar={(n / peak) * 100} />)}
      </SideBlock>
      <SideLinks links={[
        { label: 'Onboarding & exit', icon: ClipboardCheck, onClick: () => openScreen?.('checklists') },
        { label: 'Employees', icon: Users, onClick: () => openScreen?.('employees') },
      ]} />
    </>
  );
}

/* Designations: the biggest ones, the ones nobody holds, and the ones tied to no department. */
export function DesignationsPanel({ openScreen }) {
  const req = useRequest(() => Promise.all([quiet(listItems('job-positions')), quiet(listItems('departments'))]), []);
  const [items, depts] = req.data || [];
  if (!items) return null;
  const live = items.filter((r) => r.isActive !== false);
  const empty = live.filter((r) => !r.employeeCount);
  const loose = live.filter((r) => !r.departmentId);
  const deptName = new Map((depts || []).map((d) => [d.id, d.name]));
  const peak = Math.max(1, ...live.map((r) => r.employeeCount || 0));
  return (
    <>
      <SideBlock title="Largest" count={live.length}>
        {[...live].sort((a, b) => (b.employeeCount || 0) - (a.employeeCount || 0)).slice(0, 6).map((r) => (
          <SideLine key={r.id} title={r.name} sub={deptName.get(r.departmentId)} meta={r.employeeCount || 0} tone="count" bar={((r.employeeCount || 0) / peak) * 100} />
        ))}
      </SideBlock>
      <SideBlock title="Nobody holds" count={empty.length}>
        {empty.length ? <SideAlert title={`${empty.length} with no one in them`} sub={empty.slice(0, 3).map((r) => r.name).join(', ') + (empty.length > 3 ? '…' : '')} tone="warn" /> : null}
      </SideBlock>
      <SideBlock title="No department" count={loose.length}>
        {loose.length ? <SideAlert title={`${loose.length} not tied to a department`} sub={loose.slice(0, 3).map((r) => r.name).join(', ')} tone="warn" /> : null}
      </SideBlock>
      {!empty.length && !loose.length ? <SideBlock title="Tidy"><SideClear>Every designation is held and has a department</SideClear></SideBlock> : null}
      <SideLinks links={[
        { label: 'Departments', icon: Building2, onClick: () => openScreen?.('departments') },
        { label: 'Org chart', icon: Network, onClick: () => openScreen?.('orgChart') },
        { label: 'Employees', icon: Users, onClick: () => openScreen?.('employees') },
      ]} />
    </>
  );
}

/* Change history: how much changed lately, of what kind, and by whom. */
export function ChangesPanel({ openScreen }) {
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
      <SideLinks links={[
        { label: 'Departments', icon: Building2, onClick: () => openScreen?.('departments') },
        { label: 'Branches', icon: MapPin, onClick: () => openScreen?.('branches') },
        { label: 'Audit logs', icon: FileText, onClick: () => openScreen?.('auditLogs') },
      ]} />
    </>
  );
}

/* Who's away: the holidays coming, and the way to every leave list. */
export function TimeOverviewPanel({ openScreen }) {
  const req = useRequest(() => quiet(listHolidays()), []);
  const next = (req.data?.holidays || req.data || []).filter((h) => String(h.date || '').slice(0, 10) >= todayIso()).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 4);
  return (
    <>
      <SideBlock title="Next holidays" count={next.length || null} action={{ label: 'All', onClick: () => openScreen?.('holidays') }}>
        {next.map((h) => <SideLine key={h.id || h.date} lead={<DateTile iso={h.date} />} title={h.name} sub={new Date(`${String(h.date).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })} />)}
      </SideBlock>
      <SideLinks links={[
        { label: 'Leave calendar', icon: CalendarRange, onClick: () => openScreen?.('leaveCalendar') },
        { label: 'Leave balances', icon: Scale, onClick: () => openScreen?.('leaveBalances') },
        { label: 'Leave requests', icon: Inbox, onClick: () => openScreen?.('leaveRequests') },
        { label: 'Delegates', icon: UserCheck, onClick: () => openScreen?.('standIns') },
      ]} />
    </>
  );
}

/* Salary revisions: what waits for a decision and what takes effect soon. */
export function SalaryRevisionsPanel({ openScreen }) {
  const req = useRequest(() => quiet(listSalaryRevisions()), []);
  const rows = req.data;
  if (!rows) return null;
  const waiting = rows.filter((r) => ['DRAFT', 'REVIEWED'].includes(r.status));
  const soon = rows.filter((r) => r.status === 'APPROVED' && r.effectiveFrom && daysTo(r.effectiveFrom) >= 0 && daysTo(r.effectiveFrom) <= 60).sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
  return (
    <>
      <SideBlock title="Waiting for a decision" count={waiting.length} tone="warn">
        {waiting.slice(0, 4).map((r) => <SideLine key={r.id} title={r.employeeName || 'Employee'} sub={r.reason || words(r.status)} tone="warn" />)}
      </SideBlock>
      <SideBlock title="Taking effect soon" count={soon.length}>
        {soon.slice(0, 4).map((r) => <SideLine key={r.id} title={r.employeeName || 'Employee'} meta={day(r.effectiveFrom)} />)}
      </SideBlock>
      {!waiting.length && !soon.length ? <SideBlock title="Nothing pending"><SideClear>No revision waits or starts in the next 60 days</SideClear></SideBlock> : null}
      <SideLinks links={[
        { label: 'Employees', icon: Users, onClick: () => openScreen?.('employees') },
        { label: 'People report', icon: BarChart3, onClick: () => openScreen?.('reports') },
      ]} />
    </>
  );
}

/* The registers (benefits, announcements, events): where each stands and what is due. */
const REGISTER_LINKS = {
  benefits: [['Salary revisions', Scale, 'compensation'], ['Employees', Users, 'employees']],
  announcements: [['Events', CalendarDays, 'events'], ['Help desk', LifeBuoy, 'helpdesk']],
  events: [['Announcements', Inbox, 'announcements'], ['Holidays', CalendarRange, 'holidays']],
};
export function registerPanel(kind) {
  const RegisterPanel = ({ openScreen }) => {
    const req = useRequest(() => quiet(listRecords(kind)), []);
    const rows = req.data;
    if (!rows) return null;
    const by = countBy(rows, (r) => r.status);
    const peak = Math.max(1, ...by.values());
    const dated = rows.filter((r) => r.dueDate && !['CLOSED', 'COMPLETED', 'CANCELLED', 'RETIRED', 'ARCHIVED', 'HIRED', 'REJECTED'].includes(r.status));
    const late = dated.filter((r) => daysTo(r.dueDate) < 0);
    const soon = dated.filter((r) => daysTo(r.dueDate) >= 0 && daysTo(r.dueDate) <= 14).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return (
      <>
        <SideBlock title="Where they stand" count={rows.length}>
          {[...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => <SideLine key={k} title={words(k)} meta={n} tone="count" bar={(n / peak) * 100} onClick={() => openScreen?.(kind, { status: k })} />)}
          {!rows.length ? <SideClear>Nothing here yet</SideClear> : null}
        </SideBlock>
        <SideBlock title="Overdue" count={late.length}>
          {late.slice(0, 4).map((r) => <SideLine key={r.id} title={r.title} meta={day(r.dueDate)} tone="neg" />)}
        </SideBlock>
        <SideBlock title="Due in 14 days" count={soon.length}>
          {soon.slice(0, 4).map((r) => <SideLine key={r.id} title={r.title} meta={day(r.dueDate)} />)}
        </SideBlock>
        <SideLinks links={(REGISTER_LINKS[kind] || []).map(([label, icon, key]) => ({ label, icon, onClick: () => openScreen?.(key) }))} />
      </>
    );
  };
  RegisterPanel.displayName = `RegisterPanel(${kind})`;
  return RegisterPanel;
}
export const BenefitsPanel = registerPanel('benefits');
export const AnnouncementsPanel = registerPanel('announcements');
export const EventsPanel = registerPanel('events');
