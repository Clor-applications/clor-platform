import React, { useMemo, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { can } from '../workforce/shared';
import { WEEKDAYS, getWorkingWeek, saveWorkingWeek } from './api';

/**
 * Settings → Working week (TIME-LEAVE-DECISIONS M2). A People-only company has
 * no shifts, so without this leave charged every Saturday of a five-day week.
 * It is the weekly off for anyone no shift covers; with Attendance, shifts win.
 * A form being filled: one sheet, Save in its footer.
 */
const SATURDAY = 6;
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
const SATURDAY_PLANS = [
  /* A picker reads an empty value as nothing chosen, so "none off" has its own. */
  { value: 'none', label: 'Every Saturday works' },
  { value: '2,4', label: '2nd and 4th off' },
  { value: '1,3', label: '1st and 3rd off' },
  { value: '1,3,5', label: '1st, 3rd and 5th off' },
  { value: 'custom', label: 'Choose which' },
];
const list = (s) => [...new Set(String(s || '').split(',').filter(Boolean).map(Number))].sort((a, b) => a - b);
const text = (a) => [...a].sort((x, y) => x - y).join(',');

export default function WorkingWeek() {
  const perms = usePermissions();
  const canEdit = can(perms, 'ATTENDANCE::Leave Types::EDIT');
  const req = useRequest(() => getWorkingWeek(), []);
  const saved = useMemo(() => (req.data ? { offs: text(list(req.data.weeklyOffDays)), sats: text(list(req.data.offSaturdays)) } : null), [req.data]);
  /* Edits sit over what was loaded; null means nothing has been changed. */
  const [draft, setDraft] = useState(null);
  const [custom, setCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const form = draft || saved;
  const dirty = Boolean(draft && saved && (draft.offs !== saved.offs || draft.sats !== saved.sats));
  useUnsavedChanges(dirty);

  if (req.error && !req.data) return <div className="space-y-6 max-w-2xl"><PageHeader title="Working week" /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!form) return <div className="space-y-6 max-w-2xl"><PageHeader title="Working week" /><SkeletonCard lines={4} /></div>;

  const offs = list(form.offs);
  const sats = list(form.sats);
  const allOff = offs.length >= 7;
  const saturdayWorks = !offs.includes(SATURDAY);
  const plan = !form.sats && !custom ? 'none' : custom || !SATURDAY_PLANS.some((p) => p.value === form.sats) ? 'custom' : form.sats;
  const change = (next) => { setError(null); setDraft({ ...form, ...next }); };
  const toggleDay = (d) => change({ offs: text(offs.includes(d) ? offs.filter((x) => x !== d) : [...offs, d]) });
  const toggleSat = (n) => change({ sats: text(sats.includes(n) ? sats.filter((x) => x !== n) : [...sats, n]) });

  const save = async (e) => {
    e.preventDefault();
    if (!dirty || saving) return;
    if (allOff) { setError({ message: 'At least one day of the week is a working day.' }); return; }
    setSaving(true);
    setError(null);
    try {
      /* A Saturday off every week leaves nothing to choose; the server clears it too. */
      const out = await saveWorkingWeek({ weeklyOffDays: form.offs, offSaturdays: saturdayWorks ? form.sats : '' });
      req.setData((d) => ({ ...d, ...out }));
      setDraft(null);
      setCustom(false);
      notify.success('Working week saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Working week" />
      <form className="ui-record-section ui-wizard-body space-y-6" aria-label="Working week" onSubmit={save}>
        {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
        {req.data.defaultShift ? <p className="ui-caption">A default shift is set in Attendance, so its weekly offs apply instead of this week.</p> : req.data.shiftsDecide ? <p className="ui-caption">People on a shift follow its weekly offs; this week is for everyone else.</p> : null}

        <fieldset disabled={!canEdit}>
          <legend className="ui-label">Days off</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((name, d) => (
              <button key={name} type="button" className="ui-choice-chip" aria-pressed={offs.includes(d)} onClick={() => toggleDay(d)}>{name}</button>
            ))}
          </div>
          {allOff ? <p className="ui-caption ui-text-neg mt-2" role="alert">At least one day of the week is a working day.</p> : null}
        </fieldset>

        {saturdayWorks ? (
          <div className="space-y-3">
            <div className="sm:w-72">
              <PopupSelect
                showValueSubtext={false}
                label="Saturdays"
                value={plan}
                disabled={!canEdit}
                onChange={(v) => {
                  if (v === 'custom') { setCustom(true); return; }
                  setCustom(false);
                  change({ sats: v === 'none' ? '' : v || '' });
                }}
                options={SATURDAY_PLANS}
              />
            </div>
            {plan === 'custom' ? (
              <fieldset disabled={!canEdit}>
                <legend className="ui-label">Saturdays off</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ORDINALS.map((label, i) => (
                    <button key={label} type="button" className="ui-choice-chip" aria-pressed={sats.includes(i + 1)} onClick={() => toggleSat(i + 1)}>{label}</button>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <div className="ui-wizard-actions">
            <span className="flex flex-wrap gap-2 ml-auto">
              {dirty ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setDraft(null); setCustom(false); setError(null); }}>Undo changes</button> : null}
              <button type="submit" className="ui-btn ui-btn-primary" disabled={!dirty || saving || allOff}>{saving ? 'Saving…' : 'Save'}</button>
            </span>
          </div>
        ) : null}
      </form>
    </div>
  );
}
