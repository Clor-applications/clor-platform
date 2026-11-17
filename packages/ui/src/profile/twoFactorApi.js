/* The signed-in person's authenticator app, for the profile card and the shell's two-factor gate. */
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
const base = () => `/orgs/${encodeURIComponent(String(orgId() || ''))}/security`;
const opts = { skipWarehouseHeader: true };
export const getTwoFactor = () => apiFetch(`${base()}/two-factor`, opts);
export const startTwoFactor = (password) => apiFetch(`${base()}/two-factor/setup`, { method: 'POST', body: { password }, ...opts });
export const enableTwoFactor = (code) => apiFetch(`${base()}/two-factor/enable`, { method: 'POST', body: { code }, ...opts });
export const disableTwoFactor = (password, code) => apiFetch(`${base()}/two-factor/disable`, { method: 'POST', body: { password, code }, ...opts });
/* Codes by text message, beside the app (server: routes/security.ts, two-factor/sms/*). */
export const startSmsTwoFactor = (password, phone) => apiFetch(`${base()}/two-factor/sms/start`, { method: 'POST', body: { password, phone }, ...opts });
export const enableSmsTwoFactor = (code) => apiFetch(`${base()}/two-factor/sms/enable`, { method: 'POST', body: { code }, ...opts });
export const sendSmsOffCode = () => apiFetch(`${base()}/two-factor/sms/send`, { method: 'POST', body: {}, ...opts });
export const disableSmsTwoFactor = (password, code) => apiFetch(`${base()}/two-factor/sms/disable`, { method: 'POST', body: { password, code }, ...opts });
