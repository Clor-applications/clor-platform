import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Save, ShieldCheck } from 'lucide-react';

import { listRoles, updateRole } from '../../api/admin';
import { expandPreset, getPermissionCatalog, getRolePermissions, setRolePermissions } from '@ui/api/permissions';
import { EmptyState, Spinner, SkeletonCard } from '@ui/components/ui/Primitives';
import { usePermissions } from '@ui/permissions/usePermissions';
import SettingsScreenHeader from '../settings/SettingsScreenHeader';
import { orgId as platformOrgId } from '@platform/context';
import PermissionMatrix from './PermissionMatrix';
import { catalogKeys } from './permissionKeys';

export const RolePermissionManager = () => {
  const { reload: reloadMyPermissions } = usePermissions();

  const [catalog, setCatalog] = useState({ modules: [], presets: [] });
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
              onClick={() => {
                setGranted(new Set(baseline));
                setOwnDocs(ownDocsBaseline);
              }}
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
          <label className="flex items-start gap-2 text-sm ui-fg mt-3" htmlFor="rpm-own-docs">
            <input
              id="rpm-own-docs"
              type="checkbox"
              className="mt-0.5"
              checked={ownDocs}
              onChange={(e) => setOwnDocs(e.target.checked)}
            />
            <span>
              Own documents only
              <span className="block ui-subtle text-xs">
                Holders see and change only the invoices, bills, quotes and payments they raised.
              </span>
            </span>
          </label>
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

      <PermissionMatrix
        key={roleId}
        modules={catalog.modules}
        granted={granted}
        onToggle={toggle}
        onSetMany={setMany}
      />

      <p className="ui-subtle text-xs">
        Permissions decide <em>what</em> a user may do. <strong>Which</strong> records they see is separate: that comes
        from the branches and warehouses assigned to them under Settings → Users.
      </p>
    </div>
  );
};

export default RolePermissionManager;
