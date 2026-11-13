import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { GRANT_CLOSED, GRANT_NO_WRITE, supportGrantLimits } from '../middleware/supportGrantLimits.js';
import { DEFAULT_HOURS, MAX_HOURS, hoursFrom, isLive, scopeFrom, stateOf, SupportGrantError } from '../services/supportGrants.js';

/*
 * What CLOR staff may do inside a customer's company, once the customer has
 * let them in (docs/workspace/SUPPORT_GRANTS.md). These are the rules that
 * would be a breach if they were wrong, so they are tested without a database.
 */

const run = (method: string, path: string, grant?: { id: string; scope: 'READ_ONLY' | 'READ_WRITE' }) => {
  let passed = false;
  let status = 0;
  let body: any = null;
  const req = { method, path: '/', originalUrl: `${path}?x=1`, tenant: grant ? { supportGrant: grant } : {} } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  supportGrantLimits(req, res, () => {
    passed = true;
  });
  return { passed, status, code: body?.code as string | undefined };
};

const READ_ONLY = { id: 'g1', scope: 'READ_ONLY' as const };
const READ_WRITE = { id: 'g1', scope: 'READ_WRITE' as const };

describe('what a support grant allows', () => {
  it('lets a request through untouched when there is no grant', () => {
    expect(run('POST', '/api/orgs/o1/invoices').passed).toBe(true);
    expect(run('GET', '/api/orgs/o1/payroll/runs').passed).toBe(true);
  });

  it('refuses a change on a read-only grant, and says why', () => {
    const r = run('POST', '/api/orgs/o1/invoices', READ_ONLY);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.code).toBe('SUPPORT_GRANT_READ_ONLY');
  });

  it('allows a change only where the customer agreed to one', () => {
    expect(run('POST', '/api/orgs/o1/invoices', READ_WRITE).passed).toBe(true);
    expect(run('PATCH', '/api/orgs/o1/people/employees/e1', READ_WRITE).passed).toBe(true);
  });

  it('lets a read through on either scope', () => {
    expect(run('GET', '/api/orgs/o1/invoices', READ_ONLY).passed).toBe(true);
    expect(run('GET', '/api/orgs/o1/invoices', READ_WRITE).passed).toBe(true);
  });

  it('lets the session go on and end, whatever the scope', () => {
    expect(run('POST', '/api/auth/refresh', READ_ONLY).passed).toBe(true);
    expect(run('POST', '/api/auth/logout', READ_ONLY).passed).toBe(true);
  });

  /* The owner's answer on 14 Nov 2026: these stay shut even to a read. */
  it.each([
    ['/api/orgs/o1/payroll/runs', 'pay runs'],
    ['/api/orgs/o1/payroll/payslips/p1', 'payslips'],
    ['/api/orgs/o1/payroll/bank-changes', 'bank changes'],
    ['/api/orgs/o1/people/salary-revisions', 'salary revisions'],
    ['/api/orgs/o1/people/employees/e1/salary-question', 'what one person earns'],
    ['/api/orgs/o1/people/employees/e1/letters', 'letters, which carry pay'],
    ['/api/orgs/o1/people/employees/e1/documents', 'employee documents'],
    ['/api/orgs/o1/people/documents/d1', 'company documents'],
    ['/api/orgs/o1/people/request-forms/files/f1', 'form attachments'],
    ['/api/orgs/o1/people/talent/candidates/c1/resume', 'résumés'],
    ['/api/orgs/o1/people/employees/e1/statutory/reveal', 'PAN, Aadhaar and bank account'],
    ['/api/orgs/o1/people/private-cases/x', 'confidential complaints'],
    ['/api/orgs/o1/export', 'exporting the company'],
    ['/api/orgs/o1/people/employees/export', 'exporting people'],
    ['/api/orgs/o1/people/money/r1/export.csv', 'a CSV export'],
    ['/api/portal/me', 'the employee portal'],
  ])('never opens %s, even to read (%s)', (path) => {
    const r = run('GET', path, READ_WRITE);
    expect(r.passed).toBe(false);
    expect(r.code).toBe('SUPPORT_GRANT_CLOSED');
  });

  it('shuts those paths for the customer never — only for a grant', () => {
    expect(run('GET', '/api/orgs/o1/payroll/runs').passed).toBe(true);
    expect(run('GET', '/api/orgs/o1/people/employees/e1/salary-question').passed).toBe(true);
  });

  it('keeps the closed list as whole paths, so a new route under one is shut by default', () => {
    expect(GRANT_CLOSED.some((re) => re.test('/api/orgs/o1/payroll/anything/new'))).toBe(true);
    expect(GRANT_CLOSED.some((re) => re.test('/api/portal/newthing'))).toBe(true);
    expect(GRANT_CLOSED.some((re) => re.test('/api/orgs/o1/payrollish'))).toBe(false);
  });

  it('reads the whole URL, not the tail a router sees', () => {
    const r = run('GET', '/api/orgs/o1/payroll/runs', READ_WRITE);
    expect(r.code).toBe('SUPPORT_GRANT_CLOSED');
  });

  it('lets staff look at who has access, never change it, even on read and write', () => {
    expect(run('GET', '/api/orgs/o1/users', READ_WRITE).passed).toBe(true);
    for (const p of ['/api/orgs/o1/users/u1', '/api/orgs/o1/roles', '/api/orgs/o1/security/policy', '/api/orgs/o1/outside-access/a1/revoke', '/api/orgs/o1/support-grants/g1/approve', '/api/account/members/u1/role']) {
      const r = run('POST', p, READ_WRITE);
      expect(r.passed, p).toBe(false);
      expect(r.code, p).toBe('SUPPORT_GRANT_NO_ACCESS_CHANGES');
    }
    expect(GRANT_NO_WRITE.length).toBeGreaterThan(0);
  });

  it('does not shut ordinary work that only sounds alike', () => {
    expect(run('GET', '/api/orgs/o1/people/employees/e1', READ_ONLY).passed).toBe(true);
    expect(run('GET', '/api/orgs/o1/bank-book/b1', READ_ONLY).passed).toBe(true);
    expect(run('GET', '/api/orgs/o1/attendance/days', READ_ONLY).passed).toBe(true);
  });
});

describe('how long a grant lasts and what it carries', () => {
  it('lasts a day unless asked otherwise', () => {
    expect(hoursFrom(undefined)).toBe(DEFAULT_HOURS);
    expect(DEFAULT_HOURS).toBe(24);
  });

  it('refuses a grant longer than the ceiling, rather than quietly shortening it', () => {
    expect(() => hoursFrom(MAX_HOURS + 1)).toThrow(SupportGrantError);
    expect(hoursFrom(MAX_HOURS)).toBe(MAX_HOURS);
  });

  it('refuses nonsense hours', () => {
    expect(() => hoursFrom(0)).toThrow(SupportGrantError);
    expect(() => hoursFrom(-4)).toThrow(SupportGrantError);
    expect(() => hoursFrom('soon')).toThrow(SupportGrantError);
  });

  it('knows only two scopes', () => {
    expect(scopeFrom('read_write')).toBe('READ_WRITE');
    expect(scopeFrom(undefined)).toBe('READ_ONLY');
    expect(() => scopeFrom('ADMIN')).toThrow(SupportGrantError);
  });
});

describe('when a grant is live', () => {
  const at = (iso: string) => new Date(iso);
  const row = (over: Record<string, unknown> = {}) => ({ id: 'g1', status: 'ACTIVE', scope: 'READ_ONLY', startedAt: at('2026-11-14T00:00:00Z'), expiresAt: at('2026-11-15T00:00:00Z'), ...over }) as any;

  it('is live while approved and inside its hours', () => {
    expect(isLive(row(), at('2026-11-14T10:00:00Z'))).toBe(true);
  });

  it('is not live a moment past its end, and says so as EXPIRED rather than storing it', () => {
    const r = row();
    expect(isLive(r, at('2026-11-15T00:00:01Z'))).toBe(false);
    expect(stateOf(r, at('2026-11-15T00:00:01Z'))).toBe('EXPIRED');
    expect(r.status).toBe('ACTIVE');
  });

  it('is not live while it is only asked for', () => {
    expect(isLive(row({ status: 'PENDING', expiresAt: null }), at('2026-11-14T10:00:00Z'))).toBe(false);
  });

  it('is not live once ended or revoked', () => {
    expect(isLive(row({ status: 'ENDED' }), at('2026-11-14T10:00:00Z'))).toBe(false);
    expect(isLive(row({ status: 'REVOKED' }), at('2026-11-14T10:00:00Z'))).toBe(false);
  });

  it('is not live with no end at all, rather than for ever', () => {
    expect(isLive(row({ expiresAt: null }), at('2026-11-14T10:00:00Z'))).toBe(false);
  });

  it('is not live when there is no grant', () => {
    expect(isLive(null)).toBe(false);
  });
});
