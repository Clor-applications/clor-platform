import { Router } from 'express';
import { anyAppLive, appLive, closing } from '../services/principalAllowed.js';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ingestLimiter } from '../middleware/rateLimit.js';
import { readTime, istLocal } from '../services/attendance/punchMapping.js';
import { VERIFY_WORDS } from '../services/attendance/pull/index.js';
import { hikvisionCounts } from '../services/attendance/pull/hikvision.js';
import { hashToken } from './publicApi.js';
import { ingestPunches } from '../services/attendance/punches.js';
import { enterTenant, outsideTenant } from '../utils/tenantScope.js';

/**
 * /hikvision/<token> — Hikvision face / card terminals pushing events (the
 * terminal's "HTTP listening" host). Each event is a multipart/form-data POST
 * with a part `event_log` holding JSON, and often a `Picture` (JPEG); some
 * firmware posts the JSON on its own. The JSON, as public receivers see it:
 *
 *   { "ipAddress", "macAddress", "channelID", "dateTime": "2026-10-18T09:05:12+05:30",
 *     "activePostCount": 1, "eventType": "AccessControllerEvent", "eventState": "active",
 *     "AccessControllerEvent": { "deviceName", "majorEventType": 5, "subEventType": 75,
 *                               "employeeNoString": "1001", "name", "cardNo", "doorNo", "serialNo",
 *                               "currentVerifyMode": "face", "attendanceStatus": "checkIn" } }
 *
 * Major 5 is an access event; sub-events 1 (card), 38 (fingerprint), 75
 * (face) are "passed" — those with an employee number are punches. A
 * "heartBeat" event type is the terminal saying hello. Everything is answered
 * 200: a terminal that gets anything else keeps resending.
 *
 * The URL token names the reader and is the only credential. The last body is
 * kept, trimmed, so what a particular firmware sends can be seen in CLOR.
 * From public integrations, not yet tried on a terminal here.
 */
export const hikvisionPushRouter = Router();

const DIRECTION: Record<string, '0' | '1'> = { checkin: '0', overtimein: '0', breakin: '0', checkout: '1', overtimeout: '1', breakout: '1' };

/** The text parts of a multipart body, by field name; binary parts (the picture) are skipped. */
export function textParts(body: Buffer, contentType: string): Record<string, string> {
  const out: Record<string, string> = {};
  const boundary = /boundary="?([^";,\s]+)"?/i.exec(contentType)?.[1];
  if (!boundary) return out;
  const sep = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(sep);
  while (pos !== -1) {
    const start = pos + sep.length;
    const next = body.indexOf(sep, start);
    const part = body.subarray(start, next === -1 ? body.length : next);
    pos = next;
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd === -1) continue;
    const head = part.subarray(0, headEnd).toString('latin1');
    const name = /name="([^"]+)"/i.exec(head)?.[1];
    if (!name) continue;
    const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim().toLowerCase() || 'text/plain';
    if (/^(image|video|audio|application\/octet-stream)/.test(type) || /filename="[^"]*\.(jpe?g|png|bmp)"/i.test(head)) continue;
    let content = part.subarray(headEnd + 4);
    if (content.subarray(-2).toString() === '\r\n') content = content.subarray(0, -2);
    out[name] = content.toString('utf8');
  }
  return out;
}

/** The event JSON from whatever the terminal posted. */
export function eventOf(body: unknown, contentType: string): any | null {
  if (Buffer.isBuffer(body)) {
    if (/multipart\//i.test(contentType)) {
      const parts = textParts(body, contentType);
      const raw = parts.event_log || parts.AccessControllerEvent || Object.values(parts).find((v) => v.trim().startsWith('{'));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : null;
}

/** A punch line from an access event, or why it is not one. */
export function punchOf(ev: any, zone: string, countMinors?: number[] | null): { line: string; at: Date } | { skip: string } {
  const ace = ev?.AccessControllerEvent || {};
  const code = String(ace.employeeNoString ?? ace.employeeNo ?? '').trim();
  /* The same rule as pulling (services/attendance/pull/hikvision.ts): a verified person, never a door relay or a refused attempt. */
  const verdict = hikvisionCounts(ace, countMinors);
  if (!verdict.ok) return { skip: verdict.reason };
  const sub = Number(ace.subEventType);
  const status = String(ace.attendanceStatus || '').toLowerCase();
  const when = readTime(ev.dateTime || ace.time, 'auto', zone);
  if (!when) return { skip: 'no time' };
  const at = new Date(Date.parse(ev.dateTime || ace.time));
  const dir = DIRECTION[status] ?? '255';
  const verify = VERIFY_WORDS[String(ace.currentVerifyMode || '').toLowerCase().replace(/[^a-z]/g, '')] ?? (sub === 75 ? 15 : sub === 38 ? 1 : sub === 1 ? 4 : 0);
  return { line: `${code}\t${when}\t${dir}\t${verify}`, at: Number.isNaN(at.getTime()) ? new Date() : at };
}

hikvisionPushRouter.post('/:token', ...ingestLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^clorp_[A-Za-z0-9_-]{20,}$/.test(token)) return res.status(404).json({ error: 'No such URL.' });
  /* A-35: the token is how the company is found, so it is looked up across companies. */
  const device = await outsideTenant('hikvision push: which terminal this token is', () => peoplePrisma.attendanceDevice.findUnique({ where: { pushTokenHash: hashToken(token) } }));
  if (!device || device.vendor !== 'HIKVISION_PUSH') return res.status(404).json({ error: 'No such URL.' });
  if (!device.isActive) return res.status(403).json({ error: 'This reader is switched off in CLOR.' });
  /* A-11: punches are taken only while Attendance is on, paid for, and the company is not closing. */
  const refused = await appLive(device.accountId, device.orgId, 'attendance');
  if (refused) return res.status(refused.status).json({ error: refused.error, code: refused.code });
  /* A-30: the rest of this request runs as the company the token named. */
  enterTenant(device.orgId);
  try {
    const ev = eventOf(req.body, String(req.headers['content-type'] || ''));
    const now = new Date();
    const seen: Record<string, unknown> = { lastSeenAt: now };
    if (ev) {
      seen.lastPayload = JSON.stringify(ev).slice(0, 20_000);
      seen.lastPayloadAt = now;
      const model = String(ev.AccessControllerEvent?.deviceName || '').trim();
      if (model && model !== device.model) seen.model = model.slice(0, 80);
      if (ev.ipAddress && !device.ip) seen.ip = String(ev.ipAddress).slice(0, 60);
      if (ev.macAddress && !device.mac) seen.mac = String(ev.macAddress).slice(0, 40);
    }
    const type = String(ev?.eventType || '').toLowerCase();
    if (!ev || type === 'heartbeat' || type === 'videoloss') {
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: seen });
      return res.status(200).json({ ok: true });
    }
    let countMinors: number[] | null = null;
    try {
      const cfg = JSON.parse(device.configJson || '{}');
      if (Array.isArray(cfg.countMinors)) countMinors = cfg.countMinors.map(Number).filter(Number.isFinite);
    } catch {
      /* no list: the default pass codes */
    }
    const p = punchOf(ev, device.sourceTimezone || 'Asia/Kolkata', countMinors);
    const original = JSON.stringify(ev).slice(0, 8_000);
    const eventId = ev.AccessControllerEvent?.serialNo != null ? String(ev.AccessControllerEvent.serialNo) : null;
    if ('line' in p) {
      const added = await ingestPunches(device, p.line, { sources: [original], ids: [eventId] });
      /* A single live post (activePostCount 1, not a replay) says how far the terminal's clock is out. */
      const live = Number(ev.activePostCount ?? 1) <= 1 && Math.abs(p.at.getTime() - now.getTime()) < 7 * 86_400_000;
      await peoplePrisma.attendanceDevice.update({
        where: { id: device.id },
        data: { ...seen, lastError: null, ...(live && added ? { clockOffsetSec: Math.round((p.at.getTime() - now.getTime()) / 1000), clockCheckedAt: now } : {}) },
      });
      return res.status(200).json({ ok: true, added });
    }
    /* Door, alarm and failed attempts: kept as set aside (ReaderEvent), and in the reader log. */
    await ingestPunches(device, '', { aside: [{ original, reason: p.skip, id: eventId }] });
    /* Door, alarm and failed attempts: the reader log. */
    const ace = ev.AccessControllerEvent || {};
    await peoplePrisma.deviceLog.create({
      data: {
        accountId: device.accountId,
        orgId: device.orgId,
        deviceId: device.id,
        kind: /fail|denied|invalid/i.test(String(ev.eventDescription || '')) ? 'ERROR' : 'OPERATION',
        code: `${ace.majorEventType ?? ev.eventType ?? 'EVENT'}-${ace.subEventType ?? ''}`.replace(/-$/, ''),
        operator: ace.employeeNoString ? String(ace.employeeNoString) : null,
        localTime: istLocal(Number.isNaN(Date.parse(ev.dateTime)) ? now : new Date(Date.parse(ev.dateTime))),
        details: [ev.eventDescription, ace.name ? `name ${ace.name}` : null, ace.cardNo ? `card ${ace.cardNo}` : null, ace.doorNo ? `door ${ace.doorNo}` : null, `(${p.skip})`].filter(Boolean).join(' · ').slice(0, 2000),
      },
    });
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: seen });
    res.status(200).json({ ok: true, added: 0 });
  } catch (e) {
    console.error('[hikvision] push:', e instanceof Error ? e.message : e);
    res.status(200).json({ ok: false });
  }
});

hikvisionPushRouter.use((_req, res) => res.status(404).json({ error: 'POST events to /hikvision/<token>.' }));
