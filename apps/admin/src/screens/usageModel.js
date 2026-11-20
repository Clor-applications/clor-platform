import { seatsByApp } from './overviewFigures';

/**
 * Workspace → Usage, worked out in the browser from what the server already
 * sends: the plan and its seats (/account/overview) and who can open what
 * (/account/members/directory). Kept apart from the screen so it is tested
 * on its own.
 */
const DAY = 86_400_000;
/** Somebody who holds a seat and has not signed in for this long is listed as not using it. */
export const IDLE_DAYS = 30;

/** Seats per app: in use, bought, and what is left. `state`: over | full | ok | open (not metered). */
export function seatRows(directory, bought, appIds) {
  return seatsByApp(directory, bought, appIds).map((s) => {
    const left = s.bought == null ? null : s.bought - s.used;
    return { ...s, left, state: left == null ? 'open' : left < 0 ? 'over' : left === 0 ? 'full' : 'ok' };
  });
}

/**
 * People who can sign in, can open at least one app, and have not signed in
 * for 30 days or have never signed in. Never signed in first, then the
 * longest away. Somebody added in the last 30 days cannot be told from
 * somebody idle here (the directory carries no joining date), so the page
 * says "never signed in" and leaves the judgement to the reader.
 */
export function idleMembers(directory, now = Date.now()) {
  const rows = [];
  for (const m of directory || []) {
    if (m.status !== 'ACTIVE' || !m.canSignIn) continue;
    const apps = [...new Set((m.companies || []).flatMap((c) => c.apps || []))];
    if (!apps.length) continue;
    const last = m.lastSignInAt ? new Date(m.lastSignInAt).getTime() : null;
    const days = last == null ? null : Math.floor((now - last) / DAY);
    if (days != null && days < IDLE_DAYS) continue;
    rows.push({ userId: m.userId, name: m.name || m.email || 'Unnamed', email: m.email || '', apps, days, lastSignInAt: m.lastSignInAt || null });
  }
  return rows.sort((a, b) => (a.days == null ? -1 : b.days == null ? 1 : b.days - a.days) || a.name.localeCompare(b.name));
}

/** How many people can sign in and hold at least one app. */
export const seatHolders = (directory) =>
  (directory || []).filter((m) => m.status === 'ACTIVE' && m.canSignIn && (m.companies || []).some((c) => (c.apps || []).length)).length;

/** The plan's own caps with what is used; a cap the plan does not set is left out. */
export function allowances(overview) {
  const limits = overview?.plan?.limits || {};
  const usage = overview?.usage || {};
  return [
    limits.maxCompanies != null ? { key: 'companies', label: 'Companies', used: usage.companies ?? 0, limit: limits.maxCompanies } : null,
    limits.maxUsers != null ? { key: 'users', label: 'Users', used: usage.users ?? 0, limit: limits.maxUsers } : null,
  ].filter(Boolean);
}
