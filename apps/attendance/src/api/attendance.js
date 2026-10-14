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
export const deviceCommand = (id, action) => send(`/devices/${encodeURIComponent(id)}/commands`, 'POST', { action });
export const listDeviceCommands = (id) => get(`/devices/${encodeURIComponent(id)}/commands`).then((r) => r?.commands || []);
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
