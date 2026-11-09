import { getWaiting } from './approvals.js';

/*
 * Rail counts for People: the one waiting number (requests to approve plus the
 * reader's own open tasks), the same Home's subtitle and card, the bell and the
 * Inbox tabs show. A person with nothing waiting gets none, never an error.
 */
export async function peopleRailCounts() {
  const w = await getWaiting().catch(() => null);
  return { approvals: Number(w?.waiting) || 0 };
}
