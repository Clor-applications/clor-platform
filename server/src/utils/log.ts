import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Logs Google Cloud reads as records, not text.
 *
 * On Cloud Run a JSON line on stdout becomes a structured log entry: its
 * `severity` is the level, `httpRequest` shows as a request, and an error
 * whose `message` holds a stack trace with the ReportedErrorEvent type is
 * grouped in Error Reporting (free, with its own e-mail alerts). Every line
 * carries the request id, so one failing request can be followed end to end.
 * Outside production this stays out of the way: the dev console keeps morgan.
 */
const PROD = () => process.env.NODE_ENV === 'production' && !process.env.VITEST;
const SERVICE = { service: 'clor-api', version: process.env.K_REVISION || process.env.npm_package_version || 'dev' };
export const REQUEST_ID = /^[A-Za-z0-9._:-]{8,80}$/;

export function writeLog(severity: 'INFO' | 'WARNING' | 'ERROR', entry: Record<string, unknown>) {
  const line = JSON.stringify({ severity, time: new Date().toISOString(), ...entry });
  if (severity === 'ERROR') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** The request id: the caller's (when sane), else Cloud's trace id, else a new one. Echoed back as X-Request-Id. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const given = String(req.headers['x-request-id'] || '').trim();
  const trace = String(req.headers['x-cloud-trace-context'] || '').split('/')[0];
  const id = REQUEST_ID.test(given) ? given : REQUEST_ID.test(trace) ? trace : randomUUID();
  (req as any).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

const traceField = (req: Request) => {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  const trace = String(req.headers['x-cloud-trace-context'] || '').split('/')[0];
  return project && trace ? { 'logging.googleapis.com/trace': `projects/${project}/traces/${trace}` } : {};
};

/** One structured line per request in production, with the company it was for (never bodies or tokens). */
export function accessLog(safeUrl: (u: string) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!PROD()) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      writeLog(res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO', {
        message: `${req.method} ${safeUrl(req.originalUrl || req.url)} ${res.statusCode} ${ms.toFixed(0)}ms`,
        requestId: (req as any).id,
        orgId: (req as any).tenant?.orgId || req.headers['x-org-id'] || undefined,
        httpRequest: {
          requestMethod: req.method,
          requestUrl: safeUrl(req.originalUrl || req.url),
          status: res.statusCode,
          responseSize: String(res.getHeader('content-length') || ''),
          latency: `${(ms / 1000).toFixed(3)}s`,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
        },
        ...traceField(req),
      });
    });
    next();
  };
}

/** An error, the way Error Reporting groups it: the stack in `message`, the request beside it. */
export function reportError(err: unknown, req?: Request, safeUrl: (u: string) => string = (u) => u) {
  const e = err as any;
  const stack = e?.stack ? String(e.stack) : `Error: ${String(e?.message || e)}`;
  if (!PROD()) return;
  writeLog('ERROR', {
    '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
    message: stack,
    serviceContext: SERVICE,
    requestId: req ? (req as any).id : undefined,
    orgId: req ? (req as any).tenant?.orgId || req.headers['x-org-id'] || undefined : undefined,
    ...(req ? { context: { httpRequest: { method: req.method, url: safeUrl(req.originalUrl || req.url) } }, ...traceField(req) } : {}),
  });
}

/** Crashes and forgotten promise rejections, reported the same way instead of vanishing. */
export function reportProcessErrors() {
  process.on('unhandledRejection', (reason) => reportError(reason instanceof Error ? reason : new Error(`Unhandled rejection: ${String(reason)}`)));
  process.on('uncaughtException', (err) => {
    reportError(err);
    /* An uncaught exception leaves the process in an unknown state: let Cloud Run start a clean one. */
    setTimeout(() => process.exit(1), 200).unref();
  });
}
