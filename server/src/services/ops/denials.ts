import type { NextFunction, Request, Response } from 'express';

import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { routeShape } from './apiErrors.js';

/**
 * Entitlement denials: a note of each time the platform refused a signed-in
 * person, for CLOR staff's Entitlement denials page and an account's Recent
 * access denials — "why can't I open this?" answered by one search.
 *
 * The refusals are made in many places (the app guards, rbac, the tenant
 * context, the features route), each answering 402 or 403 with a reason code.
 * Rather than touch each one, `noteDenials` watches the answer on its way
 * out: a 402, or a 403, becomes one row. A 403 without a code is named from
 * its shape (a missing permission is NO_ROLE_GRANT, a company the person is
 * not a member of NO_MEMBERSHIP), otherwise FORBIDDEN.
 *
 * Kept: who, which account and company, the code, the HTTP status, the app
 * and feature the refusal names, the route with its ids taken out, the
 * request id (the correlation id the customer is shown). Never the message
 * or the request: those can carry a customer's data.
 */

/* Prompts, not refusals: the person is asked for a code and carries on. */
const NOT_A_DENIAL = new Set(['STEP_UP_REQUIRED', 'APPROVE_REQUIRED']);

/* A storm of refusals must not become a storm of writes: at most this many notes a minute from one instance. */
const PER_MINUTE = 120;
let windowStart = 0;
let inWindow = 0;

const APP_BY_PATH: [RegExp, string][] = [
  [/^\/api\/(portal\/)?people\b/, 'people'],
  [/^\/api\/(portal\/)?payroll\b/, 'payroll'],
  [/^\/api\/(portal\/)?attendance\b/, 'attendance'],
  [/^\/api\/projects\b/, 'projects'],
];

export type DenialNote = {
  accountId: string | null;
  orgId: string | null;
  userId: string | null;
  code: string;
  status: number;
  app: string | null;
  feature: string | null;
  method: string;
  route: string;
  requestId: string | null;
};

const clip = (v: unknown, n: number) => (v == null || v === '' ? null : String(v).slice(0, n));

/** What a refusal says about itself, in the columns we keep. Null when it is not one to note. */
export function denialFrom(req: Request, status: number, body: any): DenialNote | null {
  if (status !== 402 && status !== 403) return null;
  if (!req.auth?.userId) return null;
  const given = typeof body?.code === 'string' ? body.code : '';
  if (NOT_A_DENIAL.has(given)) return null;
  const perm = body?.permission && typeof body.permission === 'object' ? body.permission : null;
  const code =
    given ||
    (perm || body?.error === 'No roles assigned' ? 'NO_ROLE_GRANT' : /^No access to (org|branch|warehouse)/.test(String(body?.error || '')) ? 'NO_MEMBERSHIP' : status === 402 ? 'PAYMENT_REQUIRED' : 'FORBIDDEN');
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const app = typeof body?.app === 'string' ? body.app : APP_BY_PATH.find(([re]) => re.test(path))?.[1] || null;
  const feature = typeof body?.feature === 'string' ? body.feature : perm ? [perm.module, perm.subModule, perm.action].filter(Boolean).join('.') : null;
  const tenant = (req as any).tenant as { accountId?: string; orgId?: string } | undefined;
  return {
    accountId: clip(tenant?.accountId || req.auth.accountId, 64),
    orgId: clip(tenant?.orgId || req.headers['x-org-id'], 64),
    userId: clip(req.auth.userId, 64),
    code: String(code).slice(0, 64),
    status,
    app: clip(app, 32),
    feature: clip(feature, 120),
    method: String(req.method || 'GET').slice(0, 10),
    route: routeShape(path),
    requestId: clip((req as any).id, 80),
  };
}

/** Fire and forget: the refused request is answered whether or not the note is written. */
export function noteDenial(note: DenialNote, now = Date.now()): void {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    inWindow = 0;
  }
  if (inWindow >= PER_MINUTE) return;
  inWindow += 1;
  void outsideTenant('ops: note an entitlement denial', () => platformPrisma.entitlementDenial.create({ data: note }))
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * Middleware: watches every answer that passes it and notes the refusals.
 * Mounted ahead of the routers that refuse (routes/ops.ts mounts it on the
 * operator router, which sits before every tenant router in app.ts).
 */
export function noteDenials(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body?: any) => {
    try {
      const note = denialFrom(req, res.statusCode, body);
      if (note) noteDenial(note);
    } catch {
      /* noting is best-effort; the answer goes out regardless */
    }
    return json(body);
  };
  next();
}

/** For tests: start the per-minute window afresh. */
export const resetDenialWindow = () => {
  windowStart = 0;
  inWindow = 0;
};

export const DENIALS_KEEP_DAYS = 30;

/** Drop notes older than the keep window. Called by the list on the way in, as the API errors are. */
export const pruneDenials = (now = Date.now()) =>
  platformPrisma.entitlementDenial.deleteMany({ where: { createdAt: { lt: new Date(now - DENIALS_KEEP_DAYS * 86_400_000) } } });
