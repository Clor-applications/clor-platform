import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* People's reports (server: routes/peopleReports.ts): the list, one report with the filters on screen, the same rows as CSV. */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/hr-reports`;
const opts = { skipWarehouseHeader: true };
const query = (q) => {
  const s = new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v != null && v !== '')).toString();
  return s ? `?${s}` : '';
};

/** { reports: [{ id, group, name, description, dates: 'months' | 'day' | 'days', by }], filters: { departments, branches, employeeTypes, grades } } */
export const listHrReports = () => apiFetch(base(), opts);
/** { id, title, from, to, by, columns, rows, totals, chart, notes, masked } */
export const runHrReport = (id, q) => apiFetch(`${base()}/${encodeURIComponent(id)}${query(q)}`, opts);
/** The rows on screen as CSV text. */
export const hrReportCsv = (id, q) => apiFetch(`${base()}/${encodeURIComponent(id)}/export.csv${query(q)}`, { ...opts, asText: true });
