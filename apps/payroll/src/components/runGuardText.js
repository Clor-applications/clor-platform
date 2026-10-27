/* The words of the run guards (RunGuards.jsx), kept apart so the component file exports components only. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "September is not closed in Attendance; these figures can still change." The same sentence the server sends. */
export function provisionalWarning(openMonths = []) {
  if (!openMonths.length) return "";
  const years = new Set(openMonths.map((m) => m.slice(0, 4)));
  const names = openMonths.map((m) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${years.size > 1 ? ` ${m.slice(0, 4)}` : ""}`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} not closed in Attendance; these figures can still change.`;
}

/** The months a run's days were taken from while still open, from what the run stored. */
export const openMonthsOf = (run) =>
  (Array.isArray(run?.attendanceSnapshots) ? run.attendanceSnapshots : []).filter((t) => t && !t.closed).map((t) => t.month);
