/**
 * A stored status said as a word in a sentence: "This request was already approved", "Your CLOR
 * subscription is overdue". Statuses used to be dropped into sentences as they are stored (`past_due`,
 * `MORE_INFO`, `PENDING_HR`) (UX copy audit, 20 Nov 2026). Unknown ones fall back to lower case with spaces.
 */
const WORDS: Record<string, string> = {
  PENDING: 'waiting for a decision',
  WAITING: 'waiting for a decision',
  PENDING_HR: 'waiting for HR',
  PENDING_CANCEL: 'waiting for a decision on cancelling it',
  MORE_INFO: 'waiting for more information',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  WITHDRAWN: 'withdrawn',
  REVOKED: 'withdrawn',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  DECLINED: 'turned down',
  DRAFT: 'a draft',
  SUBMITTED: 'sent for review',
  IN_REVIEW: 'in review',
  REVIEWED: 'reviewed',
  CALCULATED: 'calculated',
  LOCKED: 'locked',
  PAID: 'paid',
  POSTED: 'posted to the books',
  SETTLED: 'settled',
  APPLIED: 'applied',
  DONE: 'done',
  CLOSED: 'closed',
  OPEN: 'open',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ON_HOLD: 'on hold',
  RESOLVED: 'resolved',
  /* Subscriptions (the gateway's own words, in lower case). */
  TRIALING: 'on a free trial',
  PAST_DUE: 'overdue',
  UNPAID: 'unpaid',
  PAUSED: 'paused',
  INCOMPLETE: 'not yet started',
  INCOMPLETE_EXPIRED: 'not started',
  ENDED: 'ended',
  /* Account roles. */
  OWNER: 'owner',
  ADMIN: 'administrator',
  BILLING_ADMIN: 'billing administrator',
  MEMBER: 'member',
};

export function statusWords(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (!s) return 'unknown';
  return WORDS[s.toUpperCase()] ?? s.toLowerCase().replace(/_/g, ' ');
}
