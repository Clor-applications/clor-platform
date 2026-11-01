import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, StatusPill } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getOvertimeRules, listShifts, saveOvertimeRules, updateShift } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import OvertimeRuleFields from '../components/OvertimeRuleFields';
import { shiftBody } from '../components/shiftBody';

const hours = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;

/**
 * Overtime Policy (NV-04): when overtime starts and how it is approved, in one
 * place.
 *
 * Not a second set of rules: when overtime starts belongs to each shift
 * (Shift.overtimeAfterMinutes, as on Shifts), and requests, approval and
 * comp-off to the company's rules (the same fields, through the same
 * OvertimeRuleFields, as the Rules drawer on Overtime & Comp-Off). This screen
 * reads and writes those, and nothing of its own.
 */
export default function OvertimePolicy({ openScreen }) {
  const [rules, setRules] = useState(null);
  const [types, setTypes] = useState([]);
  const [rulesError, setRulesError] = useState('');
  const [shifts, setShifts] = useState(null);
  const [shiftsError, setShiftsError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState('');

  const loadRules = useCallback(() => {
    getOvertimeRules()
      .then((r) => { setRules(r.rules); setTypes(r.leaveTypes || []); setRulesError(''); })
      .catch((e) => setRulesError(String(e?.message || 'Could not load the overtime rules.')));
  }, []);
  const loadShifts = useCallback(() => {
    listShifts()
      .then((v) => { setShifts(v); setShiftsError(''); setDrafts({}); })
      .catch((e) => setShiftsError(String(e?.message || 'Could not load shifts.')));
  }, []);
  useEffect(() => { loadRules(); loadShifts(); }, [loadRules, loadShifts]);

  const saveRules = async (next) => {
    try {
      const r = await saveOvertimeRules(next);
      setRules(r.rules);
      notify.success('Overtime rules saved.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  const shown = (s) => (s.id in drafts ? drafts[s.id] : s.overtimeAfterMinutes ?? '');
  const dirty = (s) => s.id in drafts && String(drafts[s.id]) !== String(s.overtimeAfterMinutes ?? '');
  const saveShift = async (s) => {
    setSaving(s.id);
    try {
      await updateShift(s.id, shiftBody(s, { overtimeAfterMinutes: drafts[s.id] }));
      notify.success(`${s.name}: overtime start saved.`);
      loadShifts();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        entity="overtime"
        title="Overtime policy"
        description="When overtime starts on each shift, and how overtime and comp-off are asked for and approved."
      />
      <div className="pb-8 space-y-4">
        <section className="ui-card p-4 space-y-3" aria-labelledby="ot-rules-h">
          <h2 id="ot-rules-h" className="ui-t-sec">Requests and approval</h2>
          <LoadFailed message={rulesError} onRetry={loadRules} />
          {rules ? <OvertimeRuleFields rules={rules} types={types} save={saveRules} /> : rulesError ? null : <SkeletonCard lines={4} />}
          {openScreen ? (
            <p className="ui-caption">
              The requests themselves are on{' '}
              <button type="button" className="ui-link" onClick={() => openScreen('overtime')}>Overtime &amp; Comp-Off</button>.
            </p>
          ) : null}
        </section>

        <section className="ui-card overflow-hidden" aria-labelledby="ot-shifts-h">
          <div className="px-4 pt-4 pb-3">
            <h2 id="ot-shifts-h" className="ui-t-sec">When overtime starts</h2>
            <p className="ui-caption">Minutes worked on a day before the rest counts as overtime. Blank means after the shift’s full day.</p>
          </div>
          <LoadFailed message={shiftsError} onRetry={loadShifts} />
          {!shifts ? (
            shiftsError ? null : <div className="px-4 pb-4"><SkeletonCard lines={3} /></div>
          ) : !shifts.length ? (
            <p className="ui-muted text-sm px-4 pb-4">No shifts yet. Add one on Shifts to set when overtime starts.</p>
          ) : (
            <div className="ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th className="ui-col-h-right">Full day</th>
                    <th className="ui-col-h-right">Overtime after (minutes)</th>
                    <th className="ui-col-h-right"><span className="sr-only">Save</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="font-medium">{s.name}</span>{' '}
                        <span className="ui-caption tabular-nums">{s.startTime}–{s.endTime}</span>{' '}
                        {s.isActive ? null : <StatusPill status="inactive" />}
                      </td>
                      <td className="text-end tabular-nums">{hours(Number(s.fullDayMinutes) || 0)}</td>
                      <td className="text-end">
                        <input
                          type="number"
                          min={0}
                          max={1440}
                          className="ui-input ui-ctl-compact !w-28 text-end"
                          value={shown(s)}
                          placeholder="Full day"
                          onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                          aria-label={`${s.name}: overtime after (minutes)`}
                        />
                      </td>
                      <td className="text-end">
                        {dirty(s) ? (
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" data-write onClick={() => saveShift(s)} disabled={saving === s.id}>
                            {saving === s.id ? 'Saving…' : 'Save'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
