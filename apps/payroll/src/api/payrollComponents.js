import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * The lines a payslip can be built from.
 *
 * Every rule about a component — what a percentage needs, which combinations
 * of switches are contradictory, whether a formula can be read at all — is
 * enforced by the server, and the screen shows what it says. Nothing here
 * re-implements a payroll rule in the browser: a second copy of "an employer
 * contribution cannot be part of net pay" is a second copy that can disagree.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/components`;

/* Salary components belong to the organisation, not to a counter or a store,
   so the warehouse header is left off — sending it makes the server refuse the
   call for anybody who has no warehouse. */
const opts = { skipWarehouseHeader: true };

export async function listSalaryComponents({ type = '', activeOnly = false } = {}) {
  const query = new URLSearchParams();
  if (type) query.set('type', type);
  if (activeOnly) query.set('active', 'true');
  const suffix = query.toString() ? `?${query}` : '';
  const { components } = await apiFetch(`${base()}${suffix}`, opts);
  return Array.isArray(components) ? components : [];
}

export async function createSalaryComponent(payload) {
  const { component } = await apiFetch(base(), { ...opts, method: 'POST', body: payload });
  return component;
}

export async function updateSalaryComponent(id, payload) {
  const { component } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, {
    ...opts,
    method: 'PUT',
    body: payload,
  });
  return component;
}

export async function deleteSalaryComponent(id) {
  return apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });
}

/**
 * Ask whether a formula can be read, before it is saved.
 *
 * The same parser the payroll run will use, so a formula that validates here
 * cannot fail on the twentieth employee of a run.
 */
export async function validateSalaryFormula(formula) {
  return apiFetch(`${base()}/validate-formula`, { ...opts, method: 'POST', body: { formula } });
}

/**
 * Where a component posts, on its own.
 *
 * Separate from editing the component because it is a different decision, and
 * because it stays possible after a component is on a payslip — which is the
 * case that matters, since a company finds out it has no mapping at the moment
 * it first tries to post.
 */
export async function setComponentLedgers(id, { expenseLedgerId = null, liabilityLedgerId = null } = {}) {
  const { component } = await apiFetch(`${base()}/${encodeURIComponent(id)}/ledgers`, {
    ...opts,
    method: 'PUT',
    body: { expenseLedgerId, liabilityLedgerId },
  });
  return component;
}

/**
 * The fields and comparisons a rule may use, from the server.
 *
 * Not a list in this file. The eligibility service evaluates exactly these,
 * and a second catalogue in the browser drifts the day somebody adds a field
 * to one of them — the symptom being a rule that saves cleanly and matches
 * nobody, silently, because an unknown field has no value to compare.
 */
export async function ruleCatalogue() {
  return apiFetch(`${base()}/rule-catalogue`, opts);
}

/**
 * The conditions on a component, replaced as a set.
 *
 * As a set because they are ANDed and mean nothing apart: removing one widens
 * the population it pays, so a half-saved rule set pays the wrong people for
 * however long the rest takes.
 */
export async function setComponentConditions(id, conditions) {
  const { component } = await apiFetch(`${base()}/${encodeURIComponent(id)}/conditions`, {
    ...opts,
    method: 'PUT',
    body: { conditions },
  });
  return component;
}

/** Naming one person in or out, which beats whatever the conditions say. */
export async function setComponentEmployee(id, { employeeId, mode }) {
  const { target } = await apiFetch(`${base()}/${encodeURIComponent(id)}/employees`, {
    ...opts,
    method: 'POST',
    body: { employeeId, mode },
  });
  return target;
}

export async function removeComponentEmployee(id, employeeId) {
  return apiFetch(`${base()}/${encodeURIComponent(id)}/employees/${encodeURIComponent(employeeId)}`, {
    ...opts,
    method: 'DELETE',
  });
}
