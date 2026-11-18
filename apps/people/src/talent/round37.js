/**
 * Round 37 picks (DESIGN.md, Round 37), the parts that need no server change.
 *
 * reviewcycle B: one last date for the whole review. A new cycle asks for "Reviews due by" once
 * and sends it as both the self-review and the manager-review date; a cycle made before this,
 * with two different dates, still shows both.
 */

/** The one date a cycle's reviews are due by, or null when the two dates differ (older cycles). */
export function oneDueDate(cycle) {
  const self = cycle?.selfDue ? String(cycle.selfDue).slice(0, 10) : '';
  const manager = cycle?.managerDue ? String(cycle.managerDue).slice(0, 10) : '';
  if (!self && !manager) return '';
  if (self && manager && self !== manager) return null;
  return self || manager;
}

/** The body a new cycle sends: the single due date in both fields. */
export function withOneDueDate(form) {
  const due = form.dueBy || null;
  const rest = { ...form };
  delete rest.dueBy;
  return { ...rest, selfDue: due, managerDue: due };
}

/** selfreview A: the self-review and the manager's review read side by side once both are in. */
export function showSideBySide({ canSelf, canManager }) {
  return !canSelf && !canManager;
}
