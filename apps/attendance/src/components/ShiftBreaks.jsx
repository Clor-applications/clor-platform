import React from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';
import SuggestInput from '@ui/components/ui/SuggestInput';

import { breakLength, unpaidTotal } from './shiftBreaksMath';

const NAMES = ['Lunch', 'Tea', 'Dinner', 'Prayer', 'Rest'];
const BLANK = { name: '', startTime: '', endTime: '', minutes: '', paid: false };

/**
 * A shift's breaks (Shift.breaks, Shift.breakMode): each named, at a time of
 * day or only a length, paid or unpaid; and whether the time taken off the day
 * is these breaks or the break punches of the day. With no breaks named the
 * shift keeps its one break in minutes, which the form shows instead.
 */
export default function ShiftBreaks({ breaks, mode, onChange, onMode }) {
  const set = (i, patch) => onChange(breaks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const unpaid = unpaidTotal(breaks);
  const paid = breaks.filter((b) => b.paid).reduce((a, b) => a + breakLength(b), 0);
  return (
    <fieldset className="sm:col-span-2 space-y-3">
      <legend className="ui-label">Breaks</legend>
      <div className="ui-table-scroll">
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col">Break</th>
              <th scope="col">Starts</th>
              <th scope="col">Ends</th>
              <th scope="col" className="ui-col-h-right">Minutes</th>
              <th scope="col">Paid</th>
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {breaks.map((b, i) => {
              const timed = Boolean(b.startTime && b.endTime);
              const label = b.name || `Break ${i + 1}`;
              return (
                <tr key={i}>
                  <td><SuggestInput className="ui-input ui-ctl-compact w-full min-w-[7rem]" maxLength={40} value={b.name} onChange={(v) => set(i, { name: v })} suggestions={NAMES} placeholder="Lunch" aria-label={`Break ${i + 1}: name`} /></td>
                  <td><input type="time" className="ui-input ui-ctl-compact tabular-nums" value={b.startTime || ''} onChange={(e) => set(i, { startTime: e.target.value })} aria-label={`${label}: starts`} /></td>
                  <td><input type="time" className="ui-input ui-ctl-compact tabular-nums" value={b.endTime || ''} onChange={(e) => set(i, { endTime: e.target.value })} aria-label={`${label}: ends`} /></td>
                  <td className="text-end">
                    <input type="number" min={1} max={600} className="ui-input ui-ctl-compact !w-20 text-end tabular-nums" value={timed ? breakLength(b) : b.minutes} disabled={timed} onChange={(e) => set(i, { minutes: e.target.value })} aria-label={`${label}: minutes`} />
                  </td>
                  <td><input type="checkbox" className="ui-checkbox" checked={Boolean(b.paid)} onChange={(e) => set(i, { paid: e.target.checked })} aria-label={`${label}: paid`} /></td>
                  <td className="text-end">
                    <button type="button" className="ui-icon-btn" onClick={() => onChange(breaks.filter((_, j) => j !== i))} aria-label={`Remove ${label}`}><Trash2 size={16} aria-hidden="true" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="ui-btn ui-btn-soft ui-btn-sm" onClick={() => onChange([...breaks, { ...BLANK }])} disabled={breaks.length >= 8}><Plus size={16} aria-hidden="true" /> Add a break</button>
        <span className="ui-caption tabular-nums">Unpaid {unpaid} min, taken off the day{paid ? ` · paid ${paid} min, counted as work` : ''}</span>
      </div>
      <p className="ui-caption">Give a start and an end, or only the minutes. An unpaid break comes off the hours worked; a paid one does not.</p>
      <label className="block">
        <span className="ui-label">Break time taken off the day</span>
        <select className="ui-input w-full" value={mode} onChange={(e) => onMode(e.target.value)}>
          <option value="FIXED">The breaks above, every day</option>
          <option value="PUNCHED">The time punched out and in for breaks</option>
        </select>
        {mode === 'PUNCHED' ? (
          <span className="ui-caption">
            Where a reader or phone records break out and break in, the time actually out is taken off, less the paid breaks.
            On a day with no break punches, the breaks above are taken off instead.
          </span>
        ) : null}
      </label>
    </fieldset>
  );
}
