import React from 'react';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { formatDate } from '@ui/components/ui/DatePicker';

/*
 * Half days on a leave request, in every leave form (HR's, My leave, the
 * employee app). One day: the whole day, or its first or second half. Several
 * days: the first day may start after lunch and the last may end at lunch
 * (ERPNext's half-day date, at either end); the server keeps such a day as a
 * half-day row of its own, linked to the rest.
 */

const isOneDay = (form) => Boolean(form.fromDate) && (!form.toDate || form.toDate === form.fromDate);

/** What the form sends for its half days: only what applies to the dates on screen and the type. */
export const halfDayBody = (form, allowed) => {
  const one = isOneDay(form);
  return {
    halfDay: allowed && one && form.halfDay ? form.halfDay : null,
    ...(allowed && !one && form.startHalf ? { startHalf: true } : {}),
    ...(allowed && !one && form.endHalf ? { endHalf: true } : {}),
  };
};

/**
 * A request as its form shows it: a leave saved as linked parts (a half day at
 * either end, or the period end) is changed as one, from its first day to its
 * last. `rows`: the request's parts, or any list that holds them.
 */
export function leaveSpan(request, rows = []) {
  const parts = [request, ...rows.filter((x) => x.id !== request.id && request.groupId && x.groupId === request.groupId && x.status === request.status)]
    .sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
  const first = parts[0];
  const last = parts[parts.length - 1];
  const longer = first.fromDate !== last.toDate;
  return {
    fromDate: first.fromDate,
    toDate: last.toDate,
    halfDay: longer ? '' : request.halfDay || '',
    startHalf: longer && first.halfDay === 'SECOND',
    endHalf: longer && last.halfDay === 'FIRST',
  };
}

function Tick({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="ui-checkbox mt-0.5" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}<span className="ui-caption block">{hint}</span></span>
    </label>
  );
}

const DAY_OPTIONS = [{ value: 'WHOLE', label: 'Whole day' }, { value: 'FIRST', label: 'First half' }, { value: 'SECOND', label: 'Second half' }];

/** `native`: a plain select, for the employee app's own form styling. */
export default function HalfDayChoice({ form, allowed, typeName, onChange, native = false, label = 'Day' }) {
  if (!form.fromDate) return null;
  if (!allowed) return typeName ? <p className="ui-caption">{typeName} is taken in whole days.</p> : null;
  if (isOneDay(form)) {
    if (native) {
      return (
        <label className="block">
          <span className="ui-label">{label}</span>
          <select className="ui-select w-full" value={form.halfDay || ''} onChange={(e) => onChange({ halfDay: e.target.value })}>
            {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value === 'WHOLE' ? '' : o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    return <PopupSelect showValueSubtext={false} label={label} value={form.halfDay || 'WHOLE'} onChange={(v) => onChange({ halfDay: v === 'WHOLE' ? '' : v || '' })} options={DAY_OPTIONS} />;
  }
  return (
    <fieldset className="space-y-2">
      <legend className="ui-label">Half days</legend>
      <Tick label="Leave after lunch on the first day" hint="The first day counts as half a day." checked={form.startHalf} onChange={(v) => onChange({ startHalf: v })} />
      <Tick label="Back after lunch on the last day" hint="The last day counts as half a day." checked={form.endHalf} onChange={(v) => onChange({ endHalf: v })} />
    </fieldset>
  );
}

/** Under the preview: which days of a longer leave are half days, as the server will save them. */
export function HalfDayNote({ parts = [] }) {
  const rows = parts.flatMap((p) => p.rows || []);
  const halves = rows.length > 1 ? rows.filter((r) => r.halfDay) : [];
  if (!halves.length) return null;
  return <p className="ui-caption tabular-nums">{halves.map((r) => `${formatDate(r.from)}: ${r.halfDay === 'FIRST' ? 'first' : 'second'} half only`).join(' · ')}</p>;
}
