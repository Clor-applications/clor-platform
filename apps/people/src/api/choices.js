import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Company choices and the read-only salary revisions they can open (server: routes/peopleCompanyChoices.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };

/** { choices: [{ key, value, default, options: [{ value, label }], canChange, why?, changed: { by, at } | null }] } */
export const getCompanyChoices = () => apiFetch(`${base()}/company-choices`, opts);
export const saveCompanyChoice = (key, value) => apiFetch(`${base()}/company-choices/${encodeURIComponent(key)}`, { ...opts, method: 'PUT', body: { value } });
/** { readOnly: true, revisions: [{ id, employeeName, employeeCode, currentAnnualCtc, proposedAnnualCtc, incrementPercent, effectiveFrom, status }] } */
export const getHrSalaryRevisions = () => apiFetch(`${base()}/salary-revisions`, opts);
