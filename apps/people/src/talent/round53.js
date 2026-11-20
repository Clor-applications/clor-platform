/**
 * Round 53 picks (DESIGN.md, Round 53), the parts that need no server change.
 *
 * dupcandidate A: a new application from someone who applied before shows
 * "Applied before for Sales Executive in Mar 2026", matched on email or phone.
 * goalweight A: each goal has a weight and a person's active goals add to 100%;
 * the goal form says what they add to with this one.
 * goalcopy A: "Copy last year's goals" copies a person's goals due last year,
 * a year on, to edit after.
 */

const email = (v) => String(v || '').trim().toLowerCase();
/* The last ten digits, so "+91 98450 12345" and "9845012345" are the same number. */
const phone = (v) => String(v || '').replace(/\D/g, '').slice(-10);

/** "Mar 2026" for a date, in India time. */
export function monthYear(at) {
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** The other applications from the same person (same email or phone) made before this one, newest first. */
export function earlierApplications(candidate, rows = []) {
  if (!candidate) return [];
  const mail = email(candidate.email);
  const tel = phone(candidate.phone);
  if (!mail && tel.length < 10) return [];
  const since = candidate.createdAt ? new Date(candidate.createdAt).getTime() : Infinity;
  return rows
    .filter((r) => r && r.id !== candidate.id && !r.anonymised)
    .filter((r) => (mail && email(r.email) === mail) || (tel.length === 10 && phone(r.phone) === tel))
    .filter((r) => !r.createdAt || new Date(r.createdAt).getTime() < since)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/** The line shown on the new application, or '' when they have not applied before. */
export function appliedBeforeText(earlier = []) {
  if (!earlier.length) return '';
  const [last] = earlier;
  const when = monthYear(last.createdAt);
  const more = earlier.length - 1;
  return `Applied before${last.openingTitle ? ` for ${last.openingTitle}` : ''}${when ? ` in ${when}` : ''}${more ? `, and ${more} more time${more === 1 ? '' : 's'}` : ''}.`;
}

/** What a person's active goals weigh with this one (the one being edited counted once, at its new weight). */
export function weightTotal(rows = [], employeeId, { exceptId = null, weight = '' } = {}) {
  const others = rows
    .filter((g) => g && g.status === 'ACTIVE' && (g.employee?.id || g.employeeId) === employeeId && g.id !== exceptId)
    .reduce((a, g) => a + (Number(g.weight) || 0), 0);
  return others + (weight === '' || weight === null || weight === undefined ? 0 : Number(weight) || 0);
}

/** The note under the weight field. */
export function weightNote(total) {
  if (total === 100) return 'Their active goals add to 100%.';
  if (total < 100) return `Their active goals add to ${total}% with this one; ${100 - total}% is still to give.`;
  return `Their active goals add to ${total}% with this one, ${total - 100}% over 100%.`;
}

/** The same day a year on; 29 Feb becomes 28 Feb. */
export function nextYear(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  if (!m) return null;
  const dd = m[2] === '02' && m[3] === '29' ? '28' : m[3];
  return `${Number(m[1]) + 1}-${m[2]}-${dd}`;
}

/**
 * A person's finished goals from last year (due last year, or set last year when undated). A goal
 * still active is still running, a dropped one is not wanted, and one whose title is already set
 * again as an active goal is not copied twice.
 */
export function lastYearGoals(goals = [], today) {
  const year = Number(String(today).slice(0, 4)) - 1;
  const title = (g) => String(g?.title || '').trim().toLowerCase();
  const active = new Set(goals.filter((g) => g?.status === 'ACTIVE').map(title));
  return goals.filter((g) => g && g.status === 'DONE'
    && Number(String(g.dueDate || g.createdAt || '').slice(0, 4)) === year
    && !active.has(title(g)));
}

/** The new goal a copy sends: the same goal a year on; a date already past is left empty. */
export function copyOf(goal, today) {
  const due = goal.dueDate ? nextYear(goal.dueDate) : null;
  return {
    employeeId: goal.employee?.id || goal.employeeId,
    title: goal.title,
    measure: goal.measure || null,
    dueDate: due && due >= String(today).slice(0, 10) ? due : null,
    weight: goal.weight === null || goal.weight === undefined ? null : goal.weight,
    description: goal.description || null,
  };
}
