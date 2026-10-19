import { authedRequest } from '../digest.js';
import { readTime } from '../punchMapping.js';
import { VERIFY_WORDS, localIn, offsetIn, originalOf, type PullContext, type PullResult } from './common.js';

/**
 * Hikvision access-control terminals (ISAPI), as the vendor's integration
 * guide describes and never tested here on a real terminal:
 *
 *   POST {base}/ISAPI/AccessControl/AcsEvent?format=json          Digest auth
 *   { "AcsEventCond": { "searchID": "...", "searchResultPosition": 0, "maxResults": 100,
 *                       "major": 5, "minor": 0, "startTime": "2026-10-17T00:00:00+05:30", "endTime": "..." } }
 *   → { "AcsEvent": { "searchID", "responseStatusStrg": "OK" | "MORE" | "NO MATCH",
 *                     "numOfMatches", "InfoList": [{ "employeeNoString", "name", "time": "2026-10-17T09:05:12+05:30",
 *                                                  "attendanceStatus": "checkIn", "currentVerifyMode": "face", "minor": 75 }] } }
 *
 * Major 5 is "event"; records without an employee number (door forced, card
 * unknown) are not punches and are skipped. Pages of 100 until OK/NO MATCH.
 */
const DIRECTION: Record<string, '0' | '1'> = { checkin: '0', overtimein: '0', breakin: '0', checkout: '1', overtimeout: '1', breakout: '1' };

/**
 * Minor codes of event 5 that mean "a person was verified": 1 card, 38
 * fingerprint, 75 face or any method (the method is in currentVerifyMode),
 * 37 card + fingerprint, 101 card + face. Codes differ by firmware, so a
 * reader can be given its own list (config.countMinors).
 */
export const HIKVISION_PASS = [1, 37, 38, 75, 101];

/**
 * Is this access event a punch? It needs an employee number and a verified
 * person: never a verify mode of "invalid" (a refused attempt, a door relay),
 * and either a check-in/out status from the terminal or a pass code.
 */
export function hikvisionCounts(e: { minor?: unknown; subEventType?: unknown; currentVerifyMode?: unknown; attendanceStatus?: unknown; employeeNoString?: unknown; employeeNo?: unknown }, countMinors?: number[] | null): { ok: true } | { ok: false; reason: string } {
  const code = String(e.employeeNoString ?? e.employeeNo ?? '').trim();
  if (!code) return { ok: false, reason: 'No employee number (a door or alarm event)' };
  const mode = String(e.currentVerifyMode || '').toLowerCase();
  if (mode === 'invalid') return { ok: false, reason: 'Verification failed or not a person (verify mode invalid)' };
  const minor = Number(e.minor ?? e.subEventType);
  const pass = countMinors && countMinors.length ? countMinors : HIKVISION_PASS;
  if (Number.isFinite(minor) && minor > 0 && !pass.includes(minor) && !String(e.attendanceStatus || '').trim()) return { ok: false, reason: `Event code ${minor} is not a verified entry` };
  return { ok: true };
}

export async function pullHikvision(ctx: PullContext): Promise<PullResult> {
  if (!ctx.baseUrl) return { ok: false, message: 'Set the terminal’s address (http://host:port).', lines: [], received: 0 };
  const lines: string[] = [];
  const sources: string[] = [];
  const ids: Array<string | null> = [];
  const aside: NonNullable<PullResult['aside']> = [];
  const countMinors = Array.isArray(ctx.config?.countMinors) ? ctx.config.countMinors.map(Number).filter(Number.isFinite) : null;
  let received = 0;
  let position = 0;
  const searchID = `clor-${Date.now()}`;
  const startTime = `${localIn(ctx.from, ctx.zone).replace(' ', 'T')}${offsetIn(ctx.from, ctx.zone)}`;
  const endTime = `${localIn(ctx.to, ctx.zone).replace(' ', 'T')}${offsetIn(ctx.to, ctx.zone)}`;
  let payload: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const body = JSON.stringify({ AcsEventCond: { searchID, searchResultPosition: position, maxResults: 100, major: 5, minor: 0, startTime, endTime } });
    const r = await authedRequest('POST', `${ctx.baseUrl}/ISAPI/AccessControl/AcsEvent?format=json`, ctx.username, ctx.password, { headers: { 'Content-Type': 'application/json' }, body });
    if (r.status === 401) return { ok: false, message: 'The terminal refused the user name or password.', lines: [], received: 0 };
    if (r.status < 200 || r.status >= 300) return { ok: false, message: `The terminal answered ${r.status}.`, lines: [], received: 0 };
    let data: any;
    try {
      data = JSON.parse(r.text);
    } catch {
      return { ok: false, message: 'The terminal did not answer with JSON — is the address its ISAPI port?', lines: [], received: 0 };
    }
    if (page === 0) payload = r.text.slice(0, 20_000);
    const ev = data?.AcsEvent || {};
    const list: any[] = Array.isArray(ev.InfoList) ? ev.InfoList : [];
    for (const e of list) {
      received += 1;
      const id = e.serialNo != null ? String(e.serialNo) : null;
      const verdict = hikvisionCounts(e, countMinors);
      if (!verdict.ok) {
        aside.push({ original: originalOf(e), reason: verdict.reason, id });
        continue;
      }
      const code = String(e.employeeNoString ?? e.employeeNo ?? '').trim();
      const t = readTime(e.time, 'auto', ctx.zone);
      if (!t) continue;
      const dir = DIRECTION[String(e.attendanceStatus || '').toLowerCase()] ?? '255';
      const verify = VERIFY_WORDS[String(e.currentVerifyMode || '').toLowerCase().replace(/[^a-z]/g, '')] ?? 0;
      lines.push(`${code}\t${t}\t${dir}\t${verify}`);
      sources.push(originalOf(e));
      ids.push(id);
    }
    position += list.length;
    if (String(ev.responseStatusStrg || 'OK').toUpperCase() !== 'MORE' || !list.length) break;
  }
  return { ok: true, message: 'Success', lines, sources, ids, aside, received, payload };
}
