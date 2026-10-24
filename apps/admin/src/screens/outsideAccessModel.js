/** Words and rules the Outside access screen shows (GAP-006). */

export const APP_LABEL = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance' };

/** A status is a pill with its word (DESIGN: never colour alone). */
export const STATUS = {
  ACTIVE: ['Active', 'ui-pill-pos'],
  SUSPENDED: ['Paused', 'ui-pill-neutral'],
  EXPIRED: ['Expired', 'ui-pill-warn'],
  ENDED: ['Ended', 'ui-pill-neutral'],
};

/** What can be done to a row, in the order shown. Ended is final: adding the person again grants afresh. */
export function actionsFor(row) {
  if (row.status === 'REVOKED') return [];
  return [row.status === 'SUSPENDED' ? 'resume' : 'pause', 'change', 'end'];
}

export const appsText = (apps) => (apps ? apps.map((a) => APP_LABEL[a] || a).join(', ') : 'Everything the company has');
