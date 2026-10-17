import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * Idempotency for writes on the public API. A client that sends
 * `Idempotency-Key: <anything up to 128 chars>` and then repeats the call —
 * a retry after a timeout, a cron that ran twice — gets the first answer back
 * (status and body, with `Idempotency-Replayed: true`) instead of a second
 * employee or a second leave request. Keys are per API key and kept a day.
 */
export function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = String(req.get('idempotency-key') || '').trim();
  const client = req.apiClient;
  if (!key || !client) return next();
  if (key.length > 128) return res.status(400).json({ error: 'Idempotency-Key is at most 128 characters.' });
  const bodyHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
  (async () => {
    const seen = await peoplePrisma.apiIdempotency.findUnique({ where: { clientId_key: { clientId: client.id, key } } });
    if (seen) {
      if (seen.method !== req.method || seen.path !== req.path || seen.bodyHash !== bodyHash) return res.status(422).json({ error: 'This Idempotency-Key was already used for a different request.' });
      res.set('Idempotency-Replayed', 'true');
      return res.status(seen.status).type('application/json').send(seen.body);
    }
    const send = res.json.bind(res);
    res.json = ((body: unknown) => {
      const text = JSON.stringify(body);
      if (res.statusCode < 500) {
        peoplePrisma.apiIdempotency
          .create({ data: { accountId: client.accountId, orgId: client.orgId, clientId: client.id, key, method: req.method, path: req.path, bodyHash, status: res.statusCode, body: text.slice(0, 100_000) } })
          .catch(() => undefined);
      }
      return send(body);
    }) as typeof res.json;
    next();
  })().catch(next);
}

export async function pruneIdempotency(now = new Date()) {
  const r = await peoplePrisma.apiIdempotency.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return r.count;
}
