import React from 'react';
import { AlertTriangle } from '@ui/components/ui/lineIcons';
import { Notice } from '@ui/timeOff/Figures';
import './lifecycle.css';

/*
 * The Joining and Leaving lists' own parts (R&D PEOPLE-07 "Onboarding & exit"): a plan's steps as a meter, and the
 * amber line above the list when steps are late. Styles in lifecycle.css.
 */

/** The bar, "6/9" beside it, and how many are late in words. */
export function StepsMeter({ done = 0, total = 0, late = 0 }) {
  if (!total) return <span className="lc-none">No plan</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="lc-steps">
      <span className="lc-steps-line">
        <span className="lc-steps-track" aria-hidden="true"><span className="lc-steps-fill" data-done={done >= total ? 'yes' : 'no'} style={{ width: `${pct}%` }} /></span>
        <span className="lc-steps-count"><span aria-hidden="true">{done}/{total}</span><span className="sr-only">{done} of {total} steps done</span></span>
      </span>
      {late ? <span className="lc-steps-late">{late} late</span> : null}
    </span>
  );
}

/** "3 steps are late for Manoj Gupta and Kavya Reddy." from the rows on screen; nothing when none is late. */
export function LateNotice({ rows }) {
  const late = (rows || []).filter((r) => Number(r.late) > 0);
  if (!late.length) return null;
  const steps = late.reduce((a, r) => a + Number(r.late), 0);
  const names = late.slice(0, 2).map((r) => r.name);
  const who = late.length > 2 ? `${names.join(', ')} and ${late.length - 2} more` : names.join(' and ');
  return (
    <Notice icon={AlertTriangle}>
      <strong>{steps === 1 ? 'One step is' : `${steps} steps are`} late</strong> for {who}. Open a plan to close a step or hand it on.
    </Notice>
  );
}
