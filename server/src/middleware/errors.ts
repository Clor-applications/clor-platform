import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { reportError } from '../utils/log.js';
import { safeUrl } from '../utils/safeUrl.js';
import { noteApiError } from '../services/ops/apiErrors.js';
import { issueWords } from './validate.js';

/* The fallbacks a person may see (UX copy audit, 20 Nov 2026): what happened and what to do, never a library's words. */
export const NO_SUCH_PAGE = 'No such page or record. It may have been removed, or the link is out of date.';
export const OUR_FAULT = 'Something went wrong on our side. Try again in a moment.';
export const ALREADY_THERE = 'Something with this name or number already exists. Change it and save again.';
export const UNREADABLE = 'The request could not be read. Reload the page and try again.';

/** The 500 sentence, with the reference support can look up. */
export const ourFault = (requestId?: string | null) => (requestId ? `${OUR_FAULT} If it keeps happening, give CLOR support this reference: ${requestId}.` : OUR_FAULT);

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: NO_SUCH_PAGE });
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Default
  let status = Number(err?.status || 500);
  let message = String(err?.message || OUR_FAULT);

  // Body parser / JSON parse errors
  if (err instanceof SyntaxError && String((err as any)?.type || '').includes('entity.parse.failed')) {
    status = 400;
    message = UNREADABLE;
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    status = 400;
    /* The schema's own words when it gave some; otherwise the answer named in words (middleware/validate.ts). */
    message = issueWords(err.issues?.[0]);
  }

  // Prisma known errors (avoid importing Prisma types; check shape)
  const prismaCode = String(err?.code || '').trim();
  const prismaName = String(err?.name || '').trim();
  if (prismaName === 'PrismaClientKnownRequestError') {
    if (prismaCode === 'P2002') {
      status = 409;
      message = ALREADY_THERE;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('API error:', err && err.stack ? err.stack : err);

    try {
      const logDir = path.join(process.cwd(), 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'api-errors.log');
      const line = [
        `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`,
        `status=${status}`,
        `message=${message}`,
        `stack=${err && err.stack ? String(err.stack).replace(/\s+/g, ' ') : String(err)}`,
      ].join(' | ');
      fs.appendFileSync(logFile, line + '\n', 'utf8');
    } catch {
      // ignore logging failures
    }
  }

  /* Production used to log nothing here at all: a 500 left no trace. Now each one goes to Error Reporting with its request id. */
  if (status >= 500) reportError(err, req, safeUrl);
  /* And a note for CLOR staff: enough of them together raise an alert (services/ops/apiErrors.ts). */
  if (status >= 500) noteApiError(err, req);

  // Unexpected 500s can carry internals (Prisma/driver text) in err.message —
  // never hand those to the client in production.
  /* `expose`: a plain sentence written for the person (a 503 "not changed", auditMutations.ts), never internals. */
  if (status >= 500 && process.env.NODE_ENV === 'production' && !err?.expose) {
    message = ourFault((req as any).id);
  }

  /* The id lets whoever saw the error quote it, and support find it in the logs. */
  res.status(status).json({ error: message, ...(err?.expose && err?.code ? { code: err.code } : {}), ...(status >= 500 && (req as any).id ? { requestId: (req as any).id } : {}) });
}
