import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const opts = { skipWarehouseHeader: true };
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const send = (path, method, body) => apiFetch(`${base()}${path}`, { method, body, ...opts });

const query = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const getOverview = () => apiFetch(`${base()}/overview`, opts);

export const listEmployees = (params) => apiFetch(`${base()}/employees${query(params)}`, opts);
export const getEmployee = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, opts);
export const createEmployee = (body) => send('/employees', 'POST', body);
export const updateEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteEmployee = (id) => send(`/employees/${encodeURIComponent(id)}`, 'DELETE');
export const importEmployees = (rows) => send('/employees/import', 'POST', { rows });
export const getOrgChart = () => apiFetch(`${base()}/org-chart`, opts);

/** kind: departments | job-positions | job-roles | employee-types | work-types */
export const listStructure = (kind) => apiFetch(`${base()}/structure/${kind}`, opts).then((r) => r?.items || []);
export const createStructure = (kind, body) => send(`/structure/${kind}`, 'POST', body);
export const updateStructure = (kind, id, body) => send(`/structure/${kind}/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteStructure = (kind, id) => send(`/structure/${kind}/${encodeURIComponent(id)}`, 'DELETE');

export const listTags = () => apiFetch(`${base()}/tags`, opts).then((r) => r?.tags || []);
export const createTag = (body) => send('/tags', 'POST', body);
export const deleteTag = (id) => send(`/tags/${encodeURIComponent(id)}`, 'DELETE');

export const listNotes = (employeeId) => apiFetch(`${base()}/employees/${encodeURIComponent(employeeId)}/notes`, opts).then((r) => r?.notes || []);
export const addNote = (employeeId, body) => send(`/employees/${encodeURIComponent(employeeId)}/notes`, 'POST', { body });
export const deleteNote = (noteId) => send(`/notes/${encodeURIComponent(noteId)}`, 'DELETE');

// Personnel operations (server: routes/personnel.ts) — used by People and by Attendance's Personnel section
export const listContractors = () => apiFetch(`${base()}/contractors`, opts).then((r) => r?.contractors || []);
export const createContractor = (body) => send('/contractors', 'POST', body);
export const updateContractor = (id, body) => send(`/contractors/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteContractor = (id) => send(`/contractors/${encodeURIComponent(id)}`, 'DELETE');
export const resignEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}/resign`, 'POST', body);
export const rehireEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}/rehire`, 'POST', body || {});
export const transferEmployees = (body) => send('/employees/transfer', 'POST', body);

export const LEAVING_TYPES = {
  RESIGNED: 'Resigned',
  TERMINATED: 'Terminated',
  RETIRED: 'Retired',
  ABSCONDED: 'Absconded',
  CONTRACT_ENDED: 'Contract ended',
  DECEASED: 'Deceased',
};
