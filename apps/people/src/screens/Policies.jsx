import React, { useCallback, useEffect, useState } from 'react';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { Plus } from 'lucide-react';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import {
  addPolicyVersion, createPolicy, getNoticeLanguages, getPolicy, listPolicies, saveNoticeLanguages, policyAcknowledgements, policyConflicts, policyScope,
  remindPolicyVersion, retirePolicyVersion, structureList, submitPolicyVersion, updatePolicy, updatePolicyVersion,
} from '../api/policies';

/**
 * Policies (POL-01..06): the library with an owner per policy; versions with
 * effective dates and who they apply to; publishing through the approval
 * rule; who has accepted and a reminder for who has not. Nothing is ever
 * overwritten: an earlier version stays readable with its dates closed off.
 */

const STATUS = { DRAFT: ['Draft', 'ui-pill-neutral'], WAITING: ['Waiting for approval', 'ui-pill-warn'], PUBLISHED: ['Published', 'ui-pill-pos'], RETIRED: ['Retired', 'ui-pill-neutral'] };
const SCOPE_KEYS = [
  ['establishmentIds', 'Establishment', 'establishments'],
  ['departmentIds', 'Department', 'departments'],
  ['employeeTypeIds', 'Employment type', 'employee-types'],
  ['gradeIds', 'Grade', 'grades'],
  ['workTypeIds', 'Work mode', 'work-types'],
];

export default function Policies() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [languagesOpen, setLanguagesOpen] = useState(false);

  const load = useCallback(() => {
    listPolicies(q, category).then(setData).catch((e) => notify.error(String(e?.message || 'Could not load.')));
    policyConflicts().then(setConflicts).catch(() => setConflicts([]));
  }, [q, category]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Policies"
        description="Each policy has an owner, versions with effective dates, and says who it applies to. Employees see only what applies to them."
        actions={allowed('PEOPLE::Policies::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New policy</button> : null}
      />
      {conflicts.length ? (
        <p className="text-sm text-[rgb(var(--neg))]" role="status">
          {conflicts.length === 1 ? 'One conflict' : `${conflicts.length} conflicts`}: two policies of the same kind reach the same people today — {conflicts.map((c) => `${c.a.title} and ${c.b.title} (${c.people})`).join('; ')}. Narrow who each applies to, or retire one.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <input className="ui-input" placeholder="Search policies" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search policies" />
        <select className="ui-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All kinds</option>
          {(data?.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {allowed('PEOPLE::Policies::EDIT') ? <button type="button" className="ui-btn ui-btn-secondary ml-auto" onClick={() => setLanguagesOpen(true)}>Notice languages{data?.languages?.length ? ` (${data.languages.length})` : ''}</button> : null}
      </div>
      {!data ? <SkeletonCard lines={5} /> : !data.policies.length ? (
        <EmptyState title="No policies yet" description="Start with the ones people ask about: leave, working hours, conduct." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="ui-caption text-left"><th className="py-1.5 font-medium">Policy</th><th className="py-1.5 font-medium">Kind</th><th className="py-1.5 font-medium">Owner</th><th className="py-1.5 font-medium">In force</th><th className="py-1.5 font-medium">Latest</th></tr>
          </thead>
          <tbody className="divide-y">
            {data.policies.map((p) => (
              <tr key={p.id} className="cursor-pointer" onClick={() => setOpen(p.id)}>
                <td className="py-2 pr-2 font-medium">{p.title}</td>
                <td className="py-2 pr-2">{p.categoryLabel}{p.purposeLabel ? <span className="ui-caption block">{p.purposeLabel}</span> : null}</td>
                <td className="py-2 pr-2">{p.ownerName}</td>
                <td className="py-2 pr-2">{p.current ? `v${p.current.version} from ${p.current.effectiveFrom}` : <span className="ui-muted">—</span>}</td>
                <td className="py-2">{p.latest ? <span className={`ui-pill ${STATUS[p.latest.status]?.[1] || ''}`}>v{p.latest.version} · {STATUS[p.latest.status]?.[0] || p.latest.status}</span> : <span className="ui-muted">No version</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating ? <PolicyForm taken={(data?.policies || []).map((p) => p.title)} categories={data?.categories || []} purposes={data?.purposes || []} onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); load(); setOpen(p.id); }} /> : null}
      {languagesOpen ? <NoticeLanguages onClose={() => setLanguagesOpen(false)} onSaved={() => { setLanguagesOpen(false); load(); }} /> : null}
      {open ? <PolicyDetail id={open} categories={data?.categories || []} purposes={data?.purposes || []} languages={data?.languages || []} allowed={allowed} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </div>
  );
}

/* The policies most Indian companies keep; offered when adding one the company does not have yet. */
const COMMON_POLICIES = ['Leave policy', 'Attendance and working hours', 'Code of conduct', 'Prevention of sexual harassment (POSH)', 'Travel and expenses', 'Work from home', 'IT and device use', 'Holiday list', 'Notice period and exit', 'Probation and confirmation', 'Overtime', 'Grievance redressal'];

function PolicyForm({ policy, taken = [], categories, purposes = [], onClose, onSaved }) {
  const [form, setForm] = useState({ title: policy?.title || '', category: policy?.category || 'OTHER', purpose: policy?.purpose || '', description: policy?.description || '' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = policy ? await updatePolicy(policy.id, form) : await createPolicy(form);
      notify.success(`${r.policy.title} saved.`);
      onSaved(r.policy);
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title={policy ? `Edit ${policy.title}` : 'New policy'} description="The owner is you unless changed; versions and who they apply to come next."
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="policy-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <form id="policy-form" onSubmit={save} className="grid gap-4">
        <label className="block"><span className="ui-label">Title *</span><SuggestInput required maxLength={160} value={form.title} onChange={(v) => setForm({ ...form, title: v })} suggestions={policy ? [] : COMMON_POLICIES.filter((t) => !taken.some((x) => String(x).trim().toLowerCase() === t.toLowerCase()))} /></label>
        <label className="block"><span className="ui-label">Kind</span>
          <select className="ui-select w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        {form.category === 'PRIVACY' ? (
          <label className="block"><span className="ui-label">Purpose *</span>
            <select className="ui-select w-full" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
              <option value="">Choose what this notice covers</option>
              {purposes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <span className="ui-caption">One notice per purpose. Every new version asks everyone it reaches to read it again.</span>
          </label>
        ) : null}
        <label className="block"><span className="ui-label">What it covers (optional)</span><textarea className="ui-input w-full" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

function PolicyDetail({ id, categories, purposes = [], languages = [], allowed, onClose, onChanged }) {
  const [policy, setPolicy] = useState(null);
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState(null);
  const [report, setReport] = useState({});
  const reload = useCallback(() => getPolicy(id).then(setPolicy).catch((e) => notify.error(String(e?.message || 'Could not load.'))), [id]);
  useEffect(() => { reload(); }, [reload]);
  if (!policy) return <Drawer open onClose={onClose} title="Policy"><SkeletonCard lines={5} /></Drawer>;
  const canEdit = allowed('PEOPLE::Policies::EDIT');
  const act = async (fn, okText) => {
    try {
      const r = await fn();
      notify.success(typeof okText === 'function' ? okText(r) : okText);
      reload();
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
    <Drawer open onClose={onClose} title={policy.title} description={`${policy.categoryLabel} · owner ${policy.ownerName}${policy.currentVersion ? ` · v${policy.currentVersion} in force` : ' · nothing in force yet'}`} widthClass="w-[min(44rem,96vw)]"
      actions={canEdit ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing(true)}>Edit</button><button type="button" className="ui-btn ui-btn-primary" onClick={() => setNewVersion({})}>New version</button></> : null}>
      {policy.description ? <p className="text-sm mb-4">{policy.description}</p> : null}
      {!policy.versions.length ? <p className="ui-muted text-sm">No version yet. A version says what the policy is, from when, and for whom.</p> : (
        <ul className="divide-y">
          {policy.versions.map((v) => (
            <li key={v.id} className="py-3 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">Version {v.version}</span>
                <span className={`ui-pill ${STATUS[v.status]?.[1] || ''}`}>{STATUS[v.status]?.[0] || v.status}</span>
                {v.inForce ? <span className="ui-pill ui-pill-info">In force today</span> : null}
                <span className="ui-caption">from {v.effectiveFrom}{v.effectiveTo ? ` to ${v.effectiveTo}` : ''}{v.needsAcceptance ? ' · needs acceptance' : ''}</span>
                <span className="ml-auto flex gap-2">
                  {v.status === 'DRAFT' && canEdit ? <button type="button" className="ui-link" onClick={() => setNewVersion(v)}>Edit draft</button> : null}
                  {v.status === 'DRAFT' && canEdit ? <button type="button" className="ui-link" onClick={() => act(() => submitPolicyVersion(id, v.version), (r) => (r.request ? 'Sent for approval.' : `Version ${v.version} is published.`))}>Publish</button> : null}
                  {(v.status === 'PUBLISHED') && canEdit ? <button type="button" className="ui-link" onClick={async () => { if (await confirmDialog({ title: `Retire version ${v.version}?`, message: 'It stops applying from today and stays readable.', confirmLabel: 'Retire' })) act(() => retirePolicyVersion(id, v.version), 'Retired.'); }}>Retire</button> : null}
                  {v.needsAcceptance && (v.status === 'PUBLISHED' || v.status === 'RETIRED') ? <button type="button" className="ui-link" onClick={() => showReport(v)}>{v.accepted} of {v.asked} accepted</button> : null}
                </span>
              </div>
              <p className="ui-caption">Applies to: {scopeWords(v.appliesTo)}</p>
              {v.body ? <details><summary className="ui-caption cursor-pointer">Read</summary><pre className="whitespace-pre-wrap text-sm mt-1 font-sans">{v.body}</pre></details> : <p className="ui-caption">A document on file.</p>}
              {report[v.id] ? (
                <div className="ui-card p-3 text-sm space-y-1">
                  <p>{report[v.id].accepted} accepted, {report[v.id].pending} pending.</p>
                  {report[v.id].pendingList.length ? <p className="ui-caption">Pending: {report[v.id].pendingList.map((x) => `${x.name}${x.remindCount ? ` (reminded ${x.remindCount}×)` : ''}`).join(', ')}</p> : null}
                  {report[v.id].pending && canEdit ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => act(() => remindPolicyVersion(id, v.version), (r) => `${r.reminded} reminded.`)}>Remind everyone pending</button> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <PolicyForm policy={policy} categories={categories} purposes={purposes} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChanged(); }} /> : null}
      {newVersion ? <VersionForm policyId={id} privacy={policy.category === 'PRIVACY'} languages={languages} version={newVersion.id ? newVersion : null} onClose={() => setNewVersion(null)} onSaved={() => { setNewVersion(null); reload(); onChanged(); }} /> : null}
    </Drawer>
  );
}

const scopeWords = (a) => {
  const parts = [];
  if (a?.establishmentIds?.length) parts.push(`${a.establishmentIds.length} establishment${a.establishmentIds.length === 1 ? '' : 's'}`);
  if (a?.states?.length) parts.push(a.states.join(', '));
  if (a?.departmentIds?.length) parts.push(`${a.departmentIds.length} department${a.departmentIds.length === 1 ? '' : 's'}`);
  if (a?.employeeTypeIds?.length) parts.push(`${a.employeeTypeIds.length} employee type${a.employeeTypeIds.length === 1 ? '' : 's'}`);
  if (a?.gradeIds?.length) parts.push(`${a.gradeIds.length} grade${a.gradeIds.length === 1 ? '' : 's'}`);
  if (a?.workTypeIds?.length) parts.push(`${a.workTypeIds.length} work type${a.workTypeIds.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'everyone';
};

function VersionForm({ policyId, privacy = false, languages = [], version, onClose, onSaved }) {
  const [form, setForm] = useState({ translations: { ...(version?.translations || {}) }, body: version?.body || '', effectiveFrom: version?.effectiveFrom || new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), effectiveTo: version?.effectiveTo || '', needsAcceptance: version?.needsAcceptance || false, appliesTo: { ...(version?.appliesTo || {}) } });
  const [lists, setLists] = useState({});
  const [scope, setScope] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all(SCOPE_KEYS.map(([, , kind]) => structureList(kind).catch(() => []))).then((rows) => setLists(Object.fromEntries(SCOPE_KEYS.map(([k], i) => [k, rows[i]]))));
  }, []);
  useEffect(() => {
    let live = true;
    policyScope(form.appliesTo).then((s) => live && setScope(s)).catch(() => live && setScope(null));
    return () => { live = false; };
  }, [form.appliesTo]);
  const toggle = (key, id) => setForm((f) => {
    const cur = f.appliesTo[key] || [];
    return { ...f, appliesTo: { ...f.appliesTo, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } };
  });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, translations: privacy ? form.translations : undefined, effectiveTo: form.effectiveTo || null, appliesTo: { ...form.appliesTo, states: (form.appliesTo.states || []).filter(Boolean) } };
      const r = version ? await updatePolicyVersion(policyId, version.version, body) : await addPolicyVersion(policyId, body);
      notify.success(`Version ${r.version.version} saved as a draft. Publish it when it is ready.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title={version ? `Edit draft version ${version.version}` : 'New version'} description="From when it applies and for whom. Leave every list empty for everyone." widthClass="w-[min(40rem,96vw)]"
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="version-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button></>}>
      <form id="version-form" onSubmit={save} className="grid gap-4">
        <label className="block"><span className="ui-label">The policy *</span><textarea className="ui-input w-full" rows={10} required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="ui-label">Applies from *</span><input type="date" className="ui-input w-full" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Until (optional)</span><input type="date" className="ui-input w-full" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></label>
        </div>
        {privacy ? (
          <>
            {languages.map((l) => (
              <label key={l.key} className="block"><span className="ui-label">In {l.label} (optional)</span><textarea className="ui-input w-full" rows={6} lang={l.key} value={form.translations[l.key] || ''} onChange={(e) => setForm({ ...form, translations: { ...form.translations, [l.key]: e.target.value } })} /></label>
            ))}
            <p className="ui-caption">{languages.length ? 'People read it in the language they choose; English shows where a translation is left empty.' : 'English only. Add languages under Notice languages.'} Everyone it reaches is asked to read and accept every version.</p>
          </>
        ) : <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.needsAcceptance} onChange={(e) => setForm({ ...form, needsAcceptance: e.target.checked })} />Everyone it applies to must read and accept it</label>}
        <fieldset className="space-y-2">
          <legend className="ui-label">Who it applies to</legend>
          <label className="block"><span className="ui-caption">States (comma-separated, e.g. Karnataka, Maharashtra)</span><input className="ui-input w-full" value={(form.appliesTo.states || []).join(', ')} onChange={(e) => setForm({ ...form, appliesTo: { ...form.appliesTo, states: e.target.value.split(',').map((s) => s.trim()) } })} /></label>
          {SCOPE_KEYS.map(([key, label]) => (lists[key]?.length ? (
            <div key={key}>
              <span className="ui-caption block">{label}</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {lists[key].map((item) => {
                  const on = (form.appliesTo[key] || []).includes(item.id);
                  return <button key={item.id} type="button" aria-pressed={on} className={`ui-pill ${on ? 'ui-pill-info' : ''}`} onClick={() => toggle(key, item.id)}>{item.name}{item.state ? ` (${item.state})` : ''}</button>;
                })}
              </div>
            </div>
          ) : null))}
          <p className="ui-caption">{scope ? `Reaches ${scope.count} ${scope.count === 1 ? 'person' : 'people'}${scope.sample.length ? `: ${scope.sample.map((p) => p.name).join(', ')}${scope.count > scope.sample.length ? '…' : ''}` : ''}` : 'Working out who it reaches…'}</p>
        </fieldset>
      </form>
    </Drawer>
  );
}

/** The languages privacy notices are offered in besides English (PRV-01). */
function NoticeLanguages({ onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState([]);
  useEffect(() => {
    getNoticeLanguages().then((r) => { setData(r); setPicked(r.enabled || []); }).catch((e) => notify.error(String(e?.message || 'Could not load.')));
  }, []);
  const save = async () => {
    try {
      await saveNoticeLanguages(picked);
      notify.success(picked.length ? `Notices offered in English and ${picked.length} more.` : 'Notices in English only.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  return (
    <Drawer open onClose={onClose} title="Notice languages" description="Privacy notices are always in English. Pick the languages your people read; each notice version then takes a translation in each."
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={!data}>Save</button></>}>
      {!data ? <SkeletonCard lines={4} /> : (
        <div className="flex flex-wrap gap-1.5">
          {data.offered.map((l) => {
            const on = picked.includes(l.key);
            return <button key={l.key} type="button" aria-pressed={on} className={`ui-pill ${on ? 'ui-pill-info' : ''}`} onClick={() => setPicked(on ? picked.filter((x) => x !== l.key) : [...picked, l.key])}>{l.label}</button>;
          })}
        </div>
      )}
    </Drawer>
  );
}
