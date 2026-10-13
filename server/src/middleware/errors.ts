import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Default
  let status = Number(err?.status || 500);
  let message = String(err?.message || 'Server error');

  // Body parser / JSON parse errors
  if (err instanceof SyntaxError && String((err as any)?.type || '').includes('entity.parse.failed')) {
    status = 400;
    message = 'Invalid JSON body';
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    status = 400;
    const first = err.issues?.[0];
    message = first?.message ? `Validation error: ${first.message}` : 'Validation error';
  }

  // Prisma known errors (avoid importing Prisma types; check shape)
  const prismaCode = String(err?.code || '').trim();
  const prismaName = String(err?.name || '').trim();
  if (prismaName === 'PrismaClientKnownRequestError') {
    if (prismaCode === 'P2002') {
      status = 409;
      message = 'Already exists';
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

  // Unexpected 500s can carry internals (Prisma/driver text) in err.message —
  // never hand those to the client in production.
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    message = 'Server error';
  }

  res.status(status).json({ error: message });
}
