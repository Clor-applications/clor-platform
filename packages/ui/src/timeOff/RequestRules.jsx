import React, { useMemo, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { can } from './shared';
import { getRequestRules, saveRequestRules } from './api';
import { KINDS, KIND_NAME } from './AttendanceRequests';

/**
 * Settings → Request rules (TIME-LEAVE-DECISIONS.md, advanced build): for
 * each kind of attendance request, whether it is on, the month's quota, how
 * far back one may ask, and who approves. One sheet, a block per kind, Save
 * in its footer. A missed punch keeps the company's correction chain.
 */
const APPROVAL = [
  { value: 'company', label: "Company's rule" },
  { value: 'HR', label: 'HR' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'MANAGER_THEN_HR', label: 'Manager, then HR' },
];
const num = (v) => (v === '' || v == null ? '' : String(v));
/** The form's words for one kind's rule, every number as text so an emptied box reads as "no limit". */
const toForm = (r) => ({ on: Boolean(r.on), quotaPerMonth: num(r.quotaPerMonth), hoursPerMonth: num(r.hoursPerMonth), maxMinutes: num(r.maxMinutes), backDays: num(r.backDays), approval: r.approval || 'company' });
/** What the server takes: only what changed, kind by kind. */
const toBody = (k, f) => ({
  on: f.on,
  backDays: Math.max(0, Math.min(366, Number(f.backDays) || 0)),
  ...(k === 'PERMISSION'
    ? { hoursPerMonth: f.hoursPerMonth === '' ? null : Math.max(0, Number(f.hoursPerMonth) || 0), maxMinutes: Math.max(15, Math.min(480, Number(f.maxMinutes) || 15)) }
    : { quotaPerMonth: f.quotaPerMonth === '' ? null : Math.max(0, Math.min(31, Math.round(Number(f.quotaPerMonth) || 0))) }),
  ...(k === 'MISSED_PUNCH' ? {} : { approval: f.approval === 'company' ? null : f.approval }),
});

export default function RequestRules() {
  const perms = usePermissions();
  /* The rules are the company's: a team-scoped role reads them (the server refuses its changes). */
  const canEdit = can(perms, 'ATTENDANCE::Attendance Requests::APPROVE') && !perms?.ownDocumentsOnly;
  const req = useRequest(() => getRequestRules(), []);
  const saved = useMemo(() => (req.data?.rules ? Object.fromEntries(KINDS.map((k) => [k, toForm(req.data.rules[k] || {})])) : null), [req.data]);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const form = draft || saved;
  const changed = form && saved ? KINDS.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(saved[k])) : [];
  const dirty = changed.length > 0;
  useUnsavedChanges(dirty);

  if (req.error && !req.data) return <div className="space-y-6 max-w-2xl"><PageHeader title="Attendance request types" /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!form) return <div className="space-y-6 max-w-2xl"><PageHeader title="Attendance request types" /><SkeletonCard lines={6} /></div>;

  const change = (k, patch) => { setError(null); setDraft({ ...form, [k]: { ...form[k], ...patch } }); };
  const save = async (e) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const out = await saveRequestRules(Object.fromEntries(changed.map((k) => [k, toBody(k, form[k])])));
      req.setData((d) => ({ ...d, rules: out?.rules || d.rules }));
      setDraft(null);
      notify.success('Request rules saved.');
    } catch (err) {
      setError(err);
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Attendance request types" />
      <form className="ui-record-section ui-wizard-body" aria-label="Request rules" onSubmit={save}>
        {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
        <div className="divide-y">
          {KINDS.map((k) => {
            const f = form[k];
            const id = `rr-${k}`;
            return (
              <fieldset key={k} disabled={!canEdit} className="py-6 first:pt-0 last:pb-0 space-y-4" aria-labelledby={`${id}-h`}>
                <div className="flex items-center justify-between gap-4">
                  <legend id={`${id}-h`} className="ui-t-sec">{KIND_NAME[k]}</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={f.on} onChange={(e) => change(k, { on: e.target.checked })} />On</label>
                </div>
                {k === 'SHIFT_CHANGE' ? <p className="ui-caption">Someone asks to work another shift for some days. Approved, those days run on that shift; cancelled, they go back.</p> : null}
                <div className="grid gap-4 sm:grid-cols-3">
                  {k === 'PERMISSION' ? (
                    <>
                      <label className="block">
                        <span className="ui-label">Hours a month</span>
                        <input type="number" min={0} max={200} step={0.5} className="ui-input w-full tabular-nums" value={f.hoursPerMonth} placeholder="No limit" onChange={(e) => change(k, { hoursPerMonth: e.target.value })} />
                      </label>
                      <label className="block">
                        <span className="ui-label">Longest permission, minutes</span>
                        <input type="number" min={15} max={480} step={15} className="ui-input w-full tabular-nums" value={f.maxMinutes} onChange={(e) => change(k, { maxMinutes: e.target.value })} />
                      </label>
                    </>
                  ) : (
                    <label className="block">
                      <span className="ui-label">{k === 'MISSED_PUNCH' ? 'Requests a month' : 'Days a month'}</span>
                      <input type="number" min={0} max={31} step={1} className="ui-input w-full tabular-nums" value={f.quotaPerMonth} placeholder="No limit" onChange={(e) => change(k, { quotaPerMonth: e.target.value })} />
                    </label>
                  )}
                  <label className="block">
                    <span className="ui-label">How far back, days</span>
                    <input type="number" min={0} max={366} step={1} className="ui-input w-full tabular-nums" value={f.backDays} onChange={(e) => change(k, { backDays: e.target.value })} />
                  </label>
                  {k === 'MISSED_PUNCH' ? (
                    <div className="block">
                      <span className="ui-label">Who approves</span>
                      <p className="text-sm pt-2">The company's correction rule.</p>
                    </div>
                  ) : (
                    <PopupSelect showValueSubtext={false} label="Who approves" value={f.approval} disabled={!canEdit} onChange={(v) => change(k, { approval: v || 'company' })} options={APPROVAL} />
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>

        {canEdit ? (
          <div className="ui-wizard-actions">
            <span className="flex flex-wrap gap-2 ml-auto">
              {dirty ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setDraft(null); setError(null); }}>Undo changes</button> : null}
              <button type="submit" className="ui-btn ui-btn-primary" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
            </span>
          </div>
        ) : null}
      </form>
    </div>
  );
}
