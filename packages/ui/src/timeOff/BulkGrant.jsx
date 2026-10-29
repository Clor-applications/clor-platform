import React, { useEffect, useRef, useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import SuggestInput from '@ui/components/ui/SuggestInput';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';

import { useSuggestions } from './suggestions';
import { bulkGrantLeave } from './api';

/**
 * Leave balances → Grant leave to many (owner, 29 Oct 2026, from ERPNext's
 * Leave Control Panel): the same days of one leave type to everyone, or to
 * some departments or employment types, for one leave period, with one
 * reason that stays on every person's record. The server says who it goes to
 * and who it skips (left, not eligible for the type, your own balance) before
 * anything is saved; Grant saves it for those people only.
 */
const BLANK = { leaveTypeId: '', days: '', reason: '', departmentIds: [], employeeTypeIds: [] };

export default function BulkGrant({ types, year, label, onClose, onDone }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const reasons = useSuggestions('leaveReason');
  const refs = useRequest(() => Promise.all([listStructure('departments').catch(() => []), listStructure('employee-types').catch(() => [])]).then(([departments, employeeTypes]) => ({ departments, employeeTypes })), []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const days = Number(form.days);
  const daysOk = days > 0 && days <= 366 && Math.round(days * 2) === days * 2;
  const body = { leaveTypeId: form.leaveTypeId, year, days, reason: form.reason.trim(), departmentIds: form.departmentIds, employeeTypeIds: form.employeeTypeIds };
  const ready = Boolean(form.leaveTypeId) && daysOk && body.reason.length >= 3;
  const dirty = Boolean(form.leaveTypeId || form.days || form.reason || form.departmentIds.length || form.employeeTypeIds.length);

  /* Who it goes to follows the form; the newest answer wins. */
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    if (!form.leaveTypeId || !daysOk) { setPreview(null); return undefined; }
    const t = setTimeout(() => {
      bulkGrantLeave({ ...body, reason: body.reason || 'Preview', preview: true })
        .then((r) => { if (n === seq.current) setPreview(r); })
        .catch((e) => { if (n === seq.current) setPreview({ error: String(e?.message || 'Could not work out who it goes to.') }); });
    }, 300);
    return () => clearTimeout(t);
  }, [form.leaveTypeId, form.days, form.departmentIds, form.employeeTypeIds, year]);

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving || !preview?.count) return;
    setSaving(true);
    try {
      const out = await bulkGrantLeave(body);
      notify.success(`${days} ${days === 1 ? 'day' : 'days'} granted to ${out.granted} ${out.granted === 1 ? 'person' : 'people'}.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not granted.'));
    } finally {
      setSaving(false);
    }
  };

  const chips = (key, legend, items, every) => (items.length ? (
    <fieldset>
      <legend className="ui-label">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => <button key={x.id} type="button" className="ui-choice-chip" aria-pressed={form[key].includes(x.id)} onClick={() => toggle(key, x.id)}>{x.name}</button>)}
      </div>
      {!form[key].length ? <span className="ui-caption">None chosen: {every}.</span> : null}
    </fieldset>
  ) : null);

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      widthClass="w-[min(36rem,96vw)]"
      title="Grant leave to many"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="bulk-grant" className="ui-btn ui-btn-primary" disabled={!ready || saving || !preview?.count}>{saving ? 'Granting…' : preview?.count ? `Grant to ${preview.count}` : 'Grant'}</button>
      </>}
    >
      <form id="bulk-grant" onSubmit={save} className="space-y-4">
        <p className="text-sm ui-muted">For {label}. Each person's balance shows it as changed by HR, with this reason.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <PopupSelect showValueSubtext={false} label="Leave type *" value={form.leaveTypeId} onChange={(v) => set('leaveTypeId', v || '')} placeholder="Choose…" options={types.map((t) => ({ value: t.id, label: t.name }))} />
          <label className="block">
            <span className="ui-label">Days each *</span>
            <input type="number" min={0.5} max={366} step={0.5} className="ui-input w-full tabular-nums" value={form.days} onChange={(e) => set('days', e.target.value)} />
          </label>
        </div>
        {chips('departmentIds', 'Departments', refs.data?.departments || [], 'every department')}
        {chips('employeeTypeIds', 'Employment types', refs.data?.employeeTypes || [], 'every employment type')}
        <label className="block">
          <span className="ui-label">Reason *</span>
          <SuggestInput maxLength={300} value={form.reason} onChange={(v) => set('reason', v)} suggestions={reasons} />
        </label>
        {preview?.error ? <p className="text-sm ui-text-neg" role="alert">{preview.error}</p> : preview ? (
          <div className="text-sm space-y-1" aria-live="polite">
            <p>Goes to <strong className="tabular-nums">{preview.count}</strong> {preview.count === 1 ? 'person' : 'people'}{preview.count ? `: ${preview.names.join(', ')}${preview.count > preview.names.length ? ` and ${preview.count - preview.names.length} more` : ''}` : ''}.</p>
            {preview.skipped?.length ? (
              <ul className="ui-caption space-y-0.5" aria-label="Left out">
                {preview.skipped.slice(0, 8).map((x) => <li key={x.employeeId}>{x.name}: {x.why}</li>)}
                {preview.skipped.length > 8 ? <li>and {preview.skipped.length - 8} more left out</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}
