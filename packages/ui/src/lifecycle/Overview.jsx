import React from 'react';
import { Banknote, CalendarArrowDown, CalendarArrowUp, Fingerprint, ListTodo } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { Avatar } from '@ui/personnel/Employees';
import { usePermissions } from '@ui/permissions/usePermissions';

import { KIND_WORD, lifecycleOverview } from './api';
import { can, crumbs } from './shared';

/**
 * Joining & Leaving → Overview: what needs doing now, and what is coming up
 * (JOINING-LEAVING-DECISIONS.md). The strip counts; each count opens the list
 * behind it. Below, the late tasks and the next 30 days, each opening the
 * person's list or record. No charts: a small company reads names.
 */
const COMING_WORD = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', CONTRACT: 'Contract' };
const COMING_PILL = { JOINING: 'ui-pill-pos', LEAVING: 'ui-pill-warn', CHANGE: 'ui-pill-info', PROBATION: 'ui-pill-neutral', CONTRACT: 'ui-pill-neutral' };

function Group({ title, count, action, children }) {
  return (
    <section className="space-y-1" aria-label={title}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="ui-t-sec">{title}{count ? <span className="ui-caption tabular-nums ml-2">{count}</span> : null}</h2>
        {action}
      </header>
      <ul className="divide-y border-t text-sm">{children}</ul>
    </section>
  );
}

export default function LifecycleOverview({ openScreen }) {
  const perms = usePermissions();
  const req = useRequest(() => lifecycleOverview(), []);
  const d = req.data;
  const header = (
    <PageHeader breadcrumb={crumbs()} title="Joining & Leaving"
      actions={can(perms, 'PEOPLE::Employees::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen?.('employeeNew')}>Add employee</button> : null} />
  );
  if (req.error && !d) return <div className="space-y-6">{header}<ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!d) return <div className="space-y-6" aria-busy="true">{header}<SkeletonCard lines={2} /><SkeletonCard lines={6} /></div>;
  const c = d.counts;
  const strip = [
    { k: 'join', label: 'Starting this week', value: c.startingThisWeek, Icon: CalendarArrowUp, onClick: () => openScreen?.('joiners', { view: 'week' }) },
    { k: 'leave', label: 'Last days this week', value: c.lastDaysThisWeek, Icon: CalendarArrowDown, onClick: () => openScreen?.('leavers') },
    { k: 'late', label: 'Tasks late', value: c.lateTasks, Icon: ListTodo, onClick: () => openScreen?.('checklists', { view: 'late' }) },
    { k: 'readers', label: c.readersFailed ? 'Readers not confirmed' : 'Waiting for readers', value: c.readersFailed || c.readersNotConfirmed, Icon: Fingerprint, tone: c.readersFailed ? 'neg' : null, onClick: () => openScreen?.('leavers', { view: 'clearing' }) },
    { k: 'wages', label: c.wagesLate ? 'Final wages late' : 'Final wages due', value: c.wagesLate || c.wagesDue, Icon: Banknote, tone: c.wagesLate ? 'neg' : null, onClick: () => openScreen?.('leavers', { view: 'clearing' }) },
  ];
  const openPerson = (e, kind) => (kind === 'JOINING' ? openScreen?.('joiners', { view: 'preparing' }) : kind === 'LEAVING' ? openScreen?.('leavers') : kind === 'CHANGE' || kind === 'PROBATION' || kind === 'CONTRACT' ? openScreen?.('lifecycleChanges', { view: kind === 'CHANGE' ? null : kind === 'PROBATION' ? 'probation' : 'contracts' }) : openScreen?.('employee', { id: e.id }));
  return (
    <div className="space-y-6">
      {header}
      <div className="ui-metric-strip" role="list" aria-label="Joining and leaving counts">
        {strip.map(({ k, label, value, Icon, tone, onClick }) => (
          <div key={k} role="listitem">
            <button type="button" className="ui-metric" onClick={onClick} aria-label={`${value} ${label}: open`}>
              <Icon size={18} aria-hidden="true" className="ui-metric-icon" />
              <span><span className={`ui-metric-value tabular-nums ${tone === 'neg' && value ? 'ui-text-neg' : ''}`}>{value}</span><span className="ui-metric-label">{label}</span></span>
            </button>
          </div>
        ))}
      </div>
      {c.plansMissing ? (
        <p className="text-sm" role="status">{c.plansMissing === 1 ? 'One person has' : `${c.plansMissing} people have`} no plan yet. CLOR starts it within a quarter of an hour, or start it from <button type="button" className="ui-link" onClick={() => openScreen?.('joiners', { view: 'all' })}>Joining</button>.</p>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-2">
        <Group title="Late" count={c.lateTasks} action={c.lateTasks > d.late.length ? <button type="button" className="ui-link text-sm" onClick={() => openScreen?.('checklists', { view: 'late' })}>All {c.lateTasks}</button> : null}>
          {d.late.length ? d.late.map((t) => (
            <li key={t.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => openScreen?.('checklists', { view: 'late', q: t.employee.name })}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block truncate ui-caption">{KIND_WORD[t.kind] || t.kind} · {t.employee.name}</span>
                </span>
                <span className="ui-caption whitespace-nowrap">{t.ownerName || `${t.ownerWord}, nobody named`}</span>
                <span className="tabular-nums whitespace-nowrap ui-text-neg w-24 text-right">{formatDate(t.dueDate)}</span>
              </button>
            </li>
          )) : <li className="py-3 text-sm ui-muted">Nothing late.</li>}
        </Group>

        <Group title="Next 30 days" count={d.comingUp.length || null}>
          {d.comingUp.length ? d.comingUp.map((x, i) => (
            <li key={`${x.kind}:${x.employee.id}:${i}`}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => openPerson(x.employee, x.kind)}>
                <span className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Avatar person={{ name: x.employee.name }} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{x.employee.name}</span>
                    <span className="block truncate ui-caption">{x.what}{x.detail ? ` · ${x.detail}` : ''}</span>
                  </span>
                </span>
                <span className={`ui-pill ${COMING_PILL[x.kind] || 'ui-pill-neutral'}`}>{COMING_WORD[x.kind] || x.kind}</span>
                <span className="tabular-nums whitespace-nowrap w-24 text-right">{formatDate(x.date)}</span>
              </button>
            </li>
          )) : <li className="py-3 text-sm ui-muted">Nobody joins or leaves in the next 30 days.</li>}
        </Group>
      </div>
    </div>
  );
}
