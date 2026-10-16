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
export const markDay = (body) => send('/records', 'PUT', body);
export const deleteDay = (id) => send(`/records/${encodeURIComponent(id)}`, 'DELETE');
export const validateDays = (ids) => send('/records/validate', 'POST', { ids });
export const approveOvertime = (id, approved = true) => send(`/records/${encodeURIComponent(id)}/overtime`, 'POST', { approved });

export const getMe = () => get('/me');
export const clock = (kind) => send('/clock', 'POST', kind ? { kind } : {});
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

/** IST "today", the attendance day. */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
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
export const approveDeviceNetwork = (id) => send(`/devices/${encodeURIComponent(id)}/approve-network`, 'POST', {});
export const deviceCommand = (id, action) => send(`/devices/${encodeURIComponent(id)}/commands`, 'POST', { action });
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
export const matchPunches = (pin, employeeId) => send('/punches/match', 'POST', { pin, employeeId });

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
export const listTransactions = (params) => get(`/transactions${query(params)}`);
export const listDeviceLogs = (params) => get(`/device-logs${query(params)}`);
export const listReports = () => get('/reports');
export const runReport = (id, params) => get(`/reports/${encodeURIComponent(id)}${query(params)}`);
export const testEtimeOffice = (body) => send('/devices/test-etimeoffice', 'POST', body);
export const syncConnection = (id, from) => send(`/devices/${encodeURIComponent(id)}/sync`, 'POST', from ? { from } : {});

// Integrations (server: routes/integrations.ts; the outside API is routes/publicApi.ts at /v1)
export const listApiKeys = () => get('/integrations/keys');
export const createApiKey = (body) => send('/integrations/keys', 'POST', body);
export const rotateApiKey = (id) => send(`/integrations/keys/${encodeURIComponent(id)}/rotate`, 'POST', {});
export const revokeApiKey = (id) => send(`/integrations/keys/${encodeURIComponent(id)}/revoke`, 'POST', {});
export const listWebhooks = () => get('/integrations/webhooks');
export const createWebhook = (body) => send('/integrations/webhooks', 'POST', body);
export const updateWebhook = (id, body) => send(`/integrations/webhooks/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteWebhook = (id) => send(`/integrations/webhooks/${encodeURIComponent(id)}`, 'DELETE');
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
export const listGeofences = () => get('/geofences').then((r) => r?.geofences || []);
export const createGeofence = (body) => send('/geofences', 'POST', body);
export const updateGeofence = (id, body) => send(`/geofences/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteGeofence = (id) => send(`/geofences/${encodeURIComponent(id)}`, 'DELETE');
export const getPunchPhoto = (id) => get(`/punch-photos/${encodeURIComponent(id)}`);
