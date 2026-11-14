import { getWaiting } from './approvals.js';

/*
 * Rail counts for People: the one waiting number (requests to approve plus the
 * reader's own open tasks), the same Home's subtitle and card, the bell and the
 * Inbox tabs show. A person with nothing waiting gets none, never an error.
 */
export async function peopleRailCounts() {
  const w = await getWaiting().catch(() => null);
  /* On Home's rail button: the Inbox sits under Home since the R&D hand-off (14 Nov 2026). */
  return { overview: Number(w?.waiting) || 0 };
}
