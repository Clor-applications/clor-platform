import { orgId as platformOrgId } from '@platform/context';

/**
 * What the platform needs from Attendance, named as the platform thinks of it.
 *
 * Attendance (Clor's reader/ADMS application) is a separate backend with its
 * own database per customer — not a table in the platform's database like
 * Accounting or Payroll. So this adapter does not reach a shared API; it reaches
 * *that org's own attendance instance*, whose address the platform resolves per
 * company (Phase 3 of the platform plan). Until single sign-on is wired
 * (Phase 2), the calls below report "not connected" rather than inventing data.
 *
 * This is the only place in the platform that knows how to reach an attendance
 * instance. It speaks in the platform's words — "today's attendance", "the
 * readers", "the month's payable days" — and returns plain data. When SSO and
 * per-org routing land, this file changes and no screen does.
 */

/** The attendance instance for the active org. Per-org routing arrives in Phase 3. */
export function instanceBase() {
  // A single dev instance for now; later: look up the active org's instance URL.
  const base = import.meta.env?.VITE_ATTENDANCE_BASE || '';
  return String(base).replace(/\/+$/, '');
}

/** Whether an attendance instance is wired up for this org yet. */
export function configured() {
  return Boolean(instanceBase());
}

/** The URL a "Open full attendance" link points at, or null. */
export function instanceUrl() {
  return configured() ? instanceBase() : null;
}

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

/**
 * Not yet callable: reaching the attendance instance needs the single sign-on
 * exchange (Phase 2), so the platform token is accepted by that instance. Until
 * then every data call is refused loudly rather than returning a guess.
 */
function notConnected() {
  const e = new Error('Attendance is not connected to this company yet.');
  e.code = 'ATTENDANCE_NOT_CONNECTED';
  return e;
}

export async function todaySummary() { void orgId(); throw notConnected(); }
export async function readers() { void orgId(); throw notConnected(); }
export async function payableDays(/* period */) { void orgId(); throw notConnected(); }
