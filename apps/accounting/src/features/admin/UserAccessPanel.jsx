import React, { useEffect, useState } from 'react';

import { getUserAccess } from '../../api/admin';
import { getPermissionCatalog } from '@ui/api/permissions';

/*
 * What one person can do here, in words.
 *
 * Roles are listed with where they apply — the whole company, one branch, or
 * through a role profile — and the permissions they add up to are grouped by
 * module and resource, so "can Priya reverse a receipt?" is answered by
 * reading, not by opening every role she holds.
 */

const ACTION_WORD = { VIEW: 'view', CREATE: 'create', EDIT: 'edit', DELETE: 'delete', APPROVE: 'approve', EXPORT: 'export' };
const ACTION_ORDER = Object.keys(ACTION_WORD);

function summarise(modules, keys) {
  const byModule = new Map();
  for (const k of keys) {
    const [m, r, a] = String(k).split('::');
    if (!byModule.has(m)) byModule.set(m, new Map());
    const res = byModule.get(m);
    if (!res.has(r)) res.set(r, []);
    res.get(r).push(a);
  }
  const order = (modules || []).map((m) => m.key);
  return [...byModule.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([m, res]) => {
      const mod = (modules || []).find((x) => x.key === m);
      return {
        key: m,
        label: mod?.label || m,
        resources: [...res.entries()].map(([r, actions]) => ({
          key: r,
          label: mod?.resources.find((x) => x.key === r)?.label || r,
          actions: actions
            .slice()
            .sort((x, y) => (ACTION_ORDER.indexOf(x) + 1 || 99) - (ACTION_ORDER.indexOf(y) + 1 || 99))
            .map((x) => ACTION_WORD[x] || String(x).toLowerCase()),
        })),
      };
    });
}

export default function UserAccessPanel({ orgId, userId }) {
  const [state, setState] = useState({ loading: true, error: '', access: null, modules: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getUserAccess(orgId, userId), getPermissionCatalog().catch(() => null)])
      .then(([access, cat]) => {
        if (!cancelled) setState({ loading: false, error: '', access, modules: cat?.modules || [] });
      })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, error: String(e?.message || e), access: null, modules: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  if (state.loading) return <div className="ui-subtle text-sm">Working out what this person can do…</div>;
  if (state.error) return <div className="ui-subtle text-sm">{state.error}</div>;

  const { access, modules } = state;
  const summary = summarise(modules, access.permissions || []);

  return (
    <div className="space-y-3">
      <div>
        <div className="ui-detail-label">Roles</div>
        {access.roles.length ? (
          <ul className="text-sm ui-fg space-y-0.5">
            {access.roles.map((r) => (
              <li key={`${r.id}-${r.scope}`}>
                {r.name} <span className="ui-subtle">· {r.scope}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ui-subtle text-sm">No role. This person can sign in but cannot do anything here.</div>
        )}
      </div>

      {access.isAdmin ? (
        <div className="text-sm ui-fg">Administrator: can do everything, including managing users and roles.</div>
      ) : (
        <div>
          <div className="ui-detail-label">
            Can do{access.ownDocumentsOnly ? ', on documents they raised themselves only' : ''}
          </div>
          {summary.length ? (
            <div className="space-y-1.5">
              {summary.map((m) => (
                <div key={m.key} className="text-sm">
                  <span className="ui-fg font-medium">{m.label}</span>
                  <span className="ui-muted">
                    {' — '}
                    {m.resources.map((r) => `${r.label} (${r.actions.join(', ')})`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ui-subtle text-sm">Nothing yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
