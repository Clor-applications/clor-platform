import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Lock, RotateCcw, Save, ShieldCheck } from 'lucide-react';

import { listRoles } from '../../api/admin';
import { expandPreset, getPermissionCatalog, getRolePermissions, setRolePermissions } from '@ui/api/permissions';
import { EmptyState, Spinner, SkeletonCard } from '@ui/components/ui/Primitives';
import { usePermissions } from '@ui/permissions/usePermissions';
import SettingsScreenHeader from '../settings/SettingsScreenHeader';
import { orgId as platformOrgId } from '@platform/context';

const key = (module, resource, action) => `${module}::${resource}::${action}`;

/** Every action used anywhere in the catalog, in a stable display order. */
const ACTION_ORDER = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT'];

const actionLabel = {
  VIEW: 'View',
  CREATE: 'Create',
  EDIT: 'Edit',
  DELETE: 'Delete',
  APPROVE: 'Approve',
  EXPORT: 'Export',
};

export const RolePermissionManager = () => {
  const { reload: reloadMyPermissions } = usePermissions();

  const [catalog, setCatalog] = useState({ modules: [], presets: [] });
  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState('');
  const [granted, setGranted] = useState(() => new Set());
  const [baseline, setBaseline] = useState(() => new Set());
  const [openModules, setOpenModules] = useState(() => new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  // Initial load: catalog + role list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [cat, roleRes] = await Promise.all([getPermissionCatalog(), listRoles(platformOrgId())]);
        if (cancelled) return;
        const list = Array.isArray(roleRes?.roles) ? roleRes.roles : [];
        setCatalog(cat || { modules: [], presets: [] });
        setRoles(list);
        setOpenModules(new Set((cat?.modules || []).slice(0, 2).map((m) => m.key)));
        setRoleId((prev) => prev || String(list[0]?.id || ''));
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected role's grants.
  useEffect(() => {
    if (!roleId) return undefined;
    let cancelled = false;
    (async () => {
      setError('');
      try {
        const res = await getRolePermissions(roleId);
        if (cancelled) return;
        const set = new Set(res?.permissions || []);
        setGranted(set);
        setBaseline(new Set(set));
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  const dirty = useMemo(() => {
    if (granted.size !== baseline.size) return true;
    for (const k of granted) if (!baseline.has(k)) return true;
    return false;
  }, [granted, baseline]);

  const toggle = useCallback((k) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const setMany = useCallback((keys, on) => {
    setGranted((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const moduleKeys = useCallback(
    (mod) => mod.resources.flatMap((r) => r.actions.map((a) => key(mod.key, r.key, a))),
    []
  );

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await setRolePermissions(roleId, Array.from(granted));
      setBaseline(new Set(granted));
      setSavedAt(Date.now());
      // The editor may have just changed their own role.
      reloadMyPermissions();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (preset) => {
    if (!preset) return;
    setError('');
    try {
      const res = await expandPreset(roleId, preset);
      setGranted(new Set(res?.permissions || []));
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const selectedRole = roles.find((r) => String(r.id) === String(roleId)) || null;
  const grantedCount = granted.size;

  if (loading) {
    return (
      <SkeletonCard lines={4} />
    );
  }

  if (!roles.length) {
    return (
      <div className="ui-card">
        <EmptyState
          icon={ShieldCheck}
          title="No roles yet"
          description="Create a role under Settings → Roles, then come back to assign what it can do."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Role Permissions"
        description="Tick what each role may do. Users inherit these through the roles assigned to them."
        actions={
          <>
            {dirty ? <span className="ui-pill ui-pill-warn">Unsaved changes</span> : null}
            {!dirty && savedAt ? (
              <span className="ui-pill ui-pill-pos" role="status">
                <Check size={11} aria-hidden="true" /> Saved
              </span>
            ) : null}
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => setGranted(new Set(baseline))}
              disabled={!dirty || saving}
            >
              <RotateCcw size={16} aria-hidden="true" /> Revert
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving ? <Spinner /> : <Save size={16} aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      <div className="ui-card p-4 grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,18rem)_1fr] md:items-end">
        <div>
          <label className="ui-label" htmlFor="rpm-role">
            Role
          </label>
          <select id="rpm-role" className="ui-select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.roleType && r.roleType !== 'CUSTOM' ? ` — ${r.roleType.toLowerCase()}` : ''}
              </option>
            ))}
          </select>
          {selectedRole?.description ? (
            <div className="ui-subtle text-xs mt-1">{selectedRole.description}</div>
          ) : null}
        </div>

        <div>
          <label className="ui-label" htmlFor="rpm-preset">
            Start from a template
          </label>
          <select
            id="rpm-preset"
            className="ui-select"
            defaultValue=""
            onChange={(e) => {
              applyPreset(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Choose a template…</option>
            {catalog.presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="ui-subtle text-xs mt-1">Replaces the ticks below. Nothing saves until you press Save.</div>
        </div>

        <div className="md:text-right">
          <div className="ui-muted text-xs font-semibold uppercase tracking-wide">Granted</div>
          <div className="ui-money-lg">{grantedCount}</div>
          <div className="ui-subtle text-xs">permissions across {catalog.modules.length} modules</div>
        </div>
      </div>

      <div className="space-y-3">
        {catalog.modules.map((mod) => {
          const keys = moduleKeys(mod);
          const on = keys.filter((k) => granted.has(k)).length;
          const all = on === keys.length && keys.length > 0;
          const some = on > 0 && !all;
          const isOpen = openModules.has(mod.key);

          return (
            <section key={mod.key} className="ui-card overflow-hidden">
              <div
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={{ borderBottom: isOpen ? '1px solid rgb(var(--border))' : 'none' }}
              >
                <button
                  type="button"
                  className="flex items-center gap-2 min-w-0 text-left"
                  onClick={() =>
                    setOpenModules((prev) => {
                      const next = new Set(prev);
                      if (next.has(mod.key)) next.delete(mod.key);
                      else next.add(mod.key);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                >
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                  />
                  <span className="ui-title text-sm">{mod.label}</span>
                  <span className={`ui-pill ${on ? 'ui-pill-neutral' : 'ui-pill-neutral'}`}>
                    {on}/{keys.length}
                  </span>
                  {mod.key === 'SETTINGS' ? (
                    <span className="ui-pill ui-pill-warn">
                      <Lock size={10} aria-hidden="true" /> Administration
                    </span>
                  ) : null}
                </button>

                <label className="flex items-center gap-2 text-xs ui-muted cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = some;
                    }}
                    onChange={(e) => setMany(keys, e.target.checked)}
                    aria-label={`Grant every permission in ${mod.label}`}
                  />
                  Select all
                </label>
              </div>

              {isOpen ? (
                <div className="overflow-x-auto">
                  <table className="ui-table ui-table-wide">
                    <thead>
                      <tr>
                        <th scope="col">Resource</th>
                        {ACTION_ORDER.map((a) => (
                          <th key={a} scope="col" className="text-center">
                            {actionLabel[a]}
                          </th>
                        ))}
                        <th scope="col" className="text-center">
                          Row
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mod.resources.map((r) => {
                        const rowKeys = r.actions.map((a) => key(mod.key, r.key, a));
                        const rowAll = rowKeys.every((k) => granted.has(k));
                        return (
                          <tr key={r.key}>
                            <td className="ui-col-meta">
                              <div>{r.label}</div>
                              {r.description ? <div className="ui-subtle text-xs">{r.description}</div> : null}
                            </td>
                            {ACTION_ORDER.map((a) => {
                              const supported = r.actions.includes(a);
                              const k = key(mod.key, r.key, a);
                              return (
                                <td key={a} className="text-center">
                                  {supported ? (
                                    <input
                                      type="checkbox"
                                      checked={granted.has(k)}
                                      onChange={() => toggle(k)}
                                      aria-label={`${actionLabel[a]} ${r.label}`}
                                    />
                                  ) : (
                                    <span className="ui-subtle" aria-label="Not applicable">
                                      –
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={rowAll}
                                ref={(el) => {
                                  if (el) el.indeterminate = !rowAll && rowKeys.some((k) => granted.has(k));
                                }}
                                onChange={(e) => setMany(rowKeys, e.target.checked)}
                                aria-label={`Grant every action on ${r.label}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <p className="ui-subtle text-xs">
        Permissions decide <em>what</em> a user may do. <strong>Which</strong> records they see is separate: that comes
        from the branches and warehouses assigned to them under Settings → Users.
      </p>
    </div>
  );
};

export default RolePermissionManager;
