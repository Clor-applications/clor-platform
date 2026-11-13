import React, { useEffect, useState } from 'react';

/** The kinds of day overtime is paid for, in the order the screen shows them. */
const DAY_TYPES = [
  ['working', 'Working day'],
  ['weeklyOff', 'Weekly off'],
  ['holiday', 'Holiday'],
];

const CAPS = [
  ['dayMinutes', 'In a day'],
  ['weekMinutes', 'In a week'],
  ['quarterMinutes', 'In a quarter'],
];

/* Caps are kept in minutes and typed in hours; blank is no cap. */
const hoursOf = (minutes) => (minutes === null || minutes === undefined ? '' : String(Math.round((minutes / 60) * 100) / 100));
const minutesOf = (hours) => (String(hours).trim() === '' ? null : Math.round(Number(hours) * 60));

const draftOf = (rules) => ({
  rates: Object.fromEntries(DAY_TYPES.map(([k]) => [k, String(rules.rates?.[k] ?? 2)])),
  caps: Object.fromEntries(CAPS.map(([k]) => [k, hoursOf(rules.caps?.[k])])),
});

/** Why the draft cannot be saved, or ''. */
function ratesCapsProblem(draft) {
  for (const [k, label] of DAY_TYPES) {
    const n = Number(draft.rates[k]);
    if (String(draft.rates[k]).trim() === '' || !Number.isFinite(n) || n < 1 || n > 10) return `${label}: the rate is between 1 and 10 times the ordinary rate.`;
  }
  for (const [k, label] of CAPS) {
    const v = String(draft.caps[k]).trim();
    if (v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) return `${label}: the cap is a number of hours, or blank for no cap.`;
  }
  const [day, week, quarter] = CAPS.map(([k]) => minutesOf(draft.caps[k]));
  if (day !== null && week !== null && day > week) return 'The cap for a day cannot be more than the cap for a week.';
  if (week !== null && quarter !== null && week > quarter) return 'The cap for a week cannot be more than the cap for a quarter.';
  return '';
}

/**
 * What overtime is paid at on each kind of day, and the most overtime in a
 * day, a week and a quarter (AttendanceSettings.overtimePolicy). Typed as a
 * draft and saved together: a rate half typed is never the company's rate.
 */
export default function OvertimeRatesCaps({ rules, suggestedCaps, save }) {
  const [draft, setDraft] = useState(() => draftOf(rules));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(draftOf(rules)); }, [rules]);

  const problem = ratesCapsProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(rules));
  const set = (group, key, value) => setDraft((d) => ({ ...d, [group]: { ...d[group], [key]: value } }));
  const submit = async () => {
    setSaving(true);
    try {
      await save({
        ...rules,
        rates: Object.fromEntries(DAY_TYPES.map(([k]) => [k, Number(draft.rates[k])])),
        caps: Object.fromEntries(CAPS.map(([k]) => [k, minutesOf(draft.caps[k])])),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="ui-label">Overtime is paid at this many times the ordinary rate</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {DAY_TYPES.map(([k, label]) => (
            <label key={k} className="block">
              <span className="ui-caption">{label}</span>
              <input type="number" min={1} max={10} step={0.25} inputMode="decimal" className="ui-input tabular-nums" value={draft.rates[k]} onChange={(e) => set('rates', k, e.target.value)} />
            </label>
          ))}
        </div>
        <p className="ui-caption">
          Section 59 of the Factories Act, 1948 sets twice the ordinary rate. It names no higher rate for a weekly off or a holiday; set one if you pay it.
          Payroll still takes the approved hours as they are. The hours at these rates are shown beside them in the month summary and the overtime register.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="ui-label">Most overtime, in hours</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {CAPS.map(([k, label]) => (
            <label key={k} className="block">
              <span className="ui-caption">{label}</span>
              <input type="number" min={0} step={0.5} inputMode="decimal" className="ui-input tabular-nums" placeholder="No cap" value={draft.caps[k]} onChange={(e) => set('caps', k, e.target.value)} />
            </label>
          ))}
        </div>
        <p className="ui-caption">
          Hours over a cap are kept on the day and marked “over the cap” for whoever approves the overtime. Blank means no cap.
          A week is Sunday to Saturday; a quarter starts on 1 January, April, July and October.
        </p>
        {suggestedCaps ? (
          <p className="ui-caption">
            <button type="button" className="ui-link" onClick={() => setDraft((d) => ({ ...d, caps: Object.fromEntries(CAPS.map(([k]) => [k, hoursOf(suggestedCaps[k])])) }))}>
              Use {hoursOf(suggestedCaps.dayMinutes)} hours a day, {hoursOf(suggestedCaps.weekMinutes)} a week and {hoursOf(suggestedCaps.quarterMinutes)} a quarter
            </button>
            . These come from section 64(4) of the Factories Act, 1948: a 10-hour day, a 60-hour week and 50 hours of overtime a quarter.
            The limits differ by state. Some states allow more in a quarter (section 65 allows 75 under a state order), and shops and offices
            follow the state’s Shops and Establishments Act instead. Check the rule for your state before relying on these figures.
          </p>
        ) : null}
      </fieldset>

      {problem && dirty ? <p className="ui-caption" role="alert" style={{ color: 'rgb(var(--neg))' }}>{problem}</p> : null}
      {dirty ? (
        <div className="flex gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" data-write onClick={submit} disabled={saving || Boolean(problem)}>{saving ? 'Saving…' : 'Save rates and caps'}</button>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setDraft(draftOf(rules))} disabled={saving}>Undo changes</button>
        </div>
      ) : null}
    </div>
  );
}
