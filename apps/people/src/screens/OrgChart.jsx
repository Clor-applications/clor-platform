import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { getOrgChart } from '@ui/personnel/api';
import { Avatar } from '@ui/personnel/Employees';

/**
 * Who reports to whom, as an outline: easier to read than boxes and lines
 * once a company is past a dozen people, and it prints.
 */
export default function OrgChart() {
  const [nodes, setNodes] = useState(null);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(() => new Set());

  useEffect(() => {
    getOrgChart()
      .then((r) => setNodes(r?.nodes || []))
      .catch((e) => setError(String(e?.message || 'Could not load the org chart.')));
  }, []);

  const { roots, children } = useMemo(() => {
    const list = nodes || [];
    const ids = new Set(list.map((n) => n.id));
    const kids = new Map();
    for (const n of list) {
      const parent = n.reportingManagerId && ids.has(n.reportingManagerId) ? n.reportingManagerId : null;
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(n);
    }
    return { roots: kids.get(null) || [], children: kids };
  }, [nodes]);

  if (error) return <div className="ui-card p-4 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</div>;
  if (!nodes) return <SkeletonCard lines={6} />;

  const toggle = (id) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const Node = ({ n, depth }) => {
    const kids = children.get(n.id) || [];
    const open = !closed.has(n.id);
    return (
      <li>
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 ui-hover-sunken" style={{ marginInlineStart: depth * 20 }}>
          {kids.length ? (
            <button type="button" className="ui-icon-btn !h-6 !w-6" aria-expanded={open} aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`} onClick={() => toggle(n.id)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="inline-block w-6" />
          )}
          <Avatar person={n} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{n.name}</span>
            <span className="block truncate ui-caption">{[n.designation, n.department].filter(Boolean).join(' · ') || '—'}</span>
          </span>
          {kids.length ? <span className="ui-pill ui-pill-neutral ms-auto">{kids.length}</span> : null}
        </div>
        {kids.length && open ? (
          <ul>
            {kids.map((k) => (
              <Node key={k.id} n={k} depth={depth + 1} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader entity="people" title="Org chart" description="Set “Reports to” on each employee file to build it." />
      {nodes.length === 0 ? (
        <EmptyState title="Nobody yet" description="Add employees and who they report to." />
      ) : (
        <ul className="ui-card p-3">
          {roots.map((n) => (
            <Node key={n.id} n={n} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}
