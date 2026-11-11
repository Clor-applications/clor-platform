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
/* The request's Explore link (server: routes/demoRequests.ts, services/explore.ts). */
export const opsResendExplore = (id) => apiFetch(`/ops/demo-requests/${encodeURIComponent(id)}/explore/resend`, { ...o, method: 'POST' });
export const opsEndExplore = (id) => apiFetch(`/ops/demo-requests/${encodeURIComponent(id)}/explore/end`, { ...o, method: 'POST' });
/* Explore on the console: the sample company and every link (server: routes/opsExplore.ts). */
export const opsSampleCompany = () => apiFetch('/ops/explore/sample', o);
export const opsBuildSample = (force = false) => apiFetch('/ops/explore/sample/build', { ...o, method: 'POST', body: { force } });
export const opsExplorePasses = (params) => apiFetch(`/ops/explore/passes${q(params)}`, o);
export const opsResendPass = (id) => apiFetch(`/ops/explore/passes/${encodeURIComponent(id)}/resend`, { ...o, method: 'POST' });
export const opsEndPass = (id) => apiFetch(`/ops/explore/passes/${encodeURIComponent(id)}/end`, { ...o, method: 'POST' });
/* Trials (server: routes/signup.ts): free trials started from clor.in, pending and made. Trial accounts themselves come from opsAccounts({ status: 'trialing' }). */
export const opsSignups = (params) => apiFetch(`/ops/signups${q(params)}`, o);
export const opsResendSignup = (id) => apiFetch(`/ops/signups/${encodeURIComponent(id)}/resend`, { ...o, method: 'POST' });
/* One page per customer (server: routes/opsCustomers.ts). */
const acct = (id) => `/ops/accounts/${encodeURIComponent(id)}`;
export const opsChangeApps = (id, apps, reason) => apiFetch(`${acct(id)}/apps`, { ...o, method: 'POST', body: { apps, reason } });
export const opsCancelSubscription = (id, reason) => apiFetch(`${acct(id)}/cancel`, { ...o, method: 'POST', body: { reason } });
export const opsReopenSubscription = (id, reason) => apiFetch(`${acct(id)}/reopen`, { ...o, method: 'POST', body: { reason } });
export const opsCustomerPayments = (id) => apiFetch(`${acct(id)}/payments`, o);
export const opsCustomerRequests = (id) => apiFetch(`${acct(id)}/requests`, o);
export const opsCustomerUsers = (id) => apiFetch(`${acct(id)}/users`, o);
export const opsCustomerActivity = (id) => apiFetch(`${acct(id)}/activity`, o);
export const opsSendResetLink = (id, userId, reason) => apiFetch(`${acct(id)}/users/${encodeURIComponent(userId)}/reset-link`, { ...o, method: 'POST', body: { reason } });
export const opsSignOutEverywhere = (id, userId, reason) => apiFetch(`${acct(id)}/users/${encodeURIComponent(userId)}/sign-out`, { ...o, method: 'POST', body: { reason } });
export const opsResendInvitation = (id, invitationId, reason) => apiFetch(`${acct(id)}/invitations/${encodeURIComponent(invitationId)}/resend`, { ...o, method: 'POST', body: { reason } });
export const opsUnlockUser = (id, userId, reason) => apiFetch(`${acct(id)}/users/${encodeURIComponent(userId)}/unlock`, { ...o, method: 'POST', body: { reason } });
export const opsResetAuthenticator = (id, userId, reason) => apiFetch(`${acct(id)}/users/${encodeURIComponent(userId)}/reset-authenticator`, { ...o, method: 'POST', body: { reason } });
export const opsRetryEmails = (id, reason) => apiFetch(`${acct(id)}/emails/retry`, { ...o, method: 'POST', body: { reason } });
export const opsCustomerConnections = (id) => apiFetch(`${acct(id)}/connections`, o);
/* System health, the search box and the request-ID lookup (server: routes/opsHealth.ts). */
export const opsHealth = () => apiFetch('/ops/health', o);
export const opsSearch = (q) => apiFetch(`/ops/search?q=${encodeURIComponent(q)}`, o);
export const opsRequestLookup = (id) => apiFetch(`/ops/request-lookup?id=${encodeURIComponent(id)}`, o);
/* Home, the audit log and staff (server: routes/ops.ts). */
export const opsHome = () => apiFetch('/ops/home', o);
export const opsAuditFilters = () => apiFetch('/ops/audit/filters', o);
export const opsAuditExportUrl = (params) => `/ops/audit/export${q(params)}`;
export const opsAuditExport = (params) => apiFetch(opsAuditExportUrl(params), { ...o, asText: true });
export const opsRemoveOperator = (userId, reason) => apiFetch(`/ops/operators/${encodeURIComponent(userId)}`, { ...o, method: 'DELETE', body: { reason } });
export const opsWithdrawInvite = (id, reason) => apiFetch(`/ops/operators/invites/${encodeURIComponent(id)}`, { ...o, method: 'DELETE', body: { reason } });
/* Email (server: routes/opsEmail.ts). */
export const opsEmailSenders = () => apiFetch('/ops/email/senders', o);
export const opsSaveSender = (purpose, body) => apiFetch(`/ops/email/senders/${encodeURIComponent(purpose)}`, { ...o, method: 'PUT', body });
export const opsTestSender = (purpose, to) => apiFetch(`/ops/email/senders/${encodeURIComponent(purpose)}/test`, { ...o, method: 'POST', body: to ? { to } : {} });
export const opsEmailTemplates = () => apiFetch('/ops/email/templates', o);
export const opsSaveTemplate = (key, body) => apiFetch(`/ops/email/templates/${encodeURIComponent(key)}`, { ...o, method: 'PUT', body });
export const opsResetTemplate = (key, reason) => apiFetch(`/ops/email/templates/${encodeURIComponent(key)}`, { ...o, method: 'DELETE', body: { reason } });
export const opsPreviewTemplate = (key, body) => apiFetch(`/ops/email/templates/${encodeURIComponent(key)}/preview`, { ...o, method: 'POST', body });
export const opsTestTemplate = (key, to) => apiFetch(`/ops/email/templates/${encodeURIComponent(key)}/test`, { ...o, method: 'POST', body: to ? { to } : {} });
export const opsEmailLog = (params) => apiFetch(`/ops/email/log${q(params)}`, o);
export const opsResendEmail = (id, reason) => apiFetch(`/ops/email/log/${encodeURIComponent(id)}/resend`, { ...o, method: 'POST', body: { reason } });
/* The app catalogue (server: routes/opsCatalogue.ts). */
export const opsApps = () => apiFetch('/ops/apps', o);
export const opsSaveApp = (code, body) => apiFetch(`/ops/apps/${encodeURIComponent(code)}`, { ...o, method: 'PUT', body });
/* CLOR's invoices to customers, and Invoice settings with the CLOR Books connector (server: routes/opsInvoices.ts). */
export const opsInvoices = (params) => apiFetch(`/ops/invoices${q(params)}`, o);
export const opsInvoice = (id) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}`, o);
export const opsInvoiceStart = (accountId) => apiFetch(`/ops/invoices/start${q({ accountId })}`, o);
export const opsNewInvoice = (body) => apiFetch('/ops/invoices', { ...o, method: 'POST', body });
export const opsSaveInvoice = (id, body) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}`, { ...o, method: 'PATCH', body });
export const opsDiscardInvoice = (id) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}`, { ...o, method: 'DELETE' });
export const opsIssueInvoice = (id) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}/issue`, { ...o, method: 'POST', body: {} });
export const opsMarkInvoicePaid = (id, body) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}/mark-paid`, { ...o, method: 'POST', body });
export const opsVoidInvoice = (id, reason) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}/void`, { ...o, method: 'POST', body: { reason } });
export const opsSendInvoiceToBooks = (id) => apiFetch(`/ops/invoices/${encodeURIComponent(id)}/books`, { ...o, method: 'POST', body: {} });
export const opsInvoicing = () => apiFetch('/ops/invoicing', o);
export const opsSaveInvoicing = (body) => apiFetch('/ops/invoicing', { ...o, method: 'PUT', body });
export const opsBooksChoices = (search) => apiFetch(`/ops/invoicing/books/choices${q({ q: search })}`, o);
export const opsSaveBooksLink = (body) => apiFetch('/ops/invoicing/books', { ...o, method: 'PUT', body });
export const opsTestBooks = () => apiFetch('/ops/invoicing/books/test', { ...o, method: 'POST', body: {} });

/* Customer tickets (Ops plan P1; server: routes/opsTickets.ts). */
export const opsTickets = (params) => apiFetch(`/ops/tickets${q(params)}`, o);
export const opsTicket = (id) => apiFetch(`/ops/tickets/${encodeURIComponent(id)}`, o).then((r) => r?.ticket);
export const opsTicketReply = (id, body) => apiFetch(`/ops/tickets/${encodeURIComponent(id)}/reply`, { ...o, method: 'POST', body });
export const opsTicketChange = (id, body) => apiFetch(`/ops/tickets/${encodeURIComponent(id)}`, { ...o, method: 'PATCH', body }).then((r) => r?.ticket);

/* Alerts (Ops plan P1; server: routes/opsHealth.ts). */
export const opsAlerts = () => apiFetch('/ops/alerts', o);
export const opsAcknowledgeAlert = (id) => apiFetch(`/ops/alerts/${encodeURIComponent(id)}/acknowledge`, { ...o, method: 'POST', body: {} });
