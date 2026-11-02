import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * The statutory schemes a company runs under, and the dated rates behind them.
 *
 * A rate is never edited. Changing one means publishing a new version from the
 * day it changes, because a payslip records the version it was computed under
 * and editing in place would restate months already filed.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/statutory`;
const opts = { skipWarehouseHeader: true };

export async function listStatutorySchemes() {
  const { schemes } = await apiFetch(base(), opts);
  return Array.isArray(schemes) ? schemes : [];
}

/** The rates to start from. Idempotent, and never overwrites a company's own. */
export const seedStatutoryRates = () => apiFetch(`${base()}/seed`, { ...opts, method: 'POST' });

export async function setSchemeEnabled(schemeId, isEnabled, registrationNumber) {
  const { scheme } = await apiFetch(`${base()}/schemes/${encodeURIComponent(schemeId)}`, {
    ...opts,
    method: 'PUT',
    body: { isEnabled, registrationNumber },
  });
  return scheme;
}

/** A new version, from the day it applies. The one before closes the day prior. */
export async function addStatutoryRate(schemeId, payload) {
  const { rule } = await apiFetch(`${base()}/schemes/${encodeURIComponent(schemeId)}/rules`, {
    ...opts,
    method: 'POST',
    body: payload,
  });
  return rule;
}

export const deleteStatutoryRate = (ruleId) =>
  apiFetch(`${base()}/rules/${encodeURIComponent(ruleId)}`, { ...opts, method: 'DELETE' });

/**
 * The whole screen at once: the schemes, the rules CLOR could not confirm that
 * apply to states the company has people in (`checks`), those states, and the
 * company's LWF settings.
 */
export async function getStatutoryOverview() {
  const body = await apiFetch(base(), opts);
  return {
    schemes: Array.isArray(body?.schemes) ? body.schemes : [],
    checks: Array.isArray(body?.checks) ? body.checks : [],
    states: Array.isArray(body?.states) ? body.states : [],
    lwf: body?.lwf || { coverage: 'BY_HEADCOUNT', managerDesignations: [] },
  };
}

/** Somebody has read the state's notice and the figures match: clears "check before use" for this version. */
export async function confirmStatutoryRate(ruleId) {
  const { rule } = await apiFetch(`${base()}/rules/${encodeURIComponent(ruleId)}/confirm`, { ...opts, method: 'POST' });
  return rule;
}

/** How LWF size thresholds are read, and which designations count as managers or supervisors. */
export async function saveLwfSettings(payload) {
  const { lwf } = await apiFetch(`${base()}/lwf-settings`, { ...opts, method: 'PUT', body: payload });
  return lwf;
}
