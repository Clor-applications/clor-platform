/**
 * The Workspace Overview's figures that are worked out in the browser from
 * what the server already sent (the member directory, the subscription's
 * seats), kept apart from the screen so they can be tested on their own.
 */

/** Rupees a month from paise, whole rupees: a run rate is read, not reconciled. */
export const rupees = (paise) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(Number(paise) / 100));

/**
 * Seats in use per app: active members of the account who can open it in at
 * least one company (their roles there, as the directory resolves them), set
 * against the seats bought where the subscription meters them.
 */
export function seatsByApp(directory, bought, appIds) {
  const active = (directory || []).filter((m) => m.status === 'ACTIVE');
  const boughtBy = new Map((bought || []).map((s) => [s.app, s.bought]));
  return appIds.map((app) => ({
    app,
    used: active.filter((m) => (m.companies || []).some((c) => (c.apps || []).includes(app))).length,
    bought: boughtBy.has(app) ? boughtBy.get(app) : null,
  }));
}

/** Two-step sign-in adoption among active members, and the privileged people still without it. */
export function securityOf(directory) {
  const active = (directory || []).filter((m) => m.status === 'ACTIVE');
  const withTotp = active.filter((m) => m.authenticator).length;
  const privileged = active.filter((m) => !m.authenticator && (m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || (m.companies || []).some((c) => c.isAdmin))).length;
  return { active: active.length, withTotp, pct: active.length ? Math.round((withTotp / active.length) * 100) : null, privilegedNo2fa: privileged };
}
