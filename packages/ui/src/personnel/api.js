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
/* People → Home's setup list and simple mode's suggestion (server: services/people/setup.ts). */
export const getPeopleSetup = () => apiFetch(`${base()}/setup`, opts);
/* { action: 'skip' | 'unskip' | 'hide' | 'show' | 'simpleAdviceSeen', step? } */
export const changePeopleSetup = (body) => apiFetch(`${base()}/setup`, { ...opts, method: 'POST', body });
/* The Monday summary opened from its e-mail (?from=weekly): counted on the server, nothing else. */
export const summaryOpened = () => apiFetch(`${base()}/summary-opened`, { ...opts, method: 'POST', body: {} });

export const listEmployees = (params) => apiFetch(`${base()}/employees${query(params)}`, opts);
export const bulkUpdateEmployees = (body) => apiFetch(`${base()}/employees/bulk`, { ...opts, method: 'POST', body });
export const listSavedViews = (screen) => apiFetch(`${base()}/saved-views?screen=${encodeURIComponent(screen)}`, opts).then((r) => r?.views || []);
export const saveSavedView = (body) => apiFetch(`${base()}/saved-views`, { ...opts, method: 'POST', body }).then((r) => r?.view);
export const deleteSavedView = (id) => apiFetch(`${base()}/saved-views/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });
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
/* Changes dated for a future day (FND-02): withdrawing one. */
export const cancelScheduledChange = (id, changeId) => send(`/employees/${encodeURIComponent(id)}/scheduled/${encodeURIComponent(changeId)}`, 'DELETE');
export const createEmployee = (body) => send('/employees', 'POST', body);
export const updateEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteEmployee = (id) => send(`/employees/${encodeURIComponent(id)}`, 'DELETE');
/* dryRun: every row checked, nothing created — the preview before an import. */
export const importEmployees = (rows, dryRun = false, mode = 'create') => send('/employees/import', 'POST', { rows, dryRun, mode });
export const importBatches = () => apiFetch(`${base()}/employees/import/batches`, opts).then((r) => r?.batches || []);
export const undoImport = (batchId) => send(`/employees/import/${encodeURIComponent(batchId)}/undo`, 'POST', {});
export const importContractors = (rows, dryRun = false) => send('/contractors/import', 'POST', { rows, dryRun });
export const getOrgChart = (params = {}) => apiFetch(`${base()}/org-chart${params.asOf ? `?asOf=${encodeURIComponent(params.asOf)}` : ''}`, opts);

/** kind: departments | job-positions | job-roles | employee-types | work-types */
export const listStructure = (kind) => apiFetch(`${base()}/structure/${kind}`, opts).then((r) => r?.items || []);
/** The company's branches (the platform's, not a People list). */
export const listBranches = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/branches`, opts).then((r) => r?.branches || []);
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
/* Versions (DOC-02): replacing keeps the earlier file. */
export const replaceDocument = (docId, body) => send(`/documents/${encodeURIComponent(docId)}/replace`, 'POST', body);
export const listDocumentVersions = (docId) => apiFetch(`${base()}/documents/${encodeURIComponent(docId)}/versions`, opts).then((r) => r?.versions || []);
/* Ask the person to read and accept a file (DOC-05), and remind those who have not. */
export const askToAccept = (docId) => send(`/documents/${encodeURIComponent(docId)}/ask-to-read`, 'POST', {});
export const remindToAccept = (docId) => send(`/documents/${encodeURIComponent(docId)}/remind`, 'POST', {});
/* Letters (DOC-04, DOC-07): templates under Settings; issued onto the record as a PDF. */
export const getLetterTemplates = () => apiFetch(`${base()}/letter-templates`, opts);
export const getLetterTemplateVersions = (kind) => apiFetch(`${base()}/letter-templates/${encodeURIComponent(kind)}/versions`, opts).then((r) => r?.versions || []);
export const saveLetterTemplate = (body) => send('/letter-templates', 'POST', body);
export const issueLetter = (id, body) => send(`/employees/${encodeURIComponent(id)}/letters`, 'POST', body);
export const serviceCertificateDue = (id, askedOn) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/letters/service-certificate${askedOn ? `?askedOn=${encodeURIComponent(askedOn)}` : ''}`, opts);
export const requestLetter = (id, body) => send(`/employees/${encodeURIComponent(id)}/letters/requests`, 'POST', body);
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
/* One identifier in clear (CORE-04): the platform client answers the authenticator prompt when the server asks for one. */
export const revealStatutory = (id, field) => send(`/employees/${encodeURIComponent(id)}/statutory/reveal`, 'POST', { field }).then((r) => r?.value ?? null);
/* The identifiers People keeps: last four of Aadhaar, passport, work permit, statutory category. */
export const saveIdentity = (id, body) => send(`/employees/${encodeURIComponent(id)}/identity`, 'PUT', body).then((r) => r?.identity);
/* Joining and leaving plans on a record (server: services/people/checklists.ts); the lists live in packages/ui/src/lifecycle. */
export const CHECKLIST_OWNER = { HR: 'HR', MANAGER: 'Manager', PAYROLL: 'Payroll', IT: 'IT / admin', EMPLOYEE: 'Employee' };
export const getChecklist = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/checklist`, opts);
export const startChecklist = (id, kind) => send(`/employees/${encodeURIComponent(id)}/checklist/${kind}`, 'POST', {});
export const updateChecklistTask = (taskId, body) => send(`/checklist-tasks/${encodeURIComponent(taskId)}`, 'PATCH', body);
/* The tasks on my name (LIFE-07), open first. */
export const listMyTasks = () => apiFetch(`${base()}/tasks/mine`, opts).then((r) => r?.tasks || []);
/* Compliance calendar (server: services/people/compliance.ts). */
export const getComplianceCalendar = () => apiFetch(`${base()}/compliance`, opts);
export const updateComplianceTask = (id, body) => send(`/compliance/${encodeURIComponent(id)}`, 'PATCH', body);
export const addComplianceTask = (body) => send('/compliance', 'POST', body);
export const getComplianceEvidence = (id) => apiFetch(`${base()}/compliance/${encodeURIComponent(id)}/evidence`, opts).then((r) => r?.evidence);
/* Data health: the implementation auditor (server: services/people/dataHealth.ts). */
export const getDataHealth = () => apiFetch(`${base()}/data-health`, opts);
/* Snooze a Health check item with a reason and a date (HLTH-03); headcount and movements (HLTH-04). */
export const snoozeHealthCheck = (checkId, body) => send(`/data-health/${encodeURIComponent(checkId)}/snooze`, 'POST', body);
export const unsnoozeHealthCheck = (checkId) => send(`/data-health/${encodeURIComponent(checkId)}/snooze`, 'DELETE');
export const getHeadcount = (params = {}) => apiFetch(`${base()}/headcount?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`, opts);
/* What else a change affects (LIFE-04): asked before the form is sent, with the fields as they would be saved. */
export const getChangeImpact = (id, fields) => {
  const q = new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, v || '']));
  return apiFetch(`${base()}/employees/${encodeURIComponent(id)}/change-impact?${q}`, opts).then((r) => r?.impact || []);
};
/* Company-wide People settings (CORE-03, D-02). */
export const getPeopleSettings = () => apiFetch(`${base()}/settings`, opts).then((r) => r?.settings);
export const savePeopleSettings = (body) => send('/settings', 'PUT', body).then((r) => r?.settings);
/* Custom fields (CORE-08): the company's own fields on a person, by grant. */
export const getCustomFieldDefs = (all) => apiFetch(`${base()}/custom-fields${all ? '?all=1' : ''}`, opts);
export const saveCustomFieldDef = (body) => (body.id ? send(`/custom-fields/${encodeURIComponent(body.id)}`, 'PUT', body) : send('/custom-fields', 'POST', body));
export const getCustomValues = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/custom-fields`, opts).then((r) => r?.fields || []);
export const saveCustomValues = (id, values) => send(`/employees/${encodeURIComponent(id)}/custom-fields`, 'PUT', { values });
/* The journey and Why (CORE-06, TRACE-01): every change in order, each with its reasons. */
export const getJourney = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/journey`, opts);
export const raiseFromWhy = (id, key, body) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/why/${encodeURIComponent(key)}/raise`, { ...opts, method: 'POST', body });
export const getSalaryQuestion = (id, month) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/salary-question?month=${encodeURIComponent(month)}`, opts);
export const getWhy = (id, key) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/why/${encodeURIComponent(key)}`, opts).then((r) => r?.why);
/* Before day one (LIFE-01): invite the joiner; see what they sent; check it onto the record. */
export const createInvite = (id, body) => send(`/employees/${encodeURIComponent(id)}/invites`, 'POST', body);
export const listEmployeeInvites = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/invites`, opts).then((r) => r?.invites || []);
export const listInvites = (status) => apiFetch(`${base()}/invites${status ? `?status=${encodeURIComponent(status)}` : ''}`, opts).then((r) => r?.invites || []);
export const checkInvite = (id, body) => send(`/invites/${encodeURIComponent(id)}/check`, 'POST', body || {});
/* PAN, UAN, ESIC, bank and PF nominees the joiner sent: in full only here, approved onto Payroll's record (HR-VIEW gap 2). */
export const joiningStatutory = (inviteId) => apiFetch(`${base()}/invites/${encodeURIComponent(inviteId)}/statutory`, opts).then((r) => r?.statutory);
export const approveJoiningStatutory = (inviteId, values) => send(`/invites/${encodeURIComponent(inviteId)}/statutory/approve`, 'POST', values ? { values } : {});
export const rejectJoiningStatutory = (inviteId, note) => send(`/invites/${encodeURIComponent(inviteId)}/statutory/reject`, 'POST', { note });
/* Payroll has been switched on since: every approved set kept in People goes to it (HR-VIEW gap 2, audit gap 15). */
export const sendHeldToPayroll = () => send('/joining-statutory/send-held', 'POST', {});
/* Probation (LIFE-03): the decision — confirm, extend or end. */
export const decideProbation = (id, body) => send(`/employees/${encodeURIComponent(id)}/probation/decide`, 'POST', body);
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
  NOT_JOINED: 'Did not join',
  DUPLICATE: 'Duplicate record',
};
