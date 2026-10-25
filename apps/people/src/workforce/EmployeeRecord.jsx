import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import RecordTabs from '@ui/components/ui/RecordTabs';
import ErrorState, { errorKind } from '@ui/components/ui/ErrorState';
import Alert from '@ui/components/ui/Alert';
import ActivityTimeline from '@ui/components/ui/ActivityTimeline';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import Popover from '@ui/components/ui/Popover';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { hasApp } from '@platform/context';
import {
  Avatar, CustomFields, EmployeeChecklist, EmployeeDocuments, EmploymentHistory, GENDER_WORDS, InviteForm, JoiningDetails, Journey, ResignForm, SCHEDULED_LABELS, StatutoryDetails,
} from '@ui/personnel/Employees';
import { LEAVING_TYPES } from '@ui/personnel/api';

import {
  addComment, changeImpact, decideProbation, deleteEmployee, employeeActivity, getEmployee, listEmployees, openTasksFor, rehireEmployee, structure, updateEmployee, withdrawScheduled,
} from './api';
import { StatusBadge, can } from './shared';

/**
 * Workforce → Employee (People design spec v1 EMP-03..09; Workforce package
 * WF-04..08, WF-12..14). One record page: a header that says who this is,
 * seven tabs that each own their part, and the employment operations. The
 * open tab, a section being edited and an operation in progress live in the
 * address, so Back and a shared link land in the same place.
 *
 * Every save sends the version this page loaded. If someone else saved first
 * the server answers 409: the edits stay in the form, the newer record is
 * shown, and the person decides (spec §8, WF-04 conflict).
 */
const TABS = [['overview', 'Overview'], ['personal', 'Personal'], ['employment', 'Employment'], ['organization', 'Organization'], ['documents', 'Documents'], ['history', 'History'], ['activity', 'Activity']];
const LAST_DIRECTORY = 'people.workforce.lastDirectory';
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shown = (v) => (v === null || v === undefined || v === '' ? null : v);

function Field({ label, value, mono = false }) {
  return (
    <div className="ui-field-row">
      <dt className="ui-caption">{label}</dt>
      <dd className={`text-sm ${mono ? 'tabular-nums' : ''}`}>{shown(value) ?? <span className="ui-muted">Not provided</span>}</dd>
    </div>
  );
}

function Section({ title, onEdit, children, action = null }) {
  return (
    <section className="ui-record-section" aria-label={title}>
      <header className="flex items-center justify-between gap-2 mb-3">
        <h2 className="ui-t-sec">{title}</h2>
        <span className="flex items-center gap-3">
          {action}
          {onEdit ? <button type="button" className="ui-link text-sm inline-flex items-center gap-1" onClick={onEdit}><Pencil size={14} aria-hidden="true" /> Edit</button> : null}
        </span>
      </header>
      {children}
    </section>
  );
}

export default function EmployeeRecord({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const allowed = (k) => can(perms, k);
  const id = params.id;
  const tabsAllowed = TABS.filter(([k]) => k !== 'documents' || allowed('PEOPLE::Documents::VIEW')).map(([key, label]) => ({ key, label }));
  const tab = tabsAllowed.some((t) => t.key === params.tab) ? params.tab : 'overview';
  const rec = useRequest(() => (id ? getEmployee(id) : Promise.reject(Object.assign(new Error('No employee chosen.'), { status: 404 }))), [id]);
  const person = rec.data?.employee || null;
  const setPerson = (patch) => rec.setData((d) => ({ ...d, employee: { ...d.employee, ...patch } }));
  const [lists, setLists] = useState(null);
  useEffect(() => {
    Promise.all(['departments', 'job-positions', 'employee-types', 'work-types', 'areas', 'establishments', 'teams', 'business-units', 'grades', 'cost-centres'].map((k) => structure(k).catch(() => [])))
      .then(([departments, positions, types, workTypes, areas, establishments, teams, units, grades, centres]) => setLists({ departments, positions, types, workTypes, areas, establishments, teams, units, grades, centres }));
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [resigning, setResigning] = useState(false);
  const [inviting, setInviting] = useState(false);
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const backToDirectory = () => {
    let last = {};
    try { last = JSON.parse(sessionStorage.getItem(LAST_DIRECTORY) || '{}'); } catch { /* none kept */ }
    openScreen?.('employees', last);
  };

  if (rec.loading) return <div className="space-y-4" aria-busy="true"><SkeletonCard lines={3} /><SkeletonCard lines={6} /></div>;
  if (rec.error && !person) {
    const k = errorKind(rec.error);
    return <ErrorState error={rec.error} title={k === 'notFound' || k === 'forbidden' ? 'This employee record is not available' : undefined} body={k === 'notFound' || k === 'forbidden' ? 'It may have been removed, or you may not have access to it.' : undefined} onRetry={k === 'notFound' || k === 'forbidden' ? null : rec.reload} onBack={backToDirectory} />;
  }

  const editable = allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT';
  const openAction = (action) => { setMoreOpen(false); set({ action }, true); };
  const remove = async () => {
    setMoreOpen(false);
    if (!(await confirmDialog({ title: `Delete ${person.name}?`, message: 'Only a record payroll has never used can be deleted. Anyone else is marked as having left, and their history is kept.', confirmLabel: 'Delete' }))) return;
    try {
      await deleteEmployee(person.id);
      notify.success(`${person.name} removed.`);
      backToDirectory();
    } catch (e) {
      notify.error(String(e?.message || 'Not deleted.'));
    }
  };
  const moreItems = [
    editable ? ['manager', 'Change manager'] : null,
    editable ? ['transfer', 'Transfer'] : null,
    editable ? ['designation', 'Change designation'] : null,
    editable ? ['type', 'Change employment type'] : null,
    editable && person.status !== 'SUSPENDED' ? ['status', 'Suspend'] : null,
    allowed('PEOPLE::Employees::EDIT') && person.status === 'SUSPENDED' ? ['status', 'Reactivate'] : null,
    person.status !== 'LEFT' && allowed('PEOPLE::Lifecycle::CREATE') ? ['invite', 'Invite to fill in details'] : null,
    person.status !== 'LEFT' && allowed('PEOPLE::Employees::EDIT') ? ['leave', 'Record leaving'] : null,
    person.status === 'LEFT' && allowed('PEOPLE::Employees::EDIT') ? ['rehire', 'Rehire'] : null,
    allowed('PEOPLE::Employees::DELETE') ? ['delete', 'Delete'] : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Workforce', onClick: backToDirectory }, { label: person.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar person={person} size={56} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">{person.name}{person.preferredName ? <span className="ui-muted text-base font-normal">({person.preferredName})</span> : null}<StatusBadge employee={person} /></span>
              <span className="block ui-caption font-normal tabular-nums">{[person.code, person.designation, person.department, person.areaName || person.workLocation].filter(Boolean).join(' · ') || 'No role or department yet'}</span>
              {person.reportingManagerName ? <span className="block ui-caption font-normal">Reports to {person.reportingManagerName}</span> : null}
            </span>
          </span>
        }
        actions={<>
          {moreItems.length ? (
            <>
              <button ref={moreRef} type="button" className="ui-btn ui-btn-secondary" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>More <ChevronDown size={14} aria-hidden="true" /></button>
              {moreOpen ? (
                <Popover anchorRef={moreRef} onClose={() => setMoreOpen(false)} minWidth={220}>
                  <MenuList items={moreItems} onPick={(k) => {
                    if (k === 'delete') return remove();
                    if (k === 'invite') { setMoreOpen(false); return setInviting(true); }
                    if (k === 'leave') { setMoreOpen(false); return setResigning(true); }
                    if (k === 'rehire') { setMoreOpen(false); return set({ tab: 'employment', action: null }, true); }
                    return openAction(k);
                  }} onEscape={() => { setMoreOpen(false); moreRef.current?.focus(); }} />
                </Popover>
              ) : null}
            </>
          ) : null}
          {editable ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => set({ tab: ['employment', 'organization'].includes(tab) ? tab : 'personal', edit: tab === 'employment' ? 'employment' : tab === 'organization' ? null : 'name', action: tab === 'organization' ? 'transfer' : null }, true)}><Pencil size={16} aria-hidden="true" /> Edit</button> : null}
        </>}
      />

      {(rec.data.permits || []).filter((p) => p.daysLeft <= 30).map((p) => (
        <Alert key={p.id} tone={p.expired ? 'neg' : 'warn'} title={p.expired ? `${p.title} expired on ${formatDate(p.expiresOn)}` : `${p.title} expires in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`}>{p.restrictsWork ? `Until renewed: ${p.restrictsWork}.` : 'Add the renewed copy on Documents.'}</Alert>
      ))}
      {rec.error ? <Alert tone="neg" title="Could not refresh this record" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={rec.reload}>Retry</button>}>Showing what was loaded before.</Alert> : null}

      <RecordTabs tabs={tabsAllowed} value={tab} onChange={(k) => set({ tab: k === 'overview' ? null : k, edit: null, action: null }, true)} label={`${person.name} sections`}>
        {tab === 'overview' ? <Overview person={person} data={rec.data} lists={lists} allowed={allowed} goTo={(t) => set({ tab: t }, true)} /> : null}
        {tab === 'personal' ? <Personal person={person} allowed={allowed} editing={params.edit} setEditing={(e) => set({ edit: e })} onSaved={(emp) => rec.setData((d) => ({ ...d, employee: { ...d.employee, ...emp } }))} reload={rec.reload} /> : null}
        {tab === 'employment' ? <Employment person={person} data={rec.data} lists={lists} allowed={allowed} editing={params.edit} setEditing={(e) => set({ edit: e })} onSaved={(emp) => setPerson(emp)} reload={rec.reload} openAction={openAction} /> : null}
        {tab === 'organization' ? <Organization person={person} lists={lists} allowed={allowed} openAction={openAction} openPerson={(pid) => openScreen?.('employee', { id: pid })} /> : null}
        {tab === 'documents' ? <EmployeeDocuments employeeId={person.id} /> : null}
        {tab === 'history' ? <div className="space-y-6"><Section title="Employment history"><EmploymentHistory employeeId={person.id} /></Section><Section title="Every change and why"><Journey employeeId={person.id} /></Section></div> : null}
        {tab === 'activity' ? <Activity person={person} canComment={allowed('PEOPLE::Employee Notes::CREATE')} /> : null}
      </RecordTabs>

      {params.action && lists ? (
        <OperationDrawer action={params.action} person={person} lists={lists} onClose={() => set({ action: null })} onDone={() => { set({ action: null }); rec.reload(); }} />
      ) : null}
      {resigning ? <ResignForm person={person} onClose={() => setResigning(false)} onDone={(p) => { setResigning(false); setPerson(p); rec.reload(); }} /> : null}
      {inviting ? <InviteForm person={person} onClose={() => setInviting(false)} onDone={() => setInviting(false)} /> : null}
    </div>
  );
}

function MenuList({ items, onPick, onEscape }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[role="menuitem"]')?.focus(); }, []);
  return (
    <div ref={ref} role="menu" className="ui-menu" onKeyDown={(e) => {
      const all = [...ref.current.querySelectorAll('[role="menuitem"]')];
      const i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
    }}>
      {items.map(([k, label]) => <button key={k} type="button" role="menuitem" className={`ui-menu-item ${k === 'delete' ? 'is-danger' : ''}`} onClick={() => onPick(k)}>{label}</button>)}
    </div>
  );
}

/* --------------------------------------------------------------- Overview */

function Overview({ person, data, lists, allowed, goTo }) {
  const activity = useRequest(() => employeeActivity(person.id), [person.id, person.version]);
  /* Open items: this person's joining and leaving tasks not yet done. */
  const checklist = useRequest(() => openTasksFor(person.id), [person.id]);
  const tasks = checklist.data ? Object.values(checklist.data).flatMap((g) => (g?.tasks || []).filter((t) => !t.done)) : null;
  void data;
  const typeName = lists?.types.find((t) => t.id === person.employeeTypeId)?.name;
  return (
    <div className="ui-record-overview">
      <div className="space-y-4 min-w-0">
        <Section title="Personal information" action={<button type="button" className="ui-link text-sm" onClick={() => goTo('personal')}>Open</button>}>
          <dl className="ui-field-grid">
            <Field label="Full name" value={person.name} />
            <Field label="Preferred name" value={person.preferredName} />
            <Field label="Work email" value={person.workEmail} />
            <Field label="Phone" value={person.phone} />
          </dl>
        </Section>
        <Section title="Job details" action={<button type="button" className="ui-link text-sm" onClick={() => goTo('employment')}>Open</button>}>
          <dl className="ui-field-grid">
            <Field label="Employee ID" value={person.code} mono />
            <Field label="Joining date" value={person.dateOfJoining ? formatDate(String(person.dateOfJoining).slice(0, 10)) : null} mono />
            <Field label="Department" value={person.department} />
            <Field label="Designation" value={person.designation} />
            <Field label="Employment type" value={typeName} />
            <Field label="Location" value={person.areaName || person.workLocation} />
          </dl>
        </Section>
        <Section title="Relationships" action={<button type="button" className="ui-link text-sm" onClick={() => goTo('organization')}>Open</button>}>
          <dl className="ui-field-grid">
            <Field label="Manager" value={person.reportingManagerName} />
            <Field label="Also reports to" value={person.dottedManagerName} />
            <Field label="Direct reports" value={(person.directReports || []).length ? `${person.directReports.length}: ${person.directReports.slice(0, 4).map((r) => r.name).join(', ')}${person.directReports.length > 4 ? '…' : ''}` : 'None'} />
          </dl>
        </Section>
        {tasks?.length ? (
          <Section title="Open items">
            <ul className="divide-y text-sm">{tasks.map((t) => <li key={t.id} className="py-2 flex justify-between gap-3"><span>{t.title}</span><span className="ui-caption tabular-nums">{t.dueDate ? formatDate(t.dueDate) : ''}</span></li>)}</ul>
          </Section>
        ) : null}
      </div>
      {/* At wide widths the latest activity sits beside the record (spec §6, WF-04 context rail); narrower, it is the Activity tab. */}
      <aside className="ui-record-rail" aria-label="Recent activity">
        <Section title="Activity & audit trail" action={<button type="button" className="ui-link text-sm" onClick={() => goTo('activity')}>View full history</button>}>
          {activity.loading ? <span className="ui-skel ui-skel-text" /> : activity.error ? <ErrorState error={activity.error} onRetry={activity.reload} compact /> : (
            <ActivityTimeline events={(activity.data?.events || []).slice(0, 5)} />
          )}
        </Section>
        {allowed('PEOPLE::Employee Notes::CREATE') ? <CommentBox employeeId={person.id} onPosted={activity.reload} /> : null}
      </aside>
    </div>
  );
}

function CommentBox({ employeeId, onPosted }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await addComment(employeeId, text.trim());
      setText('');
      onPosted?.();
    } catch (e) {
      notify.error(String(e?.message || 'Comment not saved. It is still in the box.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-record-section" aria-label="Add a comment">
      <label className="block"><span className="ui-label">Add a comment</span>
        <textarea className="ui-input w-full" rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" />
      </label>
      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="ui-caption">Seen by people who can read comments on this record.</p>
        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!text.trim() || busy} onClick={post}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Section edit */

/**
 * One section's edit form. Labels above fields; Enter in a single-line field
 * never submits (spec §5.1); Save sends the loaded version; 409 keeps the
 * edits and shows the newer record; a network failure keeps them too.
 */
function SectionForm({ person, fields, onCancel, onSaved, reload }) {
  const initial = Object.fromEntries(fields.map((f) => [f.key, person[f.key] ?? '']));
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, form[f.key] === '' ? null : form[f.key]]));
      const r = await updateEmployee(person.id, { ...body, version: conflict?.version ?? person.version });
      setConflict(null);
      notify.success('Saved.');
      onSaved(r.employee);
    } catch (e) {
      if (e?.status === 409 && e?.data?.code === 'STALE') setConflict(e.data.employee);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }}>
      {conflict ? (
        <Alert tone="warn" title="This record was updated elsewhere" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { onCancel(); reload(); }}>Reload</button>}>
          {fields.filter((f) => String(conflict[f.key] ?? '') !== String(initial[f.key] ?? '')).map((f) => `${f.label} is now "${conflict[f.key] ?? 'blank'}"`).join('; ') || 'Other details changed.'} Your edits are still here: Save again to apply them on top, or Reload to start from the newer record.
        </Alert>
      ) : null}
      {error ? <ErrorState error={error} compact onRetry={save} retryLabel="Try again" body={error?.network ? 'Your changes have not been saved. They are still in this form.' : undefined} /> : null}
      <div className="ui-form-grid">
        {fields.map((f) => (
          <label key={f.key} className={`block ${f.wide ? 'sm:col-span-2' : ''}`}>
            <span className="ui-label">{f.label}{f.required ? ' *' : ''}</span>
            {f.kind === 'select' ? (
              <select className="ui-select w-full" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                <option value="">Not set</option>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : f.kind === 'date' ? (
              <DatePicker value={form[f.key] ? String(form[f.key]).slice(0, 10) : ''} onChange={(v) => setForm({ ...form, [f.key]: v })} label={f.label} />
            ) : f.kind === 'textarea' ? (
              <textarea className="ui-input w-full" rows={3} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input className="ui-input w-full" type={f.type || 'text'} inputMode={f.inputMode} value={form[f.key] ?? ''} required={f.required} maxLength={f.max || 160} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
            {f.help ? <span className="ui-caption">{f.help}</span> : null}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={async () => { if (!dirty || await confirmDialog({ title: 'Discard your changes?', confirmLabel: 'Discard' })) onCancel(); }}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

const GENDERS = Object.entries(GENDER_WORDS);
const MARITAL = [['SINGLE', 'Single'], ['MARRIED', 'Married'], ['DIVORCED', 'Divorced'], ['WIDOWED', 'Widowed']];
const PERSONAL_SECTIONS = {
  name: { title: 'Name', fields: [{ key: 'firstName', label: 'Legal first name', required: true }, { key: 'lastName', label: 'Legal last name' }, { key: 'preferredName', label: 'Preferred name', help: 'Used in everyday communication.' }] },
  contact: { title: 'Contact', fields: [{ key: 'workEmail', label: 'Work email', type: 'email', inputMode: 'email' }, { key: 'workPhone', label: 'Work phone', type: 'tel', inputMode: 'tel' }, { key: 'personalEmail', label: 'Personal email', type: 'email', inputMode: 'email' }, { key: 'phone', label: 'Personal phone', type: 'tel', inputMode: 'tel' }] },
  personal: { title: 'Personal details', fields: [{ key: 'dateOfBirth', label: 'Date of birth', kind: 'date' }, { key: 'gender', label: 'Gender', kind: 'select', options: GENDERS }, { key: 'maritalStatus', label: 'Marital status', kind: 'select', options: MARITAL }] },
  address: { title: 'Address', fields: [{ key: 'addressLine', label: 'Address', wide: true }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'PIN code', inputMode: 'numeric', max: 10 }, { key: 'country', label: 'Country' }] },
  emergency: { title: 'Emergency contact', fields: [{ key: 'emergencyContactName', label: 'Name' }, { key: 'emergencyContactRelation', label: 'Relationship' }, { key: 'emergencyContactPhone', label: 'Phone', type: 'tel', inputMode: 'tel' }] },
};

function Personal({ person, allowed, editing, setEditing, onSaved, reload }) {
  const canEdit = allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT';
  const value = (s, f) => {
    if (f.key === 'gender') return GENDER_WORDS[person.gender] || person.gender;
    if (f.key === 'maritalStatus') return MARITAL.find(([k]) => k === person.maritalStatus)?.[1] || person.maritalStatus;
    if (f.kind === 'date') return person[f.key] ? formatDate(String(person[f.key]).slice(0, 10)) : null;
    return person[f.key];
  };
  return (
    <div className="space-y-4">
      {Object.entries(PERSONAL_SECTIONS).map(([k, s]) => (
        <Section key={k} title={s.title} onEdit={canEdit && editing !== k ? () => setEditing(k) : null}>
          {editing === k ? (
            <SectionForm person={person} fields={s.fields} onCancel={() => setEditing(null)} onSaved={(emp) => { onSaved(emp); setEditing(null); }} reload={reload} />
          ) : (
            <dl className="ui-field-grid">{s.fields.map((f) => <Field key={f.key} label={f.label} value={value(s, f)} />)}</dl>
          )}
        </Section>
      ))}
      {/* Statutory details: a section only for those with the grant (D-V2); masked, reveal needs an authenticator. */}
      {allowed('PEOPLE::Statutory Details::VIEW') ? <Section title="Identity and statutory"><StatutoryDetails employeeId={person.id} /></Section> : null}
      <Section title="More details"><CustomFields employeeId={person.id} /></Section>
      {allowed('PEOPLE::Lifecycle::VIEW') ? <JoiningDetails person={person} onChecked={(p) => onSaved(p)} /> : null}
      {!person.userId ? <p className="ui-caption">Portal access not linked: this employee has no sign-in of their own, which is fine.</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Employment */

function Employment({ person, data, lists, allowed, editing, setEditing, onSaved, reload, openAction }) {
  const canEdit = allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT';
  const [extendTo, setExtendTo] = useState('');
  const [rejoin, setRejoin] = useState('');
  const typeName = lists?.types.find((t) => t.id === person.employeeTypeId)?.name;
  const workTypeName = lists?.workTypes.find((t) => t.id === person.workTypeId)?.name;
  const probation = async (outcome) => {
    if (!(await confirmDialog({ title: outcome === 'CONFIRM' ? `Confirm ${person.name} after probation?` : `Extend probation to ${formatDate(extendTo)}?`, confirmLabel: outcome === 'CONFIRM' ? 'Confirm' : 'Extend', tone: 'primary' }))) return;
    try {
      const r = await decideProbation(person.id, outcome === 'CONFIRM' ? { outcome } : { outcome, newEndDate: extendTo });
      notify.success(r.request ? `Sent for approval: ${r.request.title}.` : outcome === 'CONFIRM' ? 'Confirmed.' : 'Probation extended.');
      setExtendTo('');
      reload();
    } catch (e) { notify.error(String(e?.message || 'Not saved.')); }
  };
  const withdraw = async (c) => {
    if (!(await confirmDialog({ title: `Withdraw the change due ${formatDate(c.effectiveOn)}?`, confirmLabel: 'Withdraw' }))) return;
    try { await withdrawScheduled(person.id, c.id); notify.success('Withdrawn.'); reload(); } catch (e) { notify.error(String(e?.message || 'Not withdrawn.')); }
  };
  const rehire = async () => {
    if (!(await confirmDialog({ title: `Rehire ${person.name} from ${formatDate(rejoin)}?`, message: 'A new stint starts on that date; the earlier one is kept in History.', confirmLabel: 'Rehire', tone: 'primary' }))) return;
    try { await rehireEmployee(person.id, { rejoinDate: rejoin }); notify.success(`${person.name} rehired.`); setRejoin(''); reload(); } catch (e) { notify.error(String(e?.message || 'Not rehired.')); }
  };
  const fields = [
    { key: 'code', label: 'Employee ID', required: true, max: 40, help: 'Unique in this company.' },
    { key: 'dateOfJoining', label: 'Joining date', kind: 'date' },
    { key: 'probationEndDate', label: 'Probation ends', kind: 'date' },
    { key: 'contractEndDate', label: 'Contract ends', kind: 'date' },
  ];
  return (
    <div className="space-y-4">
      <Section title="Employment" onEdit={canEdit && editing !== 'employment' ? () => setEditing('employment') : null}
        action={canEdit ? <><button type="button" className="ui-link text-sm" onClick={() => openAction('designation')}>Change designation</button><button type="button" className="ui-link text-sm" onClick={() => openAction('type')}>Change type</button></> : null}>
        {editing === 'employment' ? <SectionForm person={person} fields={fields} onCancel={() => setEditing(null)} onSaved={(emp) => { onSaved(emp); setEditing(null); }} reload={reload} /> : (
          <dl className="ui-field-grid">
            <Field label="Employee ID" value={person.code} mono />
            <Field label="Status" value={<StatusBadge employee={person} />} />
            <Field label="Designation" value={person.designation} />
            <Field label="Employment type" value={typeName} />
            <Field label="Work type" value={workTypeName} />
            <Field label={person.currentEpisodeSeq > 1 ? `Joined (stint ${person.currentEpisodeSeq})` : 'Joining date'} value={person.dateOfJoining ? formatDate(String(person.dateOfJoining).slice(0, 10)) : null} mono />
            {person.currentEpisodeSeq > 1 ? <Field label="First joined" value={person.firstJoiningDate ? formatDate(person.firstJoiningDate) : null} mono /> : null}
            <Field label={person.confirmedOn ? 'Confirmed on' : 'Probation ends'} value={person.confirmedOn ? formatDate(person.confirmedOn) : person.probationEndDate ? formatDate(person.probationEndDate) : null} mono />
            <Field label="Contract ends" value={person.contractEndDate ? formatDate(person.contractEndDate) : null} mono />
            {person.dateOfLeaving ? <Field label="Left" value={`${formatDate(person.dateOfLeaving)}${person.leavingType ? ` · ${LEAVING_TYPES[person.leavingType] || person.leavingType}` : ''}${person.leavingReason ? ` · ${person.leavingReason}` : ''}`} /> : null}
          </dl>
        )}
      </Section>
      {person.probationEndDate && !person.confirmedOn && person.status !== 'LEFT' && allowed('PEOPLE::Lifecycle::APPROVE') ? (
        <Section title="Probation">
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => probation('CONFIRM')}>Confirm after probation</button>
            <div><label className="ui-caption" htmlFor="prob-extend">Or extend to</label><DatePicker id="prob-extend" value={extendTo} min={person.probationEndDate} onChange={setExtendTo} /></div>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!extendTo} onClick={() => probation('EXTEND')}>Extend</button>
          </div>
        </Section>
      ) : null}
      {(data.scheduledChanges || []).length ? (
        <Section title="Changes coming">
          <ul className="divide-y text-sm">
            {data.scheduledChanges.map((c) => (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{formatDate(c.effectiveOn)}</span>
                <span>{SCHEDULED_LABELS[c.field] || c.field}: <span className="ui-muted">{c.fromLabel || 'None'}</span> → <strong>{c.toLabel || 'None'}</strong></span>
                {c.reason ? <span className="ui-caption">{c.reason}</span> : null}
                {canEdit ? <button type="button" className="ui-link ml-auto" onClick={() => withdraw(c)}>Withdraw</button> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {person.status === 'LEFT' && allowed('PEOPLE::Employees::EDIT') ? (
        <Section title="Rehire">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="ui-caption" htmlFor="rejoin">Rejoins on</label><DatePicker id="rejoin" value={rejoin} min={person.dateOfLeaving || ''} onChange={setRejoin} /></div>
            <button type="button" className="ui-btn ui-btn-primary" disabled={!rejoin} onClick={rehire}>Rehire</button>
          </div>
        </Section>
      ) : null}
      <Section title="Joining and leaving tasks"><EmployeeChecklist person={person} /></Section>
    </div>
  );
}

/* --------------------------------------------------------------- Organization */

function Organization({ person, lists, allowed, openAction, openPerson }) {
  const canEdit = allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT';
  const name = (k, v) => lists?.[k]?.find((x) => x.id === v)?.name;
  return (
    <div className="space-y-4">
      <Section title="Assignment" action={canEdit ? <button type="button" className="ui-link text-sm" onClick={() => openAction('transfer')}>Transfer</button> : null}>
        <dl className="ui-field-grid">
          <Field label="Department" value={person.department} />
          <Field label="Designation" value={person.designation} />
          <Field label="Location" value={person.areaName || person.workLocation} />
          <Field label="Establishment" value={person.establishment ? `${person.establishment}${person.workState ? ` (${person.workState})` : ''}` : null} />
          <Field label="Team" value={person.teamName} />
          <Field label="Seat" value={person.seatName} />
          <Field label="Business unit" value={person.businessUnitName} />
          <Field label="Grade" value={person.gradeName || name('grades', person.gradeId)} />
          <Field label="Cost centre" value={person.costCenterName} />
        </dl>
      </Section>
      <Section title="Reporting" action={canEdit ? <button type="button" className="ui-link text-sm" onClick={() => openAction('manager')}>Change manager</button> : null}>
        <dl className="ui-field-grid">
          <Field label="Manager" value={person.reportingManagerId ? <button type="button" className="ui-link" onClick={() => openPerson(person.reportingManagerId)}>{person.reportingManagerName}</button> : null} />
          <Field label="Also reports to (dotted line)" value={person.dottedManagerId ? <button type="button" className="ui-link" onClick={() => openPerson(person.dottedManagerId)}>{person.dottedManagerName}</button> : null} />
        </dl>
        <h3 className="ui-caption mt-4">Direct reports</h3>
        {(person.directReports || []).length ? (
          <ul className="mt-1 divide-y">
            {person.directReports.map((r) => (
              <li key={r.id}><button type="button" className="flex w-full items-center gap-2 py-2 text-left text-sm" onClick={() => openPerson(r.id)}><Avatar person={r} size={28} /><span className="font-medium">{r.name}</span><span className="ui-caption">{r.designation || ''}</span></button></li>
            ))}
          </ul>
        ) : <p className="ui-muted text-sm mt-1">None</p>}
      </Section>
      {hasApp('attendance') ? (
        <Section title="Attendance readers">
          <dl className="ui-field-grid">
            <Field label="Reader ID" value={person.devicePin || (person.code ? `${person.code} (employee ID)` : null)} />
            <Field label="Card" value={person.cardNumber ? 'Set' : null} />
            <Field label="Reader PIN" value={person.hasDevicePassword ? 'Set' : null} />
            <Field label="Attendance expected" value={person.attendanceRequired === false ? 'No, door only' : 'Yes'} />
          </dl>
        </Section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Operations (WF-06) */

const OPERATIONS = {
  manager: { title: 'Change manager', fields: [['reportingManagerId', 'New manager', 'people'], ['dottedManagerId', 'Also reports to (optional)', 'people']] },
  transfer: { title: 'Transfer', fields: [['departmentId', 'Department', 'departments'], ['areaId', 'Location', 'areas'], ['establishmentId', 'Establishment', 'establishments'], ['teamId', 'Team', 'teams']] },
  designation: { title: 'Change designation', fields: [['jobPositionId', 'New designation', 'positions'], ['gradeId', 'Grade', 'grades']] },
  type: { title: 'Change employment type', fields: [['employeeTypeId', 'Employment type', 'types'], ['workTypeId', 'Work type', 'workTypes']] },
  /* Allowed moves only: active or on notice can be suspended, suspended can be reactivated; leaving and rehire have their own flows (WF-14). */
  status: { title: 'Change status', fields: [['status', 'New status', 'statuses']], reasonRequired: true },
};
const STATUS_WORD = { ACTIVE: 'Active', ON_NOTICE: 'On notice', SUSPENDED: 'Suspended', LEFT: 'Left' };

/**
 * One employment change (WF-06 standard pattern): the current state, the
 * change, the date it counts from, the reason, and what else it affects.
 * A future date schedules it; where an approval rule is in force it becomes a
 * request and nothing changes until it is approved. The server refuses a
 * reporting loop or a manager outside the company.
 */
function OperationDrawer({ action, person, lists, onClose, onDone }) {
  const op = OPERATIONS[action];
  const [people, setPeople] = useState([]);
  const initial = useMemo(() => Object.fromEntries((op?.fields || []).map(([k]) => [k, person[k] || ''])), [op, person]);
  const [form, setForm] = useState(initial);
  const [effective, setEffective] = useState(todayIst());
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (op?.fields.some(([, , src]) => src === 'people')) listEmployees({ limit: 500, sort: 'name' }).then((r) => setPeople((r?.employees || []).filter((e) => e.id !== person.id && e.status !== 'LEFT'))).catch(() => setPeople([]));
  }, [op, person.id]);
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => (v || '') !== (initial[k] || '')));
  useEffect(() => {
    const ask = {};
    for (const k of ['establishmentId', 'departmentId', 'reportingManagerId']) if (k in changed) ask[k] = changed[k] || '';
    if (!Object.keys(ask).length) { setImpact([]); return; }
    let live = true;
    changeImpact(person.id, ask).then((r) => live && setImpact(r?.impact || [])).catch(() => live && setImpact([]));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(changed), person.id]);
  if (!op) return null;
  const options = (src) => (src === 'people' ? people.map((e) => ({ value: e.id, label: e.code ? `${e.name} (${e.code})` : e.name }))
    : src === 'statuses' ? (person.status === 'SUSPENDED' ? [{ value: 'ACTIVE', label: 'Active' }] : [{ value: 'SUSPENDED', label: 'Suspended' }])
    : (lists[src] || []).map((x) => ({ value: x.id, label: x.name })));
  const current = (k, src) => (src === 'people' ? (k === 'reportingManagerId' ? person.reportingManagerName : person.dottedManagerName) : src === 'statuses' ? STATUS_WORD[person.status] : lists[src]?.find((x) => x.id === person[k])?.name) || 'None';
  const submit = async () => {
    if (busy || !Object.keys(changed).length) return;
    setBusy(true);
    setError(null);
    try {
      const body = { ...Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v || null])), changeNote: reason || null, version: person.version, ...(effective && effective !== todayIst() ? { effectiveFrom: effective } : {}) };
      const r = await updateEmployee(person.id, body);
      notify.success(r.request ? `Sent for approval: ${r.request.title}. Nothing changes until it is approved.` : r.scheduled?.length ? `Scheduled for ${formatDate(effective)}.` : 'Changed.');
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title={`${op.title}: ${person.name}`} description="The change, the day it counts from, and why. History keeps both the before and the after." dirty={Object.keys(changed).length > 0 || Boolean(reason)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !Object.keys(changed).length || (op.reasonRequired && !reason.trim())} onClick={submit}>{busy ? 'Saving…' : 'Confirm change'}</button></>}>
      <div className="grid gap-4">
        {error ? (error?.status === 409 && error?.data?.code === 'STALE'
          ? <Alert tone="warn" title="This record was updated elsewhere">Close this, reload the record, and make the change again. Nothing was overwritten.</Alert>
          : <ErrorState error={error} compact onRetry={submit} retryLabel="Try again" body={error?.status === 400 ? error.message : undefined} />) : null}
        {op.fields.map(([k, label, src]) => (
          <div key={k}>
            <PopupSelect label={label} value={form[k]} onChange={(v) => setForm({ ...form, [k]: v || '' })} placeholder="Choose…" alwaysSearch={src !== 'statuses'} options={src === 'statuses' ? options(src) : [{ value: '', label: 'None' }, ...options(src)]} />
            <span className="ui-caption">Now: {current(k, src)}</span>
          </div>
        ))}
        <div><label className="ui-label" htmlFor="op-effective">Effective from</label><DatePicker id="op-effective" value={effective} onChange={setEffective} /><span className="ui-caption">A later date schedules it; it applies on that day.</span></div>
        <label className="block"><span className="ui-label">Reason{op.reasonRequired ? ' *' : ''}</span><textarea className="ui-input w-full" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {impact.length ? (
          <div aria-label="What else this affects">
            <p className="ui-label">What else this affects</p>
            <ul className="space-y-1">{impact.map((i) => <li key={i.key} className="text-sm"><span className="font-medium">{i.title}</span><span className="ui-caption block">{i.detail}</span></li>)}</ul>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

/* --------------------------------------------------------------- Activity tab */

function Activity({ person, canComment }) {
  const [events, setEvents] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const load = () => employeeActivity(person.id).then((r) => { setEvents(r.events); setNext(r.nextBefore); setError(null); }).catch(setError);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [person.id, person.version]);
  const older = async () => {
    setMore(true);
    try { const r = await employeeActivity(person.id, next); setEvents((e) => [...e, ...r.events]); setNext(r.nextBefore); } catch (e) { notify.error(String(e?.message || 'Could not load older activity.')); } finally { setMore(false); }
  };
  if (error && !events) return <ErrorState error={error} onRetry={load} />;
  if (!events) return <SkeletonCard lines={5} />;
  return (
    <div className="ui-record-activity space-y-4">
      {canComment ? <CommentBox employeeId={person.id} onPosted={load} /> : null}
      <ActivityTimeline events={events} onLoadMore={next ? older : null} loadingMore={more} />
    </div>
  );
}
