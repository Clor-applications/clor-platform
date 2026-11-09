import React, { useMemo, useRef, useState } from 'react';
import { FileText, Plus, X } from '@ui/components/ui/lineIcons';
import { EmptyState } from '@ui/components/ui/Primitives';
import ListHeader, { SegmentedControl } from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import * as api from '../api/compliance';

/**
 * Compliance, the one place for it (People audit 30 Oct 2026, gaps 10 and
 * 16): what the company owes — from the rule library, Payroll's statutory
 * dates (what the old calendar listed), each work site's registrations and
 * the company's own deadlines — each with an owner, a reference, a note,
 * proof files, done by and checked by; the work sites' registrations; and
 * the rule library, every rule versioned and checked by a named person.
 */

const STATUS = {
  UPCOMING: ['Upcoming', 'ui-pill-neutral'], DUE: ['Due', 'ui-pill-warn'], OVERDUE: ['Overdue', 'ui-pill-neg'],
  DONE: ['Done', 'ui-pill-pos'], CHECKED: ['Checked', 'ui-pill-pos'], NOT_APPLICABLE: ['Doesn’t apply', 'ui-pill-neutral'],
};
const OPEN = ['OVERDUE', 'DUE', 'UPCOMING'];
const CLOSED = ['DONE', 'CHECKED', 'NOT_APPLICABLE'];
const TABS = [['OPEN', 'Open', OPEN], ['OVERDUE', 'Overdue', ['OVERDUE']], ['DUE', 'Due', ['DUE']], ['UPCOMING', 'Upcoming', ['UPCOMING']], ['DONE', 'Done', CLOSED]];
const SOURCE = { RULE: 'Rule', STATUTORY: 'Payroll deadline', REGISTRATION: 'Work site registration', OWN: 'Your own' };
const VIEWS = [['owed', 'What is owed'], ['registrations', 'Registrations'], ['rules', 'Rules']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DUE_KINDS = [['STANDING', 'Standing duty'], ['MONTHLY', 'Every month'], ['ANNUAL', 'Every year'], ['HALF_YEARLY', 'Twice a year'], ['ONCE', 'Once, after a work site opens']];
const dueWords = (r) => ({ STANDING: 'Standing duty', MONTHLY: `Monthly, by day ${r.day}`, ANNUAL: `Yearly, by ${r.day} ${MONTHS[(r.month || 1) - 1]}`, HALF_YEARLY: `Half-yearly, by ${r.day} ${(r.months || []).map((m) => MONTHS[m - 1]).join(' and ')}`, ONCE: `Once, ${r.days} days after the work site opens` }[r?.kind] || '');
const words = (code) => String(code || '').replaceAll('_', ' ').toLowerCase();
const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
const where = (o) => (o.establishment ? `${o.establishment}${o.state ? ` (${o.state})` : ''}` : 'Whole company');
const STATE_CODES = { karnataka: 'KA', maharashtra: 'MH', 'tamil nadu': 'TN', telangana: 'TS', delhi: 'DL', gujarat: 'GJ', haryana: 'HR', 'uttar pradesh': 'UP', 'west bengal': 'WB', kerala: 'KL', 'andhra pradesh': 'AP', rajasthan: 'RJ', 'madhya pradesh': 'MP', punjab: 'PB', bihar: 'BR', odisha: 'OR', goa: 'GA', assam: 'AS' };
const STATE_NAMES = Object.fromEntries(Object.entries(STATE_CODES).map(([name, code]) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase())]));
const reach = (j) => (j === 'IN' ? 'All of India' : j === 'IN-STATE' ? 'Every state' : STATE_NAMES[String(j || '').replace('IN-', '')] || String(j || '').replace('IN-', ''));
const codeOf = (state) => STATE_CODES[String(state || '').trim().toLowerCase()] || String(state || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
/** A new version starts today, or the day after the version it replaces starts if that is later: a version cannot start on or before the one it replaces. */
const startOf = (prev) => {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (!prev || prev < today) return today;
  return new Date(Date.parse(`${prev}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
};
const daysTo = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** A proof shown in its own window, as a data: frame with an opaque origin, never written into HTML. */
function showFile(file, title) {
  const src = String(file?.dataUrl || '');
  if (!/^data:[\w.+-]+\/[\w.+-]+[;,]/i.test(src)) return notify.error('That file cannot be shown.');
  const w = window.open();
  if (!w) return undefined;
  w.opener = null;
  w.document.title = title || 'Proof';
  w.document.body.style.margin = '0';
  const frame = w.document.createElement('iframe');
  frame.src = src;
  frame.title = title || 'Proof';
  frame.style.cssText = 'border:0;width:100%;height:100vh;display:block';
  w.document.body.appendChild(frame);
  return undefined;
}

export default function Compliance({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const canAct = allowed('PEOPLE::Employees::EDIT');
  const canRules = allowed('PEOPLE::Org Structure::EDIT');
  const view = VIEWS.some(([k]) => k === params.view) ? params.view : 'owed';
  const tab = TABS.some(([k]) => k === params.status) ? params.status : 'OPEN';
  const set = (patch) => updateParams?.(patch, { push: false });
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [rule, setRule] = useState(null);
  const owed = useRequest(() => api.listObligations(), []);
  const owners = useRequest(() => (canAct ? api.listOwners() : Promise.resolve({ users: [], names: [] })), [canAct]);
  const regs = useRequest(() => api.listRegistrations(), []);
  const rules = useRequest(() => (view === 'rules' ? api.listRules() : Promise.resolve(null)), [view]);
  const all = owed.data || [];
  const open = params.id ? all.find((o) => o.id === params.id) : null;
  const inTab = (o, k) => TABS.find(([key]) => key === k)[2].includes(o.status);
  const shown = all.filter((o) => inTab(o, tab)).filter((o) => !q || `${o.title} ${o.establishment || ''} ${o.owner} ${o.reference || ''}`.toLowerCase().includes(q.toLowerCase()));

  const actions = view === 'owed' && canAct
    ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add a deadline</button>
    : view === 'rules' && canRules
      ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setRule({})}><Plus size={16} aria-hidden="true" /> Add a rule</button>
      : view === 'registrations' && openScreen
        ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('establishments')}>Work sites</button>
        : null;

  const columns = [
    { key: 'title', label: 'What', always: true, render: (o) => (
      <span className="block min-w-0">
        <span className="block font-medium">{o.title}</span>
        <span className="block ui-caption">{[SOURCE[o.source], !o.ruleChecked ? 'not yet checked with your adviser' : null, o.proofs?.length ? `${o.proofs.length} proof${o.proofs.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</span>
      </span>
    ) },
    { key: 'where', label: 'Where', render: (o) => where(o) },
    { key: 'due', label: 'Due', render: (o) => <span className="tabular-nums whitespace-nowrap">{o.period === 'STANDING' ? 'Standing' : day(o.dueOn)}</span> },
    { key: 'owner', label: 'Owner', render: (o) => <span className={o.ownerSet ? '' : 'ui-muted'}>{o.owner}</span> },
    { key: 'status', label: 'Status', render: (o) => <span className={`ui-pill ${STATUS[o.status]?.[1] || ''}`}>{STATUS[o.status]?.[0] || o.status}</span> },
  ];

  return (
    <div className="space-y-6">
      <ListHeader
        section="Settings"
        title="Compliance calendar"
        description="What the company owes under labour law and to Payroll, when, and whose job it is, with the registrations and rules behind it."
        secondary={actions}
        toolbar={<>
          <SegmentedControl label="Compliance" options={VIEWS.map(([k, l]) => ({ key: k, label: l }))} value={view} onChange={(k) => set({ view: k === 'owed' ? null : k, status: null, id: null })} />
          {view === 'owed' ? <SearchField value={q} onSearch={setQ} placeholder="Search what is owed" label="Search what is owed" className="w-full sm:w-80" /> : null}
        </>}
        tabs={view === 'owed' ? TABS.map(([k, l]) => ({ key: k, label: l, count: all.filter((o) => inTab(o, k)).length, tone: k === 'OVERDUE' ? 'warn' : undefined })) : null}
        tab={tab}
        onTab={(k) => set({ status: k === 'OPEN' ? null : k })}
        tabsLabel="Status"
      />

      {view === 'owed' ? (
        owed.error && !owed.data ? <ErrorState error={owed.error} onRetry={owed.reload} /> : (
          <DataTable
            label="What is owed"
            columns={columns} rows={shown} total={shown.length} pageSize={Math.max(25, shown.length)} noun="items"
            loading={owed.loading} refreshing={owed.refreshing} onRowClick={(o) => set({ id: o.id })}
            card={(o) => (
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2"><span className="font-medium">{o.title}</span><span className={`ui-pill shrink-0 ${STATUS[o.status]?.[1] || ''}`}>{STATUS[o.status]?.[0]}</span></span>
                <span className="block ui-caption">{[o.period === 'STANDING' ? 'Standing' : `Due ${day(o.dueOn)}`, o.owner, o.establishment].filter(Boolean).join(' · ')}</span>
              </span>
            )}
            empty={q ? <EmptyState kind="filtered" title="Nothing matches" description="Nothing here matches the search." />
              : tab === 'DONE' ? <EmptyState title="Nothing done yet" description="What is marked done or checked stays here, with its proof." />
                : <EmptyState title="Nothing owed" description="Add work sites under Organisation; what each state asks of them appears here, with Payroll’s deadlines and your own." />}
          />
        )
      ) : null}

      {view === 'registrations' ? <Registrations req={regs} openScreen={openScreen} /> : null}
      {view === 'rules' ? <Rules req={rules} canRules={canRules} onEdit={setRule} /> : null}

      {open ? <ObligationDrawer key={open.id} o={open} known={all} canAct={canAct} owners={owners.data} onClose={() => set({ id: null })} onSaved={owed.reload} /> : null}
      {adding ? <AddDrawer owners={owners.data} sites={regs.data?.sites || []} known={all} onClose={() => setAdding(false)} onDone={(o) => { setAdding(false); owed.reload(); if (o?.id) set({ id: o.id, status: null }); }} /> : null}
      {rule ? <RuleDrawer value={rule} rules={rules.data || []} sites={regs.data?.sites || []} onClose={() => setRule(null)} onDone={() => { setRule(null); rules.reload(); owed.reload(); }} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------- an obligation */

const ownerHints = (owners) => [...(owners?.users || []).map((u) => u.name), ...(owners?.names || [])];
/** A typed owner: a user of this company if the name is theirs, else a name outside CLOR. */
const ownerBody = (typed, owners) => {
  const t = String(typed || '').trim();
  const user = (owners?.users || []).find((u) => u.name.toLowerCase() === t.toLowerCase());
  return user ? { ownerUserId: user.id, ownerName: null } : { ownerUserId: null, ownerName: t || null };
};

function ObligationDrawer({ o, known = [], canAct, owners, onClose, onSaved }) {
  const own = o.source === 'OWN';
  const locked = o.status === 'CHECKED';
  const initial = useMemo(() => ({ owner: o.ownerSet ? o.owner : '', reference: o.reference || '', note: o.note || '', title: o.title, dueOn: o.dueOn }), [o]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [proofs, setProofs] = useState(o.proofs || []);
  const fileRef = useRef(null);
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  /* References kept on the same kind of deadline before (a challan series, the office's acknowledgement prefix). */
  const refHints = [...new Set(known.filter((x) => x.id !== o.id && x.ruleId === o.ruleId && x.reference).map((x) => x.reference))];
  const titleHints = [...new Set(known.filter((x) => x.source === 'OWN' && x.id !== o.id).map((x) => x.title))];
  const edits = () => ({
    ...(form.owner !== initial.owner ? ownerBody(form.owner, owners) : {}),
    ...(form.reference !== initial.reference ? { reference: form.reference } : {}),
    ...(form.note !== initial.note ? { note: form.note } : {}),
    ...(own && form.title !== initial.title ? { title: form.title } : {}),
    ...(own && form.dueOn !== initial.dueOn ? { dueOn: form.dueOn } : {}),
  });
  const save = async (status, ok) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateObligation(o.id, { ...edits(), ...(status ? { status } : {}) });
      notify.success(ok);
      onSaved();
      if (status) onClose();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const attach = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify.error('Proof is up to 5 MB.'); return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });
      const p = await api.addProof(o.id, { name: file.name, mime: file.type, dataUrl });
      setProofs((list) => [...list, { ...p, uploadedBy: 'You' }]);
      notify.success('Proof attached.');
      onSaved();
    } catch (e) {
      notify.error(String(e?.message || 'Not attached.'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p) => {
    try {
      await api.removeProof(o.id, p.id);
      setProofs((list) => list.filter((x) => x.id !== p.id));
      onSaved();
    } catch (e) {
      notify.error(String(e?.message || 'Not removed.'));
    }
  };
  const view = async (p) => {
    try { showFile(await api.openProof(o.id, p.id), p.name); } catch (e) { notify.error(String(e?.message || 'Could not open it.')); }
  };
  const primary = !canAct ? null
    : OPEN.includes(o.status) ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => save('DONE', 'Marked done.')}>Mark done</button>
      : o.status === 'DONE' ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => save('CHECKED', 'Marked checked.')}>Mark checked</button>
        : null;
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={o.title} dirty={dirty}
      description={`${where(o)} · ${o.period === 'STANDING' ? 'standing duty' : `due ${day(o.dueOn)}`}`}
      footer={canAct ? <>
        {OPEN.includes(o.status) ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={() => save('NOT_APPLICABLE', 'Marked as not applying.')}>Doesn’t apply</button> : null}
        {CLOSED.includes(o.status) ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={() => save('OPEN', 'Open again.')}>Open again</button> : null}
        <button type="button" className={primary ? 'ui-btn ui-btn-secondary' : 'ui-btn ui-btn-primary'} disabled={busy || !dirty} onClick={() => save(null, 'Saved.')}>Save</button>
        {primary}
      </> : null}>
      <div className="grid gap-5 text-sm">
        <dl className="grid gap-3">
          <div><dt className="ui-label">Status</dt><dd className="flex flex-wrap items-center gap-2"><span className={`ui-pill ${STATUS[o.status]?.[1] || ''}`}>{STATUS[o.status]?.[0]}</span>
            <span>{[o.doneOn && o.status !== 'NOT_APPLICABLE' ? `Done by ${o.doneBy || 'someone'} on ${day(o.doneOn)}` : null, o.status === 'NOT_APPLICABLE' && o.doneOn ? `${o.doneBy} said it does not apply, ${day(o.doneOn)}` : null, o.checkedOn ? `checked by ${o.checkedBy || 'someone'} on ${day(o.checkedOn)}` : null].filter(Boolean).join('; ') || 'Not done yet'}</span></dd></div>
          <div><dt className="ui-label">Comes from</dt><dd>{o.legalSource || SOURCE[o.source]}{o.source === 'RULE' ? <span className="ui-caption block">Rule {o.ruleId}, version {o.ruleVersion}{o.ruleChecked ? '' : ': not yet checked with your adviser'}</span> : null}
            {o.link ? <a className="ui-link block" href={`?app=${o.link.app}&open=${o.link.screen}`}>Open Payroll</a> : null}</dd></div>
          <div><dt className="ui-label">Proof it needs</dt><dd>{o.requiredProof?.length ? o.requiredProof.map(words).join(', ').replace(/^./, (c) => c.toUpperCase()) : 'None named'}</dd></div>
        </dl>

        <section className="grid gap-2" aria-label="Proof">
          <span className="ui-label">Proof</span>
          {proofs.length ? (
            <ul className="divide-y border-y">
              {proofs.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2">
                  <FileText size={16} aria-hidden="true" />
                  <button type="button" className="ui-link min-w-0 flex-1 truncate text-left" onClick={() => view(p)}>{p.name}</button>
                  {p.uploadedBy ? <span className="ui-caption">{p.uploadedBy}</span> : null}
                  {canAct && !locked ? <button type="button" className="ui-icon-btn" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}><X size={16} aria-hidden="true" /></button> : null}
                </li>
              ))}
            </ul>
          ) : <p className="ui-muted">No file yet.</p>}
          {canAct && !locked ? (
            <span>
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" aria-label="Proof file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; attach(f); }} />
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>Attach a file</button>
            </span>
          ) : null}
        </section>

        {canAct ? (
          <div className="ui-form-grid">
            {own ? <label className="block sm:col-span-2"><span className="ui-label">What</span><SuggestInput maxLength={200} value={form.title} onChange={(v) => setF('title', v)} suggestions={titleHints} /></label> : null}
            {own ? <div><span className="ui-label" id="obl-due">Due on</span><DatePicker label="Due on" describedBy="obl-due" value={form.dueOn} onChange={(v) => setF('dueOn', v || '')} /></div> : null}
            <label className="block"><span className="ui-label">Owner</span><SuggestInput maxLength={120} placeholder={o.ownerSet ? '' : o.owner} value={form.owner} onChange={(v) => setF('owner', v)} suggestions={ownerHints(owners)} /></label>
            <label className="block"><span className="ui-label">Reference</span><SuggestInput maxLength={120} placeholder="Challan or acknowledgement no." value={form.reference} onChange={(v) => setF('reference', v)} suggestions={refHints} /></label>
            <label className="block sm:col-span-2"><span className="ui-label">Note</span><textarea className="ui-input w-full" rows={3} maxLength={2000} value={form.note} onChange={(e) => setF('note', e.target.value)} /></label>
          </div>
        ) : (
          <dl className="grid gap-3">
            <div><dt className="ui-label">Owner</dt><dd>{o.owner}</dd></div>
            {o.reference ? <div><dt className="ui-label">Reference</dt><dd className="tabular-nums">{o.reference}</dd></div> : null}
            {o.note ? <div><dt className="ui-label">Note</dt><dd>{o.note}</dd></div> : null}
          </dl>
        )}
      </div>
    </Drawer>
  );
}

function AddDrawer({ owners, sites, known, onClose, onDone }) {
  const [form, setForm] = useState({ title: '', dueOn: '', establishmentId: '', owner: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const titles = [...new Set(known.filter((o) => o.source === 'OWN').map((o) => o.title))];
  const add = async () => {
    if (busy) return;
    if (!form.title.trim()) { setError('Name the deadline.'); return; }
    if (!form.dueOn) { setError('Choose the due date.'); return; }
    setBusy(true);
    setError('');
    try {
      const o = await api.addObligation({ title: form.title.trim(), dueOn: form.dueOn, establishmentId: form.establishmentId || null, note: form.note || null, ...ownerBody(form.owner, owners) });
      notify.success('Deadline added.');
      onDone(o);
    } catch (e) {
      setError(String(e?.message || 'Not added.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(32rem,96vw)] ui-drawer-sheet" title="Add a deadline" dirty={Boolean(form.title || form.dueOn || form.owner || form.note)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); add(); }}>
        {error ? <p role="alert" className="ui-text-neg text-sm sm:col-span-2">{error}</p> : null}
        <label className="block sm:col-span-2"><span className="ui-label">What *</span><SuggestInput autoFocus maxLength={200} placeholder="Trade licence renewal" value={form.title} onChange={(v) => setF('title', v)} suggestions={titles} /></label>
        <div><span className="ui-label" id="add-due">Due on *</span><DatePicker label="Due on" describedBy="add-due" value={form.dueOn} onChange={(v) => setF('dueOn', v || '')} /></div>
        <div><PopupSelect showValueSubtext={false} label="Where" placeholder="Whole company" value={form.establishmentId} onChange={(v) => setF('establishmentId', v || '')} options={[{ value: '', label: 'Whole company' }, ...sites.map((s) => ({ value: s.id, label: s.state ? `${s.name} (${s.state})` : s.name }))]} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">Owner</span><SuggestInput maxLength={120} placeholder="A user, or someone outside, like your CA" value={form.owner} onChange={(v) => setF('owner', v)} suggestions={ownerHints(owners)} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Note</span><textarea className="ui-input w-full" rows={2} maxLength={2000} value={form.note} onChange={(e) => setF('note', e.target.value)} /></label>
      </form>
    </Drawer>
  );
}

/* ---------------------------------------------------------- registrations */

function Registrations({ req, openScreen }) {
  const sites = req.data?.sites || [];
  const rows = sites.flatMap((s) => (s.registrations.length ? s.registrations.map((r, i) => ({ id: `${s.id}:${i}`, site: s, ...r })) : [{ id: `${s.id}:none`, site: s, none: true }]));
  const state = (r) => {
    if (!r.validTill) return ['No end date', 'ui-pill-neutral'];
    const n = daysTo(r.validTill);
    if (n < 0) return ['Lapsed', 'ui-pill-neg'];
    if (n <= 30) return [`Runs out in ${n} day${n === 1 ? '' : 's'}`, 'ui-pill-warn'];
    return ['Valid', 'ui-pill-pos'];
  };
  if (req.error && !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;
  return (
    <DataTable label="Registrations" rows={rows} total={rows.length} pageSize={Math.max(25, rows.length)} noun="registrations" loading={req.loading} refreshing={req.refreshing}
      onRowClick={openScreen ? () => openScreen('establishments') : null}
      columns={[
        { key: 'site', label: 'Work site', always: true, render: (r) => <span className="font-medium">{r.site.name}{r.site.state ? <span className="ui-caption block">{r.site.state}</span> : null}</span> },
        { key: 'type', label: 'Registration', render: (r) => (r.none ? <span className="ui-muted">None added</span> : r.label) },
        { key: 'number', label: 'Number', render: (r) => <span className="tabular-nums">{r.number || '—'}</span> },
        { key: 'till', label: 'Valid till', render: (r) => <span className="tabular-nums whitespace-nowrap">{r.validTill ? day(r.validTill) : '—'}</span> },
        { key: 'state', label: 'Status', render: (r) => (r.none ? null : <span className={`ui-pill ${state(r)[1]}`}>{state(r)[0]}</span>) },
      ]}
      card={(r) => (
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2"><span className="font-medium">{r.none ? r.site.name : r.label}</span>{r.none ? null : <span className={`ui-pill shrink-0 ${state(r)[1]}`}>{state(r)[0]}</span>}</span>
          <span className="block ui-caption tabular-nums">{r.none ? 'No registrations added' : [r.site.name, r.number, r.validTill ? `till ${day(r.validTill)}` : null].filter(Boolean).join(' · ')}</span>
        </span>
      )}
      empty={<EmptyState title="No work sites yet" description="Add a work site under Organisation, with its PF, ESI and Shops & Establishments numbers." />}
    />
  );
}

/* ---------------------------------------------------------- rules */

function Rules({ req, canRules, onEdit }) {
  const [busy, setBusy] = useState('');
  const rows = req.data || [];
  const check = async (r) => {
    setBusy(r.id);
    try {
      await api.checkRule(r.ruleId, r.version);
      notify.success('Marked as checked by you.');
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  if (req.error && !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;
  return (
    <DataTable label="Rules" rows={rows} total={rows.length} pageSize={Math.max(25, rows.length)} noun="rules" loading={req.loading || !req.data} refreshing={req.refreshing}
      rowActions={canRules ? (r) => [
        r.active ? { key: 'version', label: 'New version', onSelect: () => onEdit(r) } : null,
        r.active && r.reviewStatus !== 'CHECKED' ? { key: 'check', label: 'I have checked this', onSelect: () => check(r) } : null,
      ] : null}
      columns={[
        { key: 'title', label: 'Rule', always: true, render: (r) => <span className={`block ${r.active ? '' : 'ui-muted'}`}><span className="block font-medium">{r.title}</span><span className="block ui-caption">{r.legalSource}{r.threshold?.minHeadcount ? ` · from ${r.threshold.minHeadcount} people` : ''}</span></span> },
        { key: 'where', label: 'Where', render: (r) => reach(r.jurisdiction) },
        { key: 'when', label: 'When', render: (r) => dueWords(r.dueRule) },
        { key: 'version', label: 'Version', render: (r) => <span className="tabular-nums">{r.version}{r.active ? '' : ` · until ${day(r.effectiveTo)}`}</span> },
        { key: 'checked', label: 'Checked', render: (r) => (
          <span className="block">
            <span className={r.reviewStatus === 'CHECKED' ? '' : 'ui-muted'}>{r.checkedLine}</span>
            {canRules && r.active && r.reviewStatus !== 'CHECKED' ? <button type="button" className="ui-link block" disabled={busy === r.id} onClick={() => check(r)}>I have checked this</button> : null}
          </span>
        ) },
      ]}
      card={(r) => (
        <span className={`min-w-0 flex-1 ${r.active ? '' : 'ui-muted'}`}>
          <span className="block font-medium">{r.title}</span>
          <span className="block ui-caption">{[reach(r.jurisdiction), dueWords(r.dueRule), `version ${r.version}`, r.checkedLine].join(' · ')}</span>
        </span>
      )}
      empty={<EmptyState title="No rules" description="The library fills the first time it opens." />}
    />
  );
}

function RuleDrawer({ value, rules, sites, onClose, onDone }) {
  const isNew = !value.ruleId;
  const due = value.dueRule || { kind: 'STANDING' };
  const [form, setForm] = useState({
    title: value.title || '', jurisdiction: value.jurisdiction || 'IN', minHeadcount: value.threshold?.minHeadcount ? String(value.threshold.minHeadcount) : '',
    kind: due.kind, day: String(due.day || 15), month: String(due.month || 1), month2: String(due.months?.[1] || 10), days: String(due.days || 30),
    legalSource: value.legalSource || '', obligation: value.obligation || '', proof: (value.requiredProof || []).map(words).join(', '), effectiveFrom: startOf(value.effectiveFrom),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const states = [...new Map(sites.filter((s) => s.state).map((s) => [codeOf(s.state), s.state])).entries()];
  const whereOptions = [{ value: 'IN', label: 'All of India' }, { value: 'IN-STATE', label: 'Every state' }, ...states.map(([code, name]) => ({ value: `IN-${code}`, label: name })), ...(!isNew && !['IN', 'IN-STATE', ...states.map(([c]) => `IN-${c}`)].includes(value.jurisdiction) ? [{ value: value.jurisdiction, label: reach(value.jurisdiction) }] : [])];
  const sources = [...new Set(rules.map((r) => r.legalSource).filter(Boolean))];
  const proofs = [...new Set(rules.flatMap((r) => r.requiredProof || []).map(words))];
  const dueRule = () => {
    const d = Number(form.day);
    if (form.kind === 'MONTHLY') return { kind: 'MONTHLY', day: d };
    if (form.kind === 'ANNUAL') return { kind: 'ANNUAL', month: Number(form.month), day: d };
    if (form.kind === 'HALF_YEARLY') return { kind: 'HALF_YEARLY', months: [Number(form.month), Number(form.month2)], day: d };
    if (form.kind === 'ONCE') return { kind: 'ONCE', days: Number(form.days) };
    return { kind: 'STANDING' };
  };
  const save = async () => {
    if (busy) return;
    if (!form.title.trim() || !form.obligation.trim() || !form.legalSource.trim()) { setError('A rule needs a title, what it asks, and its legal source.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.saveRule({
        ...(isNew ? {} : { ruleId: value.ruleId }), title: form.title.trim(), jurisdiction: form.jurisdiction, obligation: form.obligation.trim(), legalSource: form.legalSource.trim(), effectiveFrom: form.effectiveFrom,
        threshold: form.minHeadcount ? { minHeadcount: Number(form.minHeadcount) } : null, dueRule: dueRule(),
        requiredProof: form.proof.split(',').map((p) => p.trim().toUpperCase().replace(/\s+/g, '_')).filter(Boolean),
      });
      notify.success(isNew ? 'Rule added. Check it with your adviser.' : `Version ${value.version + 1} saved. Check it with your adviser.`);
      onDone();
    } catch (e) {
      setError(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const num = (k, label, max) => <label className="block"><span className="ui-label">{label}</span><input className="ui-input w-full tabular-nums" inputMode="numeric" maxLength={String(max).length} value={form[k]} onChange={(e) => setF(k, e.target.value.replace(/\D/g, ''))} /></label>;
  const monthPick = (k, label) => <div><PopupSelect showValueSubtext={false} label={label} value={form[k]} onChange={(v) => setF(k, v || '1')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} /></div>;
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={isNew ? 'Add a rule' : `New version of ${value.title}`}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {!isNew ? <p className="ui-caption sm:col-span-2">Version {value.version + 1} replaces version {value.version} from the date below and needs checking again.</p> : null}
        {error ? <p role="alert" className="ui-text-neg text-sm sm:col-span-2">{error}</p> : null}
        <label className="block sm:col-span-2"><span className="ui-label">Title *</span><SuggestInput autoFocus={isNew} maxLength={160} value={form.title} onChange={(v) => setF('title', v)} suggestions={[...new Set(rules.map((r) => r.title))]} /></label>
        <div><PopupSelect showValueSubtext={false} label="Where" value={form.jurisdiction} onChange={(v) => setF('jurisdiction', v || 'IN')} options={whereOptions} /></div>
        {num('minHeadcount', 'From how many people', 99999)}
        <div><PopupSelect showValueSubtext={false} label="When" value={form.kind} onChange={(v) => setF('kind', v || 'STANDING')} options={DUE_KINDS.map(([v, l]) => ({ value: v, label: l }))} /></div>
        {form.kind === 'MONTHLY' ? num('day', 'By day', 31) : null}
        {form.kind === 'ANNUAL' ? <>{monthPick('month', 'Month')}{num('day', 'Day', 31)}</> : null}
        {form.kind === 'HALF_YEARLY' ? <>{monthPick('month', 'First month')}{monthPick('month2', 'Second month')}{num('day', 'Day', 31)}</> : null}
        {form.kind === 'ONCE' ? num('days', 'Days after opening', 365) : null}
        <label className="block sm:col-span-2"><span className="ui-label">Legal source *</span><SuggestInput maxLength={400} placeholder="Act, section or notification" value={form.legalSource} onChange={(v) => setF('legalSource', v)} suggestions={sources} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">What it asks *</span><textarea className="ui-input w-full" rows={3} maxLength={4000} value={form.obligation} onChange={(e) => setF('obligation', e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Proof it needs</span><SuggestInput maxLength={200} placeholder="filing receipt, payment challan" value={form.proof} onChange={(v) => setF('proof', v)} suggestions={proofs} /></label>
        <div><span className="ui-label" id="rule-from">Starts on</span><DatePicker label="Starts on" describedBy="rule-from" value={form.effectiveFrom} min={isNew ? undefined : startOf(value.effectiveFrom)} onChange={(v) => setF('effectiveFrom', v || '')} /></div>
      </form>
    </Drawer>
  );
}
