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

/* Saved views on a report (server: services/people/savedViews.ts): a name for the dates, grouping and filters on screen. */
const viewsBase = () => `/orgs/${encodeURIComponent(orgId())}/people/saved-views`;
const send = (path, method, body) => apiFetch(`${viewsBase()}${path}`, { ...opts, method, body });
/** [{ id, name, filters, shared, mine }] */
export const listReportViews = (report) => apiFetch(`${viewsBase()}?screen=${encodeURIComponent(`report:${report}`)}`, opts).then((r) => r?.views || []);
export const saveReportView = (body) => send('', 'POST', body).then((r) => r?.view);
export const deleteReportView = (id) => send(`/${encodeURIComponent(id)}`, 'DELETE');
