import 'express-async-errors';
import cookieParser from 'cookie-parser';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authRouter } from './routes/auth.js';
import { ssoRouter } from './routes/sso.js';
import { branchesRouter } from './routes/branches.js';
import { rolesRouter } from './routes/roles.js';
import { usersRouter } from './routes/users.js';
import { transfersRouter } from './routes/transfers.js';
import { warehousesRouter } from './routes/warehouses.js';
import { inventoryAdjustmentsRouter } from './routes/inventoryAdjustments.js';
import { invoicesRouter } from './routes/invoices.js';
import { ledgerRouter } from './routes/ledger.js';
import { permissionsRouter } from './routes/permissions.js';
import { governanceRouter } from './routes/governance.js';
import { featuresRouter } from './routes/features.js';
import { partiesRouter } from './routes/parties.js';
import { emailRouter } from './routes/email.js';
import { securityRouter } from './routes/security.js';
import { itemsRouter } from './routes/items.js';
import { purchaseDocsRouter } from './routes/purchaseDocs.js';
import { quoteDocsRouter } from './routes/quoteDocs.js';
import { orgMastersRouter } from './routes/orgMasters.js';
import { auditRouter } from './routes/audit.js';
import { posTenderAccountsRouter } from './routes/posTenderAccounts.js';
import { payrollComponentsRouter } from './routes/payrollComponents.js';
import { payrollPayGroupsRouter } from './routes/payrollPayGroups.js';
import { payrollPeriodsRouter } from './routes/payrollPeriods.js';
import { payrollStructuresRouter } from './routes/payrollStructures.js';
import { payrollEmployeesRouter } from './routes/payrollEmployees.js';
import { payrollSettlementsRouter } from './routes/payrollSettlements.js';
import { payrollTaxDeclarationsRouter } from './routes/payrollTaxDeclarations.js';
import { peopleRouter } from './routes/people.js';
import { peopleApprovalsRouter } from './routes/peopleApprovals.js';
import { peopleTaskLinksRouter } from './routes/peopleTaskLinks.js';
import { peopleJoinRouter } from './routes/peopleJoin.js';
import { peopleInvitesRouter } from './routes/peopleInvites.js';
import { registerPeopleEffects } from './services/people/approvals/effects.js';
import { peopleWorkspaceRouter } from './routes/peopleWorkspace.js';
import { attendanceRouter } from './routes/attendance.js';
import { attendanceInsightsRouter } from './routes/attendanceInsights.js';
import { dataProtectionRouter } from './routes/dataProtection.js';
import { leaveRouter } from './routes/leave.js';
import { iclockRouter } from './routes/iclock.js';
import { devicesRouter } from './routes/devices.js';
import { attendanceReportsRouter } from './routes/attendanceReports.js';
import { integrationsRouter } from './routes/integrations.js';
import { publicApiRouter } from './routes/publicApi.js';
import { ingestRouter } from './routes/ingest.js';
import { matrixRouter } from './routes/matrix.js';
import { hikvisionPushRouter } from './routes/hikvisionPush.js';
import { scimRouter } from './routes/scim.js';
import { agentRouter } from './routes/agent.js';
import { notificationsRouter } from './routes/notifications.js';
import { payPageRouter, payRequestsRouter } from './routes/payRequests.js';
import { agentLimiter, apiLimiter, billingWebhookLimiter, hikvisionLimiter, scimLimiter } from './middleware/rateLimit.js';
import { personnelRouter } from './routes/personnel.js';
import { schedulingRouter } from './routes/scheduling.js';
import { portalRouter } from './routes/portal.js';
import { portalAdminRouter } from './routes/portalAdmin.js';
import { readerOpsRouter } from './routes/readerOps.js';
import { payrollAssignmentsRouter } from './routes/payrollAssignments.js';
import { payrollRunsRouter } from './routes/payrollRuns.js';
import { payrollPostingRouter } from './routes/payrollPosting.js';
import { payrollSlipsRouter } from './routes/payrollSlips.js';
import { payrollStatutoryRouter } from './routes/payrollStatutory.js';
import { payrollPaymentsRouter } from './routes/payrollPayments.js';
import { payrollAdjustmentsRouter } from './routes/payrollAdjustments.js';
import { payrollLoansRouter } from './routes/payrollLoans.js';
import { payrollRevisionsRouter } from './routes/payrollRevisions.js';
import { payrollOverviewRouter } from './routes/payrollOverview.js';
import { payrollReportsRouter } from './routes/payrollReports.js';
import { payrollSetupRouter } from './routes/payrollSetup.js';
import { posCheckoutRouter } from './routes/posCheckout.js';
import { accountRouter } from './routes/account.js';
import { shareAdminRouter, sharePublicRouter } from './routes/share.js';
import { bankBookRouter } from './routes/bankBook.js';
import { posDayCloseRouter } from './routes/posDayClose.js';
import { recurringRouter } from './routes/recurring.js';
import { dataExportRouter } from './routes/dataExport.js';
import { companyClosureRouter } from './routes/companyClosure.js';
import { recycleBinRouter } from './routes/recycleBin.js';
import { companyProfileRouter } from './routes/companyProfile.js';
import { einvoiceRouter } from './routes/einvoice.js';
import { revaluationRouter } from './routes/revaluation.js';
import { currenciesRouter } from './routes/currencies.js';
import { importsRouter } from './routes/imports.js';
import { batchSerialRouter } from './routes/batchSerial.js';
import { paymentsRouter } from './routes/payments.js';
import { gstinRouter } from './routes/gstin.js';
import { stockDocumentsRouter } from './routes/stockDocuments.js';
import { stockLedgerRouter } from './routes/stockLedger.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { billingRouter, billingOperatorRouter, billingWebhook } from './routes/billing.js';
import { edgeGuard } from './middleware/edgeGuard.js';
import { auditMutations } from './middleware/auditMutations.js';
import { clearAccessCacheOnWrite } from './utils/accessCache.js';
import { safeUrl } from './utils/safeUrl.js';
import { accessLog, requestId } from './utils/log.js';
import { webIdempotency } from './middleware/idempotency.js';
import { beginRequestScope } from './utils/tenantScope.js';

export function buildApp() {
  /* What an approved People request does (services/people/approvals/effects.ts); idempotent. */
  registerPeopleEffects();
  const app = express();
  /* First: every request runs in a strict tenant scope until it names its company (A-35, utils/tenantScope.ts). */
  app.use(beginRequestScope);
  /* Every request has an id from the start, so every log line and error about it can be found together. */
  app.use(requestId);

  /*
   * Server-Timing: how long the API spent on each request, visible per call in
   * the browser's network panel. Set just before the headers go out, so it
   * covers the whole handler. Timing-Allow-Origin lets app.clor.in read it.
   */
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const writeHead = res.writeHead;
    (res as any).writeHead = function (this: typeof res, ...args: any[]) {
      if (!res.headersSent) {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        res.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
        const origin = req.headers.origin;
        if (origin) res.setHeader('Timing-Allow-Origin', origin);
      }
      return (writeHead as any).apply(this, args);
    };
    next();
  });

  /*
   * Which proxies may tell us the client's address. Only private ones by
   * default — Caddy on the host, nginx on the Docker network — so a request
   * that reaches the API directly cannot name its own IP in X-Forwarded-For.
   * TRUST_PROXY overrides it (e.g. a hop count behind a load balancer).
   */
  const trustProxy = String(process.env.TRUST_PROXY || '').trim();
  /*
   * Behind the Cloudflare Worker (EDGE_SECRET set, so a request that skipped
   * the Worker is refused): two hops, Google's front end and then the Worker,
   * which overwrites X-Forwarded-For with Cloudflare's verified client IP. With
   * the private-only default here, req.ip was the Worker's Cloudflare address
   * for everyone, and every customer shared one sign-in rate-limit bucket.
   */
  const behindEdge = Boolean(String(process.env.EDGE_SECRET || '').trim());
  app.set(
    'trust proxy',
    trustProxy
      ? /^\d+$/.test(trustProxy)
        ? Number(trustProxy)
        : trustProxy
      : behindEdge
        ? 2
        : 'loopback, linklocal, uniquelocal'
  );

  app.use(helmet());
  // Refuse requests that bypassed the api.clor.in Worker (no-op unless EDGE_SECRET is set).
  app.use(edgeGuard);
  // Role, membership and permission lookups are cached briefly; any write drops the cache.
  app.use(clearAccessCacheOnWrite);
  // The refresh token travels as an HttpOnly cookie; this reads it back.
  app.use(cookieParser());

  /*
   * CORS, with credentials.
   *
   * The refresh token is an HttpOnly cookie now, so the browser has to be
   * allowed to send it — which means `credentials: true`, and that in turn
   * means the origin must be a specific value and never `*`. The allow-list
   * below already is one; the note that used to sit here said we did not use
   * cookies at all.
   */
  const allowList = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultDevAllow = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
  /*
   * The Android and iOS shells (mobile/<app>, Capacitor) serve the web build
   * from their own origin — `https://localhost` on Android, `capacitor://localhost`
   * on iOS — so every request from the installed app carries one of these.
   * They are the same code as the web app, talking to the same API with the
   * same logins, and are allowed whatever CORS_ORIGIN says.
   */
  const nativeShellAllow = new Set(['https://localhost', 'capacitor://localhost']);

  app.use(
    cors({
      origin(origin, cb) {
        // Allow server-to-server tools with no Origin.
        if (!origin) return cb(null, true);
        if (nativeShellAllow.has(origin)) return cb(null, true);
        if (allowList.length > 0) return cb(null, allowList.includes(origin));
        return cb(null, defaultDevAllow.has(origin));
      },
      credentials: true,
      /* Browsers may reuse a preflight for 2 h (Chrome caps it there) instead of asking before every call. */
      maxAge: 7200,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id', 'x-branch-id', 'x-warehouse-id', 'x-step-up', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'Idempotency-Replayed'],
    })
  );
  /*
   * Biometric readers (ZKTeco / eSSL push). Plain-text bodies, no login: a
   * reader is known by its serial number, which a company claims under
   * Attendance → Readers. Mounted before the JSON parser and outside /api, so
   * none of the user-session middleware applies. Bodies are capped: a real
   * batch of punches is a few hundred KB (ClorTime caps at 8 MB).
   */
  app.use('/iclock', express.text({ type: () => true, limit: '8mb' }), iclockRouter);
  /* Any shape of body: JSON when it says so, a form, or plain text we try as JSON. */
  /* The exact bytes are kept beside the parsed body, so a signed push can be checked (routes/ingest.ts). */
  const keepRaw = (req: any, _res: any, buf: Buffer) => {
    req.rawBody = buf;
  };
  app.use('/ingest', express.json({ limit: '4mb', type: ['application/json', 'application/*+json'], verify: keepRaw }), express.urlencoded({ extended: true, limit: '4mb', verify: keepRaw }), express.text({ type: () => true, limit: '4mb', verify: keepRaw }), ingestRouter);
  /* Matrix COSEC controllers: GET requests with everything in the query string, no body (routes/matrix.ts). */
  app.use('/matrix', matrixRouter);
  /* Hikvision terminals post multipart (JSON + a picture): the raw body is parsed in the route. */
  app.use(
    '/hikvision',
    /* Nothing is buffered for a request that cannot be a terminal's: the token's shape and the limiter come first. */
    (req, res, next) => (/^\/clorp_[A-Za-z0-9_-]{20,}\/?$/.test(req.path) ? next() : res.status(404).json({ error: 'No such URL.' })),
    ...hikvisionLimiter,
    express.raw({ type: () => true, limit: '2mb' }),
    hikvisionPushRouter,
  );
  /* SCIM provisioning from an identity provider: its own bearer token, JSON as application/scim+json. */
  app.use('/scim/v2', ...scimLimiter, express.json({ limit: '1mb', type: ['application/json', 'application/scim+json'] }), scimRouter);
  /* UPI Direct pay pages: public, the token is the credential; the claim is a plain HTML form post. */
  app.use('/pay', express.urlencoded({ extended: false, limit: '8kb' }), payPageRouter);
  /* The on-site connector: its own token, JSON. */
  app.use('/agent/v1', ...agentLimiter, express.json({ limit: '4mb' }), agentRouter);
  /* A phone punch may carry a selfie (≤ 2 MB, base64): its own, larger limit. */
  app.use('/api/portal/punch', express.json({ limit: '3mb' }));
  /* A document on an employee file (≤ 5 MB, base64). */
  app.use('/api/orgs/:orgId/people/employees/:id/documents', express.json({ limit: '7mb' }));
  /* The payment gateway's webhook: public, its exact path, the raw body a signature is made over — ahead of the JSON parser and of every router that demands a session (A-16). */
  app.post('/api/billing/webhook', ...billingWebhookLimiter, express.raw({ type: () => true, limit: '1mb' }), billingWebhook);
  app.use(express.json({ limit: '1mb' }));
  /* Invoices, receipts, payments and payroll writes are never made twice by a double click or a retry. */
  app.use(webIdempotency);
  // The API for outside systems: an API key, no user session (routes/publicApi.ts).
  app.use('/v1', publicApiRouter);
  // `tiny`, with share tokens, GSTINs and search terms taken out of the URL.
  morgan.token('safe-url', (req: any) => safeUrl(req.originalUrl || req.url));
  /* Production: one JSON line per request with its id (Cloud Logging); elsewhere the familiar text line. */
  app.use(accessLog(safeUrl));
  if (process.env.NODE_ENV !== 'production') app.use(morgan(':method :safe-url :status :res[content-length] - :response-time ms'));

  // Test-only anomaly capture. The suite's residual flake shows up as
  // unexplained 401/403/404s that morgan records without context; this logs
  // every non-2xx JSON response with the request's tenancy headers so a
  // failing run can be diagnosed from the log instead of guessed at.
  // Gated to vitest: zero cost in dev and production.
  if (process.env.VITEST) {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    app.use((req, res, next) => {
      const orig = res.json.bind(res);
      (res as any).json = (body: unknown) => {
        if (res.statusCode >= 400) {
          try {
            const logDir = path.join(process.cwd(), 'logs');
            fs.mkdirSync(logDir, { recursive: true });
            fs.appendFileSync(
              path.join(logDir, 'test-anomalies.log'),
              JSON.stringify({
                ts: new Date().toISOString(),
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                body,
                hasAuth: Boolean(req.headers.authorization),
                org: req.headers['x-org-id'] || null,
                branch: req.headers['x-branch-id'] || null,
              }) + '\n',
              'utf8'
            );
          } catch {
            /* capture is best-effort */
          }
        }
        return orig(body as any);
      };
      next();
    });
  }

  /* Liveness: the process answers. Cheap on purpose; it is asked every few seconds. */
  app.get('/health', (_req, res) => res.json({ ok: true }));
  /*
   * Readiness: the process can do its job — each of the four databases
   * answers within two seconds. The startup probe waits on this, so a revision
   * that cannot reach its data never takes traffic. Says which store failed,
   * never how (no connection strings or errors leave the server).
   */
  app.get('/ready', async (_req, res) => {
    const { prisma } = await import('./utils/prisma.js');
    const { payrollPrisma } = await import('./utils/payrollPrisma.js');
    const { peoplePrisma } = await import('./utils/peoplePrisma.js');
    const { platformPrisma } = await import('./utils/platformPrisma.js');
    const within = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]).catch(() => false);
    const [accounting, payroll, people, platform] = await Promise.all([
      within(prisma.$queryRaw`SELECT 1`),
      within(payrollPrisma.$queryRaw`SELECT 1`),
      within(peoplePrisma.$queryRaw`SELECT 1`),
      within(platformPrisma.$queryRaw`SELECT 1`),
    ]);
    const checks = { accounting, payroll, people, platform };
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ ok, checks });
  });

  /* Single sign-on lands here from the identity provider; mounted before the password routes. */
  /* A ceiling on every API call, per session and per address (FX-05). */
  app.use('/api', ...apiLimiter);
  app.use('/api/auth/sso', ssoRouter);
  app.use('/api/auth', authRouter);

  /* No auth and no tenant headers: the customer has no account here. Mounted
     with authRouter for the same reason gstinRouter is — a router at '/api'
     runs its middleware for every '/api' request that reaches it. */
  /* Payroll and Attendance changes go in the audit log (middleware/auditMutations.ts). */
  app.use(auditMutations);
  app.use('/api', sharePublicRouter);
  /* The done link in a task e-mail: signed, no session; before the routers that demand one. */
  app.use('/api', peopleTaskLinksRouter);
  app.use('/api', peopleJoinRouter);

  /* The employee portal: its own sign-in (company + employee code), no CLOR
     user and no tenant headers — so, like the two above, before the routers
     that require both. */
  app.use('/api/portal', portalRouter);

  /* CLOR operators setting a customer's subscription: a CLOR user with no
     membership in that account, so no tenant headers either. */
  app.use('/api', billingOperatorRouter);

  /*
   * Mounted before every tenant-scoped router, and that position is the point.
   *
   * Those routers call `router.use(requireAuth, requireTenantContext)`, and a
   * router mounted at '/api' runs its own middleware for EVERY '/api' request
   * that passes through it — not only the paths it defines. So with this router
   * further down, a GSTIN lookup was answered "Missing x-org-id" by a router
   * that has nothing to do with GSTINs.
   *
   * That mattered most where the lookup is most useful: at signup, deciding a
   * company's state, there is no org yet and never will be until the company is
   * created. The button could not have worked there at all.
   */
  app.use('/api', gstinRouter);
  app.use('/api', branchesRouter);
  app.use('/api', warehousesRouter);
  app.use('/api', stockDocumentsRouter);
  app.use('/api', stockLedgerRouter);
  app.use('/api', rolesRouter);
  app.use('/api', usersRouter);
  app.use('/api', transfersRouter);
  app.use('/api', orgMastersRouter);
  app.use('/api', auditRouter);
  app.use('/api', posTenderAccountsRouter);
  app.use('/api', payrollComponentsRouter);
  app.use('/api', payrollPayGroupsRouter);
  app.use('/api', payrollPeriodsRouter);
  app.use('/api', payrollStructuresRouter);
  app.use('/api', payrollEmployeesRouter);
  app.use('/api', payrollSettlementsRouter);
  app.use('/api', payrollTaxDeclarationsRouter);
  app.use('/api', peopleRouter);
  app.use('/api', peopleApprovalsRouter);
  app.use('/api', peopleInvitesRouter);
  app.use('/api', peopleWorkspaceRouter);
  app.use('/api', personnelRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', attendanceInsightsRouter);
  app.use('/api', dataProtectionRouter);
  app.use('/api', schedulingRouter);
  app.use('/api', portalAdminRouter);
  app.use('/api', readerOpsRouter);
  app.use('/api', leaveRouter);
  app.use('/api', devicesRouter);
  app.use('/api', attendanceReportsRouter);
  app.use('/api', integrationsRouter);
  app.use('/api', payrollAssignmentsRouter);
  app.use('/api', payrollRunsRouter);
  app.use('/api', payrollPostingRouter);
  app.use('/api', payrollSlipsRouter);
  app.use('/api', payrollStatutoryRouter);
  app.use('/api', payrollPaymentsRouter);
  app.use('/api', payrollAdjustmentsRouter);
  app.use('/api', payrollLoansRouter);
  app.use('/api', payrollRevisionsRouter);
  app.use('/api', payrollOverviewRouter);
  app.use('/api', payrollReportsRouter);
  app.use('/api', payrollSetupRouter);
  app.use('/api', posCheckoutRouter);
  app.use('/api', accountRouter);
  app.use('/api', billingRouter);
  app.use('/api', shareAdminRouter);
  app.use('/api', bankBookRouter);
  app.use('/api', posDayCloseRouter);
  app.use('/api', recurringRouter);
  app.use('/api', dataExportRouter);
  app.use('/api', companyClosureRouter);
  app.use('/api', recycleBinRouter);
  app.use('/api', companyProfileRouter);
  app.use('/api', inventoryAdjustmentsRouter);
  app.use('/api', invoicesRouter);
  app.use('/api', ledgerRouter);
  app.use('/api', permissionsRouter);
  app.use('/api', governanceRouter);
  app.use('/api', featuresRouter);
  app.use('/api', partiesRouter);
  app.use('/api', emailRouter);
  app.use('/api', securityRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', payRequestsRouter);
  app.use('/api', itemsRouter);
  app.use('/api', paymentsRouter);
  app.use('/api', batchSerialRouter);
  app.use('/api', importsRouter);
  app.use('/api', currenciesRouter);
  app.use('/api', revaluationRouter);
  app.use('/api', purchaseDocsRouter);
  app.use('/api', quoteDocsRouter);
  app.use('/api', einvoiceRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
