import { apiFetch } from '@platform/http';

/* The operator console's calls (server: routes/ops.ts, routes/billing.ts). No company headers: an operator is outside every account. */
const o = { skipWarehouseHeader: true, skipTenantHeaders: true };
const q = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};

export const opsMe = () => apiFetch('/ops/me', o);
export const opsStartTwoFactor = (password) => apiFetch('/ops/two-factor/setup', { ...o, method: 'POST', body: { password } });
export const opsEnableTwoFactor = (code) => apiFetch('/ops/two-factor/enable', { ...o, method: 'POST', body: { code } });
export const opsOverview = () => apiFetch('/ops/overview', o);
export const opsAccounts = (params) => apiFetch(`/ops/accounts${q(params)}`, o);
export const opsAccount = (id) => apiFetch(`/ops/accounts/${encodeURIComponent(id)}`, o);
export const opsSuspend = (id, reason) => apiFetch(`/ops/accounts/${encodeURIComponent(id)}/suspend`, { ...o, method: 'POST', body: { reason } });
export const opsReinstate = (id, reason) => apiFetch(`/ops/accounts/${encodeURIComponent(id)}/reinstate`, { ...o, method: 'POST', body: { reason } });
export const opsExtendTrial = (id, days, reason) => apiFetch(`/ops/accounts/${encodeURIComponent(id)}/extend-trial`, { ...o, method: 'POST', body: { days, reason } });
export const opsGrantPlan = (id, body) => apiFetch(`/billing/accounts/${encodeURIComponent(id)}/subscription`, { ...o, method: 'POST', body });
export const opsAudit = (params) => apiFetch(`/ops/audit${q(params)}`, o);
export const opsOperators = () => apiFetch('/ops/operators', o);
export const opsAddOperator = (body) => apiFetch('/ops/operators', { ...o, method: 'POST', body });
export const opsChangeOperator = (userId, body) => apiFetch(`/ops/operators/${encodeURIComponent(userId)}`, { ...o, method: 'PATCH', body });
/* Demo requests from clor.in (server: routes/demoRequests.ts). */
export const opsDemoRequests = (params) => apiFetch(`/ops/demo-requests${q(params)}`, o);
export const opsDemoRequest = (id) => apiFetch(`/ops/demo-requests/${encodeURIComponent(id)}`, o);
export const opsSetDemoStatus = (id, body) => apiFetch(`/ops/demo-requests/${encodeURIComponent(id)}`, { ...o, method: 'PATCH', body });
export const opsCreateDemoAccount = (id, body) => apiFetch(`/ops/demo-requests/${encodeURIComponent(id)}/create-account`, { ...o, method: 'POST', body });
/* Pricing and Settings, Tax (server: routes/pricing.ts). */
export const opsPricing = () => apiFetch('/ops/pricing', o);
export const opsPriceBook = (id) => apiFetch(`/ops/pricing/books/${encodeURIComponent(id)}`, o);
export const opsSamplePlans = () => apiFetch('/ops/pricing/sample', o);
export const opsPricePreview = (body) => apiFetch('/ops/pricing/preview', { ...o, method: 'POST', body });
export const opsNewPriceBook = (body) => apiFetch('/ops/pricing/books', { ...o, method: 'POST', body });
export const opsSavePriceBook = (id, body) => apiFetch(`/ops/pricing/books/${encodeURIComponent(id)}`, { ...o, method: 'PATCH', body });
export const opsPublishPriceBook = (id) => apiFetch(`/ops/pricing/books/${encodeURIComponent(id)}/publish`, { ...o, method: 'POST', body: {} });
export const opsArchivePriceBook = (id) => apiFetch(`/ops/pricing/books/${encodeURIComponent(id)}/archive`, { ...o, method: 'POST', body: {} });
export const opsRollBackPriceBook = (id) => apiFetch(`/ops/pricing/books/${encodeURIComponent(id)}/roll-back`, { ...o, method: 'POST', body: {} });
export const opsTax = () => apiFetch('/ops/settings/tax', o);
export const opsSaveTax = (body) => apiFetch('/ops/settings/tax', { ...o, method: 'PUT', body });

/* Payments (server: routes/opsPayments.ts). */
const prov = (code) => `/ops/payments/providers/${encodeURIComponent(code)}`;
export const opsPayments = () => apiFetch('/ops/payments', o);
export const opsSaveProvider = (code, body) => apiFetch(prov(code), { ...o, method: 'PUT', body });
export const opsProviderMode = (code, mode, confirm) => apiFetch(`${prov(code)}/mode`, { ...o, method: 'POST', body: { mode, confirm } });
export const opsActivateProvider = (code) => apiFetch(`${prov(code)}/activate`, { ...o, method: 'POST', body: {} });
export const opsTestProvider = (code) => apiFetch(`${prov(code)}/test`, { ...o, method: 'POST', body: {} });
export const opsPaymentEvents = (params) => apiFetch(`/ops/payments/events${q(params)}`, o);
export const opsRetryPaymentEvent = (id) => apiFetch(`/ops/payments/events/${encodeURIComponent(id)}/retry`, { ...o, method: 'POST', body: {} });
export const opsPaymentAccounts = (text) => apiFetch(`/ops/payments/accounts${q({ q: text })}`, o);
export const opsRecordPayment = (body) => apiFetch('/ops/payments/manual', { ...o, method: 'POST', body });
