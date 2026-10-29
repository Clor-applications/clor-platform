import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import {
  addPolicyVersion, createPolicy, getNoticeLanguages, getPolicy, listPolicies, saveNoticeLanguages, policyAcknowledgements, policyConflicts, policyScope,
  remindPolicyVersion, retirePolicyVersion, structureList, submitPolicyVersion, updatePolicy, updatePolicyVersion,
} from '../api/policies';
import { STATE_NAMES } from '../workforce/suggestions';

/**
 * Policies (POL-01..06): the library with an owner per policy; versions with
 * effective dates and who they apply to; publishing through the approval
 * rule; who has accepted and a reminder for who has not. Nothing is ever
 * overwritten: an earlier version stays readable with its dates closed off.
 * Laid out as every Workforce list: header, attention line, search and
 * filter, the shared table, drawers for forms.
 */

const STATUS = { DRAFT: ['Draft', 'ui-pill-neutral'], WAITING: ['Waiting for approval', 'ui-pill-warn'], PUBLISHED: ['Published', 'ui-pill-pos'], RETIRED: ['Retired', 'ui-pill-neutral'] };
const SCOPE_KEYS = [
  ['establishmentIds', 'Work site', 'establishments'],
  ['departmentIds', 'Department', 'departments'],
  ['employeeTypeIds', 'Employment type', 'employee-types'],
  ['gradeIds', 'Grade', 'grades'],
  ['workTypeIds', 'Work mode', 'work-types'],
];
const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function Policies({ openScreen, params }) {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  /* A link from an employee's record opens that policy (FEATURE-UI-AUDIT gap 22). */
  const [open, setOpen] = useState(() => params?.id || null);
  const [creating, setCreating] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const req = useRequest(() => listPolicies(q, category === 'all' ? '' : category), [q, category]);
  const conflicts = useRequest(() => policyConflicts().catch(() => []), []);
  const data = req.data;
  const reload = () => { req.reload(); conflicts.reload(); };

  const columns = [
    { key: 'title', label: 'Policy', always: true, render: (p) => <span className="font-medium">{p.title}</span> },
    { key: 'kind', label: 'Kind', render: (p) => <span>{p.categoryLabel}{p.purposeLabel ? <span className="ui-caption block">{p.purposeLabel}</span> : null}</span> },
    { key: 'owner', label: 'Owner', render: (p) => p.ownerName || '—' },
    { key: 'force', label: 'In force', render: (p) => (p.current ? <span className="tabular-nums whitespace-nowrap">v{p.current.version} from {day(p.current.effectiveFrom)}</span> : '—') },
    { key: 'latest', label: 'Latest', render: (p) => (p.latest ? <span className={`ui-pill ${STATUS[p.latest.status]?.[1] || ''}`}>v{p.latest.version} · {STATUS[p.latest.status]?.[0] || p.latest.status}</span> : <span className="ui-muted">No version</span>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Policies' }]}
        title="Policies"
        actions={<>
          {allowed('PEOPLE::Policies::EDIT') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setLanguagesOpen(true)}>Notice languages{data?.languages?.length ? ` (${data.languages.length})` : ''}</button> : null}
          {allowed('PEOPLE::Policies::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New policy</button> : null}
        </>}
      />
      {conflicts.data?.length ? (
        <ul className="ui-attention" aria-label="Needs attention">
          {conflicts.data.map((c) => (
            <li key={`${c.a.id}-${c.b.id}`}>
              <span className="ui-attention-dot is-warn" aria-hidden="true" />
              <span>{c.a.title} and {c.b.title} both reach <span className="tabular-nums">{c.people}</span> {c.people === 1 ? 'person' : 'people'} today. Narrow who each applies to, or retire one.</span>
            </li>
          ))}
        </ul>
      ) : null}
      {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Policies"
          columns={columns}
          rows={data?.policies || []}
          loading={req.loading}
          refreshing={req.refreshing}
          total={data?.policies?.length || 0}
          pageSize={Math.max(25, data?.policies?.length || 0)}
          noun="policies"
          onRowClick={(p) => setOpen(p.id)}
          card={(p) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{p.title}</span>{p.latest ? <span className={`ui-pill ${STATUS[p.latest.status]?.[1] || ''}`}>v{p.latest.version}</span> : null}</span>
              <span className="block truncate ui-caption">{[p.categoryLabel, p.current ? `in force from ${day(p.current.effectiveFrom)}` : 'nothing in force'].join(' · ')}</span>
            </span>
          )}
          empty={q || category !== 'all'
            ? <EmptyState kind="filtered" title="No policies match" description="Nothing here matches the search." />
            : <EmptyState title="No policies yet" description="Start with the ones people ask about: leave, working hours, conduct." />}
          toolbar={<>
            <SearchField value={q} onSearch={setQ} placeholder="Search policies" label="Search policies" className="w-full sm:w-80" />
            <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Kind" value={category} onChange={(v) => setCategory(v || 'all')} options={[{ value: 'all', label: 'All kinds' }, ...(data?.categories || []).map((c) => ({ value: c.key, label: c.label }))]} /></div>
          </>}
        />
      )}
      {creating ? <PolicyForm taken={(data?.policies || []).map((p) => p.title)} categories={data?.categories || []} purposes={data?.purposes || []} onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); reload(); setOpen(p.id); }} /> : null}
      {languagesOpen ? <NoticeLanguages onClose={() => setLanguagesOpen(false)} onSaved={() => { setLanguagesOpen(false); reload(); }} /> : null}
      {open ? <PolicyDetail id={open} categories={data?.categories || []} purposes={data?.purposes || []} languages={data?.languages || []} allowed={allowed} openScreen={openScreen} onClose={() => setOpen(null)} onChanged={reload} /> : null}
    </div>
  );
}

/* The policies most Indian companies keep; offered when adding one the company does not have yet. */
const COMMON_POLICIES = ['Leave policy', 'Attendance and working hours', 'Code of conduct', 'Prevention of sexual harassment (POSH)', 'Travel and expenses', 'Work from home', 'IT and device use', 'Holiday list', 'Notice period and exit', 'Probation and confirmation', 'Overtime', 'Grievance redressal'];

function PolicyForm({ policy, taken = [], categories, purposes = [], onClose, onSaved }) {
  const initial = useMemo(() => ({ title: policy?.title || '', category: policy?.category || 'OTHER', purpose: policy?.purpose || '', description: policy?.description || '' }), [policy]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  /* Enter in a text field submits the form; pressed twice it lands before
     the disabled button re-renders, so a ref (not state) stops the second save. */
  const inFlight = useRef(false);
  const save = async () => {
    if (inFlight.current) return;
    if (!form.title.trim()) { setError({ message: 'Give it a title.' }); return; }
    if (form.category === 'PRIVACY' && !form.purpose) { setError({ message: 'Choose what the notice covers.' }); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const r = policy ? await updatePolicy(policy.id, { ...form, title: form.title.trim() }) : await createPolicy({ ...form, title: form.title.trim() });
      notify.success(`${r.policy.title} saved.`);
      onSaved(r.policy);
    } catch (err) { setError(err); } finally { inFlight.current = false; setSaving(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={policy ? `Edit ${policy.title}` : 'New policy'} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">Title *</span><SuggestInput maxLength={160} value={form.title} onChange={(v) => setForm({ ...form, title: v })} suggestions={policy ? [] : COMMON_POLICIES.filter((t) => !taken.some((x) => String(x).trim().toLowerCase() === t.toLowerCase()))} autoFocus /></label>
        <div><PopupSelect showValueSubtext={false} label="Kind" value={form.category} onChange={(v) => setForm({ ...form, category: v || 'OTHER' })} options={categories.map((c) => ({ value: c.key, label: c.label }))} /></div>
        {form.category === 'PRIVACY' ? (
          <div><PopupSelect showValueSubtext={false} label="Notice covers *" value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v || '' })} placeholder="Choose…" options={purposes.map((x) => ({ value: x.key, label: x.label }))} /></div>
        ) : null}
        <label className="block sm:col-span-2"><span className="ui-label">What it covers</span><textarea className="ui-input w-full" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

function PolicyDetail({ id, categories, purposes = [], languages = [], allowed, onClose, onChanged }) {
  const req = useRequest(() => getPolicy(id), [id]);
  const policy = req.data;
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState(null);
  const [report, setReport] = useState({});
  const canEdit = allowed('PEOPLE::Policies::EDIT');
  const act = async (fn, okText) => {
    try {
      const r = await fn();
      notify.success(typeof okText === 'function' ? okText(r) : okText);
      req.reload();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    }
  };
  const showReport = async (v) => {
    if (report[v.id]) return setReport((r) => ({ ...r, [v.id]: null }));
    try {
      const rep = await policyAcknowledgements(id, v.version);
      setReport((r) => ({ ...r, [v.id]: rep }));
    } catch (err) {
      notify.error(String(err?.message || 'Could not load.'));
    }
  };
  return (
    <Drawer open onClose={onClose} title={policy?.title || 'Policy'} widthClass="w-[min(44rem,96vw)] ui-drawer-sheet"
      footer={canEdit && policy ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing(true)}>Edit</button><button type="button" className="ui-btn ui-btn-primary" onClick={() => setNewVersion({})}>New version</button></> : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !policy ? <SkeletonCard lines={5} /> : (
        <div className="space-y-4">
          <p className="ui-caption">{[policy.categoryLabel, `owner ${policy.ownerName}`, policy.currentVersion ? `v${policy.currentVersion} in force` : 'nothing in force yet'].join(' · ')}</p>
          {policy.description ? <p className="text-sm">{policy.description}</p> : null}
          {!policy.versions.length ? <EmptyState title="No version yet" description="A version says what the policy is, from when, and for whom." /> : (
            <ul className="ui-history-list" aria-label="Versions">
              {policy.versions.map((v) => (
                <li key={v.id} className="ui-history-row space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">Version {v.version}</span>
                    <span className={`ui-pill ${STATUS[v.status]?.[1] || ''}`}>{STATUS[v.status]?.[0] || v.status}</span>
                    {v.inForce ? <span className="ui-pill ui-pill-info">In force today</span> : null}
                    <span className="ml-auto flex gap-3">
                      {v.status === 'DRAFT' && canEdit ? <button type="button" className="ui-link text-sm" onClick={() => setNewVersion(v)}>Edit draft</button> : null}
                      {v.status === 'DRAFT' && canEdit ? <button type="button" className="ui-link text-sm" onClick={() => act(() => submitPolicyVersion(id, v.version), (r) => (r.request ? 'Sent for approval.' : `Version ${v.version} is published.`))}>Publish</button> : null}
                      {v.status === 'PUBLISHED' && canEdit ? <button type="button" className="ui-link text-sm" onClick={async () => { if (await confirmDialog({ title: `Retire version ${v.version}?`, message: 'It stops applying from today and stays readable.', confirmLabel: 'Retire' })) act(() => retirePolicyVersion(id, v.version), 'Retired.'); }}>Retire</button> : null}
                      {v.needsAcceptance && (v.status === 'PUBLISHED' || v.status === 'RETIRED') ? <button type="button" className="ui-link text-sm tabular-nums" onClick={() => showReport(v)}>{v.accepted} of {v.asked} accepted</button> : null}
                    </span>
                  </div>
                  <p className="ui-caption"><span className="tabular-nums">From {day(v.effectiveFrom)}{v.effectiveTo ? ` to ${day(v.effectiveTo)}` : ''}</span> · {scopeWords(v.appliesTo)}{v.needsAcceptance ? ' · needs acceptance' : ''}</p>
                  {v.body ? <details><summary className="ui-caption cursor-pointer">Read</summary><pre className="whitespace-pre-wrap text-sm mt-1 font-sans">{v.body}</pre></details> : <p className="ui-caption">A document on file.</p>}
                  {report[v.id] ? (
                    <div className="text-sm space-y-1 border-t pt-2">
                      <p className="tabular-nums">{report[v.id].accepted} accepted, {report[v.id].pending} pending.</p>
                      {report[v.id].pendingList.length ? <p className="ui-caption">Pending: {report[v.id].pendingList.map((x) => `${x.name}${x.remindCount ? ` (reminded ${x.remindCount}×)` : ''}`).join(', ')}</p> : null}
                      {report[v.id].pending && canEdit ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => act(() => remindPolicyVersion(id, v.version), (r) => `${r.reminded} reminded.`)}>Remind everyone pending</button> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && policy ? <PolicyForm policy={policy} categories={categories} purposes={purposes} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); req.reload(); onChanged(); }} /> : null}
      {newVersion && policy ? <VersionForm policyId={id} privacy={policy.category === 'PRIVACY'} languages={languages} version={newVersion.id ? newVersion : null} onClose={() => setNewVersion(null)} onSaved={() => { setNewVersion(null); req.reload(); onChanged(); }} /> : null}
    </Drawer>
  );
}

const scopeWords = (a) => {
  const n = (list, one, many) => (list?.length ? `${list.length} ${list.length === 1 ? one : many}` : null);
  const parts = [n(a?.establishmentIds, 'work site', 'work sites'), a?.states?.length ? a.states.join(', ') : null, n(a?.departmentIds, 'department', 'departments'), n(a?.employeeTypeIds, 'employment type', 'employment types'), n(a?.gradeIds, 'grade', 'grades'), n(a?.workTypeIds, 'work mode', 'work modes')].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'everyone';
};

function VersionForm({ policyId, privacy = false, languages = [], version, onClose, onSaved }) {
  const initial = useMemo(() => ({ translations: { ...(version?.translations || {}) }, body: version?.body || '', effectiveFrom: version?.effectiveFrom || todayIst(), effectiveTo: version?.effectiveTo || '', needsAcceptance: version?.needsAcceptance || false, appliesTo: { ...(version?.appliesTo || {}) } }), [version]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const lists = useRequest(async () => Object.fromEntries(await Promise.all(SCOPE_KEYS.map(async ([k, , kind]) => [k, (await structureList(kind).catch(() => [])).filter((x) => x.isActive !== false)]))), []);
  const [scope, setScope] = useState(null);
  useEffect(() => {
    let live = true;
    policyScope(form.appliesTo).then((s) => { if (live) setScope(s); }).catch(() => { if (live) setScope(null); });
    return () => { live = false; };
  }, [form.appliesTo]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const toggle = (key, id) => setForm((f) => {
    const cur = f.appliesTo[key] || [];
    return { ...f, appliesTo: { ...f.appliesTo, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } };
  });
  const states = form.appliesTo.states || [];
  const save = async () => {
    if (!form.body.trim()) { setError({ message: 'Write the policy.' }); return; }
    if (!form.effectiveFrom) { setError({ message: 'Choose when it applies from.' }); return; }
    if (form.effectiveTo && form.effectiveTo < form.effectiveFrom) { setError({ message: 'The end date is before the start.' }); return; }
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, translations: privacy ? form.translations : undefined, effectiveTo: form.effectiveTo || null, appliesTo: { ...form.appliesTo, states } };
      const r = version ? await updatePolicyVersion(policyId, version.version, body) : await addPolicyVersion(policyId, body);
      notify.success(`Version ${r.version.version} saved as a draft. Publish it when it is ready.`);
      onSaved();
    } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <Drawer open onClose={onClose} title={version ? `Edit draft version ${version.version}` : 'New version'} widthClass="w-[min(40rem,96vw)] ui-drawer-sheet" dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save draft'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">The policy *</span><textarea className="ui-input w-full" rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        <div><label className="ui-label" htmlFor="pv-from">Applies from *</label><DatePicker id="pv-from" value={form.effectiveFrom} onChange={(v) => setForm({ ...form, effectiveFrom: v || '' })} /></div>
        <div><label className="ui-label" htmlFor="pv-to">Until</label><DatePicker id="pv-to" value={form.effectiveTo} min={form.effectiveFrom} onChange={(v) => setForm({ ...form, effectiveTo: v || '' })} /></div>
        {privacy ? languages.map((l) => (
          <label key={l.key} className="block sm:col-span-2"><span className="ui-label">In {l.label}</span><textarea className="ui-input w-full" rows={6} lang={l.key} value={form.translations[l.key] || ''} onChange={(e) => setForm({ ...form, translations: { ...form.translations, [l.key]: e.target.value } })} /></label>
        )) : <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.needsAcceptance} onChange={(e) => setForm({ ...form, needsAcceptance: e.target.checked })} />Everyone it applies to must read and accept it</label>}
        <fieldset className="sm:col-span-2 grid gap-3 border-t pt-3">
          <legend className="ui-label">Who it applies to</legend>
          <div>
            <PopupSelect showValueSubtext={false} label="States" value="" placeholder={states.length ? 'Add another state…' : 'Every state'} alwaysSearch onChange={(v) => { if (v && !states.includes(v)) setForm({ ...form, appliesTo: { ...form.appliesTo, states: [...states, v] } }); }} options={STATE_NAMES.filter((s) => !states.includes(s)).map((s) => ({ value: s, label: s }))} />
            {states.length ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {states.map((s) => <span key={s} className="ui-pill ui-pill-info inline-flex items-center gap-1">{s}<button type="button" className="ui-icon-btn !h-4 !w-4" aria-label={`Remove ${s}`} onClick={() => setForm({ ...form, appliesTo: { ...form.appliesTo, states: states.filter((x) => x !== s) } })}><X size={12} aria-hidden="true" /></button></span>)}
              </div>
            ) : null}
          </div>
          {SCOPE_KEYS.map(([key, label]) => (lists.data?.[key]?.length ? (
            <div key={key}>
              <span className="ui-label">{label}</span>
              <div className="flex flex-wrap gap-1.5">
                {lists.data[key].map((item) => {
                  const on = (form.appliesTo[key] || []).includes(item.id);
                  return <button key={item.id} type="button" aria-pressed={on} className="ui-choice-chip" onClick={() => toggle(key, item.id)}>{item.name}{item.state ? ` (${item.state})` : ''}</button>;
                })}
              </div>
            </div>
          ) : null))}
          <p className="text-sm" aria-live="polite">{scope ? <>Reaches <span className="tabular-nums">{scope.count}</span> {scope.count === 1 ? 'person' : 'people'}{scope.sample.length ? `: ${scope.sample.map((p) => p.name).join(', ')}${scope.count > scope.sample.length ? '…' : ''}` : ''}</> : <span className="ui-muted">Working out who it reaches…</span>}</p>
        </fieldset>
      </form>
    </Drawer>
  );
}

/** The languages privacy notices are offered in besides English (PRV-01). */
function NoticeLanguages({ onClose, onSaved }) {
  const req = useRequest(() => getNoticeLanguages(), []);
  const [picked, setPicked] = useState(null);
  const chosen = picked ?? req.data?.enabled ?? [];
  const [error, setError] = useState(null);
  const save = async () => {
    setError(null);
    try {
      await saveNoticeLanguages(chosen);
      notify.success(chosen.length ? `Notices offered in English and ${chosen.length} more.` : 'Notices in English only.');
      onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title="Notice languages" dirty={picked !== null}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={!req.data || picked === null}>Save</button></>}>
      {error ? <ErrorState error={error} compact /> : null}
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !req.data ? <SkeletonCard lines={4} /> : (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="ui-choice-chip" aria-pressed="true" disabled aria-label="English, always offered">English</button>
          {req.data.offered.map((l) => {
            const on = chosen.includes(l.key);
            return <button key={l.key} type="button" aria-pressed={on} className="ui-choice-chip" onClick={() => setPicked(on ? chosen.filter((x) => x !== l.key) : [...chosen, l.key])}>{l.label}</button>;
          })}
        </div>
      )}
    </Drawer>
  );
}
