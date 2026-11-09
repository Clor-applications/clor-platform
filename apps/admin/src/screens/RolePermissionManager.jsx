import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Save } from '@ui/components/ui/lineIcons';

import { listRoles, updateRole } from '@platform/admin/admin';
import { expandPreset, getPermissionCatalog, getRolePermissions, setRolePermissions } from '@ui/api/permissions';
import { Spinner } from '@ui/components/ui/Primitives';
import { usePermissions } from '@ui/permissions/usePermissions';
import { hasApp, orgId as platformOrgId } from '@platform/context';
import PermissionMatrix from './PermissionMatrix';
import { PERMISSION_APPS, catalogKeys, moduleKeys, visibleModules } from './permissionKeys';
import { Meter, PageHead, Panel } from './wsKit';
import './workspace.css';

export const RolePermissionManager = () => {
  const { reload: reloadMyPermissions } = usePermissions();

  const [catalog, setCatalog] = useState({ modules: [], presets: [] });
  /*
   * Which app's permissions are shown (ADR-010). One editor serves every app;
   * an app's "Roles & access" link opens it on that app (?for=payroll), and
   * only the apps this company uses are offered. Filtering hides rows, never
   * grants: what is saved is always the whole role.
   */
  const offeredApps = PERMISSION_APPS.filter((a) => a.id === 'company' || hasApp(a.id));
  const [forApp, setForApp] = useState(() => {
    try {
      const asked = new URLSearchParams(window.location.search).get('for');
      return PERMISSION_APPS.some((a) => a.id === asked) ? asked : 'all';
    } catch {
      return 'all';
    }
  });
  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState('');
  const [granted, setGranted] = useState(() => new Set());
  const [baseline, setBaseline] = useState(() => new Set());
  // Field levels above 0, kept so a save sends back what it did not change.
  const [levels, setLevels] = useState({});
  const [ownDocs, setOwnDocs] = useState(false);
  const [ownDocsBaseline, setOwnDocsBaseline] = useState(false);

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
        setLevels(res?.levels || {});
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  // The flag lives on the role row, which the list already carries.
  const roleOwnDocs = Boolean(roles.find((r) => String(r.id) === String(roleId))?.ownDocumentsOnly);
  useEffect(() => {
    setOwnDocs(roleOwnDocs);
    setOwnDocsBaseline(roleOwnDocs);
  }, [roleId, roleOwnDocs]);

  const dirty = useMemo(() => {
    if (ownDocs !== ownDocsBaseline) return true;
    if (granted.size !== baseline.size) return true;
    for (const k of granted) if (!baseline.has(k)) return true;
    return false;
  }, [granted, baseline, ownDocs, ownDocsBaseline]);

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

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // Only grants the catalogue still knows; a retired key would be refused.
      const known = catalogKeys(catalog.modules);
      const keep = Array.from(granted).filter((k) => known.has(k));
      const keptLevels = Object.fromEntries(Object.entries(levels).filter(([k]) => granted.has(k)));
      await setRolePermissions(roleId, keep, keptLevels);
      if (ownDocs !== ownDocsBaseline) {
        await updateRole(platformOrgId(), roleId, { ownDocumentsOnly: ownDocs });
        setRoles((prev) => prev.map((r) => (String(r.id) === String(roleId) ? { ...r, ownDocumentsOnly: ownDocs } : r)));
        setOwnDocsBaseline(ownDocs);
      }
      setBaseline(new Set(keep));
      setGranted(new Set(keep));
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
      // A template is the whole shape of a role, including whether its holders
      // see only their own documents.
      const meta = catalog.presets.find((p) => p.key === preset);
      if (meta) setOwnDocs(Boolean(meta.ownDocumentsOnly));
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const selectedRole = roles.find((r) => String(r.id) === String(roleId)) || null;
  const total = catalog.modules.reduce((n, m) => n + moduleKeys(m).length, 0);
  const revert = () => {
    setGranted(new Set(baseline));
    setOwnDocs(ownDocsBaseline);
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Permissions']}
          title="Permissions"
          meta={dirty ? 'Unsaved changes' : savedAt ? 'Saved' : null}
          actions={
            roles.length ? (
              <>
                <button type="button" className="ws-btn ws-btn--quiet" onClick={revert} disabled={!dirty || saving}>
                  <RotateCcw size={16} aria-hidden="true" /> Revert
                </button>
                <button type="button" className="ws-btn ws-btn--primary" onClick={save} disabled={!dirty || saving}>
                  {saving ? <Spinner /> : <Save size={16} aria-hidden="true" />} {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : null
          }
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {!dirty && savedAt ? (
          <p role="status" className="sr-only">
            <Check size={11} aria-hidden="true" /> Saved
          </p>
        ) : null}

        {loading ? (
          <p className="ws-card-blurb">Loading roles and permissions…</p>
        ) : !roles.length ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">No roles yet. Create one under Roles.</p>
          </div>
        ) : (
          <div className="ws-layout">
            <div className="grid gap-4 min-w-0">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Permissions for">
                {[{ id: 'all', label: 'All apps' }, ...offeredApps].map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="tab"
                    aria-selected={forApp === a.id}
                    onClick={() => setForApp(a.id)}
                    className={`ws-btn ws-btn--small ${forApp === a.id ? 'ws-btn--quiet' : ''}`}
                    style={forApp === a.id ? { borderColor: 'rgb(var(--ws-accent))', color: 'rgb(var(--ws-accent))' } : { background: 'none' }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <PermissionMatrix
                key={`${roleId}:${forApp}`}
                /* Time & Leave shows under People or Attendance, whichever the company has (TIME-LEAVE-DECISIONS M1). */
                modules={visibleModules(catalog.modules, offeredApps.map((a) => a.id), forApp)}
                granted={granted}
                onToggle={toggle}
                onSetMany={setMany}
              />

              <p className="ws-card-blurb">
                Record visibility comes from branches, set under Users.
              </p>
            </div>

            <aside className="ws-side">
              <Panel title="Role">
                <div className="grid gap-1">
                  <label className="text-sm font-medium" htmlFor="rpm-role">Editing</label>
                  <select id="rpm-role" className="ui-select w-full" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.roleType && r.roleType !== 'CUSTOM' ? ` — ${r.roleType.toLowerCase()}` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedRole?.description ? <p className="ui-caption">{selectedRole.description}</p> : null}
                </div>
                <Meter label="Granted" used={granted.size} limit={total || null} />
                <label className="flex items-start gap-2 text-sm" htmlFor="rpm-own-docs">
                  <input id="rpm-own-docs" type="checkbox" className="mt-0.5" checked={ownDocs} onChange={(e) => setOwnDocs(e.target.checked)} />
                  <span>
                    Own documents only
                    <span className="block ui-caption">Only documents they created.</span>
                  </span>
                </label>
              </Panel>
              {catalog.presets.length ? (
                <Panel title="Start from a template">
                  <select
                    id="rpm-preset"
                    aria-label="Template"
                    className="ui-select w-full"
                    defaultValue=""
                    onChange={(e) => {
                      applyPreset(e.target.value);
                      e.target.value = '';
                    }}
                  >
                    <option value="">Choose a template…</option>
                    {catalog.presets.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <p className="ws-card-blurb">Applies on Save changes.</p>
                </Panel>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

export default RolePermissionManager;
