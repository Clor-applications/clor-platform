import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

import { getJwtSecret } from '../services/auth.js';
import { EXPLORE_READ_ONLY_TEXT } from '../services/explore.js';
import { findSampleViewerId } from '../services/sampleCompany.js';

/**
 * An Explore session may look and may not change anything (roadmap item 6).
 *
 * Enforced here, on the server, for every route at once: mounted in app.ts
 * after CORS (so the browser can read the refusal) and before every body
 * parser and router. Hiding buttons is the app's courtesy; this is the rule.
 *
 * Who is exploring: an access token whose `xp` claim names an Explore pass
 * (services/explore.ts), or any token for the sample company's viewer login,
 * whatever its claims say — a second check that does not depend on how the
 * token was made.
 *
 * What they may do: read (GET, HEAD, OPTIONS), and the two writes a session
 * needs to go on and to end — refresh and sign out. Everything else is
 * refused with 403 EXPLORE_READ_ONLY and the one sentence the app shows.
 *
 * What they may not even read: the operator console and operator billing, the
 * employee portal, the company-wide data export and the person's own data
 * export, the list of signed-in devices, and the machine doors (outside API,
 * connectors, readers, SCIM, pay pages).
 */

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes an Explore session needs: a new access token, and signing out. */
export const EXPLORE_ALLOWED_WRITES: Array<[string, RegExp]> = [
  ['POST', /^\/api\/auth\/refresh\/?$/],
  ['POST', /^\/api\/auth\/logout\/?$/],
];

/** Closed to an Explore session for every method, reads included. */
export const EXPLORE_CLOSED: RegExp[] = [
  /^\/api\/ops(\/|$)/,
  /^\/api\/billing\/accounts(\/|$)/,
  /^\/api\/portal(\/|$)/,
  /^\/api\/auth\/me\/export\/?$/,
  /^\/api\/auth\/sessions(\/|$)/,
  /^\/api\/orgs\/[^/]+\/export(\/|$)/,
  /^\/(v1|agent|scim|iclock|ingest|matrix|hikvision|pay)(\/|$)/,
];

const refuse = (res: Response) => res.status(403).json({ error: EXPLORE_READ_ONLY_TEXT, code: 'EXPLORE_READ_ONLY' });

/** The token's claims if it is one this server signed; null otherwise (requireAuth answers those). */
function claimsOf(req: Request): { userId?: string; xp?: string } | null {
  const header = String(req.headers.authorization || '').trim();
  if (!header.startsWith('Bearer ')) return null;
  const secret = getJwtSecret();
  if (!secret) return null;
  try {
    return jwt.verify(header.slice(7).trim(), secret, {
      issuer: process.env.JWT_ISSUER || 'accounting',
      audience: process.env.JWT_AUDIENCE || 'accounting-web',
      algorithms: ['HS256'],
    }) as any;
  } catch {
    return null;
  }
}

/* The viewer's id, looked up at most once a minute while it does not exist yet. */
let viewerCheckedAt = 0;
let viewerId: string | null = null;
async function viewer(): Promise<string | null> {
  if (viewerId) return viewerId;
  if (Date.now() - viewerCheckedAt < 60_000) return null;
  viewerCheckedAt = Date.now();
  viewerId = await findSampleViewerId().catch(() => null);
  return viewerId;
}

export async function exploreReadOnly(req: Request, res: Response, next: NextFunction) {
  const claims = claimsOf(req);
  if (!claims) return next();
  const path = req.path;
  const method = req.method.toUpperCase();
  let exploring = Boolean(String(claims.xp || '').trim());
  /* Reads by anybody else pass without a lookup; only a write, or a closed path, asks whether this is the viewer. */
  if (!exploring && claims.userId && (!READS.has(method) || EXPLORE_CLOSED.some((r) => r.test(path)))) {
    exploring = String(claims.userId) === (await viewer());
  }
  if (!exploring) return next();
  if (EXPLORE_CLOSED.some((r) => r.test(path))) return refuse(res);
  if (READS.has(method)) return next();
  if (EXPLORE_ALLOWED_WRITES.some(([m, r]) => m === method && r.test(path))) return next();
  return refuse(res);
}
