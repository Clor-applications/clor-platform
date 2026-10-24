import { formatDateIn } from '@ui/utils/dates';
import { API_BASE, apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/** The native attendance API (server: routes/attendance.ts). */
const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const opts = { skipWarehouseHeader: true };
const base = () => `/orgs/${encodeURIComponent(orgId())}/attendance`;
const get = (path) => apiFetch(`${base()}${path}`, opts);
const send = (path, method, body) => apiFetch(`${base()}${path}`, { method, body, ...opts });
const query = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const getOverview = (date) => get(`/overview${query({ date })}`);
export const listEmployees = () => get('/employees').then((r) => r?.employees || []);

export const listRecords = (params) => get(`/records${query(params)}`);
/* Bulk imports (the Import screen): rows in, a verdict per failed row out. */
/* dryRun: every row checked the same way, nothing saved — the preview before an import. */
export const importRecords = (rows, dryRun = false) => send('/records/import', 'POST', { rows, dryRun });
export const importHolidays = (rows, dryRun = false) => send('/holidays/import', 'POST', { rows, dryRun });
export const importAssignments = (rows, dryRun = false) => send('/shift-assignments/import', 'POST', { rows, dryRun });
/* AT-02: opening leave balances and leave already taken. */
export const importLeaveBalances = (rows, dryRun = false) => send('/leave/allocations/import', 'POST', { rows, dryRun });
export const importLeaveHistory = (rows, dryRun = false) => send('/leave/requests/import', 'POST', { rows, dryRun });
export const markDay = (body) => send('/records', 'PUT', body);
export const deleteDay = (id) => send(`/records/${encodeURIComponent(id)}`, 'DELETE');
export const validateDays = (ids) => send('/records/validate', 'POST', { ids });
export const approveOvertime = (id, approved = true) => send(`/records/${encodeURIComponent(id)}/overtime`, 'POST', { approved });

export const getMe = () => get('/me');
export const clock = (kind) => send('/clock', 'POST', kind ? { kind } : {});
/** A punch from the phone: position (and an optional selfie) checked against the work sites. */
export const phonePunch = (body) => send('/me/punch', 'POST', body);
export const requestCorrection = (body) => send('/me/requests', 'POST', body);

export const listRequests = (status) => get(`/requests${query({ status })}`).then((r) => r?.requests || []);
export const approveRequest = (id, note) => send(`/requests/${encodeURIComponent(id)}/approve`, 'POST', { note });
export const rejectRequest = (id, note) => send(`/requests/${encodeURIComponent(id)}/reject`, 'POST', { note });

export const listShifts = () => get('/shifts').then((r) => r?.shifts || []);
export const createShift = (body) => send('/shifts', 'POST', body);
export const updateShift = (id, body) => send(`/shifts/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteShift = (id) => send(`/shifts/${encodeURIComponent(id)}`, 'DELETE');
export const listAssignments = (employeeId) => get(`/shift-assignments${query({ employeeId })}`).then((r) => r?.assignments || []);
export const assignShift = (body) => send('/shift-assignments', 'POST', body);
export const removeAssignment = (id) => send(`/shift-assignments/${encodeURIComponent(id)}`, 'DELETE');

export const listHolidays = (year) => get(`/holidays${query({ year })}`).then((r) => r?.holidays || []);
export const createHoliday = (body) => send('/holidays', 'POST', body);
export const updateHoliday = (id, body) => send(`/holidays/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteHoliday = (id) => send(`/holidays/${encodeURIComponent(id)}`, 'DELETE');

export const getSummary = (month) => get(`/summary${query({ month })}`);
/** Close a month (its days become final) or reopen it. */
/* `acknowledge`: the month-close checklist has open items and the person closing has seen them. */
export const closeMonth = (month, acknowledge = false) => send(`/months/${encodeURIComponent(month)}/close`, 'POST', acknowledge ? { acknowledge: true } : {});
export const reopenMonth = (month) => send(`/months/${encodeURIComponent(month)}/reopen`, 'POST', {});

/** IST "today", the attendance day. */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/**
 * A calendar date as people read it: the platform's dd/mm/yyyy (formatDateIn,
 * as Accounting shows dates), or "Fri, 16 Oct" with `weekday` for a list of
 * days. Read as UTC so the date never moves a day with the browser's time zone.
 */
export const dayLabel = (iso, { weekday = false, year = true } = {}) => {
  if (!iso) return '—';
  if (!weekday) return formatDateIn(iso);
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', weekday: 'short', ...(year ? { year: 'numeric' } : {}) });
};
export const hm = (minutes) => {
  const m = Math.max(0, Number(minutes) || 0);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
export const STATUS = {
  PRESENT: { label: 'Present', pill: 'ui-pill-pos' },
  HALF_DAY: { label: 'Half day', pill: 'ui-pill-warn' },
  ABSENT: { label: 'Absent', pill: 'ui-pill-neg' },
  ON_LEAVE: { label: 'On leave', pill: 'ui-pill-neutral' },
  HOLIDAY: { label: 'Holiday', pill: 'ui-pill-neutral' },
  WEEKLY_OFF: { label: 'Weekly off', pill: 'ui-pill-neutral' },
};

// Leave (server: routes/leave.ts)
export const listLeaveTypes = () => get('/leave/types').then((r) => r?.types || []);
export const createLeaveType = (body) => send('/leave/types', 'POST', body);
export const updateLeaveType = (id, body) => send(`/leave/types/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteLeaveType = (id) => send(`/leave/types/${encodeURIComponent(id)}`, 'DELETE');
export const getLeaveBalances = (year) => get(`/leave/balances${query({ year })}`);
export const setAllocation = (body) => send('/leave/allocations', 'PUT', body);
export const listLeaveRequests = (params) => get(`/leave/requests${query(params)}`).then((r) => r?.requests || []);
export const createLeaveRequest = (body) => send('/leave/requests', 'POST', body);
export const approveLeave = (id, note) => send(`/leave/requests/${encodeURIComponent(id)}/approve`, 'POST', { note });
export const rejectLeave = (id, note) => send(`/leave/requests/${encodeURIComponent(id)}/reject`, 'POST', { note });
export const cancelLeave = (id) => send(`/leave/requests/${encodeURIComponent(id)}/cancel`, 'POST', {});
export const getMyLeave = (year) => get(`/me/leave${query({ year })}`);
export const applyLeave = (body) => send('/me/leave', 'POST', body);
export const cancelMyLeave = (id) => send(`/me/leave/${encodeURIComponent(id)}/cancel`, 'POST', {});

export const LEAVE_STATUS = {
  PENDING: 'ui-pill-warn',
  APPROVED: 'ui-pill-pos',
  REJECTED: 'ui-pill-neg',
  CANCELLED: 'ui-pill-neutral',
};
/** A request's dates: one day, or first → last. */
export const leaveRange = (from, to) => (from === to ? from : `${from} → ${to}`);

// Biometric readers (server: routes/devices.ts; the readers talk to /iclock)
export const listDevices = () => get('/devices');
export const addDevice = (body) => send('/devices', 'POST', body);
export const updateDevice = (id, body) => send(`/devices/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteDevice = (id) => send(`/devices/${encodeURIComponent(id)}`, 'DELETE');
/* Readers of any vendor: HTTP push (own URL) and file import, read through a field mapping. */
export const previewMapping = (id, body) => send(`/devices/${encodeURIComponent(id)}/preview`, 'POST', body);
export const rotatePushToken = (id) => send(`/devices/${encodeURIComponent(id)}/rotate-token`, 'POST', {});
/** Signing for a push reader: on returns the secret once; off stops requiring it. */
export const setPushSigning = (id, on) => send(`/devices/${encodeURIComponent(id)}/signing`, 'POST', { on });
export const getReaderCertification = (id) => get(`/devices/${encodeURIComponent(id)}/certification`);
export const getReaderEvents = (id, outcome = '') => get(`/devices/${encodeURIComponent(id)}/events${outcome ? `?outcome=${outcome}` : ''}`);
export const getReaderCompatibility = () => get('/reader-compatibility');
export const lastPayload = (id) => get(`/devices/${encodeURIComponent(id)}/last-payload`);
export const approveDeviceNetwork = (id) => send(`/devices/${encodeURIComponent(id)}/approve-network`, 'POST', {});
export const deviceCommand = (id, action, extra = {}) => send(`/devices/${encodeURIComponent(id)}/commands`, 'POST', { action, ...extra });
export const listDeviceCommands = (id, status) => get(`/devices/${encodeURIComponent(id)}/commands${query({ status })}`);
export const retryDeviceCommands = (id, ids) => send(`/devices/${encodeURIComponent(id)}/commands/retry`, 'POST', ids ? { ids } : {});
export const cancelDeviceCommands = (id, ids) => send(`/devices/${encodeURIComponent(id)}/commands/cancel`, 'POST', ids ? { ids } : {});
// Running the fleet (server: routes/readerOps.ts)
export const getReaderHealth = () => get('/reader-health');
export const saveReaderAlertSettings = (body) => send('/reader-alerts/settings', 'PUT', body);
export const getReaderSync = () => get('/reader-sync');
export const fixReaderGaps = (body = {}) => send('/reader-sync/fix', 'POST', body);
export const removeReaderExtras = (deviceId) => send('/reader-sync/remove-extras', 'POST', { deviceId });
export const listDeviceUsers = (id) => get(`/devices/${encodeURIComponent(id)}/users`).then((r) => r?.users || []);
export const listUnmatchedPunches = () => get('/punches/unmatched').then((r) => r?.pins || []);
/** areaId: the ID is theirs only at that site's readers (a site ID), not company-wide. */
export const matchPunches = (pin, employeeId, areaId = null) => send('/punches/match', 'POST', { pin, employeeId, ...(areaId ? { areaId } : {}) });
export const listSiteReaderIds = () => get('/reader-ids/sites').then((r) => r?.sites || []);
export const getEmployeeReaderIds = (id) => get(`/employees/${encodeURIComponent(id)}/reader-ids`);
export const saveEmployeeReaderIds = (id, sites) => send(`/employees/${encodeURIComponent(id)}/reader-ids`, 'PUT', { sites });

/**
 * What to type into the reader's Cloud Server Setting: the API's own host and
 * port. Readers add the /iclock path themselves.
 */
export const readerServer = () => {
  try {
    const u = new URL(API_BASE, window.location.origin);
    return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80'), https: u.protocol === 'https:' };
  } catch {
    return { host: window.location.hostname, port: '80', https: false };
  }
};
export const listBiometrics = () => get('/biometrics').then((r) => r?.people || []);
/** The photo a reader holds for a Reader ID (USERPIC), as a data URL. */
export const getReaderPhoto = (pin) => get(`/biometrics/photo${query({ pin })}`);
export const listTransactions = (params) => get(`/transactions${query(params)}`);
export const listDeviceLogs = (params) => get(`/device-logs${query(params)}`);
export const listReports = () => get('/reports');
export const runReport = (id, params) => get(`/reports/${encodeURIComponent(id)}${query(params)}`);
/** Insights: recent months' rates and this month by department and person (server: reports/insights). */
export const getReportInsights = (params) => get(`/reports/insights${query(params)}`);
/* Reports that go out by e-mail on their own. */
export const listReportSchedules = () => get('/reports/schedules').then((r) => r?.schedules || []);
export const createReportSchedule = (body) => send('/reports/schedules', 'POST', body);
export const updateReportSchedule = (id, body) => send(`/reports/schedules/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteReportSchedule = (id) => send(`/reports/schedules/${encodeURIComponent(id)}`, 'DELETE');
export const sendReportSchedule = (id) => send(`/reports/schedules/${encodeURIComponent(id)}/send`, 'POST', {});
/** The month as a calendar: per-day counts (ClorTime's Attendance Calendar). */
export const getCalendar = (params) => get(`/calendar${query(params)}`);
export const testEtimeOffice = (body) => send('/devices/test-etimeoffice', 'POST', body);
export const testPull = (body) => send('/devices/test-pull', 'POST', body);
export const syncConnection = (id, from) => send(`/devices/${encodeURIComponent(id)}/sync`, 'POST', from ? { from } : {});

// Integrations (server: routes/integrations.ts; the outside API is routes/publicApi.ts at /v1)
export const listApiKeys = () => get('/integrations/keys');
export const createApiKey = (body) => send('/integrations/keys', 'POST', body);
export const rotateApiKey = (id) => send(`/integrations/keys/${encodeURIComponent(id)}/rotate`, 'POST', {});
export const revokeApiKey = (id) => send(`/integrations/keys/${encodeURIComponent(id)}/revoke`, 'POST', {});
export const listWebhooks = () => get('/integrations/webhooks');
/* HR tools (greytHR, Keka, …): connections the company runs alongside CLOR. */
export const listHrAdapters = () => get('/integrations/hr/adapters').then((r) => r?.adapters || []);
export const listHrConnections = () => get('/integrations/hr').then((r) => r?.connections || []);
export const createHrConnection = (body) => send('/integrations/hr', 'POST', body);
export const updateHrConnection = (id, body) => send(`/integrations/hr/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteHrConnection = (id) => send(`/integrations/hr/${encodeURIComponent(id)}`, 'DELETE');
export const testHrConnection = (id) => send(`/integrations/hr/${encodeURIComponent(id)}/test`, 'POST', {});
export const pullHrConnection = (id) => send(`/integrations/hr/${encodeURIComponent(id)}/pull`, 'POST', {});
export const flushHrConnection = (id) => send(`/integrations/hr/${encodeURIComponent(id)}/flush`, 'POST', {});
/* On-site connectors. */
export const listAgents = () => get('/integrations/agents');
export const createAgent = (body) => send('/integrations/agents', 'POST', body);
export const updateAgent = (id, body) => send(`/integrations/agents/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteAgent = (id) => send(`/integrations/agents/${encodeURIComponent(id)}`, 'DELETE');
export const rotateAgentToken = (id) => send(`/integrations/agents/${encodeURIComponent(id)}/rotate`, 'POST', {});
export const listAgentJobs = (id) => get(`/integrations/agents/${encodeURIComponent(id)}/jobs`);
export const hrConnectionLog = (id) => get(`/integrations/hr/${encodeURIComponent(id)}/log`);
export const createWebhook = (body) => send('/integrations/webhooks', 'POST', body);
export const updateWebhook = (id, body) => send(`/integrations/webhooks/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteWebhook = (id) => send(`/integrations/webhooks/${encodeURIComponent(id)}`, 'DELETE');
export const listWebhookDeliveries = (id, status) => get(`/integrations/webhooks/${encodeURIComponent(id)}/deliveries${query({ status })}`);
export const resendWebhookDelivery = (id, deliveryId) => send(`/integrations/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/resend`, 'POST', {});
export const testWebhook = (id) => send(`/integrations/webhooks/${encodeURIComponent(id)}/test`, 'POST', {});
/** Where outside systems call: the API host's /v1. */
export const publicApiBase = () => {
  try {
    const u = new URL(API_BASE, window.location.origin);
    return `${u.origin}/v1`;
  } catch {
    return '/v1';
  }
};

// Scheduling (server: routes/scheduling.ts)
export const listTemporarySchedules = (from) => get(`/temporary-schedules${query({ from })}`).then((r) => r?.schedules || []);
export const addTemporarySchedule = (body) => send('/temporary-schedules', 'POST', body);
export const removeTemporarySchedule = (id) => send(`/temporary-schedules/${encodeURIComponent(id)}`, 'DELETE');
export const listDepartmentSchedules = () => get('/department-schedules').then((r) => r?.schedules || []);
export const addDepartmentSchedule = (body) => send('/department-schedules', 'POST', body);
export const removeDepartmentSchedule = (id) => send(`/department-schedules/${encodeURIComponent(id)}`, 'DELETE');
export const listRotations = () => get('/rotations').then((r) => r?.rotations || []);
export const createRotation = (body) => send('/rotations', 'POST', body);
export const updateRotation = (id, body) => send(`/rotations/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteRotation = (id) => send(`/rotations/${encodeURIComponent(id)}`, 'DELETE');
export const listRotationPeople = (id) => get(`/rotations/${encodeURIComponent(id)}/assignments`).then((r) => r?.assignments || []);
export const assignRotation = (id, body) => send(`/rotations/${encodeURIComponent(id)}/assignments`, 'POST', body);
export const removeRotationAssignment = (id) => send(`/rotation-assignments/${encodeURIComponent(id)}`, 'DELETE');
export const getRules = () => get('/rules').then((r) => r?.rules);
/* Both unwrap { rules }: the screen keeps what it gets back as the form. */
export const saveRules = (body) => send('/rules', 'PUT', body).then((r) => r?.rules);
export const getSchedule = (params) => get(`/schedule${query(params)}`);
export const recompute = (body) => send('/recompute', 'POST', body);
export const SCHEDULE_SOURCE = { TEMPORARY: 'Temporary', EMPLOYEE: 'Own schedule', ROTATION: 'Rotation', DEPARTMENT: 'Department', DEFAULT: 'Company default' };

/* Employee portal: who may sign in, activation codes, phone punching, work sites. */
export const getPortalAccess = () => get('/portal-access');
export const issuePortalCodes = (employeeIds, email = false) => send('/portal-access/codes', 'POST', { employeeIds, email });
export const setPortalAccess = (body) => send('/portal-access', 'PUT', body);
export const resetPortalPassword = (employeeId) => send(`/portal-access/${encodeURIComponent(employeeId)}/reset`, 'POST', {});
/** A-33: sign someone out of the employee app on every device; their password still works. */
export const signOutPortalEverywhere = (employeeId) => send(`/portal-access/${encodeURIComponent(employeeId)}/sign-out-everywhere`, 'POST', {});
export const listGeofences = () => get('/geofences').then((r) => r?.geofences || []);
export const createGeofence = (body) => send('/geofences', 'POST', body);
export const updateGeofence = (id, body) => send(`/geofences/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteGeofence = (id) => send(`/geofences/${encodeURIComponent(id)}`, 'DELETE');
/** Address suggestions for a work site, and what is at a point the pin was moved to. */
export const searchPlaces = (q) => get(`/geocode?q=${encodeURIComponent(q)}`).then((r) => r?.places || []);
export const placeAt = (lat, lon) => get(`/geocode/reverse?lat=${lat}&lon=${lon}`).then((r) => r?.place || null);
/** Approve or refuse a field punch; and whether field punches wait for approval. */
export const reviewFieldPunch = (id, approve) => send(`/phone-punches/${encodeURIComponent(id)}/review`, 'POST', { approve });
export const setFieldPunchApproval = (on) => send('/phone-punches/settings', 'PUT', { fieldPunchApproval: on });
export const getPunchPhoto = (id) => get(`/punch-photos/${encodeURIComponent(id)}`);

/* --- Attendance you can trust (server: routes/attendanceInsights.ts) --- */
/** Why a day says what it says: shift, grace, punches, the rule applied, its history. */
export const explainDay = (employeeId, date) => get(`/days/explain${query({ employeeId, date })}`);
export const explainMyDay = (date) => get(`/me/days/explain${query({ date })}`);
/** What is unsettled: missing check-outs, unmarked days, queues, reader problems, clashing schedules. */
export const listExceptions = (params) => get(`/exceptions${query(params)}`);
export const setExceptionState = (body) => send('/exceptions/state', 'POST', body);
export const setExceptionStates = (body) => send('/exceptions/state/bulk', 'POST', body);
/** The month-close checklist, and the figures Payroll took when it closed. */
export const getMonthReadiness = (month) => get(`/months/${encodeURIComponent(month)}/readiness`);
/* Payroll readiness across Attendance and People / Payroll data, with money at stake (server: services/payroll/readinessTower.ts). */
export const getPayrollReadiness = (month) => get(`/months/${encodeURIComponent(month)}/payroll-readiness`);
export const getMonthSnapshot = (month, version) => get(`/months/${encodeURIComponent(month)}/snapshots/${encodeURIComponent(version)}`);
/** What a schedule change would do, before it is saved. */
export const checkSchedule = (body) => send('/schedule/check', 'POST', body);
/** Many days at once: preview first (`preview: true`), then apply. */
export const bulkChangeDays = (body) => send('/records/bulk', 'POST', body);
export const bulkReviewRequests = (ids, approve, note) => send('/requests/bulk-review', 'POST', { ids, approve, note });
export const listRuleVersions = () => get('/rules/versions').then((r) => r?.versions || []);
export const simulateRules = (body) => send('/rules/simulate', 'POST', body);
export const getMappingAudit = () => get('/mapping-audit');
export const getReaderTimeline = (id, days = 7) => get(`/devices/${encodeURIComponent(id)}/timeline${query({ days })}`);
export const explainLeave = (employeeId, leaveTypeId, year) => get(`/leave/explain${query({ employeeId, leaveTypeId, year })}`);
export const explainMyLeave = (leaveTypeId, year) => get(`/me/leave/explain${query({ leaveTypeId, year })}`);
export const getEvidence = (employeeId, from, to) => get(`/evidence${query({ employeeId, from, to })}`);
export const getPhonePunches = (params) => get(`/phone-punches${query(params)}`);
export const listScheduleRuns = (id) => get(`/reports/schedules/${encodeURIComponent(id)}/runs`).then((r) => r?.runs || []);

/** Reason categories for a correction (the free-text reason stays required). */
export const REASON_CODES = [
  { value: 'FORGOT_PUNCH', label: 'Forgot to punch' },
  { value: 'READER_DOWN', label: 'Reader not working' },
  { value: 'ON_DUTY', label: 'On duty elsewhere' },
  { value: 'WRONG_SHIFT', label: 'Wrong shift' },
  { value: 'OTHER', label: 'Other' },
];
export const reasonLabel = (code) => REASON_CODES.find((r) => r.value === code)?.label || null;


/* Data protection (DPDP): settings, the employee notice, status, and the breach register. */
export const getDataProtection = () => get('/data-protection');
export const saveDataProtection = (body) => send('/data-protection', 'PUT', body);
export const listBreaches = () => get('/data-protection/breaches').then((r) => r?.breaches || []);
export const recordBreach = (body) => send('/data-protection/breaches', 'POST', body);
export const updateBreach = (id, body) => send(`/data-protection/breaches/${encodeURIComponent(id)}`, 'PUT', body);
export const notifyBreach = (id) => send(`/data-protection/breaches/${encodeURIComponent(id)}/notify`, 'POST', {});

// Overtime and comp-off: the company's rules and the requests waiting on HR.
export const getOvertimeRules = () => get('/overtime/rules');
export const saveOvertimeRules = (rules) => send('/overtime/rules', 'PUT', rules);
export const listOvertimeRequests = (status = 'PENDING') => get(`/overtime/requests${query({ status })}`);
export const decideOvertimeRequest = (id, approve, note) => send(`/overtime/requests/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, 'POST', { note });

/* The recycle bin (server: routes/recycleBin.ts) and the audit log (routes/audit.ts), both company-wide. */
const orgPath = (path) => `/orgs/${encodeURIComponent(orgId())}${path}`;
export const listRecycleBin = () => apiFetch(orgPath('/recycle-bin'), opts);
export const restoreFromBin = (id) => apiFetch(orgPath(`/recycle-bin/${encodeURIComponent(id)}/restore`), { method: 'POST', body: {}, ...opts });
export const deleteFromBin = (id) => apiFetch(orgPath(`/recycle-bin/${encodeURIComponent(id)}`), { method: 'DELETE', ...opts });
export const listAuditLog = (params) => apiFetch(orgPath(`/audit${query({ app: 'attendance', ...params })}`), opts);
export const getAuditFacets = () => apiFetch(orgPath('/audit/facets?app=attendance'), opts);
