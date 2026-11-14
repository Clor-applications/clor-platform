import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Download, MoreHorizontal, Pencil, Plus, Power, Search, Trash2 } from '@ui/components/ui/lineIcons';

import Popover from '@ui/components/ui/Popover';
import { exportRows } from '@ui/components/ListToolbar';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { listBranches, createBranch, updateBranch, deleteBranch } from '@platform/admin/admin';
import { PageHead, WsDrawer } from './wsKit';
import './workspace.css';
import './ws-home.css';

/**
 * Workspace → Company → Branches (redesign W-R5).
 *
 * A company's places of business and GST locations: a directory with search
 * and sorting, the record in a drawer, and adding or editing one there. The
 * head office (code HO) is kept in step with the company's own address and
 * GSTIN when its fields are empty. A branch is deleted only while it has no
 * transactions — the server refuses otherwise and says so.
 */
const STATES = [...new Set(Object.values(GST_STATE_BY_CODE).map((s) => String(s || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const EMPTY_NEW = { branchCode: '', branchName: '', addressLine1: '', addressLine2: '', city: '', state: '', country: 'India', gstRegistrationType: 'UNREGISTERED', gstin: '' };

/** Search and sort the directory rows. */
export function branchRows(branches, { q = '', sort = 'branchCode', dir = 1 }) {
  const needle = q.trim().toLowerCase();
  return branches
    .filter((b) => !needle || ['branchCode', 'branchName', 'city', 'state', 'addressLine1', 'gstin', 'phone', 'email'].some((k) => String(b?.[k] || '').toLowerCase().includes(needle)))
    .sort((a, b) => String(a[sort] || '').localeCompare(String(b[sort] || '')) * dir);
}


export function SettingsBranches({ orgId, company, onBranchesChanged }) {
  const [branches, setBranches] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ q: '', sort: 'branchCode', dir: 1 });
  const [stateFilter, setStateFilter] = useState('');
  /** The drawer: { mode: 'create' } or { mode: 'view' | 'edit', id }. */
  const [drawer, setDrawer] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const menuAnchorRef = useRef(null);

  const companyDefaults = useMemo(() => {
    const profile = company?.profile?.companySettings || {};
    return {
      branchName: 'Head Office',
      addressLine1: company?.address || profile.regAddress1 || '',
      addressLine2: profile.regAddress2 || '',
      city: company?.city || profile.regCity || '',
      state: company?.state || profile.regStateName || '',
      country: company?.country || profile.regCountry || 'India',
      gstin: company?.gstin || profile.gstin || '',
      gstRegistrationType: company?.gstin || profile.gstin ? 'REGULAR' : 'UNREGISTERED',
      phone: profile.phone || '',
      email: profile.officialEmail || '',
    };
  }, [company]);
  const gstEnabled = Boolean(company?.profile?.taxCompliances?.gstEnabled ?? company?.gstEnabled ?? company?.gstin);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError('');
    try {
      const res = await listBranches(orgId);
      let rows = Array.isArray(res.branches) ? res.branches : [];
      const headOffice = rows.find((b) => String(b.branchCode || '').trim().toUpperCase() === 'HO');
      if (headOffice) {
        const fill = Object.fromEntries(Object.entries(companyDefaults).filter(([key, value]) => value && !String(headOffice[key] || '').trim()));
        if (Object.keys(fill).length) {
          const synced = await updateBranch(orgId, headOffice.id, fill);
          if (synced?.branch) rows = rows.map((b) => (String(b.id) === String(headOffice.id) ? synced.branch : b));
        }
      }
      setBranches(rows);
    } catch (err) {
      setBranches((prev) => prev || []);
      setError(err.message || 'Failed to load branches');
    }
  }, [orgId, companyDefaults]);
  useEffect(() => {
    load();
  }, [load]);

  const all = useMemo(() => branches || [], [branches]);
  const rows = useMemo(() => branchRows(all, view).filter((b) => !stateFilter || b.state === stateFilter), [all, view, stateFilter]);
  const statesHere = useMemo(() => [...new Set(all.map((b) => b.state).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);
  const active = all.filter((b) => b.isActive !== false).length;
  const noGstin = all.filter((b) => !b.gstin).length;
  const selected = drawer?.id ? all.find((b) => String(b.id) === String(drawer.id)) || null : null;

  const replace = (updated) => setBranches((prev) => (prev || []).map((b) => (String(b.id) === String(updated.id) ? updated : b)));

  const toggleStatus = async (branch) => {
    setMenuFor(null);
    try {
      const res = await updateBranch(orgId, branch.id, { isActive: branch.isActive === false });
      if (res?.branch) replace(res.branch);
      notify.success(`Branch marked ${res?.branch?.isActive === false ? 'inactive' : 'active'}.`);
      onBranchesChanged?.();
    } catch (err) {
      notify.error(err.message || 'Failed to update branch status');
    }
  };

  const remove = async (branch) => {
    setMenuFor(null);
    if (!(await confirmDialog({ title: 'Delete branch?', message: 'Only a branch with no transactions can be deleted.', confirmLabel: 'Delete branch' }))) return;
    try {
      await deleteBranch(orgId, branch.id);
      setBranches((prev) => (prev || []).filter((b) => b.id !== branch.id));
      if (String(drawer?.id) === String(branch.id)) setDrawer(null);
      notify.success('Branch deleted.');
      onBranchesChanged?.();
    } catch (err) {
      notify.error(err.message || 'Failed to delete branch');
    }
  };

  const exportAll = () =>
    exportRows({
      fileName: 'Branches',
      label: 'branch(es)',
      columns: [
        { key: 'branchCode', label: 'Code' },
        { key: 'branchName', label: 'Branch' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'gstin', label: 'GSTIN' },
      ],
      rows,
    });

  const sortBy = (key) => setView((v) => ({ ...v, sort: key, dir: v.sort === key ? -v.dir : 1 }));
  const th = (key, label) => (
    <th aria-sort={view.sort === key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(key)}>
        {label} <ArrowDownUp size={12} aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Company', 'Branches']}
          title="Branches"
          description={`Offices, plants and sites${company?.name ? ` of ${company.name}` : ''}. A branch in a new state needs its own GSTIN.`}
          actions={
            <>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={exportAll} disabled={!rows.length}>
                <Download size={16} aria-hidden="true" /> Export
              </button>
              <PermissionButton permission="MASTERS::Company/Branch setup::CREATE" className="ws-btn ws-btn--primary" onClick={() => setDrawer({ mode: 'create' })}>
                <Plus size={16} aria-hidden="true" /> Add branch
              </PermissionButton>
            </>
          }
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        <div className="ws-filters" role="search">
          <label className="ws-search">
            <span className="sr-only">Search branches</span>
            <Search size={16} aria-hidden="true" />
            <input className="ui-input" value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value }))} placeholder="Search branches" />
          </label>
          {statesHere.length > 1 ? (
            <label>
              <span className="sr-only">State</span>
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                <option value="">State: All</option>
                {statesHere.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </label>
          ) : null}
          {branches ? (
            <span className="ws-list-meta">
              {rows.length} {rows.length === 1 ? 'branch' : 'branches'}
              {all.length - active ? <> · <span>{all.length - active} marked inactive</span></> : null}
              {noGstin ? ` · ${noGstin} without a GSTIN${gstEnabled ? ' (GST is on: add each one)' : ''}` : ''}
            </span>
          ) : null}
        </div>

        {branches === null ? (
          <p className="ws-card-blurb">Loading branches…</p>
        ) : rows.length === 0 ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">{all.length ? 'No branch matches this search.' : 'No branches yet. Add the first one.'}</p>
          </div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Branches of this company</caption>
              <thead>
                <tr>
                  {th('branchName', 'Branch')}
                  {th('state', 'State')}
                  <th>GSTIN</th>
                  <th>Status</th>
                  <th className="ws-th-menu"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <button type="button" className="ws-name-link" onClick={() => setDrawer({ mode: 'view', id: String(b.id) })}>
                        {b.branchName || b.branchCode}
                      </button>
                      <span className="ws-cell-sub">{[b.branchCode, b.city].filter(Boolean).join(' · ') || '—'}</span>
                    </td>
                    <td>{b.state || '—'}</td>
                    <td className="ws-mono">{b.gstin || '—'}</td>
                    <td>
                      {b.isActive === false ? (
                        <span className="ws-pill ws-pill--neutral">Inactive</span>
                      ) : !b.gstin && gstEnabled ? (
                        <span className="ws-pill ws-pill--warn">Needs GSTIN</span>
                      ) : (
                        <span className="ws-pill ws-pill--ok">Active</span>
                      )}
                    </td>
                    <td className="ws-td-menu">
                      <button
                        type="button"
                        className="ws-rowmenu"
                        ref={menuFor === b.id ? menuAnchorRef : null}
                        aria-label={`Actions for ${b.branchName || b.branchCode}`}
                        aria-expanded={menuFor === b.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor((prev) => (prev === b.id ? null : b.id));
                        }}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </button>
                      {menuFor === b.id ? (
                        <Popover anchorRef={menuAnchorRef} onClose={() => setMenuFor(null)} minWidth={176} maxWidth={240}>
                          <button type="button" className="report-menu-item flex items-center gap-2" onClick={() => { setMenuFor(null); setDrawer({ mode: 'edit', id: String(b.id) }); }}>
                            <Pencil size={14} aria-hidden="true" /> Edit
                          </button>
                          <button type="button" className="report-menu-item flex items-center gap-2" onClick={() => toggleStatus(b)}>
                            <Power size={14} aria-hidden="true" /> Mark {b.isActive !== false ? 'inactive' : 'active'}
                          </button>
                          <PermissionButton permission="MASTERS::Company/Branch setup::DELETE" className="report-menu-item flex items-center gap-2" style={{ color: 'rgb(var(--neg))' }} onClick={() => remove(b)}>
                            <Trash2 size={14} aria-hidden="true" /> Delete
                          </PermissionButton>
                        </Popover>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WsDrawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        title={drawer?.mode === 'create' ? 'Add a branch' : drawer?.mode === 'edit' ? 'Edit branch' : selected?.branchName || 'Branch'}
        description={drawer?.mode === 'create' ? '' : selected?.branchCode || ''}
        actions={
          drawer?.mode === 'view' && selected ? (
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setDrawer({ mode: 'edit', id: String(selected.id) })}>
              <Pencil size={14} aria-hidden="true" /> Edit
            </button>
          ) : null
        }
      >
        {drawer?.mode === 'create' ? (
          <BranchForm
            key="create"
            initial={{ ...EMPTY_NEW, gstRegistrationType: gstEnabled ? 'REGULAR' : 'UNREGISTERED' }}
            gstEnabled={gstEnabled}
            onCancel={() => setDrawer(null)}
            submitLabel="Add branch"
            onSubmit={async (f) => {
              if (!String(f.state || '').trim()) throw new Error('State is required — pick the branch state.');
              if (gstEnabled && !String(f.gstin || '').trim()) throw new Error('GSTIN is mandatory while GST is enabled.');
              const payload = { ...f, gstRegistrationType: gstEnabled && f.gstRegistrationType === 'UNREGISTERED' ? 'REGULAR' : f.gstRegistrationType, gstin: f.gstin || null };
              const res = await createBranch(orgId, payload);
              setBranches((prev) => [...(prev || []), res.branch]);
              /* Saving opens what was saved, so what was stored can be checked at once. */
              setDrawer(res?.branch?.id ? { mode: 'view', id: String(res.branch.id) } : null);
              notify.success(`Branch "${res.branch?.branchName || payload.branchName}" created.`);
              onBranchesChanged?.();
            }}
          />
        ) : drawer?.mode === 'edit' && selected ? (
          <BranchForm
            key={`edit-${selected.id}`}
            editing
            initial={{
              branchCode: String(selected.branchCode || ''),
              branchName: String(selected.branchName || ''),
              addressLine1: String(selected.addressLine1 || ''),
              addressLine2: String(selected.addressLine2 || ''),
              city: String(selected.city || ''),
              state: String(selected.state || ''),
              country: String(selected.country || 'India'),
              gstRegistrationType: gstEnabled && String(selected.gstRegistrationType || '') === 'UNREGISTERED' ? 'REGULAR' : String(selected.gstRegistrationType || 'UNREGISTERED'),
              gstin: String(selected.gstin || ''),
              contactPerson: String(selected.contactPerson || ''),
              phone: String(selected.phone || ''),
              email: String(selected.email || ''),
            }}
            gstEnabled={gstEnabled}
            submitLabel="Save changes"
            onCancel={() => setDrawer({ mode: 'view', id: String(selected.id) })}
            onSubmit={async (f) => {
              const t = (v) => String(v || '').trim();
              const payload = {
                branchCode: t(f.branchCode),
                branchName: t(f.branchName),
                addressLine1: t(f.addressLine1),
                addressLine2: t(f.addressLine2) || null,
                city: t(f.city) || null,
                state: t(f.state),
                country: t(f.country) || 'India',
                gstRegistrationType: t(f.gstRegistrationType) || 'UNREGISTERED',
                gstin: t(f.gstin) || null,
                contactPerson: t(f.contactPerson) || null,
                phone: t(f.phone) || null,
                email: t(f.email) || null,
              };
              if (!payload.branchCode) throw new Error('Branch code is required');
              if (!payload.branchName) throw new Error('Branch name is required');
              if (!payload.addressLine1) throw new Error('Address is required');
              if (!payload.state) throw new Error('State is required');
              if ((gstEnabled || payload.gstRegistrationType !== 'UNREGISTERED') && !payload.gstin) throw new Error('GSTIN is mandatory while GST is enabled');
              const res = await updateBranch(orgId, selected.id, payload);
              if (res?.branch) replace(res.branch);
              else await load();
              /* Back to the record just saved, not out of it. */
              setDrawer({ mode: 'view', id: String(selected.id) });
              notify.success(`Branch "${payload.branchName}" saved.`);
            }}
          />
        ) : selected ? (
          <BranchDetail branch={selected} />
        ) : null}
      </WsDrawer>
    </div>
  );
}

/** The record, read. */
function BranchDetail({ branch: b }) {
  const rows = [
    ['Code', b.branchCode, true],
    ['Name', b.branchName],
    ['Status', b.isActive !== false ? 'Active' : 'Inactive'],
    ['Address', [b.addressLine1, b.addressLine2].filter(Boolean).join(', ')],
    ['Location', [b.city, b.state, b.country].filter(Boolean).join(', ')],
    ['GST registration', b.gstRegistrationType || 'UNREGISTERED'],
    ['GSTIN', b.gstin, true],
    ['Contact person', b.contactPerson],
    ['Phone', b.phone],
    ['Email', b.email],
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {rows.map(([label, value, mono]) => (
        <div key={label}>
          <dt className="ws-stat-note">{label}</dt>
          <dd className={`text-sm ${mono ? 'ui-mono' : ''}`}>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Adding or editing a branch. `onSubmit` throws with a sentence to show. */
function BranchForm({ initial, editing = false, gstEnabled, submitLabel, onSubmit, onCancel }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    const next = e.target.value;
    setError('');
    if (k === 'gstin') {
      const fromGstin = getGstStateFromGstin(String(next || '').trim());
      return setF((p) => ({ ...p, gstin: next, state: fromGstin || p.state }));
    }
    return setF((p) => ({ ...p, [k]: next }));
  };
  const field = (k, label, o = {}) => (
    <label className={`grid gap-1 ${o.wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-sm font-medium">{label}{o.required ? <span aria-hidden="true"> *</span> : null}</span>
      <input
        className={`ui-input w-full ${o.mono ? 'ui-mono' : ''}`}
        value={f[k] || ''}
        onChange={set(k)}
        required={Boolean(o.required)}
        readOnly={o.readOnly}
        aria-readonly={o.readOnly || undefined}
        title={o.title}
        type={o.type || 'text'}
        placeholder={o.placeholder}
        spellCheck={o.mono ? false : undefined}
      />
    </label>
  );

  return (
    <form
      className="grid gap-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSubmit(f);
        } catch (err) {
          const message = String(err?.message || 'Not saved.');
          setError(message);
          notify.error(message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="ws-panel-title mb-3">Branch</legend>
        {field('branchCode', 'Branch code', { required: true, mono: true, readOnly: editing, title: editing ? 'Branch code cannot be changed after creation' : undefined })}
        {field('branchName', 'Branch name', { required: true })}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="ws-panel-title mb-3">Address</legend>
        {field('addressLine1', 'Address', { required: true, wide: true })}
        {field('addressLine2', 'Address line 2', { wide: true })}
        {field('city', 'City')}
        <label className="grid gap-1">
          <span className="text-sm font-medium">State <span aria-hidden="true">*</span></span>
          <select className="ui-select" value={f.state} onChange={set('state')} required>
            <option value="">Choose…</option>
            {f.state && !STATES.includes(f.state) ? <option value={f.state}>{f.state}</option> : null}
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {field('country', 'Country')}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="ws-panel-title mb-3">GST</legend>
        <label className="grid gap-1">
          <span className="text-sm font-medium">GST registration</span>
          <select className="ui-select" value={f.gstRegistrationType} onChange={set('gstRegistrationType')}>
            <option value="REGULAR">Regular</option>
            <option value="COMPOSITION">Composition</option>
            {!gstEnabled ? <option value="UNREGISTERED">Unregistered</option> : null}
          </select>
        </label>
        {field('gstin', 'GSTIN', { mono: true, placeholder: '15 characters, e.g. 29ABCDE1234F1Z5' })}
      </fieldset>
      {editing ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="ws-panel-title mb-3">Contact</legend>
          {field('contactPerson', 'Contact person', { wide: true })}
          {field('phone', 'Phone')}
          {field('email', 'Email', { type: 'email' })}
        </fieldset>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className="ws-btn ws-btn--primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" className="ws-btn ws-btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default SettingsBranches;
