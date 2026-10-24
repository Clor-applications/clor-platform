/** Words and rules the Credentials screen shows (Batch 5). */

export const KIND = {
  API_KEY: 'API key',
  SCIM: 'Directory sync',
  AGENT: 'Connector',
  DEVICE_PUSH: 'Reader address',
};

/** A status is a pill with its word; a blocked one says why underneath (DESIGN: never colour alone). */
export const STATUS = {
  ACTIVE: ['Active', 'ui-pill-pos', ''],
  SUSPENDED: ['Paused', 'ui-pill-neutral', ''],
  REVOKED: ['Revoked', 'ui-pill-neutral', ''],
  EXPIRED: ['Expired', 'ui-pill-neutral', ''],
  OWNER_OFF: ['Blocked', 'ui-pill-warn', 'Switched off where it is set up'],
  PARENT_OFF: ['Blocked', 'ui-pill-warn', 'Its connector is switched off'],
  OWNER_MISSING: ['Blocked', 'ui-pill-warn', 'What it belonged to has been deleted'],
  SUPERSEDED: ['Blocked', 'ui-pill-warn', 'Replaced by a newer token'],
  APP_OFF: ['Blocked', 'ui-pill-warn', 'Attendance is off, or not on the plan'],
  COMPANY_CLOSING: ['Blocked', 'ui-pill-warn', 'The company is closing'],
};

/** What may be done to a credential now, by its stored state (the effective state only explains). */
export function actionsFor(c) {
  if (c.status === 'REVOKED') return [];
  const expired = c.effective === 'EXPIRED';
  const out = [];
  if (c.status === 'SUSPENDED' && !expired) out.push('resume');
  if (c.status === 'ACTIVE' && !expired) out.push('suspend');
  out.push('extend', 'rotate', 'revoke');
  if (c.needsReviewReason) out.unshift('review');
  return out;
}

