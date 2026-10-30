import React, { useMemo, useRef, useState } from 'react';
import { Copy, Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { structure } from '../workforce/api';
import { listBranches } from '../organization/api';
import { createOpening, deleteOpening, getOpening, listOpenings, setApplyLink, setOpeningStatus, updateOpening } from '../api/talent';
import { ReferralBlock } from './ReferralSettings';
import { FormError, Footer, OPENING_STATUS, Pill, ReasonDrawer, SHEET, Tabs, day, staffOptions, useParamState, usePerm, useStaff, usedValues } from './shared';

/**
 * Job openings (TALENT-DECISIONS.md, Hiring): what the company is hiring for, picked from its own
 * lists so the hire lands in the right department, designation, branch and manager. A manager
 * with Create alone asks for an opening; HR opens it. An open job can take applications through
 * its apply link, the page HR shares on WhatsApp or a job site.
 */
const TABS = [['active', 'Active'], ['REQUESTED', 'Asked for'], ['OPEN', 'Open'], ['DRAFT', 'Draft'], ['ON_HOLD', 'On hold'], ['FILLED', 'Filled'], ['CLOSED', 'Closed'], ['all', 'All']];

export default function Openings({ params = {}, openScreen }) {
  const allowed = usePerm();
  const canCreate = allowed('PEOPLE::Recruitment::CREATE');
  const canEdit = allowed('PEOPLE::Recruitment::EDIT');
  const canDelete = allowed('PEOPLE::Recruitment::DELETE');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [open, setOpen] = useParamState(params?.id);
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(null);
  const req = useRequest(() => listOpenings({ status, q }), [status, q]);
  const rows = req.data || [];

  const move = async (row, to) => {
    if (to === 'CLOSED') { setClosing(row); return; }
    try {
      await setOpeningStatus(row.id, to);
      notify.success(to === 'OPEN' ? `${row.title} is open.` : to === 'ON_HOLD' ? `${row.title} is on hold. Its apply link is off.` : `${row.title} is marked filled.`);
      req.reload();
    } catch (e) { notify.error(String(e?.message || 'Not changed.')); }
  };
  const remove = async (row) => {
    if (!(await confirmDialog({ title: `Delete ${row.title}?`, message: 'Only an opening with no candidates can be deleted. Close one that has candidates; it keeps their history.', confirmLabel: 'Delete' }))) return;
    try { await deleteOpening(row.id); notify.success('Deleted.'); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };
  const moves = (r) => [
    ['REQUESTED', 'DRAFT', 'ON_HOLD', 'FILLED', 'CLOSED'].includes(r.status) ? ['OPEN', r.status === 'REQUESTED' ? 'Open it' : r.status === 'DRAFT' ? 'Open' : 'Open again'] : null,
    r.status === 'OPEN' ? ['ON_HOLD', 'Put on hold'] : null,
    ['OPEN', 'ON_HOLD'].includes(r.status) ? ['FILLED', 'Mark filled'] : null,
    !['CLOSED', 'FILLED'].includes(r.status) ? ['CLOSED', r.status === 'REQUESTED' ? 'Turn down' : 'Close'] : null,
  ].filter(Boolean);

  const columns = [
    { key: 'title', label: 'Job', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.title}</span><span className="block truncate ui-caption">{[r.departmentName, r.designationName, r.branchName || r.location].filter(Boolean).join(' · ')}</span></span> },
    { key: 'places', label: 'Places', render: (r) => <span className="tabular-nums">{r.places}</span> },
    { key: 'active', label: 'Candidates', render: (r) => (r.active ? <button type="button" className="ui-link tabular-nums" onClick={(e) => { e.stopPropagation(); openScreen?.('candidates', { opening: r.id }); }}>{r.active}</button> : <span className="ui-muted tabular-nums">0</span>) },
    { key: 'hired', label: 'Hired', render: (r) => <span className={`tabular-nums ${r.hired ? '' : 'ui-muted'}`}>{r.hired}</span> },
    { key: 'manager', label: 'Hiring manager', render: (r) => r.hiringManagerName || <span className="ui-muted">—</span> },
    { key: 'target', label: 'Fill by', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.targetDate) || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className="inline-flex flex-wrap items-center gap-1.5"><Pill map={OPENING_STATUS} value={r.status} />{r.applyOpen ? <span className="ui-pill ui-pill-info">Apply link on</span> : null}{r.referralOpen ? <span className="ui-pill ui-pill-info">Referrals on</span> : null}</span> },
  ];
  const rowActions = (r) => [
    { key: 'candidates', label: 'See candidates', onSelect: () => openScreen?.('candidates', { opening: r.id }) },
    canEdit ? { key: 'edit', label: 'Edit', onSelect: () => setEditing(r) } : null,
    ...(canEdit ? moves(r).map(([to, label]) => ({ key: to, label, onSelect: () => move(r, to) })) : []),
    canDelete ? { key: 'delete', label: 'Delete', onSelect: () => remove(r) } : null,
  ];
  const oneStatus = !['active', 'all'].includes(status);
  const blank = { title: '', places: 1, status: 'OPEN' };

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Job openings' }]} title="Job openings"
        actions={canCreate ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank)}><Plus size={16} aria-hidden="true" /> {canEdit ? 'New opening' : 'Ask for an opening'}</button> : null} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          tabs={<Tabs label="Openings" tabs={TABS} value={status} onChange={setStatus} />}
          label="Job openings"
          columns={oneStatus ? columns.map((c) => (c.key === 'status' ? { ...c, label: 'Apply link', render: (r) => (r.applyOpen ? <span className="ui-pill ui-pill-info">On</span> : <span className="ui-muted">Off</span>) } : c)) : columns}
          rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="openings"
          onRowClick={(r) => setOpen(r.id)} rowActions={rowActions}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.title}</span><Pill map={OPENING_STATUS} value={r.status} /></span>
              <span className="block truncate ui-caption">{[r.departmentName, `${r.active} candidate${r.active === 1 ? '' : 's'}`, r.targetDate ? `fill by ${day(r.targetDate)}` : null].filter(Boolean).join(' · ')}</span>
            </span>
          )}
          empty={q || status !== 'active'
            ? <EmptyState kind="filtered" title="No openings match" description="Nothing here matches the search or the tab." />
            : <EmptyState title="No openings yet" description="Add the job you are hiring for; candidates and interviews hang off it." routes={canCreate ? [{ label: canEdit ? 'New opening' : 'Ask for an opening', onSelect: () => setEditing(blank) }] : undefined} />}
          toolbar={<SearchField value={q} onSearch={setQ} placeholder="Search job, department or place" label="Search openings" className="w-full sm:w-80" />} />
      )}
      {open ? <OpeningDrawer id={open} canEdit={canEdit} moves={moves} onMove={move} onEdit={(o) => { setOpen(null); setEditing(o); }} openScreen={openScreen} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
      {editing ? <OpeningForm value={editing} rows={rows} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={(o) => { setEditing(null); req.reload(); setOpen(o.id); }} /> : null}
      {closing ? (
        <ReasonDrawer title={closing.status === 'REQUESTED' ? `Turn down ${closing.title}` : `Close ${closing.title}`} label="Why" help="Say why, for example filled elsewhere or no longer needed."
          action={closing.status === 'REQUESTED' ? 'Turn down' : 'Close'} suggestions={['No longer needed', 'Filled elsewhere', 'Budget not approved']}
          onClose={() => setClosing(null)}
          onDone={async (reason) => { await setOpeningStatus(closing.id, 'CLOSED', reason); notify.success(`${closing.title} is closed.`); setClosing(null); req.reload(); }} />
      ) : null}
    </div>
  );
}

function OpeningDrawer({ id, canEdit, moves, onMove, onEdit, openScreen, onClose, onChanged }) {
  const req = useRequest(() => getOpening(id), [id]);
  const o = req.data;
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const linkRef = useRef(null);
  const toggleLink = async (on) => {
    if (!on && !(await confirmDialog({ title: 'Turn the apply link off?', message: 'Anyone who opens the link is told the job is not taking applications. Turning it on again makes a new link.', confirmLabel: 'Turn off' }))) return;
    setBusy(true);
    try {
      const r = await setApplyLink(id, on);
      setLink(r.link || null);
      notify.success(on ? 'Apply link made. Copy it now: it is shown once.' : 'Apply link off.');
      req.reload();
      onChanged();
    } catch (e) { notify.error(String(e?.message || 'Not changed.')); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); notify.success('Link copied.'); } catch { linkRef.current?.select(); }
  };
  const act = async (to) => { await onMove(o, to); req.reload(); };
  return (
    <Drawer open onClose={onClose} title={o?.title || 'Opening'} widthClass={SHEET}
      footer={o ? (
        <>
          <button type="button" className="ui-btn ui-btn-secondary mr-auto" onClick={() => openScreen?.('candidates', { opening: o.id })}>See candidates</button>
          {canEdit ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => onEdit(o)}>Edit</button> : null}
        </>
      ) : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !o ? <SkeletonCard lines={6} /> : (
        <div className="space-y-5">
          <dl className="ui-field-grid">
            <div><dt className="ui-label">Status</dt><dd><Pill map={OPENING_STATUS} value={o.status} /></dd></div>
            <div><dt className="ui-label">Places</dt><dd className="text-sm tabular-nums">{o.places}</dd></div>
            <div><dt className="ui-label">Department</dt><dd className="text-sm">{o.departmentName || '—'}</dd></div>
            <div><dt className="ui-label">Designation</dt><dd className="text-sm">{o.designationName || '—'}</dd></div>
            <div><dt className="ui-label">Branch</dt><dd className="text-sm">{o.branchName || '—'}</dd></div>
            <div><dt className="ui-label">Employment type</dt><dd className="text-sm">{o.employeeTypeName || '—'}</dd></div>
            <div><dt className="ui-label">Hiring manager</dt><dd className="text-sm">{o.hiringManagerName || '—'}</dd></div>
            <div><dt className="ui-label">Fill by</dt><dd className="text-sm tabular-nums">{day(o.targetDate) || '—'}</dd></div>
            {o.location ? <div><dt className="ui-label">Where</dt><dd className="text-sm">{o.location}</dd></div> : null}
            {o.closedReason ? <div className="sm:col-span-2"><dt className="ui-label">Why it closed</dt><dd className="text-sm">{o.closedReason}</dd></div> : null}
          </dl>
          {o.description ? <section className="text-sm"><p className="ui-label">About the job</p><p className="whitespace-pre-wrap">{o.description}</p></section> : null}
          {canEdit && moves(o).length ? (
            <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'rgb(var(--border))' }}>
              {moves(o).map(([to, label]) => <button key={to} type="button" className="ui-btn ui-btn-secondary" onClick={() => act(to)}>{label}</button>)}
            </div>
          ) : null}
          {canEdit ? (
            <section className="space-y-2 border-t pt-3" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Apply link">
              <p className="ui-label">Apply link</p>
              {o.status !== 'OPEN' ? <p className="text-sm ui-muted">Open the job to take applications through a link.</p> : link ? (
                <div className="flex gap-2">
                  <input ref={linkRef} className="ui-input w-full" readOnly value={link} aria-label="Apply link" onFocus={(e) => e.target.select()} />
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={copy}><Copy size={16} aria-hidden="true" /> Copy</button>
                </div>
              ) : (
                <p className="text-sm ui-muted">{o.applyOpen ? 'On. Applications land in Candidates as Applied. The link was shown when it was made; make a new one to share it again.' : 'Off. Make a link to share on WhatsApp or a job site; applications land in Candidates.'}</p>
              )}
              {o.status === 'OPEN' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => toggleLink(true)}>{o.applyOpen ? 'Make a new link' : 'Make a link'}</button>
                  {o.applyOpen ? <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => toggleLink(false)}>Turn off</button> : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {canEdit ? <ReferralBlock opening={o} onChanged={() => { req.reload(); onChanged(); }} /> : null}
        </div>
      )}
    </Drawer>
  );
}

function OpeningForm({ value, rows, canEdit, onClose, onSaved }) {
  const lists = useRequest(() => Promise.all([
    structure('departments').catch(() => []), structure('job-positions').catch(() => []), structure('employee-types').catch(() => []), listBranches().catch(() => []),
  ]), []);
  const [departments, designations, types, branches] = lists.data || [[], [], [], []];
  const staff = useStaff();
  const initial = useMemo(() => ({
    title: value.title || '', places: String(value.places ?? 1), departmentId: value.departmentId || '', jobPositionId: value.jobPositionId || '', branchId: value.branchId || '',
    employeeTypeId: value.employeeTypeId || '', hiringManagerId: value.hiringManagerId || '', location: value.location || '', targetDate: value.targetDate || '', description: value.description || '', openNow: true,
  }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (inFlight.current) return;
    if (!form.title.trim()) { setError({ message: 'Say what the job is.' }); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = { ...form, title: form.title.trim(), places: Number(form.places) || 1, ...Object.fromEntries(['departmentId', 'jobPositionId', 'branchId', 'employeeTypeId', 'hiringManagerId', 'targetDate', 'location', 'description'].map((k) => [k, form[k] || null])) };
    try {
      const o = value.id ? await updateOpening(value.id, body) : await createOpening({ ...body, status: form.openNow ? 'OPEN' : 'DRAFT' });
      notify.success(value.id ? 'Saved.' : o.status === 'REQUESTED' ? 'Asked for. HR is told and opens it.' : o.status === 'OPEN' ? `${o.title} is open.` : 'Saved as a draft.');
      onSaved(o);
    } catch (e) { setError(e); } finally { inFlight.current = false; setBusy(false); }
  };
  const pick = (label, key, items, nameOf = (x) => x.name) => (
    <div><PopupSelect showValueSubtext={false} label={label} value={form[key]} placeholder="None" alwaysSearch={items.length > 8} onChange={(v) => set({ [key]: v || '' })} options={[{ value: '', label: 'None' }, ...items.filter((x) => x.isActive !== false || x.id === form[key]).map((x) => ({ value: x.id, label: nameOf(x) }))]} /></div>
  );
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={value.id ? `Edit ${value.title}` : canEdit ? 'New opening' : 'Ask for an opening'}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label={value.id ? 'Save' : !canEdit ? 'Ask HR' : form.openNow ? 'Open' : 'Save draft'} disabled={value.id && !dirty} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        <label className="block sm:col-span-2"><span className="ui-label">Job *</span><SuggestInput autoFocus maxLength={120} value={form.title} onChange={(v) => set({ title: v })} suggestions={[...usedValues(rows, (r) => r.title), ...designations.map((d) => d.name)]} /></label>
        {pick('Department', 'departmentId', departments)}
        {pick('Designation', 'jobPositionId', designations)}
        {pick('Branch', 'branchId', branches, (b) => b.branchName)}
        {pick('Employment type', 'employeeTypeId', types)}
        <div><PopupSelect showValueSubtext={false} label="Hiring manager" value={form.hiringManagerId} placeholder="None" alwaysSearch onChange={(v) => set({ hiringManagerId: v || '' })} options={[{ value: '', label: 'None' }, ...staffOptions(staff)]} /></div>
        <label className="block"><span className="ui-label">Places</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={form.places} onChange={(e) => set({ places: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
        <label className="block"><span className="ui-label">Where</span><SuggestInput maxLength={120} value={form.location} onChange={(v) => set({ location: v })} suggestions={[...usedValues(rows, (r) => r.location), ...branches.map((b) => b.city).filter(Boolean)]} /></label>
        <div><label className="ui-label" htmlFor="opening-target">Fill by</label><DatePicker id="opening-target" value={form.targetDate} onChange={(d) => set({ targetDate: d || '' })} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">About the job</span><textarea className="ui-input w-full" rows={5} maxLength={10000} value={form.description} onChange={(e) => set({ description: e.target.value })} /></label>
        {!value.id && canEdit ? <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.openNow} onChange={(e) => set({ openNow: e.target.checked })} />Open it now, to take candidates</label> : null}
      </form>
    </Drawer>
  );
}
