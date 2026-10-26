import React, { useState } from 'react';
import { Building2, GitBranch, MapPin, Plus, UserMinus, UserX } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

import { can } from '../workforce/shared';
import { organization } from './api';

/**
 * Organization → Overview: the owner's question, "how is my company set up,
 * and who runs what", on one page (ORGANIZATION-DECISIONS.md). Top: the
 * counts that matter and what in the structure needs fixing, each with its
 * way to fix it. Then the departments as an outline under their parents,
 * each with its head and how many people work in it; then the branches;
 * then the other lists, with the one switch that brings in the detailed
 * ones a larger company uses.
 */
const SCREEN_OF = { departments: 'departments', branches: 'branches', teams: 'teams', jobPositions: 'jobPositions', employees: 'employees' };

export default function OrganizationOverview({ openScreen }) {
  const perms = usePermissions();
  const req = useRequest(() => organization(), []);
  const d = req.data;
  const [switching, setSwitching] = useState(false);
  const canSwitch = Boolean(perms?.isAdmin) || can(perms, 'SETTINGS::Company Profile::EDIT');

  const go = (screen, params) => () => openScreen?.(screen, params);
  const turnDetailed = async (on) => {
    setSwitching(true);
    try {
      await apiFetch(`/orgs/${encodeURIComponent(orgId())}/features`, { method: 'PUT', body: { features: { peopleOrgDetail: on } }, skipWarehouseHeader: true });
      notify.success(on ? 'Detailed structure is on: its lists are in the sidebar.' : 'Detailed structure is off.');
      window.location.reload();
    } catch (e) { notify.error(String(e?.message || 'Not changed.')); setSwitching(false); }
  };

  if (req.error) return <div className="space-y-6"><Header openScreen={openScreen} perms={perms} /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!d) return <div className="space-y-6" aria-busy="true"><Header openScreen={openScreen} perms={perms} /><SkeletonCard lines={3} /><SkeletonCard lines={8} /></div>;

  const activeDepts = d.departments.filter((x) => x.isActive !== false);
  const activeBranches = d.branches.filter((b) => b.isActive !== false);
  const strip = [
    { k: 'departments', label: 'Departments', value: activeDepts.length, Icon: Building2, onClick: go('departments') },
    { k: 'branches', label: activeBranches.length === 1 ? 'Branch' : 'Branches', value: activeBranches.length, Icon: GitBranch, onClick: go('branches') },
    { k: 'noManager', label: 'Without a manager', value: d.unplaced.noManager ?? 0, Icon: UserMinus, onClick: go('employees', { mgr: 'none' }) },
    { k: 'noDept', label: 'Without a department', value: d.unplaced.noDepartment, Icon: UserX, onClick: go('employees', { dept: 'none' }) },
    ...(activeBranches.length > 1 ? [{ k: 'noBranch', label: 'Without a branch', value: d.unplaced.noBranch, Icon: MapPin, onClick: go('employees', { branch: 'none' }) }] : []),
  ];
  /* The departments as an outline: each under its parent, in name order. */
  const childrenOf = (id) => activeDepts.filter((x) => (x.parentId || null) === id && (id || !activeDepts.some((p) => p.id === x.parentId))).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  const walk = (id, depth) => { for (const x of childrenOf(id)) { rows.push({ ...x, depth }); if (depth < 8) walk(x.id, depth + 1); } };
  walk(null, 0);
  const lists = [
    ['jobPositions', 'Designations', d.lists.designations, true],
    ['establishments', 'Work sites', d.lists.sites, false],
    ['teams', 'Teams', d.lists.teams, false],
    ['seats', 'Positions', d.lists.positions, false],
    ['businessUnits', 'Business units', d.lists.units, false],
    ['grades', 'Grades', d.lists.grades, false],
    ['costCentres', 'Cost centres', d.lists.centres, false],
    ['jobRoles', 'Job roles', d.lists.roles, false],
    ['areas', 'Locations', d.lists.areas, false],
  ];

  return (
    <div className="space-y-6">
      <Header openScreen={openScreen} perms={perms} />
      <div className="ui-metric-strip" role="list" aria-label="Organization counts">
        {strip.map(({ k, label, value, Icon, onClick }) => (
          <div key={k} role="listitem"><button type="button" className="ui-metric" onClick={onClick} aria-label={`${value} ${label}: open`}><Icon size={18} aria-hidden="true" className="ui-metric-icon" /><span><span className="ui-metric-value tabular-nums">{value}</span><span className="ui-metric-label">{label}</span></span></button></div>
        ))}
      </div>
      {d.checks?.length ? (
        <ul className="ui-attention" aria-label="To fix in the structure">
          {d.checks.map((c) => (
            <li key={c.id}>
              <span className={`ui-attention-dot ${c.severity === 'FIX_SOON' ? 'is-warn' : c.severity === 'BLOCKS_PAYROLL' ? 'is-neg' : 'is-quiet'}`} aria-hidden="true" />
              <span>{c.title} <span className="tabular-nums">({c.count})</span></span>
              {SCREEN_OF[c.screen] ? <button type="button" className="ui-link" onClick={go(SCREEN_OF[c.screen])}>Fix</button> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="space-y-2" aria-labelledby="org-depts">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="org-depts" className="ui-t-sec">Departments</h2>
          <button type="button" className="ui-link text-sm" onClick={go('departments')}>Open</button>
        </div>
        {rows.length ? (
          /* One ruled row per department, indented under its parent: name, head, people. */
          <ul className="ui-org-outline">
            {rows.map((x) => (
              <li key={x.id} style={{ '--depth': x.depth }}>
                <button type="button" className="ui-org-outline-name" onClick={go('departments')}>{x.name}</button>
                <span className={`ui-org-outline-head ${x.headLeft ? 'ui-text-neg' : x.headName ? '' : 'ui-muted'}`}>{x.headName ? `${x.headName}${x.headLeft ? ' (left)' : ''}` : 'No head'}</span>
                <button type="button" className="ui-link tabular-nums ui-org-outline-count" onClick={go('employees', { dept: x.id })} aria-label={`${x.people} people in ${x.name}`}>{x.people}</button>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No departments yet" description="Add the first department, or import people and their departments come with them." />}
      </section>

      <section className="space-y-2" aria-labelledby="org-branches">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="org-branches" className="ui-t-sec">Branches</h2>
          <button type="button" className="ui-link text-sm" onClick={go('branches')}>Open</button>
        </div>
        {activeBranches.length ? (
          <ul className="ui-org-outline">
            {activeBranches.map((b) => (
              <li key={b.id} style={{ '--depth': 0 }}>
                <button type="button" className="ui-org-outline-name" onClick={go('branches')}>{b.name}</button>
                <span className="ui-org-outline-head ui-muted">{[b.city, b.state].filter(Boolean).join(', ') || '—'}</span>
                <button type="button" className="ui-link tabular-nums ui-org-outline-count" onClick={go('employees', { branch: b.id })} aria-label={`${b.people} people at ${b.name}`}>{b.people}</button>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No branches yet" description="Branches are the company’s registered places." />}
      </section>

      <section className="space-y-2" aria-labelledby="org-lists">
        <h2 id="org-lists" className="ui-t-sec">Other lists</h2>
        <ul className="ui-org-outline">
          {lists.filter(([, , , core]) => core || d.detailed).map(([screen, label, n]) => (
            <li key={screen} style={{ '--depth': 0 }}>
              <button type="button" className="ui-org-outline-name" onClick={go(screen)}>{label}</button>
              <span />
              <span className="tabular-nums ui-org-outline-count">{n}</span>
            </li>
          ))}
        </ul>
        {/* One switch: a 15-person shop never sees teams, positions or grades; a larger company turns them on. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-sm">Detailed structure: teams, positions, business units, grades, cost centres, job roles and locations. <span className="ui-muted">{d.detailed ? 'On' : 'Off'}</span></p>
          {canSwitch ? <button type="button" className="ui-btn ui-btn-secondary" disabled={switching} onClick={() => turnDetailed(!d.detailed)}>{d.detailed ? 'Turn off' : 'Turn on'}</button> : null}
        </div>
      </section>
    </div>
  );
}

function Header({ openScreen, perms }) {
  return (
    <PageHeader
      breadcrumb={[{ label: 'People' }, { label: 'Organization' }]}
      title="Organization"
      actions={can(perms, 'PEOPLE::Org Structure::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen?.('departments', { new: '1' })}><Plus size={16} aria-hidden="true" /> New department</button> : null}
    />
  );
}
