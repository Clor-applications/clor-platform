import React, { useState } from 'react';
import { Building2, GitBranch, MapPin, Plus, UserMinus, UserX } from '@ui/components/ui/lineIcons';
import { useContentIcon } from '@ui/components/ui/colorSwap';

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
  const mark = useContentIcon();
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
    { k: 'departments', label: 'Departments', tint: 'sky', value: activeDepts.length, Icon: mark(Building2), onClick: go('departments') },
    { k: 'branches', tint: 'sky', label: activeBranches.length === 1 ? 'Branch' : 'Branches', value: activeBranches.length, Icon: mark(GitBranch), onClick: go('branches') },
    { k: 'noManager', label: 'Without a manager', tint: 'peach', value: d.unplaced.noManager ?? 0, Icon: mark(UserMinus), onClick: go('employees', { mgr: 'none' }) },
    { k: 'noDept', label: 'Without a department', tint: 'peach', value: d.unplaced.noDepartment, Icon: mark(UserX), onClick: go('employees', { dept: 'none' }) },
    ...(activeBranches.length > 1 ? [{ k: 'noBranch', label: 'Without a branch', tint: 'peach', value: d.unplaced.noBranch, Icon: mark(MapPin), onClick: go('employees', { branch: 'none' }) }] : []),
  ];
  /* The departments as an outline: each under its parent, in name order. */
  const childrenOf = (id) => activeDepts.filter((x) => (x.parentId || null) === id && (id || !activeDepts.some((p) => p.id === x.parentId))).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  /* Marigold is kept for what waits on you, so departments and branches cycle the other four. */
  const ORG_TINTS = ['sky', 'mint', 'lilac', 'peach'];
  const walk = (id, depth) => { for (const x of childrenOf(id)) { rows.push({ ...x, depth }); if (depth < 8) walk(x.id, depth + 1); } };
  walk(null, 0);
  const orgTotal = Math.max(1, rows.reduce((n, x) => n + (x.people || 0), 0));
  /* In the sidebar's order. */
  const lists = [
    ['jobPositions', 'Designations', d.lists.designations, true],
    ['establishments', 'Work sites', d.lists.sites, false],
    ['areas', 'Locations', d.lists.areas, false],
    ['teams', 'Teams', d.lists.teams, false],
    ['seats', 'Positions', d.lists.positions, false],
    ['businessUnits', 'Business units', d.lists.units, false],
    ['grades', 'Grades', d.lists.grades, false],
    ['costCentres', 'Cost centres', d.lists.centres, false],
    ['jobRoles', 'Job roles', d.lists.roles, false],
  ];

  return (
    <div className="space-y-6">
      <Header openScreen={openScreen} perms={perms} />
      <div className="ui-metric-strip" role="list" aria-label="Organisation counts">
        {strip.map(({ k, label, tint, value, Icon, onClick }) => (
          <div key={k} role="listitem" data-tint={tint}><button type="button" className="ui-metric" data-zero={Number(value) === 0 || undefined} onClick={onClick}><Icon size={18} aria-hidden="true" className="ui-metric-icon" /><span><span className="ui-metric-value tabular-nums">{value}</span> <span className="ui-metric-label">{label}</span><span className="sr-only">: open</span></span></button></div>
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
          /* Departments as cards (an overview, not a register): head, size, and share of the company. */
          <ul className="org-cards">
            {rows.map((x, i) => (
              <li key={x.id}>
                <button type="button" className="org-card" data-tint={ORG_TINTS[i % ORG_TINTS.length]} onClick={go('employees', { dept: x.id })} aria-label={`${x.name}: ${x.people} people. Open them.`}>
                  <span className="org-card-top">
                    <span className="org-tile" aria-hidden="true">{x.name.charAt(0).toUpperCase()}</span>
                    <span className="org-card-n tabular-nums">{x.people}</span>
                  </span>
                  <span className="org-card-name">{x.name}{x.depth ? <span className="ui-caption"> · sub-department</span> : null}</span>
                  <span className={`org-card-head ${x.headLeft ? 'ui-text-neg' : x.headName ? '' : 'ui-muted'}`}>{x.headName ? `Head: ${x.headName}${x.headLeft ? ' (left)' : ''}` : 'No head yet'}</span>
                  <span className="org-card-bar" aria-hidden="true"><span style={{ width: `${Math.round((x.people / orgTotal) * 100)}%` }} /></span>
                  <span className="ui-caption">{Math.round((x.people / orgTotal) * 100)}% of the company</span>
                </button>
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
          <ul className="org-cards org-cards-sm">
            {activeBranches.map((b, i) => (
              <li key={b.id}>
                <button type="button" className="org-card" data-tint={ORG_TINTS[(i + 2) % ORG_TINTS.length]} onClick={go('employees', { branch: b.id })} aria-label={`${b.name}: ${b.people} people. Open them.`}>
                  <span className="org-card-top">
                    <span className="org-card-name">{b.name}</span>
                    <span className="org-card-n tabular-nums">{b.people}</span>
                  </span>
                  <span className="ui-caption">{[b.city, b.state].filter(Boolean).join(', ') || '—'}</span>
                </button>
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
          <p className="text-sm">Detailed structure: work sites, locations, teams, positions, business units, grades, cost centres and job roles. <span className="ui-muted">{d.detailed ? 'On' : 'Off'}</span></p>
          {canSwitch ? <button type="button" className="ui-btn ui-btn-secondary" disabled={switching} onClick={() => turnDetailed(!d.detailed)}>{d.detailed ? 'Turn off' : 'Turn on'}</button> : null}
        </div>
      </section>
    </div>
  );
}

function Header({ openScreen, perms }) {
  return (
    <PageHeader
      breadcrumb={[{ label: 'People' }, { label: 'Organisation' }]}
      title="Organisation"
      actions={can(perms, 'PEOPLE::Org Structure::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen?.('departments', { new: '1' })}><Plus size={16} aria-hidden="true" /> New department</button> : null}
    />
  );
}
