import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Attendance rules, late marks, absences and night-work consent (server: routes/peopleTimeRules.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const get = (path) => apiFetch(`${base()}${path}`, opts);
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });
const id = (v) => encodeURIComponent(v);

/** { rules: { marks, nudge, absence, night }, leaveTypes: [{ id, name }], version, canEdit } */
export const getAttendanceRules = () => get('/attendance-rules');
export const saveAttendanceRules = (body) => send('/attendance-rules', 'PUT', body);

/** { month, rules, ended, totals, rows: [{ employeeId, name, lateMarks, earlyMarks, lateDates, days, status, fromLeave, lossOfPayDays, decision }], canApply } */
export const getLateMarks = (month) => get(`/late-marks?month=${id(month)}`);
export const previewLateMarks = (month, marks) => send('/late-marks/preview', 'POST', { month, marks });
export const waivePenalty = (employeeId, month, reason) => send(`/late-marks/${id(employeeId)}/waive`, 'POST', { month, reason });
export const undoPenalty = (employeeId, month) => send(`/late-marks/${id(employeeId)}/undo`, 'POST', { month });
export const applyPenalties = (month) => send('/late-marks/apply', 'POST', { month });

/** { rules, rows, counts: { open, held }, canAct } */
export const getAbsences = (status) => get(`/absences?status=${id(status || 'open')}`);
export const checkAbsences = () => send('/absences/check', 'POST', {});
export const sendAbsenceNotice = (caseId, body) => send(`/absences/${id(caseId)}/notice`, 'POST', body);
export const getNoticeCopy = (noticeId) => get(`/absences/notices/${id(noticeId)}`).then((r) => r.notice);
export const closeAbsence = (caseId, body) => send(`/absences/${id(caseId)}/close`, 'POST', body);
export const recordAbsconded = (caseId, body) => send(`/absences/${id(caseId)}/absconded`, 'POST', body);
export const holdSettlement = (caseId, reason) => send(`/absences/${id(caseId)}/hold`, 'POST', { reason });
export const releaseSettlement = (caseId, note) => send(`/absences/${id(caseId)}/release`, 'POST', { note });

/** { night: { from, to, words }, rows: [{ employeeId, name, consent, nightDays, firstNightDay, problem }], totals, canEdit } */
export const getNightWork = () => get('/night-work');
export const getConsentHistory = (employeeId) => get(`/night-work/${id(employeeId)}`).then((r) => r?.history || []);
export const recordNightConsent = (employeeId, body) => send(`/night-work/${id(employeeId)}`, 'POST', body);
