import React, { useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import Alert from '@ui/components/ui/Alert';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { homeCrumbs } from '@ui/timeOff/shared';
import { STAND_IN_TYPES, scopeWords } from '@ui/timeOff/standInScope';
import { addStandIn as addLeaveDelegate, listPeople, listStandIns as listLeaveDelegates, removeStandIn as removeLeaveDelegate } from '@ui/timeOff/api';

import { addStandIn as addApprovalDelegate, listStandInsFull as listApprovalDelegates, removeStandIn as removeApprovalDelegate, standInCandidates } from '../api/approvals';

/**
 * Time → Delegates (FEATURE-UI-AUDIT gap 9): who decides in a manager's
 * place while they are away. Since the stand-in merge (workflow engine phase
 * 2b) every delegate is one row in one table, saying what it hands on:
 *
 *   All approvals          leave, attendance and every People request
 *   Leave and attendance   what a leave delegate always handed on
 *   Leave only
 *   Chosen request types
 *   (Other approvals: a People stand-in named before the merge)
 *
 * HR names one for any manager, for leave and attendance; anything more is
 * handed on by the manager themselves, from their own sign-in. The list reads
 * both routes (HR's whole-company leave view, and my own) and shows each row once.
 */
const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
const rank = (r, today) => (r.live ? 0 : r.fromDate > today ? 1 : 2);
const when = (r, today) => (r.live ? ['Live', 'ui-pill-pos'] : r.fromDate > today ? ['Starts later', 'ui-pill-neutral'] : ['Over', 'ui-pill-neutral']);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const TYPES = STAND_IN_TYPES;
const TIME = new Set(['LEAVE', 'ATTENDANCE']);
const CHOICES = { ALL: ['ALL'], TIME: ['LEAVE', 'ATTENDANCE'], LEAVE: ['LEAVE'] };

export default function Delegates() {
  const perms = usePermissions();
  const seesLeave = can(perms, 'ATTENDANCE::Leave Requests::VIEW');
  const namesLeave = can(perms, 'ATTENDANCE::Leave Requests::APPROVE');
  const seesApprovals = can(perms, 'PEOPLE::Requests::VIEW');
  /* Whole-company roles name a leave delegate for anyone; a team role only for themselves. */
  const wholeCompany = Boolean(perms?.isAdmin) || !perms?.ownDocumentsOnly;
  const leave = useRequest(() => (seesLeave ? listLeaveDelegates() : Promise.resolve({ standIns: [] })), [seesLeave]);
  const mine = useRequest(() => (seesApprovals ? listApprovalDelegates() : Promise.resolve({ standIns: [] })), [seesApprovals]);
  const [adding, setAdding] = useState(false);
  const today = leave.data?.today || mine.data?.today || todayIst();
  const selfEmployeeId = mine.data?.selfEmployeeId || null;
  const reload = () => { leave.reload(); mine.reload(); };

  /* One table behind both lists: a row in both is shown once, as mine when it is. */
  const byId = new Map();
  for (const r of leave.data?.standIns || []) byId.set(r.id, { ...r, mine: Boolean(selfEmployeeId) && r.managerEmployeeId === selfEmployeeId });
  for (const r of mine.data?.standIns || []) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r, mine: true });
  const rows = [...byId.values()]
    .map((r) => ({ ...r, key: r.id, what: scopeWords(r.requestTypes), name: `${r.standInName || 'Delegate'} for ${r.mine ? 'you' : r.managerName || 'a manager'}` }))
    .sort((a, b) => rank(a, today) - rank(b, today) || a.fromDate.localeCompare(b.fromDate));

  /* Mine are removed from my own sign-in; anyone else's take the right to approve leave. */
  const removesAsMine = (r) => r.mine && seesApprovals;
  /* Someone else's one that also hands on their other approvals is theirs alone to remove. */
  const timeAlone = (t) => Array.isArray(t) && t.length > 0 && t.every((x) => x === 'LEAVE' || x === 'ATTENDANCE');
  const canRemove = (r) => removesAsMine(r) || (namesLeave && timeAlone(r.requestTypes));
  const remove = async (r) => {
    const ok = await confirmDialog({ title: 'Remove this delegate?', message: `${r.standInName || 'They'} stop${r.standInName ? 's' : ''} deciding for ${r.mine ? 'you' : r.managerName || 'this manager'}.`, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await (removesAsMine(r) ? removeApprovalDelegate(r.id) : removeLeaveDelegate(r.id));
      notify.success('Delegate removed.');
      reload();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  const columns = [
    { key: 'manager', label: 'In place of', always: true, render: (r) => <span className="font-medium">{r.mine ? 'You' : r.managerName || '—'}</span> },
    { key: 'standIn', label: 'Decides', render: (r) => r.standInName || '—' },
    { key: 'what', label: 'What', render: (r) => r.what },
    { key: 'from', label: 'From', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.fromDate)}</span> },
    { key: 'to', label: 'To', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.toDate)}</span> },
    { key: 'status', label: 'Status', render: (r) => { const [label, pill] = when(r, today); return <span className={`ui-pill ${pill}`}>{label}</span>; } },
  ];
  const error = (seesLeave && leave.error && !leave.data) || (seesApprovals && mine.error && !mine.data);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={homeCrumbs()}
        title="Delegates"
        actions={namesLeave || seesApprovals ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add delegate</button> : null}
      />
      {error ? <Alert tone="neg" title="Part of this list could not be loaded" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={reload}>Retry</button>}>{(leave.error || mine.error)?.message || 'Try again.'}</Alert> : null}
      <DataTable
        label="Delegates"
        columns={columns}
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={Math.max(25, rows.length)}
        noun="delegates"
        loading={leave.loading || mine.loading}
        refreshing={leave.refreshing || mine.refreshing}
        rowActions={(r) => (canRemove(r) ? [{ key: 'remove', label: 'Remove', danger: true, onSelect: () => remove(r) }] : [])}
        card={(r) => {
          const [label, pill] = when(r, today);
          return (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className={`ui-pill ${pill}`}>{label}</span></span>
              <span className="block ui-caption tabular-nums">{r.what} · {formatDate(r.fromDate)} – {formatDate(r.toDate)}</span>
            </span>
          );
        }}
        empty={<EmptyState title="No delegates" description="While a manager is away, someone else can decide their team's leave and other approvals." />}
      />
      {adding ? (
        <AddDelegate wholeCompany={wholeCompany} namesLeave={namesLeave} namesApprovals={seesApprovals} selfEmployeeId={selfEmployeeId}
          onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      ) : null}
    </div>
  );
}

function AddDelegate({ wholeCompany, namesLeave, namesApprovals, selfEmployeeId, onClose, onDone }) {
  const [form, setForm] = useState({ managerEmployeeId: selfEmployeeId || '', standInEmployeeId: '', fromDate: '', toDate: '', choice: namesApprovals && selfEmployeeId ? 'ALL' : 'TIME', chosen: [] });
  const [saving, setSaving] = useState(false);
  /* Whose decisions: the people this role may see. Who decides: also anyone with a sign-in (a team manager's own manager is outside their team). */
  const people = useRequest(() => Promise.all([listPeople().catch(() => []), namesApprovals ? standInCandidates() : Promise.resolve([])]), [namesApprovals]);
  const label = (x) => (x.code ? `${x.name} (${x.code})` : x.name);
  const options = (people.data?.[0] || []).map((x) => ({ value: x.id, label: label(x) }));
  const standInOptions = [...options, ...(people.data?.[1] || []).filter((x) => !options.some((o) => o.value === x.id)).map((x) => ({ value: x.id, label: label(x) }))].sort((a, b) => a.label.localeCompare(b.label));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'fromDate' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}) }));

  /* More than leave and attendance is handed on by the manager themselves, from their own sign-in. */
  /* HR picks whose decisions; an empty "In place of" is nobody yet, never "me". */
  const picksManager = wholeCompany && namesLeave;
  const forSelf = !picksManager || (Boolean(form.managerEmployeeId) && form.managerEmployeeId === selfEmployeeId);
  const handsOnMore = namesApprovals && forSelf && Boolean(selfEmployeeId);
  const choice = !handsOnMore && form.choice === 'ALL' ? 'TIME' : form.choice;
  const chosen = handsOnMore ? form.chosen : form.chosen.filter((t) => TIME.has(t));
  const requestTypes = choice === 'CHOSEN' ? chosen : CHOICES[choice];
  const timeAlone = requestTypes.length > 0 && requestTypes.every((t) => TIME.has(t));
  /* Through my own sign-in when it is mine and I hand on approvals; else the leave route, which takes leave and attendance. */
  const asMine = forSelf && namesApprovals && Boolean(selfEmployeeId);
  const same = Boolean(form.standInEmployeeId) && form.standInEmployeeId === (picksManager ? form.managerEmployeeId : selfEmployeeId);
  const allowed = asMine || (namesLeave && timeAlone);
  const ready = form.standInEmployeeId && form.fromDate && form.toDate && (!picksManager || form.managerEmployeeId) && !same && (choice !== 'CHOSEN' || chosen.length > 0) && allowed;
  const dirty = Boolean(form.standInEmployeeId || form.fromDate);
  const toggle = (t) => setForm((f) => ({ ...f, chosen: f.chosen.includes(t) ? f.chosen.filter((x) => x !== t) : [...f.chosen, t] }));

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    const body = { standInEmployeeId: form.standInEmployeeId, fromDate: form.fromDate, toDate: form.toDate, requestTypes };
    try {
      if (asMine) await addApprovalDelegate(body);
      else await addLeaveDelegate({ ...(picksManager ? { managerEmployeeId: form.managerEmployeeId } : {}), ...body });
      const name = standInOptions.find((o) => o.value === form.standInEmployeeId)?.label?.replace(/ \(.*\)$/, '') || 'They';
      notify.success(`${name} decides ${scopeWords(requestTypes).toLowerCase()} from ${formatDate(form.fromDate)} to ${formatDate(form.toDate)}.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const radio = (key, text, disabled = false) => (
    <label className="ui-choice-row"><input type="radio" name="delegate-what" checked={choice === key} disabled={disabled} onChange={() => set('choice', key)} /><span className="flex-1">{text}</span></label>
  );

  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" dirty={dirty} title="Add delegate"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-delegate" className="ui-btn ui-btn-primary" disabled={!ready || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <form id="add-delegate" onSubmit={save} className="space-y-4">
        {picksManager ? <PopupSelect showValueSubtext={false} label="In place of *" value={form.managerEmployeeId} onChange={(v) => set('managerEmployeeId', v || '')} placeholder="Choose…" alwaysSearch options={options} /> : null}
        <PopupSelect showValueSubtext={false} label="Decides *" value={form.standInEmployeeId} onChange={(v) => set('standInEmployeeId', v || '')} placeholder="Choose…" alwaysSearch options={standInOptions} />
        {same ? <p className="ui-caption ui-text-neg" role="alert">Someone else decides.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="dl-from">From *</span><DatePicker label="From" describedBy="dl-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          <div><span className="ui-label" id="dl-to">To *</span><DatePicker label="To" describedBy="dl-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>
        </div>
        <fieldset className="space-y-2">
          <legend className="ui-label">What they decide</legend>
          <div role="radiogroup" aria-label="What they decide" className="ui-choice-list">
            {radio('ALL', 'All approvals', !handsOnMore)}
            {radio('TIME', 'Leave and attendance', !namesLeave && !asMine)}
            {radio('LEAVE', 'Leave only', !namesLeave && !asMine)}
            {radio('CHOSEN', 'Chosen request types')}
          </div>
          {choice === 'CHOSEN' ? (
            <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Request types">
              {TYPES.map(([key, text]) => (
                <label key={key} className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={chosen.includes(key)} disabled={!handsOnMore && !TIME.has(key)} onChange={() => toggle(key)} />{text}</label>
              ))}
            </div>
          ) : null}
          {namesApprovals && !selfEmployeeId ? <span className="block ui-caption">Other approvals are handed on from your own employee record; your sign-in is not linked to one.</span>
            : namesApprovals && !forSelf ? <span className="block ui-caption">Other approvals are handed on by the manager themselves, from their own sign-in.</span> : null}
        </fieldset>
      </form>
    </Drawer>
  );
}
