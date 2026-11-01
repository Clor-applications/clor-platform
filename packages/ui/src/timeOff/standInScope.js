/**
 * What a delegate (stand-in) hands on, in plain words (workflow engine phase
 * 2b, one StandIn table). The server writes an explicit list:
 *   ALL                  all approvals
 *   PEOPLE               People requests, not leave or attendance (a stand-in
 *                        named before the merge; an empty list reads the same)
 *   LEAVE, ATTENDANCE    leave; attendance requests, overtime, field punches
 *   other types          the People request types named
 */
export const STAND_IN_TYPES = [
  ['LEAVE', 'Leave'],
  ['ATTENDANCE', 'Attendance requests, overtime and field punches'],
  ['PROFILE_CHANGE', 'Personal detail changes'],
  ['JOB_CHANGE', 'Job changes'],
  ['LEAVING', 'Leaving'],
  ['PROBATION', 'Probation'],
  ['LETTER_REQUEST', 'Letters'],
  ['DOCUMENT_REQUEST', 'Documents'],
  ['EXPENSE_CLAIM', 'Expense claims'],
  ['EMPLOYEE_ADVANCE', 'Advances'],
  ['SALARY_ADVANCE', 'Salary advances'],
  ['SHIFT_SWAP', 'Shift swaps'],
  ['SEAT_REQUEST', 'Seats'],
  ['DESK_ESCALATION', 'Help desk'],
  ['POLICY_PUBLISH', 'Policies'],
];
const LABEL = Object.fromEntries(STAND_IN_TYPES);

/** One line for what a delegate hands on. */
export function scopeWords(types) {
  const t = [...(types || [])].sort();
  if (t.includes('ALL')) return 'All approvals';
  if (!t.length || (t.length === 1 && t[0] === 'PEOPLE')) return 'Other approvals';
  if (t.length === 2 && t[0] === 'ATTENDANCE' && t[1] === 'LEAVE') return 'Leave and attendance';
  if (t.length === 1 && t[0] === 'LEAVE') return 'Leave only';
  return t.map((x) => (x === 'PEOPLE' ? 'Other approvals' : LABEL[x] || (x.startsWith('FORM:') ? 'A request type' : x))).join(', ');
}
