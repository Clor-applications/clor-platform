import React from 'react';
import PopupSelect from '@ui/components/pickers/PopupSelect';

import { QUARTERS } from './partOfDay';

/*
 * Hourly leave and the preview's notes, the same in HR's Enter leave, My
 * leave and the employee app (TIME-LEAVE-DECISIONS.md, "Leave policy rules").
 * Half days are HalfDayChoice's.
 */

function Time({ label, value, options, onChange, native }) {
  if (native) {
    return (
      <label className="block">
        <span className="ui-label">{label}</span>
        <select className="ui-select w-full" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
    );
  }
  return <div><PopupSelect showValueSubtext={false} label={label} value={value || ''} placeholder="Choose…" onChange={(v) => onChange(v || '')} options={options.map((t) => ({ value: t, label: t }))} /></div>;
}

/** From and to on the one day, in quarter hours. `native`: plain selects, for the employee app's own form styling. */
export function HoursChoice({ form, onChange, native = false }) {
  if (!form.fromDate) return null;
  const ends = QUARTERS.filter((t) => !form.fromTime || t > form.fromTime);
  return (
    <div className="grid gap-4 grid-cols-2">
      <Time label="From *" value={form.fromTime} options={QUARTERS} native={native} onChange={(v) => onChange({ fromTime: v, ...(form.toTime && v && form.toTime <= v ? { toTime: '' } : {}) })} />
      <Time label="To *" value={form.toTime} options={ends} native={native} onChange={(v) => onChange({ toTime: v })} />
    </div>
  );
}

/** What the preview says that does not stop the request: serving notice, days over the balance as loss of pay. */
export function PreviewNotes({ preview }) {
  const notes = preview?.warnings || [];
  if (!notes.length) return null;
  return (
    <ul className="space-y-1" aria-label="Before you send">
      {notes.map((w) => <li key={w.code + w.message} className="text-sm ui-text-warn">{w.message}</li>)}
    </ul>
  );
}
