import React, { useCallback, useEffect, useState } from 'react';

import { EmptyState, PageHeader, SkeletonCard, StatusPill } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listShifts, updateShift } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import { shiftBody } from '../components/shiftBody';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NTH = ['1st', '2nd', '3rd', '4th', '5th'];
const toSet = (csv) => new Set(String(csv || '').split(',').filter(Boolean));
const toCsv = (set) => [...set].sort().join(',');

/**
 * Weekly Off Policy (NV-03): every shift's days off in one table.
 *
 * Not a second set of rules: weekly offs belong to shifts (Shift.weeklyOffDays
 * and Shift.offSaturdays), as on the Shifts screen. This screen only shows
 * them side by side and saves them back to the same shift, so a company can
 * see and change its weekly-off pattern without opening each shift.
 */
export default function WeeklyOffPolicy({ openScreen }) {
  const [shifts, setShifts] = useState(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState('');

  const load = useCallback(() => {
    listShifts()
      .then((v) => { setShifts(v); setError(''); setDrafts({}); })
      .catch((e) => setError(String(e?.message || 'Could not load shifts.')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = (s) => drafts[s.id] || { weeklyOffDays: s.weeklyOffDays || '', offSaturdays: s.offSaturdays || '' };
  const dirty = (s) => Boolean(drafts[s.id]) && (drafts[s.id].weeklyOffDays !== (s.weeklyOffDays || '') || drafts[s.id].offSaturdays !== (s.offSaturdays || ''));
  const toggle = (s, field, key) => {
    const c = current(s);
    const set = toSet(c[field]);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    setDrafts((d) => ({ ...d, [s.id]: { ...c, [field]: toCsv(set) } }));
  };
  const save = async (s) => {
    setSaving(s.id);
    try {
      await updateShift(s.id, shiftBody(s, current(s)));
      notify.success(`${s.name}: weekly offs saved.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        entity="shift"
        title="Weekly off policy"
        description="The days each shift has off. Someone with no shift is off on Sunday."
      />
      <div className="pb-8 space-y-3">
        <LoadFailed message={error} onRetry={load} />
        {!shifts ? (
          error ? null : <SkeletonCard lines={5} />
        ) : !shifts.length ? (
          <EmptyState
            title="No shifts yet"
            description="Weekly offs are set on each shift. Add a shift first."
            action={openScreen ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('shifts')}>Open Shifts</button> : null}
          />
        ) : (
          <div className="ui-card overflow-hidden">
            <div className="ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th>Shift</th>
                    {DAYS.map((d) => <th key={d} className="ui-col-h-center">{d}</th>)}
                    {NTH.map((n) => <th key={n} className="ui-col-h-center">{n} Sat</th>)}
                    <th className="ui-col-h-right"><span className="sr-only">Save</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => {
                    const c = current(s);
                    const off = toSet(c.weeklyOffDays);
                    const sats = toSet(c.offSaturdays);
                    return (
                      <tr key={s.id}>
                        <td>
                          <span className="font-medium">{s.name}</span>{' '}
                          <span className="ui-caption tabular-nums">{s.startTime}–{s.endTime}</span>{' '}
                          {s.isActive ? null : <StatusPill status="inactive" />}
                        </td>
                        {DAYS.map((d, i) => (
                          <td key={d} className="text-center">
                            <input type="checkbox" className="ui-checkbox" checked={off.has(String(i))} onChange={() => toggle(s, 'weeklyOffDays', String(i))} aria-label={`${s.name}: ${d} off`} />
                          </td>
                        ))}
                        {NTH.map((n, i) => (
                          <td key={n} className="text-center">
                            <input type="checkbox" className="ui-checkbox" checked={sats.has(String(i + 1))} disabled={off.has('6')} onChange={() => toggle(s, 'offSaturdays', String(i + 1))} aria-label={`${s.name}: ${n} Saturday off`} />
                          </td>
                        ))}
                        <td className="text-end">
                          {dirty(s) ? (
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" data-write onClick={() => save(s)} disabled={saving === s.id}>
                              {saving === s.id ? 'Saving…' : 'Save'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="ui-caption px-4 py-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
              For “2nd and 4th Saturday off”, leave Sat unticked and tick the 2nd and 4th. Everything else about a shift is on Shifts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
