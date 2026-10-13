import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * The statutory schemes a company runs under, and the dated rates behind them.
 *
 * A rate is never edited. Changing one means publishing a new version from the
 * day it changes, because a payslip records the version it was computed under
 * and editing in place would restate months already filed.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

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
