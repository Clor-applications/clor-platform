import React from 'react';
import { BarList, ChartPanel } from '@ui/timeOff/Figures';
import { todayIst } from '@ui/utils/dates';

/**
 * Round 45 picks (18 Nov 2026), from the employee list the report already reads:
 *  - ageprofile A: bars by age band, under 25, 25–35, 35–45, 45–55, 55+.
 *  - spanofcontrol A: managers with their team size, largest first.
 * Counts only for ages; nobody's date of birth is shown.
 */

export const AGE_BANDS = [
  { key: 'u25', label: 'Under 25', min: 0, max: 25 },
  { key: '25to35', label: '25–35', min: 25, max: 35 },
  { key: '35to45', label: '35–45', min: 35, max: 45 },
  { key: '45to55', label: '45–55', min: 45, max: 55 },
  { key: '55p', label: '55+', min: 55, max: Infinity },
];

const working = (e) => e && e.status !== 'LEFT';

/** Whole years between a date of birth and today (IST dates as YYYY-MM-DD). */
export function ageOn(dob, today = todayIst()) {
  const d = dob ? String(dob).slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) return null;
  let years = Number(today.slice(0, 4)) - Number(d.slice(0, 4));
  if (today.slice(5) < d.slice(5)) years -= 1;
  return years;
}

export function ageBands(people, today = todayIst()) {
  const counts = Object.fromEntries(AGE_BANDS.map((b) => [b.key, 0]));
  let noDate = 0;
  for (const e of people || []) {
    if (!working(e)) continue;
    const age = ageOn(e.dateOfBirth, today);
    if (age === null) { noDate += 1; continue; }
    const band = AGE_BANDS.find((b) => age >= b.min && age < b.max);
    counts[band.key] += 1;
  }
  return { rows: AGE_BANDS.map((b) => ({ key: b.key, label: b.label, value: counts[b.key] })), noDate };
}

/** Managers of people working today, with how many report to each, largest team first. */
export function managerSpans(people) {
  const list = (people || []).filter(working);
  const nameOf = new Map(list.map((e) => [e.id, e.name]));
  const spans = new Map();
  for (const e of list) {
    const m = e.reportingManagerId;
    if (!m || m === e.id) continue;
    const row = spans.get(m) || { id: m, name: e.reportingManagerName || nameOf.get(m) || 'Someone who has left', team: 0 };
    row.team += 1;
    spans.set(m, row);
  }
  return [...spans.values()].sort((a, b) => b.team - a.team || a.name.localeCompare(b.name));
}

export function AgePanel({ employees }) {
  const { rows, noDate } = ageBands(employees);
  if (!rows.some((r) => r.value)) return null;
  return (
    <ChartPanel title="Age mix" note={noDate ? `Working today · ${noDate} without a date of birth left out` : 'Working today'}>
      <BarList one label="People working today by age" rows={rows} />
    </ChartPanel>
  );
}

export function SpanPanel({ employees, limit = 10 }) {
  const spans = managerSpans(employees);
  if (!spans.length) return null;
  const shown = spans.slice(0, limit);
  const noManager = (employees || []).filter((e) => working(e) && !e.reportingManagerId).length;
  return (
    <ChartPanel title="Team size per manager" note={[`${spans.length} ${spans.length === 1 ? 'manager' : 'managers'}`, noManager ? `${noManager} with no manager set` : null].filter(Boolean).join(' · ')}>
      <table className="ui-table w-full ui-span-table">
        <thead><tr><th scope="col">Manager</th><th scope="col" className="text-right">Team</th></tr></thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id}><th scope="row" className="font-normal text-left">{s.name}</th><td className="text-right tabular-nums">{s.team}</td></tr>
          ))}
        </tbody>
      </table>
      {spans.length > shown.length ? <p className="pt-foot">{`and ${spans.length - shown.length} more`}</p> : null}
    </ChartPanel>
  );
}
