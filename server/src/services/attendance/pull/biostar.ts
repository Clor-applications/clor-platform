import { guardedRequest } from '../../outbound.js';
import { readTime } from '../punchMapping.js';
import { type PullContext, type PullResult } from './common.js';

/**
 * Suprema BioStar 2 server (its REST API), per the published API and never
 * tested here against a real server:
 *
 *   POST {base}/api/login   { "User": { "login_id": "…", "password": "…" } }   → header bs-session-id
 *   POST {base}/api/events/search   header bs-session-id
 *   { "Query": { "limit": 500, "offset": 0,
 *                "conditions": [{ "column": "datetime", "operator": 3, "values": ["2026-10-17T00:00:00.000Z", "…"] }],
 *                "orderBy": [{ "column": "datetime", "descending": false }] } }
 *   → { "EventCollection": { "rows": [{ "datetime": "2026-10-17T03:35:12.00Z", "user_id": { "user_id": "104" },
 *                                      "event_type_id": { "code": "4102" }, "device_id": { "id": "…" }, "tna_key": "1" }] } }
 *
 * Event codes 4096–4895 are the "authentication succeeded" family; others
 * (door, alarm) are skipped. tna_key is the T&A key pressed: 1 in, 2 out,
 * when the site uses them.
 */
export async function pullBiostar(ctx: PullContext): Promise<PullResult> {
  if (!ctx.baseUrl) return { ok: false, message: 'Set the BioStar server address (https://host).', lines: [], received: 0 };
  const login = await guardedRequest('POST', `${ctx.baseUrl}/api/login`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ User: { login_id: ctx.username, password: ctx.password } }) });
  if (login.status === 401 || login.status === 403) return { ok: false, message: 'BioStar refused the login.', lines: [], received: 0 };
  if (login.status < 200 || login.status >= 300) return { ok: false, message: `BioStar answered ${login.status} at login.`, lines: [], received: 0 };
  const session = String(login.headers['bs-session-id'] || '');
  if (!session) return { ok: false, message: 'BioStar gave no session — is the address its web port?', lines: [], received: 0 };

  const lines: string[] = [];
  let received = 0;
  let offset = 0;
  const limit = 500;
  let payload: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const body = JSON.stringify({
      Query: { limit, offset, conditions: [{ column: 'datetime', operator: 3, values: [ctx.from.toISOString(), ctx.to.toISOString()] }], orderBy: [{ column: 'datetime', descending: false }] },
    });
    const r = await guardedRequest('POST', `${ctx.baseUrl}/api/events/search`, { headers: { 'Content-Type': 'application/json', 'bs-session-id': session }, body });
    if (r.status < 200 || r.status >= 300) return { ok: false, message: `BioStar answered ${r.status} searching events.`, lines: [], received: 0 };
    let data: any;
    try {
      data = JSON.parse(r.text);
    } catch {
      return { ok: false, message: 'BioStar did not answer with JSON.', lines: [], received: 0 };
    }
    if (page === 0) payload = r.text.slice(0, 20_000);
    const rows: any[] = data?.EventCollection?.rows || [];
    for (const e of rows) {
      received += 1;
      const codeNum = Number(e.event_type_id?.code);
      if (Number.isFinite(codeNum) && (codeNum < 4096 || codeNum > 4895)) continue;
      const code = String(e.user_id?.user_id ?? '').trim();
      const t = readTime(e.datetime, 'auto', ctx.zone);
      if (!code || !t) continue;
      const dir = String(e.tna_key || '') === '1' ? '0' : String(e.tna_key || '') === '2' ? '1' : '255';
      lines.push(`${code}\t${t}\t${dir}\t0`);
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  return { ok: true, message: 'Success', lines, received, payload };
}
