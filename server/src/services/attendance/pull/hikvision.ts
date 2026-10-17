import { authedRequest } from '../digest.js';
import { readTime } from '../punchMapping.js';
import { VERIFY_WORDS, localIn, offsetIn, type PullContext, type PullResult } from './index.js';

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

export async function pullHikvision(ctx: PullContext): Promise<PullResult> {
  if (!ctx.baseUrl) return { ok: false, message: 'Set the terminal’s address (http://host:port).', lines: [], received: 0 };
  const lines: string[] = [];
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
      const code = String(e.employeeNoString ?? e.employeeNo ?? '').trim();
      if (!code) continue;
      const t = readTime(e.time, 'auto', ctx.zone);
      if (!t) continue;
      const dir = DIRECTION[String(e.attendanceStatus || '').toLowerCase()] ?? '255';
      const verify = VERIFY_WORDS[String(e.currentVerifyMode || '').toLowerCase().replace(/[^a-z]/g, '')] ?? 0;
      lines.push(`${code}\t${t}\t${dir}\t${verify}`);
    }
    position += list.length;
    if (String(ev.responseStatusStrg || 'OK').toUpperCase() !== 'MORE' || !list.length) break;
  }
  return { ok: true, message: 'Success', lines, received, payload };
}
