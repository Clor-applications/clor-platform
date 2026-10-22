import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { featuresFor } from '@platform/auth';

/**
 * People → Leave & Attendance. HR's leave and holidays are the same records
 * Attendance reads (server: routes/leave.ts, routes/attendance.ts), so the two
 * apps never disagree; the server opens them when People or Attendance is on.
 */
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
const id = (v) => encodeURIComponent(v);

export const listLeaveTypes = () => get('/leave/types').then((r) => r?.types || []);
export const createLeaveType = (body) => send('/leave/types', 'POST', body);
export const updateLeaveType = (typeId, body) => send(`/leave/types/${id(typeId)}`, 'PUT', body);
export const deleteLeaveType = (typeId) => send(`/leave/types/${id(typeId)}`, 'DELETE');

export const listLeaveRequests = (params) => get(`/leave/requests${query(params)}`).then((r) => r?.requests || []);
export const createLeaveRequest = (body) => send('/leave/requests', 'POST', body);
export const approveLeave = (requestId, note) => send(`/leave/requests/${id(requestId)}/approve`, 'POST', { note });
export const rejectLeave = (requestId, note) => send(`/leave/requests/${id(requestId)}/reject`, 'POST', { note });
export const cancelLeave = (requestId) => send(`/leave/requests/${id(requestId)}/cancel`, 'POST', {});

export const getLeaveBalances = (year) => get(`/leave/balances${query({ year })}`);
export const getLeaveLedger = (employeeId, year) => get(`/leave/ledger${query({ employeeId, year })}`);
export const addLeaveAdjustment = (body) => send('/leave/adjustments', 'POST', body);
export const deleteLeaveAdjustment = (adjustmentId) => send(`/leave/adjustments/${id(adjustmentId)}`, 'DELETE');

export const listHolidays = (year) => get(`/holidays${query({ year })}`).then((r) => r?.holidays || []);
export const listRecords = (params) => get(`/records${query(params)}`).then((r) => r?.records || []);
export const getMyDays = () => get('/me');
export const clock = (kind) => send('/clock', 'POST', kind ? { kind } : {});

/** Whether the company has Attendance switched on (readers, shifts, automatic marking). */
export const attendanceIsOn = () => featuresFor(orgId()).then((r) => Boolean((r?.features || r || {}).attendance)).catch(() => false);

export const STATUS_PILL = { PENDING: 'ui-pill-warn', APPROVED: 'ui-pill-pos', REJECTED: 'ui-pill-neg', CANCELLED: 'ui-pill-neutral' };
export const STATUS_LABEL = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const DAY_LABEL = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };
export const DAY_PILL = { PRESENT: 'ui-pill-pos', HALF_DAY: 'ui-pill-warn', ABSENT: 'ui-pill-neg', ON_LEAVE: 'ui-pill-info', HOLIDAY: 'ui-pill-neutral', WEEKLY_OFF: 'ui-pill-neutral' };
/** A request's dates: one day, or first to last. */
export const dates = (from, to) => (from === to ? from : `${from} to ${to}`);
/** A type's colour, or a steady one from its name so the calendar stays readable without set-up. */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#64748b'];
export const colorOf = (t) => t?.color || PALETTE[[...String(t?.name || t?.leaveTypeName || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
export const thisYear = () => new Date().getFullYear();
