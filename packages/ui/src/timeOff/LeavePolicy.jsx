import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listStructure } from '@ui/personnel/api';

import { can } from './shared';
import {
  ACCRUAL_LABEL, MONTH_NAMES, PRIVATE_LABEL, colorOf, createLeaveType, creditText, deleteLeaveType, getLeaveSettings, listLeaveTypes,
  previewLeaveType, saveLeaveSettings, todayIst, updateLeaveType,
} from './api';

/**
 * People → Settings → Leave Policy (founder, 22 Oct 2026: the full leave
 * module in HR). Each type says what it gives, who it is for, how it is asked
 * for, and what happens to what is left; the form tries it on five real
 * people before it is saved. The same types Attendance uses.
 */
const BLANK = {
  name: '', code: '', description: '', color: '', isPaid: true, isActive: true, isPrivate: false,
  annualDays: 12, accrual: 'YEARLY', creditOn: 'START', creditDay: '', prorateForJoiners: true, carryForwardMax: '',
  gender: '', employeeTypeIds: [], availableAfterDays: '',
  allowHalfDay: true, minNoticeDays: '', maxDaysPerRequest: '', backdatedDays: '', sandwich: false,
  negativeDays: 0, encashable: false, maxEncashDays: '',
  entitlements: [], probationRule: 'ACCRUE', approval: '', autoApproveUpToDays: '', handOnAfterDays: '',
};
/* One entitlement rule: days a year for an employee type, after years of service, or both. */
const BLANK_RULE = { employeeTypeId: '', years: '', annualDays: '' };
const PROBATION = [
  { value: 'ACCRUE', label: 'Counts as normal' },
  { value: 'HOLD', label: 'Starts when confirmed' },
  { value: 'LOCK', label: 'Builds up, usable when confirmed' },
];
const APPROVAL = [
  { value: 'company', label: "Company's rule" },
  { value: 'HR', label: 'HR' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'MANAGER_THEN_HR', label: 'Manager, then HR' },
];
const APPROVAL_WORDS = { HR: 'HR decides', MANAGER: 'the manager decides', MANAGER_THEN_HR: 'the manager, then HR' };
/**
 * State starting points (TIME-LEAVE-RESEARCH.md): the law's days as a set of
 * types, created once and edited by the owner. Never rules.
 */
const EARNED = { name: 'Earned Leave', code: 'EL', accrual: 'MONTHLY', encashable: true, minNoticeDays: 7, color: '#d97706' };
const CASUAL = { name: 'Casual Leave', code: 'CL', accrual: 'MONTHLY', creditOn: 'START', minNoticeDays: 1, maxDaysPerRequest: 3, color: '#2563eb' };
const SICK = { name: 'Sick Leave', code: 'SL', backdatedDays: 7, isPrivate: true, color: '#16a34a' };
const MATERNITY = { name: 'Maternity Leave', code: 'ML', annualDays: 182, gender: 'FEMALE', allowHalfDay: false, prorateForJoiners: false, isPrivate: true, color: '#db2777' };
const PATERNITY = { name: 'Paternity Leave', code: 'PL', annualDays: 15, gender: 'MALE', allowHalfDay: false, isPrivate: true, color: '#0891b2' };
const LOP = { name: 'Loss of Pay', code: 'LOP', isPaid: false, annualDays: 0, color: '#64748b' };
const STATE_SETS = [
  { value: 'KA', label: 'Karnataka', types: [{ ...EARNED, annualDays: 18, carryForwardMax: 45 }, { ...CASUAL, annualDays: 12 }, { ...SICK, annualDays: 12 }, MATERNITY, PATERNITY, LOP] },
  { value: 'MH', label: 'Maharashtra', types: [{ ...EARNED, annualDays: 21, carryForwardMax: 45 }, { ...CASUAL, annualDays: 8 }, { ...SICK, annualDays: 10 }, MATERNITY, PATERNITY, LOP] },
  { value: 'TN', label: 'Tamil Nadu', types: [{ ...EARNED, annualDays: 12, carryForwardMax: 24, availableAfterDays: 240 }, { ...CASUAL, annualDays: 12 }, { ...SICK, annualDays: 12 }, MATERNITY, PATERNITY, LOP] },
  { value: 'DL', label: 'Delhi', types: [{ ...EARNED, annualDays: 15, carryForwardMax: 45 }, { ...CASUAL, name: 'Casual & Sick Leave', code: 'CSL', annualDays: 12, backdatedDays: 7 }, MATERNITY, PATERNITY, LOP] },
  { value: 'FA', label: 'Factories Act', types: [{ ...EARNED, annualDays: 15, carryForwardMax: 30, availableAfterDays: 240 }, MATERNITY, LOP] },
  { value: 'OSH', label: 'OSH Code default', types: [{ ...EARNED, annualDays: 15, carryForwardMax: 30, availableAfterDays: 180 }, { ...CASUAL, annualDays: 12 }, { ...SICK, annualDays: 12 }, MATERNITY, PATERNITY, LOP] },
];
/* The usual Indian set. Sick and maternity leave are private: the reason is nobody's business but HR's. */
const TEMPLATES = [
  { name: 'Casual Leave', code: 'CL', annualDays: 12, accrual: 'MONTHLY', creditOn: 'START', minNoticeDays: 1, maxDaysPerRequest: 3, color: '#2563eb' },
  { name: 'Sick Leave', code: 'SL', annualDays: 6, backdatedDays: 7, isPrivate: true, color: '#16a34a' },
  { name: 'Earned Leave', code: 'EL', annualDays: 15, accrual: 'MONTHLY', carryForwardMax: 30, encashable: true, maxEncashDays: 15, minNoticeDays: 7, availableAfterDays: 180, color: '#d97706' },
  { name: 'Maternity Leave', code: 'ML', annualDays: 182, gender: 'FEMALE', allowHalfDay: false, prorateForJoiners: false, isPrivate: true, color: '#db2777' },
  { name: 'Paternity Leave', code: 'PL', annualDays: 5, gender: 'MALE', allowHalfDay: false, color: '#0891b2' },
  { name: 'Loss of Pay', code: 'LOP', isPaid: false, annualDays: 0, color: '#64748b' },
];
const CREDIT_ON = [
  { value: 'START', label: 'The first day of each part' },
  { value: 'END', label: 'The last day of each part' },
  { value: 'DAY', label: 'A day of the month I choose' },
];
const GENDERS = [
  { value: '', label: 'Everyone' },
  { value: 'FEMALE', label: 'Women' },
  { value: 'MALE', label: 'Men' },
];
const num = (v) => (v === '' || v == null ? null : Number(v));
const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? '' : 's'}`;
const lower = (s) => String(s || '').trim().toLowerCase();
/** "3 years", "18 months": length of service, stored in months. */
const serviceText = (months) => (months % 12 === 0 ? plural(months / 12, 'year') : plural(months, 'month'));
/** The form keeps years (0.5 steps); the server keeps months. */
const monthsOf = (years) => (years === '' || years == null ? null : Math.round(Number(years) * 12));
const yearsOf = (months) => (months == null ? '' : String(Math.round((months / 12) * 100) / 100));
/** One rule in words: "6 for Interns", "15 after 3 years", "15 for Staff after 3 years". */
const ruleText = (e, typeNames) => [e.annualDays, e.employeeTypeId ? `for ${typeNames.get(e.employeeTypeId) || 'a type'}` : null, e.minServiceMonths ? `after ${serviceText(e.minServiceMonths)}` : null].filter(Boolean).join(' ');

/** One line per rule that is on, so the list reads as the policy. */
function rulesOf(t, typeNames = new Map()) {
  const r = [];
  if (t.isPaid) {
    r.push(`${t.annualDays} a year: ${creditText(t)}`);
    for (const e of t.entitlements || []) r.push(ruleText(e, typeNames));
    if (t.probationRule === 'HOLD') r.push('starts when confirmed');
    if (t.probationRule === 'LOCK') r.push('locked until confirmed');
    r.push(t.carryForwardMax != null ? `carry up to ${t.carryForwardMax}` : 'lapses at year end');
  } else r.push('unpaid: loss of pay');
  if (t.approval && APPROVAL_WORDS[t.approval]) r.push(APPROVAL_WORDS[t.approval]);
  if (t.autoApproveUpToDays != null) r.push(`approved on its own up to ${t.autoApproveUpToDays}`);
  if (t.handOnAfterDays != null) r.push(`to HR after ${plural(t.handOnAfterDays, 'day')} waiting`);
  if (t.isPrivate) r.push('private');
  if (t.gender) r.push(t.gender === 'FEMALE' ? 'women' : 'men');
  if (t.employeeTypeIds?.length) r.push(t.employeeTypeIds.map((i) => typeNames.get(i) || 'a type').join(', '));
  if (t.availableAfterDays) r.push(`after ${plural(t.availableAfterDays, 'day')} of joining`);
  if (t.minNoticeDays) r.push(`${plural(t.minNoticeDays, 'day')} notice`);
  if (t.maxDaysPerRequest != null) r.push(`at most ${t.maxDaysPerRequest} at a time`);
  if (t.backdatedDays != null) r.push(t.backdatedDays ? `up to ${plural(t.backdatedDays, 'day')} late` : 'not after the day');
  if (t.allowHalfDay === false) r.push('whole days');
  if (t.sandwich) r.push('sandwich rule');
  if (t.negativeDays) r.push(`${t.negativeDays} in advance`);
  if (t.encashable) r.push(t.maxEncashDays != null ? `pay out up to ${t.maxEncashDays}` : 'paid out');
  return r;
}

/** A saved type as the form holds it: blanks for what is not set. */
const formOf = (t) => ({
  ...BLANK, ...t,
  code: t.code || '', description: t.description || '', color: t.color || '', gender: t.gender || '', employeeTypeIds: t.employeeTypeIds || [],
  isPrivate: Boolean(t.isPrivate), creditOn: t.creditOn || 'START', creditDay: t.creditDay ?? '',
  carryForwardMax: t.carryForwardMax ?? '', minNoticeDays: t.minNoticeDays ?? '', maxDaysPerRequest: t.maxDaysPerRequest ?? '',
  backdatedDays: t.backdatedDays ?? '', availableAfterDays: t.availableAfterDays ?? '', maxEncashDays: t.maxEncashDays ?? '',
  entitlements: (t.entitlements || []).map((e) => ({ employeeTypeId: e.employeeTypeId || '', years: yearsOf(e.minServiceMonths), annualDays: e.annualDays ?? '' })),
  probationRule: t.probationRule || 'ACCRUE', approval: t.approval || '', autoApproveUpToDays: t.autoApproveUpToDays ?? '', handOnAfterDays: t.handOnAfterDays ?? '',
});

/** What the server is sent, for a save and for the preview alike. */
function bodyOf(form) {
  const paid = Boolean(form.isPaid);
  return {
    name: String(form.name || '').trim(),
    code: String(form.code || '').trim() || null,
    description: String(form.description || '').trim() || null,
    color: form.color || null,
    isPaid: paid,
    isActive: Boolean(form.isActive),
    isPrivate: Boolean(form.isPrivate),
    annualDays: paid ? Number(form.annualDays) || 0 : 0,
    accrual: form.accrual || 'YEARLY',
    creditOn: form.creditOn || 'START',
    creditDay: form.creditOn === 'DAY' ? num(form.creditDay) : null,
    prorateForJoiners: Boolean(form.prorateForJoiners),
    carryForwardMax: paid ? num(form.carryForwardMax) : null,
    gender: form.gender || null,
    employeeTypeIds: form.employeeTypeIds || [],
    availableAfterDays: num(form.availableAfterDays),
    allowHalfDay: Boolean(form.allowHalfDay),
    minNoticeDays: num(form.minNoticeDays),
    maxDaysPerRequest: num(form.maxDaysPerRequest),
    backdatedDays: num(form.backdatedDays),
    sandwich: Boolean(form.sandwich),
    negativeDays: paid ? Number(form.negativeDays) || 0 : 0,
    encashable: paid && Boolean(form.encashable),
    maxEncashDays: paid && form.encashable ? num(form.maxEncashDays) : null,
    entitlements: paid ? (form.entitlements || []).map((e) => ({ employeeTypeId: e.employeeTypeId || null, minServiceMonths: monthsOf(e.years) || null, annualDays: Number(e.annualDays) || 0 })) : [],
    probationRule: paid ? form.probationRule || 'ACCRUE' : 'ACCRUE',
    approval: form.approval || null,
    autoApproveUpToDays: num(form.autoApproveUpToDays),
    handOnAfterDays: num(form.handOnAfterDays),
  };
}

export default function LeavePolicy() {
  const perms = usePermissions();
  const canCreate = can(perms, 'ATTENDANCE::Leave Types::CREATE');
  const canEdit = can(perms, 'ATTENDANCE::Leave Types::EDIT');
  const canDelete = can(perms, 'ATTENDANCE::Leave Types::DELETE');
  const req = useRequest(() => listLeaveTypes(), []);
  const empTypes = useRequest(() => listStructure('employee-types').catch(() => []), []);
  const period = useRequest(() => getLeaveSettings().catch(() => null), []);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  /* `seq` remounts the form when one drawer hands over to another (a new type made from a type in use). */
  const [editing, setEditing] = useState(null);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);

  const all = useMemo(() => req.data || [], [req.data]);
  const typeNames = useMemo(() => new Map((empTypes.data || []).map((t) => [t.id, t.name])), [empTypes.data]);
  const counts = { active: all.filter((t) => t.isActive).length, inactive: all.filter((t) => !t.isActive).length };
  const shown = all
    .filter((t) => (tab === 'active' ? t.isActive : !t.isActive))
    .filter((t) => !q || `${t.name} ${t.code || ''} ${t.description || ''}`.toLowerCase().includes(q.toLowerCase()));
  const missing = TEMPLATES.filter((x) => !all.some((t) => lower(t.name) === lower(x.name)));
  const start = (value) => setEditing((e) => ({ value, seq: (e?.seq || 0) + 1 }));
  const [startingFrom, setStartingFrom] = useState(false);

  /* A state's set, created as types the owner then edits; a name or code already in the list is left alone. */
  const startFrom = async (code) => {
    const set = STATE_SETS.find((s) => s.value === code);
    if (!set || startingFrom) return;
    const fresh = set.types.filter((x) => !all.some((t) => lower(t.name) === lower(x.name) || (x.code && lower(t.code || '') === lower(x.code))));
    const skipped = set.types.length - fresh.length;
    if (!fresh.length) { notify.error(`Every type in the ${set.label} set is already in the list.`); return; }
    const ok = await confirmDialog({
      title: `Start from ${set.label}?`,
      message: `Creates ${fresh.map((x) => (x.isPaid === false ? `${x.name} (unpaid)` : `${x.name}, ${x.annualDays} a year`)).join('; ')}.${skipped ? ` ${plural(skipped, 'type')} already in the list ${skipped === 1 ? 'is' : 'are'} left as ${skipped === 1 ? 'it is' : 'they are'}.` : ''} Starting points: edit them.`,
      confirmLabel: 'Create them',
      tone: 'default',
    });
    if (!ok) return;
    setStartingFrom(true);
    const failed = [];
    for (const x of fresh) {
      try { await createLeaveType(bodyOf({ ...BLANK, ...x })); } catch (err) { failed.push(`${x.name}: ${err?.message || 'not saved'}`); }
    }
    setStartingFrom(false);
    req.reload();
    if (failed.length) notify.error(`${plural(fresh.length - failed.length, 'type')} created. Not saved: ${failed.join('; ')}`);
    else notify.success(`${plural(fresh.length, 'type')} created from ${set.label}. Starting points: edit them.`);
  };

  const columns = [
    { key: 'name', label: 'Leave type', always: true, render: (t) => (
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(t) }} aria-hidden="true" />
        <span className="truncate font-medium">{t.name}</span>
        {t.isPrivate ? <span className="ui-pill ui-pill-neutral">Private</span> : null}
      </span>
    ) },
    { key: 'code', label: 'Code', render: (t) => t.code || '—' },
    { key: 'policy', label: 'Policy', render: (t) => <span className="whitespace-normal">{rulesOf(t, typeNames).join('; ')}</span> },
    { key: 'requests', label: 'Requests', align: 'right', render: (t) => <span className="tabular-nums">{t.requests || 0}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Policy"
        actions={canCreate ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => start({ ...BLANK })}><Plus size={16} aria-hidden="true" /> New leave type</button> : null}
      />
      {period.data?.current ? (
        <p className="text-sm">
          Leave period <span className="tabular-nums">{period.data.current.label}</span>
          <span className="ui-muted">, from {period.data.startDay} {MONTH_NAMES[period.data.startMonth - 1]}</span>
          {canEdit ? <button type="button" className="ui-link ml-3" onClick={() => setEditingPeriod(true)}>Change</button> : null}
        </p>
      ) : null}
      {canCreate && req.data && missing.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-caption">Usual types</span>
          {missing.map((x) => (
            <button key={x.name} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => start({ ...BLANK, ...x })}><Plus size={14} aria-hidden="true" /> {x.name}</button>
          ))}
          <div className="w-full sm:w-64 sm:ml-auto">
            <PopupSelect showValueSubtext={false} ariaLabel="Start from your state's rules" value="" placeholder="Start from your state's rules" disabled={startingFrom} onChange={(v) => v && startFrom(v)} options={STATE_SETS.map(({ value, label }) => ({ value, label }))} />
          </div>
        </div>
      ) : null}
      <div ref={tabsRef} role="tablist" aria-label="Leave types" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['active', 'In use', counts.active], ['inactive', 'Inactive', counts.inactive]].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
        ))}
        {tabIndicator}
      </div>
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Leave types"
          columns={columns}
          rows={shown}
          total={shown.length}
          page={1}
          pageSize={Math.max(25, shown.length)}
          loading={req.loading}
          refreshing={req.refreshing}
          noun="leave types"
          onRowClick={(t) => start(formOf(t))}
          card={(t) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{t.name}</span>{t.isPrivate ? <span className="ui-pill ui-pill-neutral">Private</span> : null}</span>
              <span className="block truncate ui-caption">{rulesOf(t, typeNames).join('; ')}</span>
            </span>
          )}
          empty={q
            ? <EmptyState kind="filtered" title="No leave types match" description="Nothing here matches the search." />
            : tab === 'inactive'
              ? <EmptyState title="No inactive leave types" description="A type nobody may ask for any more stays here, with its history." />
              : <EmptyState title="No leave types yet" description="Start from a usual type and change what differs." />}
          toolbar={<SearchField value={q} onSearch={setQ} placeholder="Search leave types" label="Search leave types" className="w-full sm:w-80" />}
        />
      )}
      {editing ? (
        <PolicyForm
          key={editing.seq}
          initial={editing.value}
          empTypes={empTypes.data || []}
          taken={all.filter((t) => t.id !== editing.value.id).map((t) => t.name)}
          suggested={missing.map((x) => x.name)}
          canSave={editing.value.id ? canEdit : canCreate}
          canCreate={canCreate}
          canDelete={canDelete}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); req.reload(); }}
          onFork={(value) => start(value)}
        />
      ) : null}
      {editingPeriod ? <PeriodForm initial={period.data} onClose={() => setEditingPeriod(false)} onSaved={() => { setEditingPeriod(false); period.reload(); }} /> : null}
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="sm:col-span-2 ui-form-grid border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} aria-label={title}>
      <div className="sm:col-span-2">
        <h3 className="ui-t-sec">{title}</h3>
        {note ? <p className="ui-caption">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange, placeholder, hint, step = 1 }) {
  return (
    <div>
      <label className="block">
        <span className="ui-label">{label}</span>
        <input type="number" min={0} max={3650} step={step} className="ui-input w-full tabular-nums" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </label>
      {hint ? <span className="ui-caption">{hint}</span> : null}
    </div>
  );
}

function Check({ label, hint, checked, onChange, disabled }) {
  return (
    <label className="flex items-start gap-2 text-sm sm:col-span-2">
      <input type="checkbox" className="ui-checkbox mt-0.5" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint ? <span className="ui-caption block">{hint}</span> : null}</span>
    </label>
  );
}

function PolicyForm({ initial, empTypes, taken, suggested, canSave, canCreate, canDelete, onClose, onSaved, onFork }) {
  const start = useMemo(() => formOf(initial), [initial]);
  const [form, setForm] = useState(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => { setError(null); setForm((f) => ({ ...f, [k]: v })); };
  const paid = Boolean(form.isPaid);
  /* A usual type, or a new type made from one in use, is unsaved work before it is touched; a blank form is not. */
  const dirty = (!form.id && Boolean(start.name)) || JSON.stringify(form) !== JSON.stringify(start);
  const body = bodyOf(form);
  const nameTaken = taken.some((n) => lower(n) === lower(form.name));
  /* A type in use keeps its history exact: a change to what it gives is refused, and a new type carries the change instead. */
  const forkable = Boolean(form.id && canCreate && error?.code === 'LEAVE_POLICY_IN_USE');
  const setRule = (i, patch) => set('entitlements')(form.entitlements.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  /* A rule says who: an employee type, a length of service, or both; and how many days. */
  const ruleProblem = paid && form.entitlements.some((e) => !e.employeeTypeId && !(Number(e.years) > 0))
    ? 'Each rule names an employee type, years of service, or both.'
    : paid && form.entitlements.some((e) => e.annualDays === '' || Number(e.annualDays) < 0) ? 'Each rule says how many days a year.' : null;

  const save = async (e) => {
    e?.preventDefault();
    if (saving || !canSave) return;
    if (!body.name) { setError({ message: 'Name the leave type.' }); return; }
    if (nameTaken) { setError({ message: `${body.name} is already in the list.` }); return; }
    if (ruleProblem) return;
    setSaving(true);
    setError(null);
    try {
      if (form.id) await updateLeaveType(form.id, body);
      else await createLeaveType(body);
      notify.success(`${body.name} saved.`);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  /* The edited values, as a type of its own; the old one keeps its balances and requests. */
  const fork = () => {
    /* The code is left blank: one code per type, and this one is still on the old type. */
    const copy = { ...form, name: `${form.name.trim().slice(0, 54)} (new)`, code: '', isActive: true };
    for (const k of ['id', 'requests', 'createdAt', 'updatedAt', 'createdByUserId', 'accountId', 'orgId']) delete copy[k];
    onFork(copy);
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${start.name}?`, message: 'Only a type nobody has used can be deleted; a used one can be made inactive.', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await deleteLeaveType(form.id);
      notify.success(`${start.name} deleted.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  const toggleType = (typeId) => set('employeeTypeIds')(form.employeeTypeIds.includes(typeId) ? form.employeeTypeIds.filter((x) => x !== typeId) : [...form.employeeTypeIds, typeId]);

  return (
    <Drawer
      widthClass="w-[min(36rem,96vw)] ui-drawer-sheet"
      open
      dirty={canSave && dirty}
      onClose={onClose}
      title={form.id ? start.name : 'New leave type'}
      footer={canSave ? (
        <>
          {form.id && canDelete && !Number(form.requests) ? <button type="button" className="ui-btn ui-btn-secondary mr-auto" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leave-policy" className="ui-btn ui-btn-primary" disabled={saving || !body.name || !dirty || Boolean(ruleProblem)}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      ) : null}
    >
      <form id="leave-policy" onSubmit={save}>
        <fieldset disabled={!canSave} className="ui-form-grid">
          {error ? (
            <div className="sm:col-span-2 space-y-2">
              <ErrorState error={error?.status ? error : null} compact title={forkable ? 'This type is in use' : error?.status === 409 ? 'Not saved' : error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} />
              {forkable ? <button type="button" className="ui-btn ui-btn-primary" onClick={fork}><Plus size={16} aria-hidden="true" /> Make a new type from this</button> : null}
            </div>
          ) : null}
          <label className="block">
            <span className="ui-label">Name *</span>
            <SuggestInput required maxLength={60} value={form.name} onChange={set('name')} suggestions={form.id ? [] : suggested} aria-invalid={nameTaken || undefined} />
            {nameTaken ? <span className="ui-caption ui-text-neg">Already in the list.</span> : null}
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="block"><span className="ui-label">Code</span><input className="ui-input w-full" maxLength={10} value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="e.g. CL" /></label>
            <label className="block"><span className="ui-label">Colour</span><input type="color" className="ui-input h-9 w-14 p-1" value={form.color || colorOf(form)} onChange={(e) => set('color')(e.target.value)} aria-label="Colour on the leave calendar" /></label>
          </div>
          <label className="block sm:col-span-2"><span className="ui-label">What it is for</span><input className="ui-input w-full" maxLength={300} value={form.description} onChange={(e) => set('description')(e.target.value)} placeholder="Shown to employees when they choose it" /></label>
          <Check label="Paid leave" hint={paid ? null : 'Each day is loss of pay in payroll.'} checked={paid} onChange={set('isPaid')} />
          <Check label="Private" hint={`The reason is optional and only HR reads it; colleagues and the calendar see “${PRIVATE_LABEL}”.`} checked={form.isPrivate} onChange={set('isPrivate')} />

          {paid ? (
            <Section title="What it gives">
              <NumberField label="Days a year" value={form.annualDays} onChange={set('annualDays')} step={0.5} />
              <div><PopupSelect showValueSubtext={false} label="Credited" value={form.accrual || 'YEARLY'} onChange={(v) => set('accrual')(v || 'YEARLY')} options={Object.entries(ACCRUAL_LABEL).map(([value, label]) => ({ value, label }))} /></div>
              <div><PopupSelect showValueSubtext={false} label="On" value={form.creditOn || 'START'} onChange={(v) => set('creditOn')(v || 'START')} options={CREDIT_ON} /></div>
              {form.creditOn === 'DAY' ? <NumberField label="Day of the month (1–28)" value={form.creditDay} onChange={set('creditDay')} placeholder="e.g. 10" /> : <div />}
              <p className="ui-caption sm:col-span-2">Credits {creditText({ ...form, creditDay: Number(form.creditDay) || null })}, from the start of the leave period, by themselves.</p>
              <Check label="Joiners get only the part of the year they work" hint="A month counts when joined by its 15th. Monthly leave always starts from joining." checked={form.prorateForJoiners || form.accrual === 'MONTHLY'} disabled={form.accrual === 'MONTHLY'} onChange={set('prorateForJoiners')} />
            </Section>
          ) : null}

          {paid ? (
            <Section title="Who gets how much">
              <div className="sm:col-span-2 space-y-3">
                <p className="text-sm">Everyone else: <span className="tabular-nums">{Number(form.annualDays) || 0}</span> a year.</p>
                {form.entitlements.map((e, i) => (
                  <div key={i} className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-end gap-2" role="group" aria-label={`Rule ${i + 1}`}>
                    <div>
                      <PopupSelect showValueSubtext={false} label="Employee type" value={e.employeeTypeId} placeholder="Any type" onChange={(v) => setRule(i, { employeeTypeId: v || '' })} options={[{ value: '', label: 'Any type' }, ...empTypes.map((t) => ({ value: t.id, label: t.name }))]} />
                    </div>
                    <label className="block">
                      <span className="ui-label">After, years</span>
                      <input type="number" min={0} max={50} step={0.5} className="ui-input w-full tabular-nums" value={e.years} onChange={(ev) => setRule(i, { years: ev.target.value })} />
                    </label>
                    <label className="block">
                      <span className="ui-label">Days a year</span>
                      <input type="number" min={0} max={366} step={0.5} className="ui-input w-full tabular-nums" value={e.annualDays} onChange={(ev) => setRule(i, { annualDays: ev.target.value })} />
                    </label>
                    <button type="button" className="ui-icon-btn" aria-label={`Remove rule ${i + 1}`} onClick={() => set('entitlements')(form.entitlements.filter((_, j) => j !== i))}><X size={16} aria-hidden="true" /></button>
                  </div>
                ))}
                {ruleProblem ? <p className="ui-caption ui-text-neg" role="alert">{ruleProblem}</p> : null}
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={form.entitlements.length >= 20} onClick={() => set('entitlements')([...form.entitlements, { ...BLANK_RULE }])}><Plus size={14} aria-hidden="true" /> Add a rule</button>
              </div>
            </Section>
          ) : null}

          {paid ? (
            <Section title="Probation">
              <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="During probation" value={form.probationRule || 'ACCRUE'} onChange={(v) => set('probationRule')(v || 'ACCRUE')} options={PROBATION} /></div>
            </Section>
          ) : null}

          <Section title="Who it is for">
            <div><PopupSelect showValueSubtext={false} label="Gender" value={form.gender} onChange={(v) => set('gender')(v || '')} options={GENDERS} /></div>
            <NumberField label="Usable after joining, days" value={form.availableAfterDays} onChange={set('availableAfterDays')} placeholder="From the first day" />
            {empTypes.length ? (
              <fieldset className="sm:col-span-2">
                <legend className="ui-label">Employee types</legend>
                <div className="flex flex-wrap gap-1.5">
                  {empTypes.map((t) => (
                    <button key={t.id} type="button" className="ui-choice-chip" aria-pressed={form.employeeTypeIds.includes(t.id)} onClick={() => toggleType(t.id)}>{t.name}</button>
                  ))}
                </div>
                {!form.employeeTypeIds.length ? <span className="ui-caption">None chosen: every type.</span> : null}
              </fieldset>
            ) : null}
          </Section>

          <Section title="How it is asked for" note="Notice and lateness apply to people asking for themselves; HR can always enter leave.">
            <NumberField label="Notice, days ahead" value={form.minNoticeDays} onChange={set('minNoticeDays')} placeholder="Any time" />
            <NumberField label="Longest request, days" value={form.maxDaysPerRequest} onChange={set('maxDaysPerRequest')} placeholder="No limit" step={0.5} />
            <NumberField label="Asked for after the day, up to" value={form.backdatedDays} onChange={set('backdatedDays')} placeholder="No limit" hint="0: only before the day." />
            <div />
            <Check label="Half days allowed" checked={form.allowHalfDay} onChange={set('allowHalfDay')} />
            <Check label="Sandwich rule" hint="Weekly offs and holidays between two leave days count as leave. Friday and Monday off makes four days." checked={form.sandwich} onChange={set('sandwich')} />
          </Section>

          <Section title="Who approves">
            <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Decided by" value={form.approval || 'company'} onChange={(v) => set('approval')(v === 'company' ? '' : v || '')} options={APPROVAL} /></div>
            <NumberField label="Approved on its own up to, days" value={form.autoApproveUpToDays} onChange={set('autoApproveUpToDays')} placeholder="Never" step={0.5} hint="A person's own request, when the balance covers it." />
            <NumberField label="Handed on to HR after, days waiting" value={form.handOnAfterDays} onChange={set('handOnAfterDays')} placeholder="Never" />
          </Section>

          {paid ? (
            <Section title="What happens to the balance">
              <NumberField label="Carry into next year, up to" value={form.carryForwardMax} onChange={set('carryForwardMax')} placeholder="Nothing: unused days lapse" step={0.5} />
              <NumberField label="Days allowed in advance" value={form.negativeDays} onChange={set('negativeDays')} hint="The balance may go this far below zero." step={0.5} />
              <Check label="Unused days can be paid out (encashment)" checked={form.encashable} onChange={set('encashable')} />
              {form.encashable ? <NumberField label="Paid out at most, days a year" value={form.maxEncashDays} onChange={set('maxEncashDays')} placeholder="No limit" step={0.5} /> : null}
            </Section>
          ) : null}

          <Check label="Active: people can ask for it" checked={form.isActive} onChange={set('isActive')} />
        </fieldset>
        <TryOnPeople body={body} />
      </form>
    </Drawer>
  );
}

/**
 * The type as it stands in the form, tried on five real people this period
 * (TLA-015): what each gets, what is credited so far, and the next credit.
 * Asked for 400ms after the last change; the last answer stays while the
 * next one comes, so the table does not blink on every keystroke.
 */
function TryOnPeople({ body }) {
  /* The name does not change what anyone gets; leaving it out spares a request per letter typed. */
  const ask = JSON.stringify({ ...body, name: 'Preview', code: null, description: null, color: null });
  const [state, setState] = useState({ ask: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      previewLeaveType(JSON.parse(ask))
        .then((data) => { if (live) setState({ ask, data, error: null }); })
        .catch((error) => { if (live) setState((s) => ({ ask, data: s.data, error })); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [ask]);
  const busy = state.ask !== ask;
  const data = state.data;
  const today = todayIst();
  const day = (d) => (d ? formatDate(String(d).slice(0, 10)) : '');

  return (
    <section className="ui-form-grid border-t pt-4 mt-4" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Try on five people" aria-busy={busy || undefined}>
      <div className="sm:col-span-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="ui-t-sec">Try on five people</h3>
        {data?.period?.label ? <span className="ui-caption tabular-nums">{data.period.label}</span> : null}
      </div>
      <div className="sm:col-span-2" aria-live="polite">
        {state.error && !busy ? <p className="ui-caption ui-text-neg">{String(state.error?.message || 'Could not try it.')}</p> : null}
        {!data ? (
          state.error ? null : <p className="ui-caption">Trying it…</p>
        ) : !data.rows?.length ? (
          <p className="ui-caption">Nobody to try it on yet.</p>
        ) : (
          <div className="ui-table-scroll">
            <table className="ui-table w-full" style={{ opacity: busy ? 0.6 : 1, transition: 'opacity var(--dur-state) ease' }}>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col" className="ui-num">A year</th>
                  <th scope="col" className="ui-num">This period</th>
                  <th scope="col" className="ui-num">So far</th>
                  <th scope="col">Next credit</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const next = (r.credits || []).find((c) => c.date > today);
                  return (
                    <tr key={r.employeeId || r.name}>
                      <td>
                        <span className="block font-medium">{r.name}</span>
                        <span className="block ui-caption">{[r.why, r.dateOfJoining ? `joined ${day(r.dateOfJoining)}` : null].filter(Boolean).join(' · ')}</span>
                        {r.open && r.note ? <span className="block ui-caption ui-text-warn whitespace-normal">{r.note}</span> : null}
                      </td>
                      {!r.open ? (
                        <td colSpan={4} className="ui-caption whitespace-normal">{r.note || 'Not open to them.'}</td>
                      ) : r.fullPeriod == null ? (
                        <td colSpan={4} className="ui-caption">Can ask for it</td>
                      ) : (
                        <>
                          <td className="ui-num tabular-nums">{r.entitled ?? body.annualDays}</td>
                          <td className="ui-num tabular-nums">{r.fullPeriod}</td>
                          <td className="ui-num tabular-nums">{r.soFar ?? 0}</td>
                          <td className="tabular-nums whitespace-nowrap">{next ? `${next.days} on ${day(next.date)}` : '—'}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function PeriodForm({ initial, onClose, onSaved }) {
  const start = useMemo(() => ({ startMonth: initial?.startMonth || 1, startDay: initial?.startDay || 1 }), [initial]);
  const [form, setForm] = useState(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = form.startMonth !== start.startMonth || form.startDay !== start.startDay;
  const save = async (e) => {
    e.preventDefault();
    if (!dirty || saving) return;
    const ok = await confirmDialog({
      title: 'Change the leave period?',
      message: 'Balances, carry-forward and the register are worked out again for the new period. Balances set or changed by hand stay with the period they were given for.',
      confirmLabel: 'Change it',
      tone: 'default',
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const out = await saveLeaveSettings(form);
      notify.success(`Leave period: ${out.current.label}.`);
      onSaved(out);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      widthClass="w-[min(36rem,96vw)] ui-drawer-sheet"
      title="Leave period"
      footer={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leave-period" className="ui-btn ui-btn-primary" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="leave-period" onSubmit={save} className="ui-form-grid">
        {error ? <div className="sm:col-span-2"><ErrorState error={error} compact /></div> : null}
        <label className="block">
          <span className="ui-label">Starts on day</span>
          <input type="number" min={1} max={28} className="ui-input w-full tabular-nums" value={form.startDay} onChange={(e) => setForm({ ...form, startDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} />
        </label>
        <div><PopupSelect showValueSubtext={false} label="Of" value={String(form.startMonth)} onChange={(v) => setForm({ ...form, startMonth: Number(v) || 1 })} options={MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
      </form>
    </Drawer>
  );
}
