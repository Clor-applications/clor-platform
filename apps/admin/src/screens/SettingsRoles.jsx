import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, Search } from '@ui/components/ui/lineIcons';
import { emoji } from '@ui/components/ui/emoji';
import { confirmDialog } from '@ui/components/ui/notify';
import { listRoles, listUsers, createRole, updateRole, deleteRole } from '@platform/admin/admin';
import Popover from '@ui/components/ui/Popover';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { getPermissionCatalog } from '@ui/api/permissions';
import { failWords } from './failWords';
import TemplateDrift from './TemplateDrift';
import PermissionMatrix from './PermissionMatrix';
import { RoleAccessList } from './round38';
import { catalogKeys, displayModules, permissionLabel } from './permissionKeys';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Empty, Loading, PageHead, WsDrawer } from './wsKit';
import './workspace.css';
import './ws-access.css';
import './ws-security.css';
import { enumWords, errorWords } from '@ui/utils/errorWords';

/* The colour icon an empty list shows: the one its menu item wears. */
const EMPTY_ICON = emoji('key');

function permKey(p) {
  const module = String(p?.module || '').trim();
  const subModule = String(p?.subModule || '').trim();
  const action = String(p?.action || '').trim();
  return `${module}::${subModule}::${action}`;
}

/*
 * W-5.1: the role catalogue grouped by what a role opens — company
 * administration first, then each app, then roles that reach several apps —
 * from the role's own permissions (the same module-to-app mapping the server
 * enforces, middleware/rbac.ts). Account roles (owner, administrator, billing
 * admin, member) are the account's, shown above the company's roles.
 */
const ACCOUNTING_MODULES = new Set(['SALES', 'PURCHASE', 'INVENTORY', 'ACCOUNTING', 'CASHBANK', 'EXPENSES', 'MASTERS']);
const APP_OF_MODULE = (m) => (ACCOUNTING_MODULES.has(m) ? 'Books' : m === 'PAYROLL' ? 'Payroll' : m === 'PEOPLE' || m === 'ATTENDANCE' ? 'People and Attendance' : null);
/* Each group heading carries its app's colour, as the app tags do elsewhere. */
const GROUP_COLOUR = { 'Company administration': '42 120 214', Books: 'var(--app-accounting, 30 41 99)', Payroll: 'var(--app-payroll, 30 100 160)', 'People and Attendance': 'var(--app-people, 147 51 170)' };
const GROUP_ORDER = ['Company administration', 'Books', 'Payroll', 'People and Attendance', 'Across apps', 'Settings and reports only'];
export function roleGroup(role) {
  if (String(role?.roleType || '') === 'ADMIN') return 'Company administration';
  const apps = new Set((role?._normalizedPermissions || []).filter((p) => p.allowed !== false).map((p) => APP_OF_MODULE(String(p.module || ''))).filter(Boolean));
  if (apps.size === 1) return [...apps][0];
  return apps.size > 1 ? 'Across apps' : 'Settings and reports only';
}
export const ACCOUNT_ROLES = [
  ['Owner', 'Runs the account. No business data by itself.'],
  ['Administrator', 'Adds companies and invites people.'],
  ['Billing admin', 'Sees the account, its plan and billing.'],
  ['Member', 'Access comes from company roles.'],
];

function normalizeRolePermissions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x) return null;
      // Backend shape: RolePermission include { permission: { module, subModule, action }, allowed }
      if (typeof x === 'object' && x.permission) {
        return {
          module: x.permission.module,
          subModule: x.permission.subModule ?? null,
          action: x.permission.action,
          allowed: x.allowed !== false,
        };
      }
      // Alternate acceptable shape
      if (typeof x === 'object' && x.module && x.action) {
        return {
          module: x.module,
          subModule: x.subModule ?? null,
          action: x.action,
          allowed: x.allowed !== false,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function permissionsToSet(perms) {
  const s = new Set();
  for (const p of perms || []) {
    if (p && p.allowed !== false) s.add(permKey(p));
  }
  return s;
}

/*
 * Round 64 "usersroles" B: roles first, and the people inside each one. Who holds the shown role, by name, from the
 * users list (only for someone who may read it; otherwise the count above stays the only figure).
 */
function RoleHolders({ users, roleId }) {
  if (!Array.isArray(users)) return null;
  const inRole = users.filter((u) => u.roleId === roleId && u.isActive !== false && !u.left);
  const names = inRole.map((u) => u.fullName || u.name || u.email).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, 12);
  return (
    <section className="ws-role-holders" aria-label="Who has this role">
      <h3 className="ws-kicker">Who has it</h3>
      {names.length ? (
        <p className="text-sm">{shown.join(', ')}{names.length > shown.length ? ` and ${names.length - shown.length} more` : ''}</p>
      ) : (
        <p className="ws-foot-note">Nobody in this company holds it yet. Give it from Company users.</p>
      )}
    </section>
  );
}

export function SettingsRoles({ orgId }) {
  const [holders, setHolders] = useState(null);
  useEffect(() => {
    if (!orgId) return undefined;
    let gone = false;
    Promise.resolve()
      .then(() => listUsers(orgId))
      .then((r) => { if (!gone) setHolders(Array.isArray(r?.users) ? r.users : null); })
      .catch(() => { if (!gone) setHolders(null); });
    return () => { gone = true; };
  }, [orgId]);
  /* Saving a role can change what the person saving it may do; their own permissions are read again afterwards. */
  const reloadMyPermissions = usePermissions()?.reload;
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', ownDocumentsOnly: false, permissions: new Set() });
  /** The server's permission catalogue: the only list the form may offer. */
  const [catalog, setCatalog] = useState({ modules: [], presets: [] });
  /** Grants the role holds that the catalogue has since retired; dropped on save. */
  const [retired, setRetired] = useState(0);
  /** Narrows the permission list in the role form; it never changes what is granted. */
  const [permissionSearch, setPermissionSearch] = useState('');
  useEffect(() => {
    if (showForm) setPermissionSearch('');
  }, [showForm]);
  const [search, setSearch] = useState('');
  const [openMenuForRoleId, setOpenMenuForRoleId] = useState(null);
  /** The trigger the open menu hangs from; only one row's menu is open. */
  const menuAnchorRef = useRef(null);
  const [viewRoleId, setViewRoleId] = useState(null);

  const loadRoles = async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const [res, cat] = await Promise.all([listRoles(orgId), getPermissionCatalog().catch(() => null)]);
      const modules = cat?.modules || catalog.modules;
      if (cat) setCatalog(cat);
      const next = (Array.isArray(res.roles) ? res.roles : []).map((r) => {
        const normalized = normalizeRolePermissions(r.permissions);
        return {
          ...r,
          _normalizedPermissions: normalized,
          _permissionLabels: normalized.filter((p) => p.allowed !== false).map((p) => permissionLabel(modules, permKey(p))),
        };
      });
      setRoles(next);
    } catch (err) {
      setError(errorWords(err, 'load the roles'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, [orgId]);

  const openCreate = () => {
    setEditRole(null);
    setForm({ name: '', description: '', ownDocumentsOnly: false, permissions: new Set() });
    setRetired(0);
    setShowForm(true);
  };

  const openView = (roleId) => {
    setViewRoleId(String(roleId));
    setOpenMenuForRoleId(null);
  };

  const openEdit = (r) => {
    setEditRole(r);
    const normalized = normalizeRolePermissions(r.permissions || r._normalizedPermissions);
    const held = permissionsToSet(normalized);
    // Keep only what the catalogue still offers. Older roles can hold keys from
    // the list this screen used to keep; they never granted anything.
    const known = catalogKeys(catalog.modules);
    const kept = new Set([...held].filter((k) => known.has(k)));
    setRetired(held.size - kept.size);
    setForm({
      name: r.name,
      description: r.description || '',
      ownDocumentsOnly: Boolean(r.ownDocumentsOnly),
      permissions: kept,
    });
    setShowForm(true);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: String(form.name || '').trim(),
        description: String(form.description || '').trim() || null,
        ownDocumentsOnly: Boolean(form.ownDocumentsOnly),
        // Catalogue wire keys, which the server accepts as they are.
        permissions: Array.from(form.permissions),
      };
      if (editRole) {
        const res = await updateRole(orgId, editRole.id, payload);
        const normalized = normalizeRolePermissions(res.role?.permissions);
        const nextRole = {
          ...res.role,
          // The save answers with the role, not with who holds it: keep the count the list already had.
          assignedUsersCount: res.role?.assignedUsersCount ?? editRole.assignedUsersCount ?? 0,
          _normalizedPermissions: normalized,
          _permissionLabels: normalized.filter((p) => p.allowed !== false).map((p) => permissionLabel(catalog.modules, permKey(p))),
        };
        setRoles((prev) => prev.map((r) => (r.id === editRole.id ? nextRole : r)));
      } else {
        const res = await createRole(orgId, payload);
        const normalized = normalizeRolePermissions(res.role?.permissions);
        const nextRole = {
          ...res.role,
          assignedUsersCount: res.role?.assignedUsersCount ?? 0,
          _normalizedPermissions: normalized,
          _permissionLabels: normalized.filter((p) => p.allowed !== false).map((p) => permissionLabel(catalog.modules, permKey(p))),
        };
        setRoles((prev) => [...prev, nextRole]);
      }
      setShowForm(false);
      reloadMyPermissions?.();
    } catch (err) {
      const perm = err?.data?.permission;
      const permHint = perm?.module && perm?.action ? ` It needs the “${perm.subModule || enumWords(perm.module)}: ${String(perm.action).toLowerCase()}” permission.` : '';
      setError(err?.data?.code ? failWords(err, 'save the role') : errorWords(err, 'save the role') + permHint);
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async (id, name) => {
    if (!await confirmDialog({ title: name ? `Delete the role “${name}”?` : 'Delete this role?', message: 'People who hold it lose what it allowed. This cannot be undone.', confirmLabel: 'Delete role', tone: 'danger' })) return;
    try {
      await deleteRole(orgId, id);
      setRoles((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(failWords(err, 'delete the role'));
    }
  };

  const query = String(search || '').trim().toLowerCase();
  const filteredRoles = query
    ? roles.filter((r) => {
        const name = String(r?.name || '').toLowerCase();
        const desc = String(r?.description || '').toLowerCase();
        return name.includes(query) || desc.includes(query);
      })
    : roles;

  const selectedRole = useMemo(() => {
    if (!viewRoleId) return null;
    return roles.find((r) => String(r.id) === String(viewRoleId)) || null;
  }, [roles, viewRoleId]);

  const exportRoles = (key) => {
    const format = exportFormatFromKey(key);
    if (!format) return;
    runListExport({
      format,
      title: 'Roles',
      fileName: 'Roles',
      label: 'role(s)',
      columns: [
        { key: 'name', label: 'Role' },
        { key: 'description', label: 'Description' },
        { key: 'group', label: 'Opens', value: (r) => roleGroup(r) },
        { key: 'assignedUsersCount', label: 'People', value: (r) => Number(r.assignedUsersCount || 0) },
      ],
      rows: filteredRoles,
    });
  };

  const groups = GROUP_ORDER.map((group) => ({ group, rows: filteredRoles.filter((r) => roleGroup(r) === group) })).filter((g) => g.rows.length);
  const errorNote = error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null;

  /* The role shown on the page: the one picked, else the first in the list. */
  const shownRole = selectedRole || filteredRoles[0] || null;
  const shownPermissions = shownRole
    ? permissionsToSet(normalizeRolePermissions(shownRole.permissions || shownRole._normalizedPermissions))
    : new Set();
  const peopleOf = (r) => Number(r?.assignedUsersCount || 0);

  /* The role form's permission list, narrowed to what the search names. A hidden row keeps whatever it was granted. */
  const permissionQuery = permissionSearch.trim().toLowerCase();
  const formModules = permissionQuery
    ? displayModules(catalog.modules)
        .map((m) => ({
          ...m,
          resources: (m.resources || []).filter((r) => `${m.label} ${r.label} ${r.description || ''}`.toLowerCase().includes(permissionQuery)),
        }))
        .filter((m) => m.resources.length)
    : catalog.modules;

  /* A copy of a role: the create form, filled with the role's permissions. */
  const openDuplicate = (r) => {
    if (!r) return;
    const known = catalogKeys(catalog.modules);
    const held = permissionsToSet(normalizeRolePermissions(r.permissions || r._normalizedPermissions));
    setEditRole(null);
    setForm({
      name: `${r.name} (copy)`,
      description: r.description || '',
      ownDocumentsOnly: Boolean(r.ownDocumentsOnly),
      permissions: new Set([...held].filter((k) => !known.size || known.has(k))),
    });
    setRetired(0);
    setShowForm(true);
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Users & access', 'Roles']}
          title="Roles"
          description="What each role can do in each app. People can hold different roles in different companies."
          actions={
            <>
              <MoreButton items={[exportMenuItem('Export roles')]} onSelect={exportRoles} />
              <PermissionButton permission="SETTINGS::Roles::CREATE" type="button" onClick={openCreate} className="ws-btn ws-btn--primary">
                <Plus size={16} aria-hidden="true" /> New role
              </PermissionButton>
            </>
          }
        />

        {!showForm ? errorNote : null}

        <div className="ws-roles-layout">
          <section className="ws-flat" aria-label={shownRole ? `${shownRole.name} permissions` : 'Role permissions'}>
            {loading && !roles.length ? (
              <Loading shape="rows" rows={3} label="Loading roles…" />
            ) : !shownRole ? (
              <Empty icon={EMPTY_ICON} compact actionNode={roles.length ? null : <PermissionButton permission="SETTINGS::Roles::CREATE" type="button" onClick={openCreate} className="ws-btn ws-btn--quiet ws-btn--small">Create role</PermissionButton>}>{roles.length ? 'No role matches this search.' : 'Roles say what people can do in each app. They will be listed here.'}</Empty>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1" style={{ minWidth: 0 }}>
                    <h2 className="ws-h2">{shownRole.name}</h2>
                    <p className="ws-foot-note">
                      {peopleOf(shownRole)} {peopleOf(shownRole) === 1 ? 'person' : 'people'} · {roleGroup(shownRole)}
                      {String(shownRole.roleType || '') === 'CUSTOM' ? ' · made here' : ''}
                      {shownRole.description ? ` · ${shownRole.description}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" className="ws-row-link" onClick={() => openEdit(shownRole)}>Edit role</button>
                    <button
                      type="button"
                      ref={openMenuForRoleId === shownRole.id ? menuAnchorRef : null}
                      className="ws-more-btn"
                      aria-label={`Actions for ${shownRole.name}`}
                      aria-expanded={openMenuForRoleId === shownRole.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuForRoleId((prev) => (prev === shownRole.id ? null : shownRole.id));
                      }}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    {openMenuForRoleId === shownRole.id ? (
                      <Popover anchorRef={menuAnchorRef} onClose={() => setOpenMenuForRoleId(null)} minWidth={160} maxWidth={220}>
                        <button type="button" className="report-menu-item" onClick={() => { setOpenMenuForRoleId(null); openDuplicate(shownRole); }}>Copy</button>
                        <PermissionButton
                          permission="SETTINGS::Roles::DELETE"
                          type="button"
                          className="report-menu-item"
                          style={{ color: 'rgb(var(--neg))' }}
                          onClick={() => { setOpenMenuForRoleId(null); removeRole(shownRole.id, shownRole.name); }}
                        >
                          Delete
                        </PermissionButton>
                      </Popover>
                    ) : null}
                  </div>
                </div>
                {shownRole.ownDocumentsOnly ? <p><span className="ws-state" data-tone="info">Own documents only</span></p> : null}
                <RoleHolders users={holders} roleId={shownRole.id} />
                <TemplateDrift template={shownRole.template} modules={catalog.modules} />
                {/* Round 38: a plain list of what the role can see and change, by screen; the full grid stays one click away. */}
                {catalog.modules.length ? (
                  <>
                    <RoleAccessList modules={catalog.modules} granted={shownPermissions} roleName={shownRole.name} />
                    <details className="ui-role-grid">
                      <summary>Every permission, as a grid</summary>
                      <fieldset disabled aria-label="Permissions (read only)">
                        <PermissionMatrix key={shownRole.id} modules={catalog.modules} granted={shownPermissions} onToggle={() => {}} onSetMany={() => {}} initiallyOpen={2} />
                      </fieldset>
                    </details>
                  </>
                ) : (
                  <Loading shape="card" rows={3} label="Loading the permission list…" />
                )}
              </>
            )}
          </section>

          <aside className="ws-flat" aria-labelledby="ws-roles-list-title">
            <h2 id="ws-roles-list-title" className="ws-h2">Roles</h2>
            <div className="ws-filters" role="search">
              <label className="ws-search" style={{ flex: '1 1 auto' }}>
                <span className="sr-only">Search roles</span>
                <Search size={16} aria-hidden="true" />
                <input className="ui-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by role name" />
              </label>
            </div>
            {groups.map(({ group, rows }) => (
              <section key={group} className="grid gap-1" aria-labelledby={`roles-${group}`}>
                <h3 id={`roles-${group}`} className="ws-role-group" style={{ '--tag': GROUP_COLOUR[group] || 'var(--ws-blue, 42 120 214)' }}><i aria-hidden="true" />{group}</h3>
                <ul className="ws-role-list">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="ws-role-pick" aria-current={shownRole?.id === r.id ? 'true' : undefined} onClick={() => openView(r.id)}>
                        <span className="min-w-0 truncate">{r.name}</span>
                        <span className="num" data-zero={peopleOf(r) ? undefined : ''} aria-label={`${peopleOf(r)} ${peopleOf(r) === 1 ? 'person' : 'people'}`}>{peopleOf(r)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section className="grid gap-1" aria-labelledby="ws-account-roles">
              <h3 id="ws-account-roles" className="ws-role-group" style={{ '--tag': '42 120 214' }}><i aria-hidden="true" />Account roles</h3>
              <p className="ws-foot-note" style={{ padding: '0 12px' }}>The level above these, given under Members.</p>
              <ul className="ws-list">
                {ACCOUNT_ROLES.map(([name, what]) => (
                  <li key={name}>
                    <div className="ws-item" style={{ minHeight: 48, padding: '8px 12px' }}>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{name}</span>
                        <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{what}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>

      <WsDrawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editRole ? `Edit ${editRole.name}` : 'New role'}
        actions={(
          <>
            <button type="button" onClick={() => setShowForm(false)} className="ws-btn ws-btn--quiet">Cancel</button>
            <button type="submit" form="role-settings-form" disabled={saving} className="ws-btn ws-btn--primary">
              {saving ? 'Saving…' : editRole ? 'Save role' : 'Create role'}
            </button>
          </>
        )}
      >
        <form id="role-settings-form" onSubmit={onSubmit} className="ws-role-form grid gap-5">
          {errorNote}
          <div className="ws-role-fields">
          <label className="grid gap-1" htmlFor="settingsroles-role-name">
            <span className="text-sm font-semibold">Role name <span className="ui-required" aria-hidden="true">*</span></span>
            <input id="settingsroles-role-name" className="ui-input w-full" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </label>
          <label className="grid gap-1" htmlFor="settingsroles-role-description">
            <span className="text-sm font-semibold">Description</span>
            <input
              id="settingsroles-role-description"
              className="ui-input w-full"
              maxLength={300}
              placeholder="What people with this role do, in one line"
              value={form.description || ''}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
            <span className="ui-caption">Shown when picking a role for someone.</span>
          </label>
          </div>
          <label className="flex items-start gap-2 text-sm" htmlFor="settingsroles-own-docs">
            <input
              id="settingsroles-own-docs"
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(form.ownDocumentsOnly)}
              onChange={(e) => setForm((p) => ({ ...p, ownDocumentsOnly: e.target.checked }))}
            />
            <span>
              Own documents only
              <span className="block ui-caption">Only documents they created.</span>
            </span>
          </label>
          <div className="grid gap-2">
            <span className="ws-role-form-h">Permissions</span>
            {retired > 0 ? (
              <p className="ui-caption" role="status">
                {retired} old permission{retired === 1 ? '' : 's'} on this role no longer exist and will be removed when you save. They never granted anything.
              </p>
            ) : null}
            {catalog.modules.length ? (
              <div className="ws-role-find">
                <label className="ws-search">
                  <span className="sr-only">Find a module or permission</span>
                  <Search size={16} aria-hidden="true" />
                  <input
                    className="ui-input"
                    value={permissionSearch}
                    onChange={(e) => setPermissionSearch(e.target.value)}
                    placeholder="Find a module or permission"
                  />
                </label>
                <span className="ui-caption whitespace-nowrap tabular-nums">{form.permissions.size} selected</span>
              </div>
            ) : null}
            {catalog.modules.length && !formModules.length ? (
              <Empty icon={EMPTY_ICON} compact>No permissions match your search.</Empty>
            ) : catalog.modules.length ? (
              <PermissionMatrix
                key={`${editRole?.id || 'new'}:${permissionQuery}`}
                modules={formModules}
                granted={form.permissions}
                initiallyOpen={permissionQuery ? formModules.length : 1}
                onToggle={(k) =>
                  setForm((prev) => {
                    const next = new Set(prev.permissions);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return { ...prev, permissions: next };
                  })
                }
                onSetMany={(keys, on) =>
                  setForm((prev) => {
                    const next = new Set(prev.permissions);
                    for (const k of keys) {
                      if (on) next.add(k);
                      else next.delete(k);
                    }
                    return { ...prev, permissions: next };
                  })
                }
              />
            ) : (
              <Loading shape="card" rows={3} label="Loading the permission list…" />
            )}
          </div>
        </form>
      </WsDrawer>
    </div>
  );
}
