import { Router } from 'express';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ingestLimiter } from '../middleware/rateLimit.js';
import { mappingSchema, recordsOf, toAttlog } from '../services/attendance/punchMapping.js';
import { hashToken } from './publicApi.js';
import { ingestPunches } from './iclock.js';

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
  const device = await peoplePrisma.attendanceDevice.findUnique({ where: { pushTokenHash: hashToken(token) } });
  if (!device || device.vendor !== 'HTTP_PUSH') return res.status(404).json({ error: 'No such URL.' });
  if (!device.isActive) return res.status(403).json({ error: 'This reader is switched off in CLOR.' });

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
  const added = out.lines.length ? await ingestPunches(device, out.lines.join('\n')) : 0;
  await peoplePrisma.attendanceDevice.update({
    where: { id: device.id },
    data: { ...seen, lastError: out.errors.length && !out.lines.length ? out.errors[0] : null },
  });
  res.json({ received: records.length, accepted: out.lines.length, added, duplicates: out.lines.length - added, skipped: out.skipped, rejected: out.errors.length, errors: out.errors.slice(0, 10) });
});

ingestRouter.use((_req, res) => res.status(404).json({ error: 'POST punches to /ingest/<token>.' }));
