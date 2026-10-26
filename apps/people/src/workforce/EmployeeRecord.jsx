import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Briefcase, Building2, CalendarClock, Camera, ChevronDown, Clock, Hash, Hourglass, MapPin, Pencil, Plus, UserRound } from 'lucide-react';

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
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { usePermissions } from '@ui/permissions/usePermissions';
import { hasApp } from '@platform/context';
import {
  Avatar, CustomFields, EmployeeChecklist, shrinkPhoto, EmployeeDocuments, EmploymentHistory, GENDER_WORDS, InviteForm, JoiningDetails, Journey, ResignForm, SCHEDULED_LABELS, StatutoryDetails,
} from '@ui/personnel/Employees';
import { LEAVING_TYPES } from '@ui/personnel/api';
import { HOURS_WORDS, datesFor, kindOf, probationState } from '@ui/personnel/employmentKinds';

import {
  addComment, changeImpact, employeeReadiness, linkCandidates, linkUser, decideProbation, deleteEmployee, employeeActivity, employeeAsOf, getEmployee, listContractors, listEmployees, listTags, openTasksFor, rehireEmployee, stayOn, structure, updateEmployee, withdrawScheduled,
} from './api';
import { listBranches } from '../organization/api';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { refreshSuggestions, useEmailSuggestions, useSuggestions } from './suggestions';
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

function Section({ title, count = null, onEdit, children, action = null }) {
  /* Edit hides while its form is open; when the form closes (saved or cancelled) and the caret was left nowhere, it goes back to Edit. */
  const editRef = useRef(null);
  const hadEdit = useRef(Boolean(onEdit));
  useEffect(() => {
    const has = Boolean(onEdit);
    if (has && !hadEdit.current && (!document.activeElement || document.activeElement === document.body)) editRef.current?.focus();
    hadEdit.current = has;
  }, [onEdit]);
  return (
    <section className="ui-record-section" aria-label={title}>
      <header className="flex items-center justify-between gap-2 mb-3">
        <h2 className="ui-t-sec">{title}{count != null ? <span className="ui-section-count tabular-nums">{count}</span> : null}</h2>
        <span className="flex items-center gap-3">
          {action}
          {onEdit ? <button ref={editRef} type="button" className="ui-link text-sm inline-flex items-center gap-1" onClick={onEdit}><Pencil size={14} aria-hidden="true" /> Edit</button> : null}
        </span>
      </header>
      {children}
    </section>
  );
}

export default function EmployeeRecord({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  /* A team lead's own record is changed through the employee app (the server says so as ownRecordLocked), so its edit actions are not offered. */
  const allowed = (k) => can(perms, k) && !(k === 'PEOPLE::Employees::EDIT' && rec.data?.employee?.ownRecordLocked);
  const id = params.id;
  const tabsAllowed = TABS.filter(([k]) => k !== 'documents' || allowed('PEOPLE::Documents::VIEW')).map(([key, label]) => ({ key, label }));
  const tab = tabsAllowed.some((t) => t.key === params.tab) ? params.tab : 'overview';
  const rec = useRequest(() => (id ? getEmployee(id) : Promise.reject(Object.assign(new Error('No employee chosen.'), { status: 404 }))), [id]);
  const person = rec.data?.employee || null;
  const setPerson = (patch) => rec.setData((d) => ({ ...d, employee: { ...d.employee, ...patch } }));
  const [lists, setLists] = useState(null);
  useEffect(() => {
    Promise.all([...['departments', 'job-positions', 'employee-types', 'work-types', 'areas', 'establishments', 'teams', 'business-units', 'grades', 'cost-centres', 'seats', 'job-roles'].map((k) => structure(k).catch(() => [])), hasApp('attendance') ? listContractors() : Promise.resolve([]), listTags().catch(() => []), listBranches().catch(() => [])])
      .then(([departments, positions, types, workTypes, areas, establishments, teams, units, grades, centres, seats, roles, contractors, tags, branchRows]) => setLists({ departments, positions, types, workTypes, areas, establishments, teams, units, grades, centres, seats, roles, contractors, tags , branches: branchRows.filter((b) => b.isActive !== false).map((b) => ({ id: b.id, name: b.branchName, isActive: true })) }));
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

  if (rec.loading) return <RecordSkeleton />;
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
  /* A resignation taken back, a termination reversed before the day: active again, the leaving tasks closed as not needed. */
  const withdrawLeaving = async () => {
    if (!(await confirmDialog({ title: `Keep ${person.name}?`, message: `Their last day, ${formatDate(String(person.dateOfLeaving).slice(0, 10))}, is cancelled and they stay active.`, confirmLabel: 'Withdraw leaving', tone: 'primary' }))) return;
    try {
      const r = await stayOn(person.id);
      notify.success(`${person.name} stays on.`);
      setPerson({ ...person, ...r.employee });
      rec.reload();
    } catch (e) { notify.error(String(e?.message || 'Not changed.')); }
  };
  const moreItems = [
    editable ? ['manager', 'Change manager'] : null,
    editable ? ['transfer', 'Transfer'] : null,
    editable ? ['designation', 'Change designation'] : null,
    editable ? ['type', 'Change employment type'] : null,
    /* Someone on notice is not suspended: their leaving runs on its day (W2). */
    editable && person.status === 'ACTIVE' ? ['status', 'Suspend'] : null,
    allowed('PEOPLE::Employees::EDIT') && person.status === 'SUSPENDED' ? ['status', 'Reactivate'] : null,
    person.status !== 'LEFT' && allowed('PEOPLE::Lifecycle::CREATE') ? ['invite', 'Invite to complete profile'] : null,
    person.status !== 'LEFT' && person.status !== 'ON_NOTICE' && allowed('PEOPLE::Employees::EDIT') ? ['leave', person.dateOfJoining && String(person.dateOfJoining).slice(0, 10) > todayIst() ? 'Did not join' : 'Mark as left'] : null,
    person.status === 'ON_NOTICE' && allowed('PEOPLE::Employees::EDIT') ? ['leave', 'Change leaving details'] : null,
    person.status === 'ON_NOTICE' && allowed('PEOPLE::Employees::EDIT') ? ['stay', 'Withdraw leaving'] : null,
    person.status === 'LEFT' && allowed('PEOPLE::Employees::EDIT') ? ['rehire', 'Rehire'] : null,
    allowed('PEOPLE::Employees::DELETE') ? ['delete', 'Delete'] : null,
  ].filter(Boolean);
  const headerDates = datesFor(kindOf(lists?.types, person.employeeTypeId));
  const probation = probationState(person, todayIst());

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Employees', onClick: backToDirectory }, { label: person.name }]}
        title={
          <span className="ui-profile">
            <PhotoControl person={person} canEdit={editable} onSaved={(emp) => setPerson(emp)} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{person.name}</span>
                {person.preferredName ? <span className="ui-profile-aka">“{person.preferredName}”</span> : null}
                <StatusBadge employee={person} />
              </span>
              <ul className="ui-profile-facts" aria-label="Summary">
                {person.code ? <li><Hash size={14} aria-hidden="true" /><span className="tabular-nums">{person.code}</span></li> : null}
                {person.designation ? <li><Briefcase size={14} aria-hidden="true" />{person.designation}</li> : null}
                {person.department ? <li><Building2 size={14} aria-hidden="true" />{person.department}</li> : null}
                {person.branchName || person.areaName || person.workLocation ? <li><MapPin size={14} aria-hidden="true" />{person.branchName || person.areaName || person.workLocation}</li> : null}
                {person.reportingManagerName ? <li><UserRound size={14} aria-hidden="true" /><span>Reports to {person.managerOpens === false ? person.reportingManagerName : <button type="button" className="ui-link" onClick={() => openScreen?.('employee', { id: person.reportingManagerId })}>{person.reportingManagerName}</button>}</span></li> : null}
                {person.hours === 'PART_TIME' ? <li><Clock size={14} aria-hidden="true" />Part-time</li> : null}
                {probation === 'ON' ? <li><Hourglass size={14} aria-hidden="true" /><span>On probation until <span className="tabular-nums">{formatDate(String(person.probationEndDate).slice(0, 10))}</span></span></li> : null}
                {probation === 'OVER' ? <li className="is-warn"><Hourglass size={14} aria-hidden="true" /><span>Probation ended <span className="tabular-nums">{formatDate(String(person.probationEndDate).slice(0, 10))}</span>, not confirmed</span></li> : null}
                {person.contractEndDate && person.status !== 'LEFT' ? (
                  String(person.contractEndDate).slice(0, 10) < todayIst()
                    ? <li className="is-warn"><CalendarClock size={14} aria-hidden="true" /><span>{headerDates.contractLabel === 'Internship ends' ? 'Internship ended' : 'Contract ended'} <span className="tabular-nums">{formatDate(String(person.contractEndDate).slice(0, 10))}</span></span></li>
                    : <li><CalendarClock size={14} aria-hidden="true" /><span>{headerDates.contractLabel} <span className="tabular-nums">{formatDate(String(person.contractEndDate).slice(0, 10))}</span></span></li>
                ) : null}
                {!person.code && !person.designation && !person.department ? <li>No role or department yet</li> : null}
              </ul>
              <TagLine person={person} tags={lists?.tags || []} canEdit={allowed('PEOPLE::Employees::EDIT')} onSaved={(emp) => setPerson(emp)} />
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
                    if (k === 'stay') { setMoreOpen(false); return withdrawLeaving(); }
                    /* Rehire lives on the Employment tab; the caret goes to its first field so the step is visible. */
                    if (k === 'rehire') { setMoreOpen(false); set({ tab: 'employment', action: null }, true); return setTimeout(() => document.getElementById('rejoin')?.focus(), 150); }
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
        {tab === 'overview' ? <Overview person={person} data={rec.data} lists={lists} allowed={allowed} goTo={(t) => set({ tab: t }, true)} go={(patch) => set(patch, true)} /> : null}
        {tab === 'personal' ? <Personal person={person} allowed={allowed} editing={params.edit} setEditing={(e) => set({ edit: e })} onSaved={(emp) => rec.setData((d) => ({ ...d, employee: { ...d.employee, ...emp } }))} reload={rec.reload} /> : null}
        {tab === 'employment' ? <Employment person={person} data={rec.data} lists={lists} allowed={allowed} editing={params.edit} setEditing={(e) => set({ edit: e })} onSaved={(emp) => setPerson(emp)} reload={rec.reload} onLeave={() => setResigning(true)} /> : null}
        {tab === 'organization' ? <Organization person={person} lists={lists} allowed={allowed} openAction={openAction} openPerson={(pid) => openScreen?.('employee', { id: pid })} editing={params.edit} setEditing={(e) => set({ edit: e })} onSaved={(emp) => setPerson(emp)} reload={rec.reload} /> : null}
        {tab === 'documents' ? <EmployeeDocuments employeeId={person.id} /> : null}
        {tab === 'history' ? <div className="space-y-6"><HistoryCompare person={person} lists={lists} /><Section title="Employment history"><EmploymentHistory employeeId={person.id} /></Section><Section title="Every change and why"><Journey employeeId={person.id} /></Section></div> : null}
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
  /* The Popover gives the caret to [data-autofocus] once it is placed; an earlier focus() lands on a hidden panel. */
  return (
    <div ref={ref} role="menu" className="ui-menu" onKeyDown={(e) => {
      const all = [...ref.current.querySelectorAll('[role="menuitem"]')];
      const i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
    }}>
      {items.map(([k, label], i) => <button key={k} type="button" role="menuitem" data-autofocus={i === 0 ? '' : undefined} className={`ui-menu-item ${k === 'delete' ? 'is-danger' : ''}`} onClick={() => onPick(k)}>{label}</button>)}
    </div>
  );
}

/* The loading shape is the page's own shape: header, tabs, then one sheet. */
function RecordSkeleton() {
  const rows = (n) => (
    <div className="ui-field-grid mt-4">
      {Array.from({ length: n }).map((_, i) => <span key={i} className="ui-skel ui-skel-text" style={{ width: i % 2 ? '70%' : '85%' }} />)}
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Loading the employee record">
      <div className="ui-profile py-3">
        <span className="ui-skel" style={{ width: 64, height: 64, borderRadius: 999 }} />
        <span className="flex-1 space-y-2.5"><span className="ui-skel ui-skel-title block" style={{ width: 260 }} /><span className="ui-skel ui-skel-text block" style={{ width: 420 }} /></span>
      </div>
      <div className="ui-record-tablist mt-4 h-10" />
      <div className="ui-record-tabpanel" aria-hidden="true">
        <span className="ui-skel ui-skel-title block" style={{ width: 180 }} />{rows(4)}
        <div className="border-t mt-6 pt-6"><span className="ui-skel ui-skel-title block" style={{ width: 140 }} />{rows(6)}</div>
      </div>
    </div>
  );
}

/* The CLOR login this person uses, if any: picked from the company's own logins not linked to anyone else. */
function SignInSection({ person, canEdit, editing, setEditing, onSaved }) {
  const candidates = useRequest(() => (editing ? linkCandidates() : Promise.resolve([])), [editing]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (userId) => {
    setBusy(true);
    try {
      const r = await linkUser(person.id, userId);
      onSaved(r.employee);
      setEditing(null);
      notify.success(userId ? 'Sign-in linked.' : 'Sign-in link removed.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const linked = person.linkedUser;
  return (
    <Section title="CLOR sign-in" onEdit={canEdit && !editing ? () => { setChoice(''); setEditing('signin'); } : null}>
      {editing ? (
        <div className="space-y-3 ui-panel-in">
          {candidates.loading ? <span className="ui-skel ui-skel-text" /> : (
            <div className="max-w-md"><PopupSelect showValueSubtext={false} label="Login" value={choice} placeholder={candidates.data?.length ? 'Choose a login' : 'No unlinked logins in this company'} alwaysSearch onChange={(v) => setChoice(v || '')}
              options={(candidates.data || []).map((u) => ({ value: u.id, label: u.name === u.email ? u.email : `${u.name} · ${u.email}` }))} /></div>
          )}
          <div className="flex flex-wrap gap-2 justify-end">
            {linked ? <button type="button" className="ui-btn ui-btn-secondary mr-auto" disabled={busy} onClick={() => save(null)}>Remove link</button> : null}
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy || !choice} onClick={() => save(choice)}>{busy ? 'Saving…' : 'Link'}</button>
          </div>
        </div>
      ) : (
        <dl className="ui-field-grid"><Field label="Login" value={linked ? `${linked.name}${linked.email && linked.email !== linked.name ? ` · ${linked.email}` : ''}` : 'Not linked'} /></dl>
      )}
    </Section>
  );
}

/*
 * Before payday (the Data Health checks, for this one person): what will stop
 * this person being paid or their attendance being counted, where the owner
 * already is. Each fix opens the tab that fixes it here, or Payroll for
 * payroll details. Nothing is shown about an app the company does not use.
 */
const SEVERITY_WORD = { BLOCKS_PAYROLL: 'Blocks payday', FIX_SOON: 'Fix soon', TIDY_UP: 'Tidy up' };
const FIX_HERE = {
  'no-joining-date': { tab: 'employment', edit: 'employment' }, 'no-code': { tab: 'employment', edit: 'employment' },
  'no-department': { tab: 'organization', action: 'transfer' }, 'no-manager': { tab: 'organization', action: 'manager' },
  'no-reader-id': { tab: 'organization', edit: 'readers' }, 'document-expired': { tab: 'documents' }, 'permit-expired': { tab: 'documents' },
  'duplicate-person': { tab: 'personal' }, 'shared-phone': { tab: 'personal', edit: 'contact' }, 'shared-email': { tab: 'personal', edit: 'contact' },
  'overdue-tasks': { tab: 'employment' }, 'contract-ended': { tab: 'employment' }, 'probation-due': { tab: 'employment' },
};
function ReadinessSection({ person, go }) {
  const r = useRequest(() => employeeReadiness(person.id), [person.id, person.version]);
  if (r.loading || r.error || !r.data) return null;
  const { apps, checks } = r.data;
  const order = ['BLOCKS_PAYROLL', 'FIX_SOON', 'TIDY_UP'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  if (!sorted.length) {
    if (!apps.payroll && !apps.attendance) return null;
    return <p className="ui-ready-line"><span className="ui-attention-dot is-pos" aria-hidden="true" />Nothing stops payday or attendance for {person.preferredName || person.firstName || person.name}.</p>;
  }
  const blocking = sorted.filter((c) => c.severity === 'BLOCKS_PAYROLL').length;
  return (
    <Section title="Before payday" count={sorted.length}>
      {blocking ? <p className="text-sm mb-2">{blocking === 1 ? 'One thing stops' : `${blocking} things stop`} {person.preferredName || person.firstName || person.name} being paid.</p> : null}
      <ul className="ui-ready-list">
        {sorted.map((c) => {
          const here = FIX_HERE[c.id];
          return (
            <li key={c.id}>
              <span className={`ui-attention-dot is-${c.severity === 'BLOCKS_PAYROLL' ? 'neg' : c.severity === 'FIX_SOON' ? 'warn' : 'neutral'}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{c.title}{c.detail ? <span className="ui-muted font-normal"> · {c.detail}</span> : null}</span>
                <span className="block ui-caption">{c.why}</span>
              </span>
              <span className="sr-only">{SEVERITY_WORD[c.severity]}</span>
              {here ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => go(here)}>Fix</button>
                : c.area === 'Payroll' ? <a className="ui-btn ui-btn-secondary ui-btn-sm" href={`?app=payroll&open=${encodeURIComponent(c.screen)}`}>Fix in Payroll</a> : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* --------------------------------------------------------------- Photo and tags */

/** The portrait: a square photo kept small (160px), or initials. Changing it is a normal, logged edit. */
function PhotoControl({ person, canEdit, onSaved }) {
  const input = useRef(null);
  const btn = useRef(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const save = async (photoUrl) => {
    setBusy(true);
    try {
      const r = await updateEmployee(person.id, { photoUrl, version: person.version });
      onSaved(r.employee);
      notify.success(photoUrl ? 'Photo updated.' : 'Photo removed.');
    } catch (e) {
      notify.error(String(e?.status === 409 ? 'Someone else changed this record. Reload and try again.' : e?.message || 'Photo not saved.'));
    } finally {
      setBusy(false);
    }
  };
  if (!canEdit) return <Avatar person={person} size={64} />;
  /* The portrait is the control: with no photo it asks for one; with one, it offers change or remove. */
  return (
    <>
      <button ref={btn} type="button" className="ui-avatar-edit" disabled={busy} aria-label={person.photoUrl ? 'Photo options' : 'Add a photo'} aria-haspopup={person.photoUrl ? 'menu' : undefined} aria-expanded={person.photoUrl ? menu : undefined}
        onClick={() => (person.photoUrl ? setMenu((o) => !o) : input.current?.click())}>
        <Avatar person={person} size={64} />
        <span className="ui-avatar-edit-badge" aria-hidden="true"><Camera size={14} /></span>
      </button>
      {menu ? (
        <Popover anchorRef={btn} onClose={() => setMenu(false)} minWidth={180}>
          <MenuList items={[['change', 'Change photo'], ['remove', 'Remove photo']]} onPick={(k) => { setMenu(false); if (k === 'change') input.current?.click(); else save(null); }} onEscape={() => { setMenu(false); btn.current?.focus(); }} />
        </Popover>
      ) : null}
      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choose a photo" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try { await save(await shrinkPhoto(f)); } catch (err) { notify.error(String(err?.message || 'Could not use that photo.')); }
      }} />
    </>
  );
}

/** Tags on the person, edited in place; the directory filters by them. */
function TagLine({ person, tags, canEdit, onSaved }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const mine = (person.tags || []).map((t) => t.id);
  const toggle = async (id) => {
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id];
    try {
      const r = await updateEmployee(person.id, { tagIds: next, version: person.version });
      onSaved(r.employee);
    } catch (e) {
      notify.error(String(e?.message || 'Tags not saved.'));
    }
  };
  if (!mine.length && (!canEdit || !tags.length)) return null;
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5 font-normal">
      {(person.tags || []).map((t) => <span key={t.id} className="ui-pill" style={{ backgroundColor: `${t.color}22`, color: `color-mix(in srgb, ${t.color} 55%, rgb(var(--fg)))` }}>{t.name}</span>)}
      {canEdit && tags.length ? (
        <>
          <button ref={btn} type="button" className="ui-tag-add" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{mine.length ? <><Pencil size={12} aria-hidden="true" /> Tags</> : <><Plus size={12} aria-hidden="true" /> Add tag</>}</button>
          {open ? (
            <Popover anchorRef={btn} onClose={() => setOpen(false)} minWidth={220}>
              <div role="dialog" aria-label="Tags" className="p-2 space-y-1">
                {tags.map((t) => <label key={t.id} className="flex items-center gap-2 text-sm px-1 py-1"><input type="checkbox" className="ui-checkbox" checked={mine.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}</label>)}
              </div>
            </Popover>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/* --------------------------------------------------------------- Overview */

function Overview({ person, data, lists, allowed, goTo, go }) {
  const activity = useRequest(() => employeeActivity(person.id), [person.id, person.version]);
  /* Open items: this person's joining and leaving tasks not yet done. */
  const checklist = useRequest(() => openTasksFor(person.id), [person.id]);
  const tasks = checklist.data ? Object.values(checklist.data).flatMap((g) => (g?.tasks || []).filter((t) => !t.done)) : null;
  void data;
  const typeName = lists?.types.find((t) => t.id === person.employeeTypeId)?.name;
  return (
    <div className="ui-record-overview">
      <div className="space-y-4 min-w-0">
        {person.status !== 'LEFT' ? <ReadinessSection person={person} go={go} /> : null}
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
            <Field label="Works at" value={person.branchName || person.areaName || person.workLocation} />
          </dl>
        </Section>
        <Section title="Relationships" action={<button type="button" className="ui-link text-sm" onClick={() => goTo('organization')}>Open</button>}>
          <dl className="ui-field-grid">
            <Field label="Manager" value={person.reportingManagerName} />
            <Field label="Secondary manager" value={person.dottedManagerName} />
            <Field label="Direct reports" value={(person.directReports || []).length ? `${person.directReports.length}: ${person.directReports.slice(0, 4).map((r) => r.name).join(', ')}${person.directReports.length > 4 ? '…' : ''}` : 'None'} />
          </dl>
        </Section>
        {tasks?.length ? (
          <Section title="Open items" count={tasks.length} action={tasks.length > 5 ? <button type="button" className="ui-link text-sm" onClick={() => goTo('employment')}>Show all</button> : null}>
            <ul className="ui-task-list">
              {[...tasks].sort((x, y) => String(x.dueDate || '9').localeCompare(String(y.dueDate || '9'))).slice(0, 5).map((t) => {
                const late = t.dueDate && t.dueDate < todayIst();
                return (
                  <li key={t.id}>
                    <span className="min-w-0">{t.title}</span>
                    <span className={`tabular-nums whitespace-nowrap ${late ? 'ui-text-neg' : 'ui-muted'}`}>{t.dueDate ? `${late ? 'Was due ' : ''}${formatDate(t.dueDate)}` : ''}</span>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}
      </div>
      {/* At wide widths the latest activity sits beside the record (spec §6, WF-04 context rail); narrower, it is the Activity tab. */}
      <aside className="ui-record-rail" aria-label="Recent activity">
        <Section title="Recent activity" action={<button type="button" className="ui-link text-sm" onClick={() => goTo('activity')}>View all</button>}>
          {activity.loading ? <span className="ui-skel ui-skel-text" /> : activity.error ? <ErrorState error={activity.error} onRetry={activity.reload} compact /> : (
            <ActivityTimeline filters={false} events={(activity.data?.events || []).slice(0, 5)} />
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
    <div className="ui-composer">
      <textarea className="ui-input w-full" aria-label="Add a comment" rows={2} maxLength={4000} value={text} placeholder="Add a comment…" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }} />
      <div className="ui-composer-bar">
        <button type="button" className="ui-btn ui-btn-sm ui-btn-secondary" disabled={!text.trim() || busy} onClick={post}>{busy ? 'Posting…' : 'Comment'}</button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Section edit */

/**
 * One section's edit form. Labels above fields; Enter in a single-line field
 * never submits (spec §5.1); Save sends the loaded version; 409 keeps the
 * edits and shows the newer record; a network failure keeps them too.
 */
/* A text field that offers what the company already has (`suggest`: a suggestions field name, or 'email' for the work email). */
function SuggestedText({ field: f, id, help, value, onChange, person }) {
  const shared = useSuggestions(f.suggest === 'email' ? null : f.suggest);
  const email = useEmailSuggestions(f.suggest === 'email' ? value : '', person.firstName || String(person.name || '').split(' ')[0], person.lastName);
  return <SuggestInput id={id} type={f.type || 'text'} inputMode={f.inputMode} placeholder={f.placeholder} aria-describedby={help} value={value} required={f.required} maxLength={f.max || 160} onChange={onChange} suggestions={f.suggest === 'email' ? email : shared} />;
}

function SectionForm({ person, fields, onCancel, onSaved, reload }) {
  const formId = useId();
  const initial = Object.fromEntries(fields.map((f) => [f.key, f.writeOnly ? '' : (f.kind === 'checkbox' ? person[f.key] !== false : person[f.key] ?? f.fallback ?? '')]));
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  /* The Edit button that opened this is gone; the caret goes to the first field, not back to the top of the page. */
  const formRef = useRef(null);
  useEffect(() => { formRef.current?.querySelector('input:not([type=hidden]), select, textarea')?.focus(); }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      /* Only what changed goes up; a write-only field (the reader PIN) left blank is not sent. */
      const body = Object.fromEntries(fields.filter((f) => form[f.key] !== initial[f.key] && !(f.writeOnly && form[f.key] === '')).map((f) => [f.key, form[f.key] === '' ? null : form[f.key]]));
      const r = await updateEmployee(person.id, { ...body, version: conflict?.version ?? person.version });
      refreshSuggestions();
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
    <form ref={formRef} className="space-y-3 ui-panel-in" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }}>
      {conflict ? (
        <Alert tone="warn" title="This record was updated elsewhere" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { onCancel(); reload(); }}>Reload</button>}>
          {fields.filter((f) => String(conflict[f.key] ?? '') !== String(initial[f.key] ?? '')).map((f) => `${f.label} is now "${conflict[f.key] ?? 'blank'}"`).join('; ') || 'Other details changed.'} Your edits are still here: Save again to apply them on top, or Reload to start from the newer record.
        </Alert>
      ) : null}
      {error ? <ErrorState error={error} compact onRetry={save} retryLabel="Try again" body={error?.network ? 'Your changes have not been saved. They are still in this form.' : undefined} /> : null}
      <div className="ui-form-grid">
        {fields.map((f) => {
          const id = `${formId}-${f.key}`;
          const help = f.help ? `${id}-help` : undefined;
          return (
            <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
              {f.kind === 'select' ? <span className="ui-label" aria-hidden="true">{f.label}{f.required ? ' *' : ''}</span> : <label htmlFor={id} className="ui-label">{f.label}{f.required ? ' *' : ''}</label>}
              {f.kind === 'select' ? (
                <PopupSelect showValueSubtext={false} ariaLabel={f.label} value={form[f.key] == null ? '' : String(form[f.key])} placeholder="Not set" alwaysSearch={f.options.length > 8}
                  onChange={(v) => setForm({ ...form, [f.key]: f.number ? Number(v) : (v || '') })}
                  options={[...(f.noBlank ? [] : [{ value: '', label: 'Not set' }]), ...f.options.map(([v, l]) => ({ value: String(v), label: l }))]} />
              ) : f.kind === 'checkbox' ? (
                <span className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" className="ui-checkbox" aria-describedby={help} checked={form[f.key] !== false} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />{f.checkLabel}</span>
              ) : f.kind === 'date' ? (
                <DatePicker id={id} describedBy={help} value={form[f.key] ? String(form[f.key]).slice(0, 10) : ''} onChange={(v) => setForm({ ...form, [f.key]: v })} />
              ) : f.kind === 'textarea' ? (
                <textarea id={id} className="ui-input w-full" rows={3} aria-describedby={help} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              ) : f.suggest ? (
                <SuggestedText field={f} id={id} help={help} value={form[f.key] ?? ''} onChange={(v) => setForm({ ...form, [f.key]: v })} person={person} />
              ) : (
                <input id={id} className="ui-input w-full" type={f.type || 'text'} inputMode={f.inputMode} placeholder={f.placeholder} aria-describedby={help} value={form[f.key] ?? ''} required={f.required} maxLength={f.max || 160} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
              {f.help ? <p id={help} className="ui-caption">{f.help}</p> : null}
            </div>
          );
        })}
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
  name: { title: 'Name', fields: [{ key: 'firstName', label: 'First name', required: true }, { key: 'lastName', label: 'Last name' }, { key: 'preferredName', label: 'Preferred name' }] },
  /* `email` is the personal address the employee form has always saved; `personalEmail` is what a joiner gives on their invite. */
  contact: { title: 'Contact', fields: [{ key: 'workEmail', label: 'Work email', type: 'email', inputMode: 'email', suggest: 'email' }, { key: 'workPhone', label: 'Work phone', type: 'tel', inputMode: 'tel' }, { key: 'email', label: 'Personal email', type: 'email', inputMode: 'email' }, { key: 'phone', label: 'Personal phone', type: 'tel', inputMode: 'tel' }, { key: 'personalEmail', label: 'Email from invite', type: 'email', inputMode: 'email', hideEmpty: true }] },
  personal: { title: 'Personal details', fields: [{ key: 'dateOfBirth', label: 'Date of birth', kind: 'date' }, { key: 'gender', label: 'Gender', kind: 'select', options: GENDERS }, { key: 'maritalStatus', label: 'Marital status', kind: 'select', options: MARITAL }, { key: 'guardianName', label: 'Father / husband name' }] },
  address: { title: 'Address', fields: [{ key: 'addressLine', label: 'Address', wide: true }, { key: 'city', label: 'City', suggest: 'city' }, { key: 'state', label: 'State', suggest: 'state' }, { key: 'pincode', label: 'PIN code', inputMode: 'numeric', max: 10 }, { key: 'country', label: 'Country', suggest: 'country' }] },
  emergency: { title: 'Emergency contact', fields: [{ key: 'emergencyContactName', label: 'Name' }, { key: 'emergencyContactRelation', label: 'Relationship', suggest: 'relation' }, { key: 'emergencyContactPhone', label: 'Phone', type: 'tel', inputMode: 'tel' }] },
};

/* Personal details the server leaves out for a read-only role (routes/people.ts seesPersonal): their fields are not drawn, rather than shown as "Not provided". */
const PERSONAL_KEYS = new Set(['dateOfBirth', 'maritalStatus', 'guardianName', 'email', 'personalEmail', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'notes', 'cardNumber']);
const shownFields = (person, fields) => (person.personalHidden ? fields.filter((f) => !PERSONAL_KEYS.has(f.key)) : fields);

function Personal({ person, allowed, editing, setEditing, onSaved, reload }) {
  /* Personal and contact details stay correctable after someone leaves: a settlement, a certificate or a reference still needs them right. */
  const canEdit = allowed('PEOPLE::Employees::EDIT');
  const value = (s, f) => {
    if (f.key === 'gender') return GENDER_WORDS[person.gender] || person.gender;
    if (f.key === 'maritalStatus') return MARITAL.find(([k]) => k === person.maritalStatus)?.[1] || person.maritalStatus;
    if (f.kind === 'date') return person[f.key] ? formatDate(String(person[f.key]).slice(0, 10)) : null;
    return person[f.key];
  };
  return (
    <div className="space-y-4">
      {Object.entries(PERSONAL_SECTIONS).filter(([, s]) => shownFields(person, s.fields).length).map(([k, s]) => (
        <Section key={k} title={s.title} onEdit={canEdit && editing !== k ? () => setEditing(k) : null}>
          {editing === k ? (
            <SectionForm person={person} fields={s.fields} onCancel={() => setEditing(null)} onSaved={(emp) => { onSaved(emp); setEditing(null); }} reload={reload} />
          ) : (
            <dl className="ui-field-grid">{shownFields(person, s.fields).filter((f) => !f.hideEmpty || person[f.key]).map((f) => <Field key={f.key} label={f.label} value={value(s, f)} />)}</dl>
          )}
        </Section>
      ))}
      {person.personalHidden ? <p className="ui-caption">Date of birth, home address and family details are kept with HR.</p> : null}
      {/* Statutory details: a section only for those with the grant (D-V2); masked, reveal needs an authenticator. */}
      {allowed('PEOPLE::Statutory Details::VIEW') ? <Section title="IDs and statutory"><StatutoryDetails employeeId={person.id} embedded /></Section> : null}
      <Section title="More details"><CustomFields employeeId={person.id} embedded /></Section>
      {allowed('PEOPLE::Lifecycle::VIEW') ? <JoiningDetails person={person} onChecked={(p) => onSaved(p)} /> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Employment */

function Employment({ person, data, lists, allowed, editing, setEditing, onSaved, reload, onLeave }) {
  const canEdit = allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT';
  const [extendTo, setExtendTo] = useState('');
  const [endOn, setEndOn] = useState('');
  const [renewTo, setRenewTo] = useState('');
  const [rejoin, setRejoin] = useState('');
  const [rejoinType, setRejoinType] = useState(person.employeeTypeId || '');
  const [rejoinProbation, setRejoinProbation] = useState('');
  const [rejoinContract, setRejoinContract] = useState('');
  const rejoinDates = datesFor(kindOf(lists?.types, rejoinType));
  /* Who they come back to: chosen here; a manager who has since left is not offered (W18). */
  const [rejoinManager, setRejoinManager] = useState('');
  const [managers, setManagers] = useState([]);
  useEffect(() => {
    if (person.status !== 'LEFT') return;
    listEmployees({ limit: 500, sort: 'name' }).then((r) => {
      const here = (r?.employees || []).filter((e) => e.id !== person.id);
      setManagers(here);
      if (here.some((e) => e.id === person.reportingManagerId)) setRejoinManager(person.reportingManagerId);
    }).catch(() => setManagers([]));
  }, [person.id, person.status, person.reportingManagerId]);
  const typeName = lists?.types.find((t) => t.id === person.employeeTypeId)?.name;
  const workTypeName = lists?.workTypes.find((t) => t.id === person.workTypeId)?.name;
  const dates = datesFor(kindOf(lists?.types, person.employeeTypeId));
  const probation = async (outcome) => {
    const ask = {
      CONFIRM: { title: `Confirm ${person.name} after probation?`, confirmLabel: 'Confirm', tone: 'primary' },
      EXTEND: { title: `Extend probation to ${formatDate(extendTo)}?`, confirmLabel: 'Extend', tone: 'primary' },
      END: { title: `End ${person.name}’s employment after probation?`, message: `Their last day is ${formatDate(endOn)}. The leaving checklist starts.`, confirmLabel: 'End employment' },
    }[outcome];
    if (!(await confirmDialog(ask))) return;
    try {
      const r = await decideProbation(person.id, outcome === 'CONFIRM' ? { outcome } : outcome === 'EXTEND' ? { outcome, newEndDate: extendTo } : { outcome, lastDay: endOn });
      notify.success(r.request ? `Sent for approval: ${r.request.title}.` : { CONFIRM: 'Confirmed.', EXTEND: 'Probation extended.', END: 'Employment ends after probation.' }[outcome]);
      setExtendTo('');
      setEndOn('');
      reload();
    } catch (e) { notify.error(String(e?.message || 'Not saved.')); }
  };
  /* A renewal is the end date moving on, said in words on the history. */
  const renew = async () => {
    if (!(await confirmDialog({ title: `Renew ${person.name}’s ${dates.contractLabel === 'Internship ends' ? 'internship' : 'contract'} to ${formatDate(renewTo)}?`, confirmLabel: 'Renew', tone: 'primary' }))) return;
    try {
      const r = await updateEmployee(person.id, { contractEndDate: renewTo, changeNote: `Renewed to ${formatDate(renewTo)}`, version: person.version });
      notify.success(r.request ? `Sent for approval: ${r.request.title}.` : 'Renewed.');
      setRenewTo('');
      onSaved(r.employee);
      reload();
    } catch (e) { notify.error(String(e?.message || 'Not renewed.')); }
  };
  const withdraw = async (c) => {
    if (!(await confirmDialog({ title: `Withdraw the change due ${formatDate(c.effectiveOn)}?`, confirmLabel: 'Withdraw' }))) return;
    try { await withdrawScheduled(person.id, c.id); notify.success('Withdrawn.'); reload(); } catch (e) { notify.error(String(e?.message || 'Not withdrawn.')); }
  };
  const rehire = async () => {
    if (!(await confirmDialog({ title: `Rehire ${person.name} from ${formatDate(rejoin)}?`, message: 'A new period of employment starts on that date; the earlier one stays in History.', confirmLabel: 'Rehire', tone: 'primary' }))) return;
    try {
      await rehireEmployee(person.id, { rejoinDate: rejoin, employeeTypeId: rejoinType || null, reportingManagerId: rejoinManager || null, probationEndDate: (rejoinDates.probation && rejoinProbation) || null, contractEndDate: (rejoinDates.contract && rejoinContract) || null });
      notify.success(`${person.name} rehired.`);
      setRejoin('');
      reload();
    } catch (e) { notify.error(String(e?.message || 'Not rehired.')); }
  };
  const fields = [
    { key: 'code', label: 'Employee ID', required: true, max: 40 },
    { key: 'dateOfJoining', label: 'Joining date', kind: 'date' },
    { key: 'hours', label: 'Hours', kind: 'select', options: Object.entries(HOURS_WORDS), noBlank: true, fallback: 'FULL_TIME' },
    dates.probation && { key: 'probationEndDate', label: 'Probation ends', kind: 'date' },
    dates.contract && { key: 'contractEndDate', label: dates.contractLabel, kind: 'date' },
    { key: 'jobRoleId', label: 'Job role', kind: 'select', options: (lists?.roles || []).filter((x) => !person.jobPositionId || !x.jobPositionId || x.jobPositionId === person.jobPositionId || x.id === person.jobRoleId).map((x) => [x.id, x.name]) },
  ].filter(Boolean);
  return (
    <div className="space-y-4">
      <Section title="Employment" onEdit={canEdit && editing !== 'employment' ? () => setEditing('employment') : null}
>
        {editing === 'employment' ? <SectionForm person={person} fields={fields} onCancel={() => setEditing(null)} onSaved={(emp) => { onSaved(emp); setEditing(null); }} reload={reload} /> : (
          <dl className="ui-field-grid">
            <Field label="Employee ID" value={person.code} mono />
            <Field label="Status" value={<StatusBadge employee={person} />} />
            <Field label="Designation" value={person.designation} />
            <Field label="Employment type" value={typeName} />
            <Field label="Hours" value={HOURS_WORDS[person.hours || 'FULL_TIME']} />
            <Field label="Work mode" value={workTypeName} />
            <Field label="Job role" value={lists?.roles?.find((r) => r.id === person.jobRoleId)?.name} />
            <Field label={person.currentEpisodeSeq > 1 ? 'Rejoined' : 'Joining date'} value={person.dateOfJoining ? formatDate(String(person.dateOfJoining).slice(0, 10)) : null} mono />
            {person.currentEpisodeSeq > 1 ? <Field label="First joined" value={person.firstJoiningDate ? formatDate(person.firstJoiningDate) : null} mono /> : null}
            {dates.probation || person.probationEndDate || person.confirmedOn ? <Field label={person.confirmedOn ? 'Confirmed on' : 'Probation ends'} value={person.confirmedOn ? formatDate(person.confirmedOn) : person.probationEndDate ? formatDate(person.probationEndDate) : null} mono /> : null}
            {dates.contract || person.contractEndDate ? <Field label={dates.contractLabel} value={person.contractEndDate ? formatDate(person.contractEndDate) : null} mono /> : null}
            {person.resignedOn ? <Field label="Resignation received" value={`${formatDate(String(person.resignedOn).slice(0, 10))}${person.noticeWaived ? ' · notice waived' : ''}`} mono /> : null}
            {person.dateOfLeaving ? <Field label={person.status === 'LEFT' ? 'Left' : 'Last day'} value={`${formatDate(person.dateOfLeaving)}${person.leavingType ? ` · ${LEAVING_TYPES[person.leavingType] || person.leavingType}` : ''}${person.leavingReason ? ` · ${person.leavingReason}` : ''}`} /> : null}
          </dl>
        )}
      </Section>
      {person.probationEndDate && !person.confirmedOn && person.status !== 'LEFT' && !(person.dateOfJoining && String(person.dateOfJoining).slice(0, 10) > todayIst()) && allowed('PEOPLE::Lifecycle::APPROVE') ? (
        <Section title="Probation">
          {/* One decision, three outcomes: a row each, so the choice reads down the page. */}
          <div className="ui-decide">
            <div className="ui-decide-row">
              <span className="ui-decide-label">Passed</span>
              <span />
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => probation('CONFIRM')}>Confirm</button>
            </div>
            <div className="ui-decide-row">
              <label className="ui-decide-label" htmlFor="prob-extend">Extend to</label>
              <DatePicker id="prob-extend" value={extendTo} min={person.probationEndDate} onChange={setExtendTo} />
              <button type="button" className="ui-btn ui-btn-secondary" disabled={!extendTo} onClick={() => probation('EXTEND')}>Extend</button>
            </div>
            <div className="ui-decide-row">
              <label className="ui-decide-label" htmlFor="prob-end">End on</label>
              <DatePicker id="prob-end" value={endOn} min={String(person.dateOfJoining || '').slice(0, 10)} onChange={setEndOn} />
              <button type="button" className="ui-btn ui-btn-secondary" disabled={!endOn} onClick={() => probation('END')}>End employment</button>
            </div>
          </div>
        </Section>
      ) : null}
      {dates.contract && person.contractEndDate && canEdit ? (
        <Section title={dates.contractLabel === 'Internship ends' ? 'Internship' : 'Contract'}>
          <div className="ui-decide">
            <div className="ui-decide-row">
              <label className="ui-decide-label" htmlFor="contract-renew">Renew to</label>
              <DatePicker id="contract-renew" value={renewTo} min={String(person.contractEndDate).slice(0, 10)} onChange={setRenewTo} />
              <button type="button" className="ui-btn ui-btn-secondary" disabled={!renewTo} onClick={renew}>Renew</button>
            </div>
            <div className="ui-decide-row">
              <span className="ui-decide-label">Not renewing</span>
              <span />
              <button type="button" className="ui-btn ui-btn-secondary" onClick={onLeave}>Record leaving</button>
            </div>
          </div>
        </Section>
      ) : null}
      {(data.scheduledChanges || []).length ? (
        <Section title="Upcoming changes">
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
          {/* A new stint has its own terms; last time's probation and contract dates do not carry over. */}
          <div className="ui-form-grid">
            <div><label className="ui-label" htmlFor="rejoin">Rejoins on *</label><DatePicker id="rejoin" value={rejoin} min={person.dateOfLeaving || ''} onChange={setRejoin} /></div>
            <div><PopupSelect showValueSubtext={false} label="Manager" value={rejoinManager} onChange={(v) => setRejoinManager(v || '')} placeholder="Not set" alwaysSearch options={[{ value: '', label: 'Not set' }, ...managers.map((m) => ({ value: m.id, label: m.code ? `${m.name} (${m.code})` : m.name }))]} /></div>
            <div><PopupSelect showValueSubtext={false} label="Employment type" value={rejoinType} onChange={(v) => setRejoinType(v || '')} placeholder="Not set" options={[{ value: '', label: 'Not set' }, ...(lists?.types || []).map((t) => ({ value: t.id, label: t.name }))]} /></div>
            {rejoinDates.probation ? <div><label className="ui-label" htmlFor="rejoin-probation">Probation ends</label><DatePicker id="rejoin-probation" value={rejoinProbation} min={rejoin || ''} onChange={setRejoinProbation} /></div> : null}
            {rejoinDates.contract ? <div><label className="ui-label" htmlFor="rejoin-contract">{rejoinDates.contractLabel}</label><DatePicker id="rejoin-contract" value={rejoinContract} min={rejoin || ''} onChange={setRejoinContract} /></div> : null}
          </div>
          <div className="mt-4"><button type="button" className="ui-btn ui-btn-secondary" disabled={!rejoin} onClick={rehire}>Rehire</button></div>
        </Section>
      ) : null}
      <Section title="Onboarding & exit"><EmployeeChecklist person={person} /></Section>
    </div>
  );
}

/* --------------------------------------------------------------- Organization */

function Organization({ person, lists, allowed, openAction, openPerson, editing, setEditing, onSaved, reload }) {
  const canEdit = allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT';
  const name = (k, v) => lists?.[k]?.find((x) => x.id === v)?.name;
  /* A list the company has not set up is not shown as "Not provided" on everyone; a value already on the person always is. */
  const uses = (list, value) => Boolean(value) || Boolean(lists?.[list]?.length);
  return (
    <div className="space-y-4">
      <Section title="Placement" onEdit={canEdit ? () => openAction('transfer') : null}>
        <dl className="ui-field-grid">
          <Field label="Department" value={person.department} />
          <Field label="Designation" value={person.designation} />
          {/* Works at: the branch, the place people work; Attendance gives its holidays. Shown once a company has more than one. */}
          {(lists?.branches?.length || 0) > 1 || person.branchId ? <Field label="Works at" value={person.branchName || lists?.branches?.find((b) => b.id === person.branchId)?.name} /> : null}
          {uses('areas', person.areaId) ? <Field label="Location" value={person.areaName} /> : null}
          {uses('establishments', person.establishmentId) ? <Field label="Work site" value={person.establishment ? `${person.establishment}${person.workState ? ` (${person.workState})` : ''}` : null} /> : null}
          {uses('teams', person.teamId) ? <Field label="Team" value={person.teamName} /> : null}
          {uses('seats', person.seatId) ? <Field label="Position" value={person.seatName} /> : null}
          {uses('units', person.businessUnitId) ? <Field label="Business unit" value={person.businessUnitName} /> : null}
          {uses('grades', person.gradeId) ? <Field label="Grade" value={person.gradeName || name('grades', person.gradeId)} /> : null}
          {uses('centres', person.costCenterId) ? <Field label="Cost centre" value={person.costCenterName} /> : null}
        </dl>
      </Section>
      {/* A typed work address from before Branches: kept, and editable, for the people who carry one. */}
      {person.workLocation ? (
        <Section title="Work address" onEdit={canEdit && editing !== 'place' ? () => setEditing('place') : null}>
          {editing === 'place' ? (
            <SectionForm person={person} fields={[{ key: 'workLocation', label: 'Site or address', suggest: 'workLocation' }]} onCancel={() => setEditing(null)} onSaved={(emp) => { onSaved(emp); setEditing(null); }} reload={reload} />
          ) : <dl className="ui-field-grid"><Field label="Site or address" value={person.workLocation} /></dl>}
        </Section>
      ) : null}
      <Section title="Reporting" onEdit={canEdit ? () => openAction('manager') : null}>
        <dl className="ui-field-grid">
          <Field label="Manager" value={person.reportingManagerId ? (person.managerOpens === false ? person.reportingManagerName : <button type="button" className="ui-link" onClick={() => openPerson(person.reportingManagerId)}>{person.reportingManagerName}</button>) : null} />
          <Field label="Secondary manager" value={person.dottedManagerId ? <button type="button" className="ui-link" onClick={() => openPerson(person.dottedManagerId)}>{person.dottedManagerName}</button> : null} />
          <Field label="Direct reports" value={(person.directReports || []).length ? (
            <ul className="space-y-1.5">
              {person.directReports.map((r) => (
                <li key={r.id}><button type="button" className="inline-flex items-center gap-2 text-left text-sm hover:underline" onClick={() => openPerson(r.id)}><Avatar person={r} size={24} /><span className="font-medium">{r.name}</span>{r.designation ? <span className="ui-muted">{r.designation}</span> : null}</button></li>
              ))}
            </ul>
          ) : 'None'} />
        </dl>
      </Section>
      <SignInSection person={person} canEdit={allowed('PEOPLE::Employees::EDIT') && person.status !== 'LEFT'} editing={editing === 'signin'} setEditing={setEditing} onSaved={onSaved} />
      {hasApp('attendance') ? (
        /* Stored on the employee and pushed to the biometric readers by Attendance; edited here as the old form did. */
        <Section title="Attendance device" onEdit={canEdit && editing !== 'readers' ? () => setEditing('readers') : null}>
          {editing === 'readers' ? (
            <SectionForm person={person} onCancel={() => setEditing(null)} onSaved={(emp) => { onSaved(emp); setEditing(null); }} reload={reload} fields={[
              { key: 'devicePin', label: 'Attendance ID', placeholder: person.code || '', max: 20 },
              { key: 'cardNumber', label: 'Card number', max: 20 },
              { key: 'devicePassword', label: 'Device PIN', type: 'password', writeOnly: true, max: 8, placeholder: person.hasDevicePassword ? '••••' : '' },
              { key: 'devicePrivilege', label: 'Device role', kind: 'select', number: true, noBlank: true, options: [[0, 'User'], [14, 'Reader administrator']] },
              { key: 'contractorId', label: 'Contractor', kind: 'select', options: (lists?.contractors || []).map((c) => [c.id, c.name]) },
              { key: 'attendanceRequired', label: 'Attendance', kind: 'checkbox', checkLabel: 'Expected to mark attendance (untick for door access only)' },
            ]} />
          ) : (
            <dl className="ui-field-grid">
              <Field label="Attendance ID" value={person.devicePin || (person.code ? `${person.code} (employee ID)` : null)} />
              <Field label="Card number" value={person.cardNumber} mono />
              <Field label="Device PIN" value={person.hasDevicePassword ? 'Set' : null} />
              <Field label="Device role" value={person.devicePrivilege === 14 ? 'Reader administrator' : 'User'} />
              <Field label="Contractor" value={person.contractorName} />
              <Field label="Marks attendance" value={person.attendanceRequired === false ? 'No, door only' : 'Yes'} />
            </dl>
          )}
        </Section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Operations (WF-06) */

const OPERATIONS = {
  manager: { title: 'Change manager', fields: [['reportingManagerId', 'New manager', 'people'], ['dottedManagerId', 'Secondary manager', 'people']] },
  transfer: { title: 'Transfer', fields: [['branchId', 'Works at', 'branches'], ['departmentId', 'Department', 'departments'], ['areaId', 'Location', 'areas'], ['establishmentId', 'Work site', 'establishments'], ['businessUnitId', 'Business unit', 'units'], ['teamId', 'Team', 'teams'], ['seatId', 'Position', 'seats'], ['costCenterId', 'Cost centre', 'centres']] },
  designation: { title: 'Change designation', fields: [['jobPositionId', 'New designation', 'positions'], ['gradeId', 'Grade', 'grades']] },
  type: { title: 'Change employment type', fields: [['employeeTypeId', 'Employment type', 'types'], ['workTypeId', 'Work mode', 'workTypes']] },
  /* Allowed moves only: active or on notice can be suspended, suspended can be reactivated; leaving and rehire have their own flows (WF-14). */
  status: { title: 'Change status', fields: [['status', 'New status', 'statuses']], reasonRequired: true },
};
const NARROWED_BY = { seatId: 'teamId', teamId: 'departmentId', jobPositionId: 'departmentId', jobRoleId: 'jobPositionId' };
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
  /* A status change has one allowed move from where they are (suspend, or reactivate), so it starts chosen. */
  const target = action === 'status' ? (person.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED') : null;
  const initial = useMemo(() => Object.fromEntries((op?.fields || []).map(([k]) => [k, k === 'status' ? target : person[k] || ''])), [op, person, target]);
  const [form, setForm] = useState(initial);
  const [effective, setEffective] = useState(todayIst());
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const reasonHints = useSuggestions('reason');
  const [impact, setImpact] = useState([]);
  const [followPt, setFollowPt] = useState(true);
  const ptFix = impact.find((i) => i.fix?.kind === 'ptState');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /* A new employment type brings its own end dates: asked for here, and the ones it does not have are cleared (an intern made permanent has no internship end). */
  const day = (v) => (v ? String(v).slice(0, 10) : '');
  const [ends, setEnds] = useState({ probationEndDate: day(person.probationEndDate), contractEndDate: day(person.contractEndDate) });
  const typeChanged = action === 'type' && (form.employeeTypeId || '') !== (person.employeeTypeId || '');
  const newDates = datesFor(kindOf(lists.types, form.employeeTypeId));
  const endChanges = !typeChanged ? {} : Object.fromEntries([
    ['contractEndDate', newDates.contract ? ends.contractEndDate : ''],
    ...(person.confirmedOn ? [] : [['probationEndDate', newDates.probation ? ends.probationEndDate : '']]),
  ].filter(([k, v]) => v !== day(person[k])));
  useEffect(() => {
    if (op?.fields.some(([, , src]) => src === 'people')) listEmployees({ limit: 500, sort: 'name' }).then((r) => setPeople((r?.employees || []).filter((e) => e.id !== person.id && e.status !== 'LEFT'))).catch(() => setPeople([]));
  }, [op, person.id]);
  const changed = { ...Object.fromEntries(Object.entries(form).filter(([k, v]) => (v || '') !== (person[k] || ''))), ...endChanges };
  useEffect(() => {
    const ask = {};
    for (const k of ['establishmentId', 'departmentId', 'reportingManagerId', 'areaId']) if (k in changed) ask[k] = changed[k] || '';
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
  /* A list narrowed to what sits under the choice above it (in this form, or on the record); the current pick stays. */
  const narrowed = (k, src) => {
    const parentKey = NARROWED_BY[k];
    if (!parentKey) return options(src);
    const parent = parentKey in form ? form[parentKey] : person[parentKey];
    return options(src).filter((o) => { const item = lists[src]?.find((x) => x.id === o.value); return !parent || !item?.[parentKey] || item[parentKey] === parent || o.value === form[k]; });
  };
  const current = (k, src) => (src === 'people' ? (k === 'reportingManagerId' ? person.reportingManagerName : person.dottedManagerName) : src === 'statuses' ? STATUS_WORD[person.status] : lists[src]?.find((x) => x.id === person[k])?.name) || 'None';
  const submit = async () => {
    if (busy || !Object.keys(changed).length) return;
    if (op.reasonRequired && !reason.trim()) { setReasonMissing(true); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { ...Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v || null])), changeNote: reason || null, version: person.version, ...(effective && effective !== todayIst() ? { effectiveFrom: effective } : {}), ...(ptFix && followPt ? { alsoPtState: true } : {}) };
      const r = await updateEmployee(person.id, body);
      const pt = r.ptState ? (r.ptState.applied ? ` Professional Tax is now ${r.ptState.state}.` : ` A task to set Professional Tax to ${r.ptState.state} is on the record.`) : '';
      notify.success(`${r.request ? `Sent for approval: ${r.request.title}. Nothing changes until it is approved.` : r.scheduled?.length ? `Scheduled for ${formatDate(effective)}.` : 'Changed.'}${pt}`);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title={`${target ? (target === 'ACTIVE' ? 'Reactivate' : 'Suspend') : op.title}: ${person.name}`} dirty={Object.keys(form).some((k) => (form[k] || '') !== (initial[k] || '')) || Boolean(reason)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !Object.keys(changed).length} onClick={submit}>{busy ? 'Saving…' : 'Confirm change'}</button></>}>
      <div className="grid gap-4">
        {error ? (error?.status === 409 && error?.data?.code === 'STALE'
          ? <Alert tone="warn" title="This record was updated elsewhere">Close this, reload the record, and make the change again. Nothing was overwritten.</Alert>
          : <ErrorState error={error} compact onRetry={submit} retryLabel="Try again" body={error?.status === 400 ? error.message : undefined} />) : null}
        {/* Only the lists the company uses (or this person already has a value from). */}
        {op.fields.filter(([k, , src]) => src === 'people' || src === 'statuses' || person[k] || (lists[src] || []).length > (src === 'branches' ? 1 : 0)).map(([k, label, src]) => (
          <div key={k}>
            <PopupSelect showValueSubtext={false} label={label} value={form[k]} onChange={(v) => setForm({ ...form, [k]: v || '' })} placeholder="Choose…" alwaysSearch={src !== 'statuses'} options={src === 'statuses' ? options(src) : [{ value: '', label: 'None' }, ...narrowed(k, src)]} />
            <span className="ui-caption">Now: {current(k, src)}</span>
          </div>
        ))}
        {typeChanged && newDates.probation && !person.confirmedOn ? <div><label className="ui-label" htmlFor="op-probation">Probation ends</label><DatePicker id="op-probation" value={ends.probationEndDate} min={day(person.dateOfJoining)} onChange={(v) => setEnds({ ...ends, probationEndDate: v || '' })} /></div> : null}
        {typeChanged && newDates.contract ? <div><label className="ui-label" htmlFor="op-contract">{newDates.contractLabel}</label><DatePicker id="op-contract" value={ends.contractEndDate} min={day(person.dateOfJoining)} onChange={(v) => setEnds({ ...ends, contractEndDate: v || '' })} /></div> : null}
        {/* A date the new type does not have is removed; said, never done quietly. */}
        {['probationEndDate', 'contractEndDate'].filter((k) => endChanges[k] === '' && person[k]).map((k) => <p key={k} className="ui-caption">{k === 'probationEndDate' ? 'Probation end' : 'Contract end'} {formatDate(day(person[k]))} is removed.</p>)}
        {/* A suspension or reactivation takes effect when it is made; only job changes can be dated (W8). */}
        {action !== 'status' ? <div><label className="ui-label" htmlFor="op-effective">Effective from</label><DatePicker id="op-effective" value={effective} onChange={setEffective} /></div> : null}
        <label className="block"><span className="ui-label">Reason{op.reasonRequired ? ' *' : ''}</span><SuggestInput maxLength={500} value={reason} suggestions={reasonHints} aria-invalid={reasonMissing || undefined} aria-describedby={reasonMissing ? 'op-reason-error' : undefined} onChange={(v) => { setReason(v); setReasonMissing(false); }} /></label>
        {reasonMissing ? <p id="op-reason-error" className="ui-field-error" role="alert">Add a reason.</p> : null}
        {impact.length ? (
          /* What follows by itself, what needs someone, what to check: never "told" for something that does not happen. */
          <div className="ui-impact" aria-label="What else this affects">
            {[['ACTION', 'Needs you'], ['AUTO', 'Follows by itself'], ['TASK', 'To check (a task is added)'], ['INFO', 'Nothing to do']].map(([kind, heading]) => {
              const lines = impact.filter((i) => i.target === kind);
              return lines.length ? (
                <section key={kind} className={`ui-impact-group is-${kind.toLowerCase()}`} aria-label={heading}>
                  <p className="ui-impact-heading" aria-hidden="true">{heading}</p>
                  <ul>
                    {lines.map((i) => (
                      <li key={i.key}>
                        <span className="block text-sm font-medium">{i.title}</span>
                        <span className="block ui-caption">{i.detail}</span>
                        {i.fix?.kind === 'ptState' ? (
                          <label className="ui-impact-fix"><input type="checkbox" className="ui-checkbox" checked={followPt} onChange={(e) => setFollowPt(e.target.checked)} /> Also set it to {i.fix.state}{effective && effective > todayIst() ? ' (as a task for that day)' : ''}</label>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

/* --------------------------------------------------------------- History compare (WF-08) */

const COMPARE_FIELDS = [
  ['Department', (e, l) => l?.departments?.find((x) => x.id === e.departmentId)?.name || e.department],
  ['Designation', (e, l) => l?.positions?.find((x) => x.id === e.jobPositionId)?.name || e.designation],
  ['Manager', (e) => e.reportingManagerName],
  ['Secondary manager', (e) => e.dottedManagerName],
  ['Location', (e) => e.areaName],
  ['Work site', (e) => e.establishment],
  ['Business unit', (e) => e.businessUnitName],
  ['Team', (e) => e.teamName],
  ['Position', (e) => e.seatName],
  ['Employment type', (e, l) => l?.types?.find((x) => x.id === e.employeeTypeId)?.name],
  ['Work mode', (e, l) => l?.workTypes?.find((x) => x.id === e.workTypeId)?.name],
  ['Grade', (e) => e.gradeName],
  ['Cost centre', (e) => e.costCenterName],
  ['Status', (e) => STATUS_WORD[e.status] || e.status],
];

/**
 * The record as it stood on two days, side by side (WF-08 "compare
 * snapshots"): job and organisation fields rolled back through employment
 * history, so a backdated change shows on the day it counts from. Rows that
 * differ are marked.
 */
function HistoryCompare({ person, lists }) {
  const joined = person.dateOfJoining ? String(person.dateOfJoining).slice(0, 10) : '';
  const [a, setA] = useState(joined && joined <= todayIst() ? joined : todayIst());
  const [b, setB] = useState(todayIst());
  const [snap, setSnap] = useState({});
  useEffect(() => {
    let live = true;
    for (const [k, d] of [['a', a], ['b', b]]) {
      if (!d) continue;
      employeeAsOf(person.id, d)
        .then((r) => live && setSnap((x) => ({ ...x, [k]: { date: d, employee: r.employee } })))
        .catch((e) => live && setSnap((x) => ({ ...x, [k]: { date: d, error: e?.status === 404 ? 'Not with the company yet on this day.' : String(e?.message || 'Could not load.') } })));
    }
    return () => { live = false; };
  }, [person.id, person.version, a, b]);
  const value = (k, f) => (snap[k]?.employee ? f(snap[k].employee, lists) || '—' : null);
  /* Before the first day there is nothing to compare. */
  if (!joined || joined > todayIst()) return null;
  return (
    <Section title="Compare two dates">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div><label className="ui-caption" htmlFor="cmp-a">As of</label><DatePicker id="cmp-a" value={a} max={todayIst()} onChange={(v) => setA(v || a)} /></div>
        <div><label className="ui-caption" htmlFor="cmp-b">and as of</label><DatePicker id="cmp-b" value={b} max={todayIst()} onChange={(v) => setB(v || b)} /></div>
      </div>
      {snap.a?.error || snap.b?.error ? <p className="ui-caption mb-2">{[...new Set([snap.a?.error && `${formatDate(snap.a.date)}: ${snap.a.error}`, snap.b?.error && snap.b.date !== snap.a?.date && `${formatDate(snap.b.date)}: ${snap.b.error}`].filter(Boolean))].join(' ')}</p> : null}
      <div className="ui-table-scroll">
        <table className="ui-table ui-compare w-full">
          <thead><tr><th scope="col">Field</th><th scope="col">{formatDate(a)}</th><th scope="col">{formatDate(b)}</th></tr></thead>
          <tbody className="ui-rows">
            {COMPARE_FIELDS.map(([label, f]) => {
              const x = value('a', f);
              const y = value('b', f);
              const changed = x !== null && y !== null && x !== y;
              return (
                <tr key={label} className={changed ? 'is-changed' : ''}>
                  <th scope="row" className="font-normal ui-caption text-left">{label}{changed ? <span className="sr-only"> (changed)</span> : null}</th>
                  <td>{x ?? <span className="ui-muted">—</span>}</td>
                  <td className={changed ? 'font-medium' : ''}>{y ?? <span className="ui-muted">—</span>}{changed ? <span className="ui-pill ui-pill-info ml-2">Changed</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
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
