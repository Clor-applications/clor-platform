import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { featuresFor } from '@platform/auth';

/**
 * People → Time & Leave. HR's leave and holidays are the same records
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
export const bulkGrantLeave = (body) => send('/leave/adjustments/bulk', 'POST', body);
export const listLeaveBlocks = () => get('/leave/blocks').then((r) => r?.blocks || []);
export const createLeaveBlock = (body) => send('/leave/blocks', 'POST', body);
export const updateLeaveBlock = (blockId, body) => send(`/leave/blocks/${id(blockId)}`, 'PUT', body);
export const deleteLeaveBlock = (blockId) => send(`/leave/blocks/${id(blockId)}`, 'DELETE');

export const listLeaveRequests = (params) => get(`/leave/requests${query(params)}`).then((r) => r?.requests || []);
/** One page of requests, searched and filtered on the server: { requests, total, counts: { PENDING, APPROVED, REJECTED, CANCELLED, all } }. */
export const pageLeaveRequests = (params) => get(`/leave/requests${query(params)}`);
/** One request's story: { request, history, dates, balance, parts, alsoAway, waitingForManager, ownRequest }. */
export const getLeaveRequest = (requestId) => get(`/leave/requests/${id(requestId)}`);
/** The document sent with a request (a certificate), as a data URL. */
export const getLeaveDocument = (requestId) => get(`/leave/requests/${id(requestId)}/document`).then((r) => r?.document || null);
/** What a request would charge, without saving: { ok, total, split, parts[{label, from, to, days, balance, dates}], problems, reasonNeeded, alsoAway }. */
export const previewLeave = (body) => send('/leave/requests/preview', 'POST', body);
export const previewMyLeave = (body) => send('/me/leave/preview', 'POST', body);
/** Away today, waiting (oldest first), the next seven days, days lapsing at the period end. */
export const getTimeOverview = () => get('/leave/overview');
/** A draft leave type tried on five real people this period. */
export const previewLeaveType = (body) => send('/leave/types/preview', 'POST', body);
/** The company's working week: { weeklyOffDays: '0,6', offSaturdays: '2,4', shiftsDecide }. */
export const getWorkingWeek = () => get('/leave/working-week');
export const saveWorkingWeek = (body) => send('/leave/working-week', 'PUT', body);
export const createLeaveRequest = (body) => send('/leave/requests', 'POST', body);
export const approveLeave = (requestId, note) => send(`/leave/requests/${id(requestId)}/approve`, 'POST', { note });
export const rejectLeave = (requestId, note) => send(`/leave/requests/${id(requestId)}/reject`, 'POST', { note });
export const cancelLeave = (requestId) => send(`/leave/requests/${id(requestId)}/cancel`, 'POST', {});
/** Decide several waiting leave requests at once, each through the same checks as one: { done, failed, handedOn, results: [{ id, error, code }] }. */
export const bulkReviewLeave = (ids, approve, note) => send('/leave/requests/bulk-review', 'POST', { ids, approve, ...(note ? { note } : {}) });
/** Approved work from home and on duty in a month: { rows: [{ id, employeeId, employeeName, department, kind, fromDate, toDate, halfDay, place }] }. */
export const getWorkingAway = (month) => get(`/leave/working-away${query({ month })}`).then((r) => r?.rows || []);
/** A month's payable and loss-of-pay days per person, as Payroll takes them: { month, source: 'ATTENDANCE'|'LEAVE', rows, payrollTaken }. */
export const getPayableDays = (month) => get(`/payable-days${query({ month })}`);
/** Change a waiting request (same body as create; the manager's step starts again). */
export const updateLeaveRequest = (requestId, body) => send(`/leave/requests/${id(requestId)}`, 'PUT', body);
/** Came back early: approved leave that has started now ends on `toDate`. */
export const shortenLeave = (requestId, toDate) => send(`/leave/requests/${id(requestId)}/shorten`, 'POST', { toDate });
/** Comp-off for a day worked, as a dated credit of the comp-off type (409 COMP_OFF_TYPE when none is set). */
export const grantCompOff = (body) => send('/leave/comp-off', 'POST', body);
/** Who decides for a manager while they are away: { standIns: [{ id, managerEmployeeId, standInEmployeeId, managerName, standInName, fromDate, toDate, live }], today }. */
export const listStandIns = () => get('/leave/stand-ins');
export const addStandIn = (body) => send('/leave/stand-ins', 'POST', body);
export const removeStandIn = (standInId) => send(`/leave/stand-ins/${id(standInId)}`, 'DELETE');
/** A person's restricted holidays for a calendar year: { quota, picked, left, holidays: [{ id, date, name, picked, past }] }. */
export const getRestrictedHolidays = (employeeId, year) => get(`/leave/holidays/restricted${query({ employeeId, year })}`);
export const getMyRestrictedHolidays = (year) => get(`/me/holidays/restricted${query({ year })}`);
export const pickMyRestrictedHoliday = (holidayId, picked) => send(`/me/holidays/restricted/${id(holidayId)}`, 'POST', { picked });
/** Year end of a leave period: per person and type, what carries, lapses and is paid out; the runs so far. */
export const getYearEnd = (year) => get(`/leave/year-end${query({ year })}`);
export const runYearEnd = (year) => send('/leave/year-end', 'POST', { year });
export const undoYearEnd = (runId) => send(`/leave/year-end/${id(runId)}/undo`, 'POST', {});
export const editMyLeave = (requestId, body) => send(`/me/leave/${id(requestId)}`, 'PUT', body);
export const shortenMyLeave = (requestId, toDate) => send(`/me/leave/${id(requestId)}/shorten`, 'POST', { toDate });

export const getLeaveBalances = (year) => get(`/leave/balances${query({ year })}`);
/** One person's ledger; `asOf` (YYYY-MM-DD) shows the balance as it stands on that day. */
export const getLeaveLedger = (employeeId, year, asOf) => get(`/leave/ledger${query({ employeeId, year, asOf })}`);
export const addLeaveAdjustment = (body) => send('/leave/adjustments', 'POST', body);
/** One person's days of a type for a period, in place of the policy's; `days: null` puts them back on the policy (time depth, gap 22). */
export const setAllocation = (body) => send('/leave/allocations', 'PUT', body);
/** Who picked which restricted holiday in a year (HR's view, time depth, gap 22). */
export const restrictedPicks = (year) => get(`/leave/holidays/restricted/picks${query({ year })}`);
export const deleteLeaveAdjustment = (adjustmentId) => send(`/leave/adjustments/${id(adjustmentId)}`, 'DELETE');

/** The company's leave period (e.g. April–March), with this, the last and the next period's bounds and names. */
export const getLeaveSettings = () => get('/leave/settings');
export const saveLeaveSettings = (body) => send('/leave/settings', 'PUT', body);
/** The leave register of a period: opening, credited, changed, taken, paid out, waiting, lapsed, left. */
export const getLeaveRegister = (params) => get(`/leave/register${query(params)}`);
/** The register per worker, in a prescribed form's layout: days worked, opening, earned, availed and refused with dates, paid out, closing. */
export const getLeaveRegisterBook = (params) => get(`/leave/register/book${query(params)}`);
/** The periods to choose from, newest first, named as the company's leave year names them. */
/** The leave period a date falls in, by the year it starts in (the calendar year without settings). */
export const periodYearOf = (s, date) => {
  const y = Number(String(date).slice(0, 4));
  if (!s) return y;
  const start = `${y}-${String(s.startMonth).padStart(2, '0')}-${String(s.startDay).padStart(2, '0')}`;
  return date >= start ? y : y - 1;
};
export const periodChoices = (s) => (s ? [s.next, s.current, s.previous].filter(Boolean) : []);
export const ACCRUAL_LABEL = { YEARLY: 'Yearly', HALF_YEARLY: 'Half-yearly', QUARTERLY: 'Quarterly', MONTHLY: 'Monthly' };
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
/** "1 day on the 10th of each month", "3 days at the end of each quarter". */
export function creditText(t) {
  const part = { YEARLY: 'period', HALF_YEARLY: 'half-year', QUARTERLY: 'quarter', MONTHLY: 'month' }[t.accrual] || 'period';
  const n = Math.round(((Number(t.annualDays) || 0) * ({ YEARLY: 12, HALF_YEARLY: 6, QUARTERLY: 3, MONTHLY: 1 }[t.accrual] || 12)) / 12 * 100) / 100;
  const days = `${n} day${n === 1 ? '' : 's'}`;
  if (t.creditOn === 'END') return `${days} at the end of each ${part}`;
  if (t.creditOn === 'DAY' && t.creditDay) return part === 'month' ? `${days} on the ${ordinal(Number(t.creditDay))} of each month` : `${days} each ${part}, on the first ${ordinal(Number(t.creditDay))}`;
  return `${days} at the start of each ${part}`;
}
export const listHolidays = (year) => get(`/holidays${query({ year })}`).then((r) => r?.holidays || []);
export const listRecords = (params) => get(`/records${query(params)}`).then((r) => r?.records || []);
/* Mark one person's day by hand: check-in, check-out (HH:MM) or a status (server: PUT /attendance/records). */
export const markDay = (body) => send('/records', 'PUT', body);
export const getMyDays = () => get('/me');
export const clock = (kind) => send('/clock', 'POST', kind ? { kind } : {});
/** A punch from the phone with its position (and a selfie, if taken): the same checks as the employee app's. */
export const phonePunch = (body) => send('/me/punch', 'POST', body);

/** Whether the company has Attendance switched on (readers, shifts, automatic marking). */
export const attendanceIsOn = () => featuresFor(orgId()).then((r) => Boolean((r?.features || r || {}).attendance)).catch(() => false);

export const STATUS_PILL = { PENDING: 'ui-pill-warn', APPROVED: 'ui-pill-pos', REJECTED: 'ui-pill-neg', CANCELLED: 'ui-pill-neutral' };
export const STATUS_LABEL = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
/** Private leave as a reader without the right to see it gets it: no type colour, no reason. */
export const PRIVATE_LABEL = 'Private leave';
export const DAY_LABEL = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };
export const DAY_PILL = { PRESENT: 'ui-pill-pos', HALF_DAY: 'ui-pill-warn', ABSENT: 'ui-pill-neg', ON_LEAVE: 'ui-pill-info', HOLIDAY: 'ui-pill-neutral', WEEKLY_OFF: 'ui-pill-neutral' };
/** A request's dates: one day, or first to last. */
export const dates = (from, to) => (from === to ? from : `${from} to ${to}`);
/** A type's colour, or a steady one from its name so the calendar stays readable without set-up. */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#64748b'];
export const colorOf = (t) => t?.color || PALETTE[[...String(t?.name || t?.leaveTypeName || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
export const thisYear = () => new Date().getFullYear();
/** Today in India, as the server counts days (not the browser's UTC date). */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "2 days", "half a day". */
export const daysText = (n) => (n === 0.5 ? 'half a day' : `${n} day${n === 1 ? '' : 's'}`);

/*
 * Attendance requests (TIME-LEAVE-DECISIONS.md, advanced build): missed punch,
 * work from home, on duty, permission hours; one list, one approval, monthly
 * quotas from Settings → Request rules (server: services/attendance/requests.ts).
 */
/** One page: { requests, total, counts: { PENDING, APPROVED, REJECTED, CANCELLED, all }, limit, offset }. */
export const pageRequests = (params) => get(`/requests${query(params)}`);
/** One request's story: { request, history, usage, rule, chain, days, waitingForManager, ownRequest }. */
export const getRequest = (requestId) => get(`/requests/${id(requestId)}`);
export const createRequest = (body) => send('/requests', 'POST', body);
export const updateRequest = (requestId, body) => send(`/requests/${id(requestId)}`, 'PUT', body);
/** Approve or reject; under manager-then-HR the manager's step answers { stage: 'HR' }. */
export const decideRequest = (requestId, approve, note) => send(`/requests/${id(requestId)}/${approve ? 'approve' : 'reject'}`, 'POST', { note });
/** Decide several at once, each through the same checks as one: { done, failed, handedOn, results: [{ id, error }] }. */
export const bulkReviewRequests = (ids, approve, note) => send('/requests/bulk-review', 'POST', { ids, approve, ...(note ? { note } : {}) });
/* Field punches and overtime from the one Approvals inbox (time depth, gap 18). */
export const bulkReviewPunches = (ids, approve) => send('/phone-punches/bulk-review', 'POST', { ids, approve });
export const bulkReviewOvertime = (ids, approve, note) => send('/overtime/requests/bulk-review', 'POST', { ids, approve, ...(note ? { note } : {}) });
export const cancelRequest = (requestId, note) => send(`/requests/${id(requestId)}/cancel`, 'POST', note ? { note } : {});
/** Used, waiting and left this month: { month, usage: { [kind]: { unit, used, pending, quota, left } } }. */
export const requestUsage = (employeeId, month, kind) => get(`/requests/usage${query({ employeeId, month, kind })}`);
/** { rules: { MISSED_PUNCH, WFH, ON_DUTY, PERMISSION }, kinds, chains, defaults }. */
export const getRequestRules = () => get('/request-rules');
export const saveRequestRules = (body) => send('/request-rules', 'PUT', body);
/** My own: { month, requests, usage, rules }. */
export const myRequests = (month) => get(`/me/requests${query({ month })}`);
export const createMyRequest = (body) => send('/me/requests', 'POST', body);
export const updateMyRequest = (requestId, body) => send(`/me/requests/${id(requestId)}`, 'PUT', body);
export const cancelMyRequest = (requestId) => send(`/me/requests/${id(requestId)}/cancel`, 'POST', {});

/** Who a request can be entered for: current people in the caller's scope, from the leave engine (works with People or Attendance alone). */
export const listPeople = () => get('/employees').then((r) => r?.employees || []);
