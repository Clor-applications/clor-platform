import { getWaiting } from './approvals.js';
import { listOpenings } from './talent.js';
import { listEmployees } from '@ui/personnel/api';
import { getMyPermissions } from '@ui/api/permissions';

/*
 * Rail counts for People: the one waiting number (requests to approve plus the
 * reader's own open tasks), the same Home's subtitle and card, the bell and the
 * Inbox tabs show. A person with nothing waiting gets none, never an error.
 */
export async function peopleRailCounts() {
  const w = await getWaiting().catch(() => null);
  /* On Home's rail button: the Inbox sits under Home since the R&D hand-off (14 Nov 2026). */
  return { overview: Number(w?.waiting) || 0 };
}

/* The shell asks again on every screen change; one answer serves the next few seconds of clicking around. */
const FRESH_MS = 15_000;
let last = { key: '', at: 0, counts: null };

/*
 * Counts beside panel items (R&D hand-off, PEOPLE-02/11/18/24: "Employees 248", "Leave applications 5"),
 * from the APIs the screens already read: the inbox's waiting numbers, the directory's total and the open jobs.
 * A count this person cannot read is left out, never shown as nought; a waiting count of nought is left out too,
 * so a quiet inbox shows no number. Never throws: a failure is {}.
 */
export async function peoplePanelCounts({ tenant } = {}) {
  const key = String(tenant?.id || '');
  if (last.counts && last.key === key && Date.now() - last.at < FRESH_MS) return last.counts;
  try {
    const settle = (p) => Promise.resolve().then(p).catch(() => null);
    /* Only ask for what this person may read: a refused call is noise in the denials log, and a manager's own screens
       must never draw a refusal (e2e M11). Unknown permissions ask nothing beyond the inbox. */
    const mine = await settle(getMyPermissions);
    const granted = new Set(Array.isArray(mine?.permissions) ? mine.permissions : []);
    const may = (k) => Boolean(mine?.isAdmin) || granted.has(k);
    const [w, staff, openings] = await Promise.all([
      settle(getWaiting),
      may('PEOPLE::Employees::VIEW') ? settle(() => listEmployees({ working: 'now', limit: 1 })) : null,
      may('PEOPLE::Recruitment::VIEW') ? settle(() => listOpenings({ status: 'OPEN' })) : null,
    ]);
    const counts = {};
    const waiting = (k, n) => { if (Number(n) > 0) counts[k] = Number(n); };
    waiting('approvals', w?.waiting);
    waiting('leaveRequests', w?.counts?.LEAVE);
    waiting('attendanceRequests', w?.counts?.ATTENDANCE);
    waiting('overtime', w?.counts?.OVERTIME);
    waiting('helpdesk', w?.counts?.HELPDESK);
    if (Number.isFinite(Number(staff?.total)) && staff?.total != null) counts.employees = Number(staff.total);
    if (Array.isArray(openings)) counts.recruitment = openings.length;
    last = { key, at: Date.now(), counts };
    return counts;
  } catch {
    return {};
  }
}
