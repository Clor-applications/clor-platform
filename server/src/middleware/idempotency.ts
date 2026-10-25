import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Writes that must not happen twice.
 *
 * A double-clicked "Save receipt", a request retried after a timeout, a
 * phone that resends on a flaky network: each made a second invoice, receipt
 * or payment. For the routes that create money records:
 *
 * - With an `Idempotency-Key` header, the first answer is kept for a day and
 *   the same key gets it back (`Idempotency-Replayed: true`); the same key
 *   with a different request is refused. If the first is still being saved,
 *   the repeat waits for it.
 * - The web app sends one key per submission and reuses it when the same form
 *   is sent again within seconds (packages/platform/http.js), which is what
 *   catches a double click or a retry. Without a key nothing changes: two
 *   identical receipts sent on purpose are two receipts.
 *
 * Only a success is kept: after any failure a retry runs for real.
 */
const GUARDED = /^\/api\/orgs\/[^/]+\/(people\/employees|people\/employees\/bulk|people\/employees\/import|invoices|payments|payments\/[^/]+\/reverse|ledger\/entries|bank-book|adjustments|transfers|fixed-assets|recurring\/run|pay-requests|payroll\/payments|payroll\/payments\/[^/]+\/(settle|post|cancel)|payroll\/runs|payroll\/settlements)\/?$/;
const KEY_WINDOW_MS = 24 * 3_600_000;
const WAIT_MS = 10_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isGuardedWrite = (method: string, path: string) => method === 'POST' && GUARDED.test(path);

export function webIdempotency(req: Request, res: Response, next: NextFunction) {
  const path = req.originalUrl.split('?')[0];
  if (!isGuardedWrite(req.method, path)) return next();
  const auth = String(req.headers.authorization || '');
  const given = String(req.get('idempotency-key') || '').trim();
  if (!auth || !given) return next();
  if (given.length > 128) return res.status(400).json({ error: 'Idempotency-Key is at most 128 characters.' });
  const scope = sha(auth).slice(0, 40);
  const bodyHash = sha(JSON.stringify(req.body ?? null));
  const key = `k:${given}`;
  const ttl = KEY_WINDOW_MS;

  (async () => {
    const now = new Date();
    if (Math.random() < 0.02) void platformPrisma.idempotentRequest.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => undefined);
    let row: { id: string } | null = null;
    for (let attempt = 0; attempt < 2 && !row; attempt += 1) {
      try {
        row = await platformPrisma.idempotentRequest.create({ data: { scope, key, method: req.method, path, bodyHash, expiresAt: new Date(now.getTime() + ttl) }, select: { id: true } });
      } catch (e: any) {
        if (String(e?.code) !== 'P2002') throw e;
        const seen = await platformPrisma.idempotentRequest.findUnique({ where: { scope_key: { scope, key } } });
        if (!seen) continue;
        if (seen.expiresAt < now) {
          await platformPrisma.idempotentRequest.deleteMany({ where: { id: seen.id, expiresAt: { lt: now } } });
          continue;
        }
        if (seen.path !== path || seen.bodyHash !== bodyHash) return res.status(422).json({ error: 'This Idempotency-Key was already used for a different request.' });
        /* The first is still being saved: wait for its answer rather than make a second record. */
        let done = seen;
        const until = Date.now() + WAIT_MS;
        while (done && done.status === 0 && Date.now() < until) {
          await sleep(200);
          done = (await platformPrisma.idempotentRequest.findUnique({ where: { scope_key: { scope, key } } })) || null as any;
        }
        if (!done) continue;
        if (done.status === 0) return res.status(409).json({ error: 'This is already being saved. Refresh in a moment to see it.', code: 'IN_PROGRESS' });
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(done.status).type('application/json').send(done.body ?? '{}');
      }
    }
    if (!row) return next();
    const id = row.id;
    const json = res.json.bind(res);
    let captured: string | null = null;
    (res as any).json = (body: unknown) => {
      try { captured = JSON.stringify(body ?? null); } catch { captured = null; }
      return json(body);
    };
    res.on('finish', () => {
      /* Only a success is kept. A refusal (401 before a token refresh, a step-up, a validation error) or a
         server error is forgotten, so the retry or the corrected request runs for real. */
      const write = res.statusCode >= 400
        ? platformPrisma.idempotentRequest.deleteMany({ where: { id } })
        : platformPrisma.idempotentRequest.update({ where: { id }, data: { status: res.statusCode, body: captured ? captured.slice(0, 1_000_000) : null } });
      void write.catch(() => undefined);
    });
    res.on('close', () => {
      if (!res.writableFinished) void platformPrisma.idempotentRequest.deleteMany({ where: { id, status: 0 } }).catch(() => undefined);
    });
    next();
  })().catch(next);
}
