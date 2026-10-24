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
/* People → Home: what needs someone today (server: services/people/home.ts). */
export const getPeopleHome = () => apiFetch(`${base()}/home`, opts).then((r) => r?.todos || []);

export const listEmployees = (params) => apiFetch(`${base()}/employees${query(params)}`, opts);
/** Fetch every API page for complete reports and employee pickers. */
export async function listAllEmployees(params = {}) {
  const employees = [];
  for (let offset = 0; ; offset += 500) {
    const page = await listEmployees({ ...params, limit: 500, offset });
    employees.push(...page.employees);
    if (!page.employees.length || employees.length >= page.total) return { employees, total: page.total };
  }
}
export const getEmployee = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, opts);
/* Changes dated for a future day (FND-02): pending ones on the record, and withdrawing one. */
export const getScheduledChanges = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, opts).then((r) => r?.scheduledChanges || []);
export const cancelScheduledChange = (id, changeId) => send(`/employees/${encodeURIComponent(id)}/scheduled/${encodeURIComponent(changeId)}`, 'DELETE');
export const createEmployee = (body) => send('/employees', 'POST', body);
export const updateEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteEmployee = (id) => send(`/employees/${encodeURIComponent(id)}`, 'DELETE');
/* dryRun: every row checked, nothing created — the preview before an import. */
export const importEmployees = (rows, dryRun = false) => send('/employees/import', 'POST', { rows, dryRun });
export const importContractors = (rows, dryRun = false) => send('/contractors/import', 'POST', { rows, dryRun });
export const getOrgChart = () => apiFetch(`${base()}/org-chart`, opts);

/** kind: departments | job-positions | job-roles | employee-types | work-types */
export const listStructure = (kind) => apiFetch(`${base()}/structure/${kind}`, opts).then((r) => r?.items || []);
export const createStructure = (kind, body) => send(`/structure/${kind}`, 'POST', body);
export const updateStructure = (kind, id, body) => send(`/structure/${kind}/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteStructure = (kind, id) => send(`/structure/${kind}/${encodeURIComponent(id)}`, 'DELETE');

export const listTags = () => apiFetch(`${base()}/tags`, opts).then((r) => r?.tags || []);
export const createTag = (body) => send('/tags', 'POST', body);
export const deleteTag = (id) => send(`/tags/${encodeURIComponent(id)}`, 'DELETE');

/* Documents on the file (≤ 5 MB each, as data URLs). */
export const listCompanyDocuments = () => apiFetch(`${base()}/documents`, opts).then((r) => r?.documents || []);
export const listDocuments = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/documents`, opts).then((r) => r?.documents || []);
export const uploadDocument = (id, body) => send(`/employees/${encodeURIComponent(id)}/documents`, 'POST', body);
export const getDocument = (docId) => apiFetch(`${base()}/documents/${encodeURIComponent(docId)}`, opts).then((r) => r?.document);
export const deleteDocument = (docId) => send(`/documents/${encodeURIComponent(docId)}`, 'DELETE');
/* DPDP data requests raised from the portal. */
export const listDataRequests = (status) => apiFetch(`${base()}/data-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`, opts);
export const resolveDataRequest = (id, body) => send(`/data-requests/${encodeURIComponent(id)}/resolve`, 'POST', body);
/** LX-07: erase a former employee's personal data (irreversible); `dataRequestId` answers their erasure request. */
export const anonymiseEmployee = (employeeId, body) => send(`/employees/${encodeURIComponent(employeeId)}/anonymise`, 'POST', body);
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
/* Employment history: joined, moved, changed, left, rehired, with payroll impact (server: services/people/employmentHistory.ts). */
/* Statutory and bank details from Payroll, masked (server: people /employees/:id/statutory). */
export const getEmployeeStatutory = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/statutory`, opts);
/* Joining and leaving checklists (server: services/people/checklists.ts). */
export const CHECKLIST_OWNER = { HR: 'HR', MANAGER: 'Manager', PAYROLL: 'Payroll', IT: 'IT / admin', EMPLOYEE: 'Employee' };
export const getChecklist = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/checklist`, opts);
export const startChecklist = (id, kind) => send(`/employees/${encodeURIComponent(id)}/checklist/${kind}`, 'POST', {});
export const updateChecklistTask = (taskId, body) => send(`/checklist-tasks/${encodeURIComponent(taskId)}`, 'PATCH', body);
export const listOpenChecklistTasks = () => apiFetch(`${base()}/checklist-tasks`, opts).then((r) => r?.tasks || []);
export const getChecklistTemplates = () => apiFetch(`${base()}/checklist-templates`, opts);
export const saveChecklistTemplate = (kind, items) => send(`/checklist-templates/${kind}`, 'PUT', { items });
export const resetChecklistTemplate = (kind) => send(`/checklist-templates/${kind}`, 'DELETE');
/* Compliance calendar (server: services/people/compliance.ts). */
export const getComplianceCalendar = () => apiFetch(`${base()}/compliance`, opts);
export const updateComplianceTask = (id, body) => send(`/compliance/${encodeURIComponent(id)}`, 'PATCH', body);
export const addComplianceTask = (body) => send('/compliance', 'POST', body);
export const getComplianceEvidence = (id) => apiFetch(`${base()}/compliance/${encodeURIComponent(id)}/evidence`, opts).then((r) => r?.evidence);
/* Data health: the implementation auditor (server: services/people/dataHealth.ts). */
export const getDataHealth = () => apiFetch(`${base()}/data-health`, opts);
export const getEmploymentHistory = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/history`, opts).then((r) => r?.events || []);
/* Stints: joined, left, rejoined (FND-06). First to last. */
export const getEmploymentEpisodes = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/history`, opts).then((r) => r?.episodes || []);

export const LEAVING_TYPES = {
  RESIGNED: 'Resigned',
  TERMINATED: 'Terminated',
  RETIRED: 'Retired',
  ABSCONDED: 'Absconded',
  CONTRACT_ENDED: 'Contract ended',
  DECEASED: 'Deceased',
};
