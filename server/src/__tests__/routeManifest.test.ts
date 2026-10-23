import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The route manifest is a gate, not a report (A-49, GAP-008).
 *
 * `inventory-routes.mjs` reads app.ts and every route file and says, for each
 * route, who may call it and what stops the wrong person: the session, the
 * company, the permission, the subscription, maker-checker and the audit
 * trail. The old version guessed mounts with a regex that ran across lines —
 * the outside-systems API came out under /api/portal/punch — and saw only
 * literal `requirePermission(...)`, so a route was "HUMAN_TENANT" whether or
 * not anything checked what the person was allowed to do.
 *
 * The gate: a route that changes something (POST, PUT, PATCH, DELETE) with
 * neither a permission nor an entitlement check, and anything public or
 * token-based, must be on the allow-list with a reason. A new unguarded write
 * fails CI instead of shipping.
 */

const repo = resolve(__dirname, '..', '..', '..');
const script = join(repo, 'tenant-platform-upgrade-2026-10-23', 'scripts', 'inventory-routes.mjs');
const serverDir = join(repo, 'server');

type Route = {
  method: string;
  path: string;
  location: string;
  principal: string;
  auth: string;
  tenant: string;
  permission: string;
  entitlement: string;
  makerChecker: string;
  audit: string;
  reviewed: string;
};
type Manifest = { routes: Route[]; violations: Array<{ method: string; path: string; problem: string }>; knownGaps: Route[] };

const load = async () => (await import(pathToFileURL(script).href)) as { buildManifest: (o: { serverDir: string; allowlist?: string }) => Manifest };

let manifest: Manifest;
const find = (method: string, path: string) => {
  const r = manifest.routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`${method} ${path} is not in the manifest`);
  return r;
};

beforeAll(async () => {
  manifest = (await load()).buildManifest({ serverDir });
}, 120_000);

describe('route manifest (A-49)', () => {
  it('mounts each router where app.ts mounts it', () => {
    expect(find('POST', '/v1/employees').principal).toBe('machine-token');
    expect(manifest.routes.some((r) => r.path.startsWith('/api/portal/punch/') && r.location.includes('publicApi.ts'))).toBe(false);
    expect(find('GET', '/api/auth/sso/callback').principal).toBe('public');
    expect(find('POST', '/api/portal/login').principal).toBe('public');
    expect(find('GET', '/api/portal/me').principal).toBe('employee-token');
    /* Registered before the router's own authenticate(): public, by position. */
    expect(find('GET', '/v1/openapi.json').principal).toBe('public');
    expect(find('POST', '/api/billing/accounts/:accountId/subscription').principal).toBe('platform-operator');
    /* Mounted on the app itself, ahead of the JSON parser (A-16). */
    expect(find('POST', '/api/billing/webhook').location).toMatch(/server\/src\/app\.ts:\d+$/);
  });

  it('sees permission checks however a route spells them', () => {
    /* A const alias. */
    expect(find('POST', '/api/orgs/:orgId/items').permission).toBe('MASTERS::Items::CREATE');
    /* A local helper with the module bound inside it. */
    expect(find('DELETE', '/api/orgs/:orgId/attendance/records/:id').permission).toBe('ATTENDANCE::Attendance Records::DELETE');
    /* A registration helper called once per transition, the action passed in. */
    const approve = find('POST', '/api/orgs/:orgId/payroll/runs/:id/approve');
    expect(approve.permission).toBe('PAYROLL::Payroll Runs::APPROVE');
    expect(approve.entitlement).toContain('payrollRouteOk');
    expect(approve.makerChecker).toBe('yes');
    expect(approve.audit).not.toBe('none');
    /* A forEach over document kinds, the resource read from a config table. */
    expect(find('POST', '/api/orgs/:orgId/bills').permission).toBe('PURCHASE::Bills::CREATE');
    /* Accounting modules carry the subscription ceiling inside authorize(). */
    expect(find('POST', '/api/orgs/:orgId/bills').entitlement).toContain('rbac ceiling');
    /* Any one of several permissions (A-22). */
    expect(find('GET', '/api/orgs/:orgId/payment-modes').permission).toContain('SALES::Receipts::CREATE');
    /* A role check inside the handler and, for DELETE, inside the service it calls (A-21). */
    expect(find('POST', '/api/orgs/:orgId/closure').permission).toBe('role:company ADMIN (mayClose)');
    expect(find('POST', '/api/orgs/:orgId/closure').reviewed).toContain('step-up');
    expect(find('DELETE', '/api/orgs/:orgId/closure').permission).toBe('role:company ADMIN (mayClose)');
  });

  it('fails a write that nothing guards and the allow-list does not name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'route-manifest-'));
    try {
      mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
      mkdirSync(join(dir, 'src', 'middleware'), { recursive: true });
      writeFileSync(join(dir, 'src', 'middleware', 'auth.ts'), 'export async function requireAuth(_req: any, _res: any, next: any) { next(); }\n');
      writeFileSync(join(dir, 'src', 'middleware', 'tenantContext.ts'), 'export async function requireTenantContext(_req: any, _res: any, next: any) { next(); }\n');
      writeFileSync(join(dir, 'src', 'middleware', 'rbac.ts'), 'export function requirePermission(_m: string, _a: string, _s?: string) { return (_req: any, _res: any, next: any) => next(); }\n');
      writeFileSync(
        join(dir, 'src', 'routes', 'fixture.ts'),
        [
          "import { Router } from 'express';",
          "import { requireAuth } from '../middleware/auth.js';",
          "import { requireTenantContext } from '../middleware/tenantContext.js';",
          "import { requirePermission } from '../middleware/rbac.js';",
          'export const fixtureRouter = Router();',
          'fixtureRouter.use(requireAuth, requireTenantContext);',
          "const EDIT = requirePermission('SETTINGS', 'EDIT', 'Fixture');",
          "fixtureRouter.post('/orgs/:orgId/guarded', EDIT, async (_req, res) => { res.json({}); });",
          "fixtureRouter.post('/orgs/:orgId/unguarded', async (_req, res) => { res.json({}); });",
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'src', 'app.ts'),
        ["import express from 'express';", "import { fixtureRouter } from './routes/fixture.js';", 'export function createApp() {', '  const app = express();', "  app.use('/api', fixtureRouter);", '  return app;', '}', ''].join('\n'),
      );
      const empty = join(dir, 'allowlist.json');
      writeFileSync(empty, JSON.stringify({ routes: [] }));

      const fixture = (await load()).buildManifest({ serverDir: dir, allowlist: empty });
      expect(fixture.routes.find((r) => r.path === '/api/orgs/:orgId/guarded')?.permission).toBe('SETTINGS::Fixture::EDIT');
      expect(fixture.violations.map((v) => `${v.method} ${v.path}`)).toEqual(['POST /api/orgs/:orgId/unguarded']);

      /* Named on the allow-list as a known gap: passes, and is reported as one. */
      const listed = join(dir, 'listed.json');
      writeFileSync(listed, JSON.stringify({ routes: [{ method: 'POST', path: '/api/orgs/:orgId/unguarded', finding: 'A-99', reason: 'fixture' }] }));
      const ok = (await load()).buildManifest({ serverDir: dir, allowlist: listed });
      expect(ok.violations).toEqual([]);
      expect(ok.knownGaps.map((r) => r.path)).toEqual(['/api/orgs/:orgId/unguarded']);

      /* An allow-list entry for a route that no longer exists is itself a failure. */
      const stale = join(dir, 'stale.json');
      writeFileSync(stale, JSON.stringify({ routes: [{ method: 'POST', path: '/api/orgs/:orgId/unguarded', finding: 'A-99', reason: 'fixture' }, { method: 'GET', path: '/gone', reason: 'x' }] }));
      expect((await load()).buildManifest({ serverDir: dir, allowlist: stale }).violations.map((v) => v.problem)).toEqual([expect.stringMatching(/stale/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('passes on this branch: every write is guarded or allow-listed, and every public or token route has a reason', () => {
    expect(manifest.violations).toEqual([]);
    for (const r of manifest.routes.filter((x) => ['public', 'employee-token', 'machine-token'].includes(x.principal))) {
      expect(r.reviewed, `${r.method} ${r.path}`).not.toBe('');
    }
  });
});
