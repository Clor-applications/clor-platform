import React, { useState } from 'react';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createGoal, listCandidates, listGoals } from '../api/talent';
import { todayIst } from './shared';
import { appliedBeforeText, copyOf, earlierApplications, lastYearGoals, weightNote, weightTotal } from './round53';

/* Round 53 picks (DESIGN.md, Round 53): the screens' parts; the rules are in round53.js. */

/** dupcandidate A: "Applied before for … in …" on the application, for HR (who see e-mail and phone). */
export function AppliedBefore({ candidate, hr }) {
  const key = hr && candidate ? (candidate.email || candidate.phone || '') : '';
  const req = useRequest(() => (key ? listCandidates({ q: key, stage: 'all', limit: 50 }).catch(() => null) : Promise.resolve(null)), [candidate?.id, key]);
  const text = appliedBeforeText(earlierApplications(candidate, req.data?.rows || []));
  return text ? <p className="text-sm ui-applied-before" data-testid="applied-before">{text}</p> : null;
}

/** goalweight A: what the person's active goals add to with this one (read fresh, whatever tab the list is on). */
export function WeightTotal({ employeeId, goalId, weight }) {
  const req = useRequest(() => (employeeId ? listGoals({ status: 'ACTIVE', employeeId }).catch(() => null) : Promise.resolve(null)), [employeeId]);
  if (!employeeId || !req.data) return null;
  const total = weightTotal(req.data.goals, employeeId, { exceptId: goalId || null, weight });
  if (!total) return null;
  return <span className={`mt-1 block ui-caption tabular-nums ${total > 100 ? 'ui-text-neg' : ''}`} data-testid="weight-total">{weightNote(total)}</span>;
}

/** goalcopy A: copy a person's goals from last year, a year on, then edit them. */
export function CopyLastYear({ employeeId, onDone }) {
  const [busy, setBusy] = useState(false);
  if (!employeeId) return null;
  const run = async () => {
    setBusy(true);
    try {
      const today = todayIst();
      const { goals } = await listGoals({ status: 'all', employeeId });
      const old = lastYearGoals(goals, today);
      if (!old.length) { notify.info('No finished goals from last year to copy.'); return; }
      const ok = await confirmDialog({ title: `Copy ${old.length} goal${old.length === 1 ? '' : 's'} from last year?`, message: 'Each is set again with its measure and weight, due a year on. Edit them after.', confirmLabel: 'Copy', tone: 'neutral' });
      if (!ok) return;
      let made = 0;
      for (const g of old) { await createGoal(copyOf(g, today)); made += 1; }
      notify.success(`${made} goal${made === 1 ? '' : 's'} copied.`);
      onDone?.();
    } catch (e) { notify.error(String(e?.message || 'Not copied.')); } finally { setBusy(false); }
  };
  return <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={run}>Copy last year’s goals</button>;
}
