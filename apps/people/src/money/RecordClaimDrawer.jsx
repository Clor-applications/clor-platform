import React, { useRef, useState } from 'react';
import { Plus, Upload, X } from '@ui/components/ui/lineIcons';

import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { Button } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { todayIst as today } from '@ui/utils/dates';

import { listCategories, readBill, recordClaim } from '../api/money';
import { money } from './words';

/**
 * HR records a claim on a person's behalf (People plan 8 Nov 2026, step 4): a
 * paper bill handed over, someone without the app. The same bills the person
 * would add themselves, sent for approval under their name and marked as
 * recorded by HR. The person was chosen in the drawer before this one.
 */
const blankLine = () => ({ key: Math.random().toString(36).slice(2), spentOn: today(), categoryId: '', merchant: '', amount: '', note: '', bill: null, billName: '' });

export default function RecordClaimDrawer({ person, onClose, onDone }) {
  const cats = useRequest(() => listCategories().then((rows) => rows.filter((c) => c.active !== false)).catch(() => []), []);
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRefs = useRef({});
  const set = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const dirty = Boolean(title.trim()) || lines.some((l) => l.merchant || l.amount);
  const pick = async (key, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify.error('Bills up to 5 MB.'); return; }
    try { const b = await readBill(file); set(key, { bill: b.data, billName: b.name }); } catch (err) { notify.error(String(err?.message || 'Could not read the file.')); }
  };
  const save = async () => {
    const bad = lines.find((l) => !l.categoryId || !l.merchant.trim() || !(Number(l.amount) > 0) || !l.spentOn);
    if (bad) { setError({ message: 'Each bill needs the day, what it was for, where it was spent and the amount.' }); return; }
    setBusy(true);
    setError(null);
    try {
      const claim = await recordClaim({
        employeeId: person.id,
        title: title.trim() || null,
        lines: lines.map((l) => ({ spentOn: l.spentOn, categoryId: l.categoryId, merchant: l.merchant.trim(), amount: Number(l.amount), note: l.note.trim() || null, ...(l.bill ? { bill: l.bill, billName: l.billName } : {}) })),
      });
      notify.success(`${claim.number} recorded for ${person.name}: ${money(claim.claimed)}. It waits for approval in the Inbox.`);
      onDone(claim);
    } catch (e) { setError(e); setBusy(false); }
  };
  const options = (cats.data || []).map((c) => ({ value: c.id, label: c.name, subtext: c.limitPerBill ? `Up to ${money(c.limitPerBill)} a bill` : '' }));
  return (
    <Drawer open onClose={onClose} title={`Record a claim for ${person.name}`} widthClass="w-[min(44rem,96vw)] ui-drawer-sheet" dirty={dirty}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <Button variant="primary" loading={busy} onClick={save}>Record claim</Button>
      </>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
        <label className="block"><span className="ui-label">Claim</span><SuggestInput maxLength={120} value={title} onChange={setTitle} placeholder="Spent for work" suggestions={['Paper bills handed in', 'Client visit', 'Site purchase']} /></label>
        <ol className="space-y-4" aria-label="Bills">
          {lines.map((l, i) => (
            <li key={l.key} className="ui-form-grid border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }}>
              <div className="sm:col-span-2 flex items-center justify-between gap-2">
                <span className="ui-label">Bill {i + 1}</span>
                {lines.length > 1 ? <button type="button" className="ui-icon-btn" aria-label={`Remove bill ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X size={16} aria-hidden="true" /></button> : null}
              </div>
              <div><label className="ui-label" htmlFor={`spent-${l.key}`}>Spent on *</label><DatePicker id={`spent-${l.key}`} value={l.spentOn} max={today()} onChange={(v) => set(l.key, { spentOn: v || '' })} /></div>
              <div><PopupSelect label="For *" showValueSubtext={false} value={l.categoryId} placeholder={cats.loading ? 'Loading…' : 'Choose…'} onChange={(v) => set(l.key, { categoryId: v || '' })} options={options} /></div>
              <label className="block"><span className="ui-label">Where *</span><SuggestInput maxLength={120} value={l.merchant} onChange={(v) => set(l.key, { merchant: v })} placeholder="The shop, cab or hotel" suggestions={[]} /></label>
              <label className="block"><span className="ui-label">Amount *</span><input className="ui-input w-full tabular-nums" inputMode="decimal" aria-label={`Amount for bill ${i + 1}`} value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value.replace(/[^\d.]/g, '') })} /></label>
              <label className="block sm:col-span-2"><span className="ui-label">Note</span><input className="ui-input w-full" maxLength={300} value={l.note} onChange={(e) => set(l.key, { note: e.target.value })} /></label>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-2 text-sm">
                <input ref={(el) => { fileRefs.current[l.key] = el; }} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" aria-label={`Bill file ${i + 1}`} onChange={(e) => pick(l.key, e)} />
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => fileRefs.current[l.key]?.click()}><Upload size={14} aria-hidden="true" /> {l.bill ? 'Replace the bill' : 'Attach the bill'}</button>
                {l.bill ? <span className="ui-caption truncate">{l.billName}</span> : <span className="ui-caption">A photo or PDF, up to 5 MB.</span>}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={16} aria-hidden="true" /> Add another bill</button>
          <span className="text-sm">Total <span className="font-medium tabular-nums">{money(total)}</span></span>
        </div>
        <p className="ui-caption">It goes for approval under {person.name}’s name, marked as recorded by you, and is paid from To pay once approved.</p>
      </form>
    </Drawer>
  );
}
