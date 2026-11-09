import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.7, 4.8, 4.9; server: routes/peopleEngagement.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

/* Settings → Automations: the shared endpoint of every module (routes/automations.ts), People's recipes. */
const automations = () => `/orgs/${encodeURIComponent(orgId())}/automations`;
export const getAutomations = () => apiFetch(`${automations()}?module=people`, opts);
export const saveAutomations = (list) => apiFetch(`${automations()}?module=people`, { ...opts, method: 'PUT', body: { automations: list } });
export const getAutomationHistory = (key) => apiFetch(`${automations()}/${encodeURIComponent(key)}/history`, opts);
export const getExitQuestions = () => apiFetch(`${base()}/exit-questions`, opts);
export const saveExitQuestions = (body) => send('/exit-questions', 'PUT', body);
export const resetExitQuestions = () => send('/exit-questions', 'DELETE');
export const leavingReasons = (months = 12) => apiFetch(`${base()}/reports/leaving-reasons?months=${months}`, opts);
export const finalPayList = () => apiFetch(`${base()}/final-pay`, opts).then((r) => r?.rows || []);
/* Whether a person is announced on birthdays and work anniversaries; HR records their wish (QA on #81). */
export const getCelebrationsFor = (employeeId) => apiFetch(`${base()}/employees/${encodeURIComponent(employeeId)}/celebrations`, opts);
export const setCelebrationsFor = (employeeId, optedOut) => send(`/employees/${encodeURIComponent(employeeId)}/celebrations`, 'PUT', { optedOut });
