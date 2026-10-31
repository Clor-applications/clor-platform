/**
 * Leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.7, 4.8, 4.9). Importing this module
 * registers every recipe with the automations job; `startEngagement` starts the job (index.ts).
 */
import './clearance.js';
import './exitInterview.js';
import './greetings.js';
import './reminders.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { registerJob } from '../../jobRegistry.js';
import { startPeopleAutomations } from './automations.js';
import { eraseExpiredAnswers } from './exitInterview.js';

export { runAutomations, runCompany, startPeopleAutomations } from './automations.js';

/** The automations job, and once a day the exit-interview answers past their keeping period erased. */
export function startEngagement() {
  const stopAutomations = startPeopleAutomations();
  const day = 24 * 3_600_000;
  const tick = () => exclusive('people.exit-answers-erase', leaseFor(day), () => eraseExpiredAnswers(), { idempotent: true }).catch((e) => console.error('[exit answers] failed:', e instanceof Error ? e.message : e));
  registerJob('startExitAnswerErase', tick, day);
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return stopAutomations;
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, day);
    i.unref?.();
  }, 260_000);
  t.unref?.();
  return () => {
    stopAutomations();
    clearTimeout(t);
  };
}
