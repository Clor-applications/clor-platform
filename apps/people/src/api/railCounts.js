import { getInbox } from './approvals.js';

/* Rail counts for People: what waits in the Inbox. A person who cannot open it gets none, never an error. */
export async function peopleRailCounts() {
  const inbox = await getInbox().catch(() => null);
  return { approvals: Number(inbox?.counts?.all) || 0 };
}
