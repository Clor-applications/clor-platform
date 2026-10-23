import { Router } from 'express';
import { anyAppLive, appLive, closing } from '../services/principalAllowed.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ingestLimiter } from '../middleware/rateLimit.js';
import { mappingSchema, recordsOf, toAttlog } from '../services/attendance/punchMapping.js';
import { hashToken } from './publicApi.js';
import { ingestPunches } from '../services/attendance/punches.js';
import { decryptSecret } from '../services/mailer.js';
import { enterTenant, outsideTenant } from '../utils/tenantScope.js';

/** How far a signed push's timestamp may be from now (seconds): older is a replay, refused. */
export const SIGNATURE_WINDOW_S = 300;

/**
 * A reader set to sign its pushes (a signing secret on the reader) must send
 *   X-Clor-Timestamp: <unix seconds>
 *   X-Clor-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<exact body>" with the secret>
 * so a captured request cannot be changed, and cannot be sent again after five
 * minutes (inside them, the same punches are dropped as repeats anyway).
 */
export function signatureProblem(secret: string, raw: Buffer, tsHeader: unknown, sigHeader: unknown, now = Date.now()): string | null {
  const ts = Number(String(tsHeader || ''));
  if (!Number.isFinite(ts) || ts <= 0) return 'Missing X-Clor-Timestamp.';
  if (Math.abs(now / 1000 - ts) > SIGNATURE_WINDOW_S) return 'X-Clor-Timestamp is more than five minutes from now; send the current time.';
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(sigHeader || '').trim());
  if (!m) return 'Missing X-Clor-Signature (sha256=<hex>).';
  const want = createHmac('sha256', secret).update(`${Math.trunc(ts)}.`).update(raw).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === want.length && timingSafeEqual(got, want) ? null : 'X-Clor-Signature does not match the body.';
}

/**
 * A reader's own push URL: POST /ingest/<token>. For readers, turnstiles,
 * middleware and vendor software that can post JSON (or a form) to a URL but
 * speak no protocol CLOR knows. The token names the reader and is the only
 * credential; the body can be any shape, read through the reader's field
 * mapping (services/attendance/punchMapping.ts). The last body is kept,
 * trimmed, so the mapping can be set up against what the device really sends.
 *
 * Mounted outside /api: no session, no org header, the token is everything.
 */
export const ingestRouter = Router();

ingestRouter.post('/:token', ...ingestLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^clorp_[A-Za-z0-9_-]{20,}$/.test(token)) return res.status(404).json({ error: 'No such URL.' });
  /* A-35: the token is how the company is found, so it is looked up across companies. */
  const device = await outsideTenant('push: which reader this token is', () => peoplePrisma.attendanceDevice.findUnique({ where: { pushTokenHash: hashToken(token) } }));
  if (!device || device.vendor !== 'HTTP_PUSH') return res.status(404).json({ error: 'No such URL.' });
  if (!device.isActive) return res.status(403).json({ error: 'This reader is switched off in CLOR.' });
  /* A-11: punches are taken only while Attendance is on, paid for, and the company is not closing. */
  const refused = await appLive(device.accountId, device.orgId, 'attendance');
  if (refused) return res.status(refused.status).json({ error: refused.error, code: refused.code });
  /* A-30: the rest of this request runs as the company the token named. */
  enterTenant(device.orgId);

  if (device.apiSecret) {
    let secret = '';
    try {
      secret = decryptSecret(device.apiSecret);
    } catch {
      secret = '';
    }
    const problem = secret ? signatureProblem(secret, (req as any).rawBody || Buffer.alloc(0), req.headers['x-clor-timestamp'], req.headers['x-clor-signature']) : 'This reader\'s signing secret could not be read; make a new one in CLOR.';
    if (problem) {
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastError: `Refused an unsigned or badly signed push: ${problem}`.slice(0, 300) } });
      return res.status(401).json({ error: problem });
    }
  }

  const body = req.body;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  const seen = { lastPayload: text.slice(0, 20_000), lastPayloadAt: new Date(), lastSeenAt: new Date() };

  let mapping;
  try {
    mapping = device.mappingJson ? mappingSchema.parse(JSON.parse(device.mappingJson)) : null;
  } catch {
    mapping = null;
  }
  if (!mapping) {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: seen });
    return res.status(202).json({ received: true, stored: 0, message: 'Received. Set the field mapping in CLOR (Attendance → Readers) and punches will be read from the next push.' });
  }
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { ...seen, lastError: 'Body was not JSON.' } });
      return res.status(400).json({ error: 'Send JSON.' });
    }
  }
  const records = recordsOf(parsed, mapping);
  const out = toAttlog(records, mapping, device.sourceTimezone);
  const added = out.lines.length || out.aside.length ? await ingestPunches(device, out.lines.join('\n'), { sources: out.sources, aside: out.aside }) : 0;
  await peoplePrisma.attendanceDevice.update({
    where: { id: device.id },
    data: { ...seen, lastError: out.errors.length && !out.lines.length ? out.errors[0] : null },
  });
  res.json({ received: records.length, accepted: out.lines.length, added, duplicates: out.lines.length - added, skipped: out.skipped, rejected: out.errors.length, errors: out.errors.slice(0, 10) });
});

ingestRouter.use((_req, res) => res.status(404).json({ error: 'POST punches to /ingest/<token>.' }));
