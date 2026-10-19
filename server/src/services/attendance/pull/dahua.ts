import { authedRequest } from '../digest.js';
import { readTime } from '../punchMapping.js';
import { originalOf, type PullContext, type PullResult } from './common.js';

/**
 * Dahua access controllers (the CGI "recordFinder"), per the vendor's HTTP
 * API document and never tested here on a real controller:
 *
 *   GET {base}/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec
 *       &condition.CreateTime[0]=<unix from>&condition.CreateTime[1]=<unix to>&count=200&startIndex=0     Digest auth
 *   → text, one field a line:
 *       found=2
 *       records[0].CardNo=0001
 *       records[0].UserID=104
 *       records[0].CreateTime=1760690712
 *       records[0].Status=1          (1 = allowed)
 *       records[0].Type=Entry        (Entry | Exit)
 *       records[0].Method=15         (1 finger, 4 card, 15 face, 0 password)
 *
 * Pages of 200 by startIndex until fewer come back than asked for.
 */
export function parseDahuaRecords(text: string) {
  const rows = new Map<number, Record<string, string>>();
  let found = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^records\[(\d+)\]\.(\w+)=(.*)$/.exec(line.trim());
    if (m) {
      const i = Number(m[1]);
      if (!rows.has(i)) rows.set(i, {});
      rows.get(i)![m[2]] = m[3].trim();
    } else if (/^found=(\d+)/.test(line)) found = Number(line.split('=')[1]);
  }
  return { found, records: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r) };
}

export async function pullDahua(ctx: PullContext): Promise<PullResult> {
  if (!ctx.baseUrl) return { ok: false, message: 'Set the controller’s address (http://host:port).', lines: [], received: 0 };
  const lines: string[] = [];
  const sources: string[] = [];
  const ids: Array<string | null> = [];
  const aside: NonNullable<PullResult['aside']> = [];
  let received = 0;
  let start = 0;
  const count = 200;
  const fromS = Math.floor(ctx.from.getTime() / 1000);
  const toS = Math.floor(ctx.to.getTime() / 1000);
  let payload: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const url = `${ctx.baseUrl}/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&condition.CreateTime%5B0%5D=${fromS}&condition.CreateTime%5B1%5D=${toS}&count=${count}&startIndex=${start}`;
    const r = await authedRequest('GET', url, ctx.username, ctx.password);
    if (r.status === 401) return { ok: false, message: 'The controller refused the user name or password.', lines: [], received: 0 };
    if (r.status < 200 || r.status >= 300) return { ok: false, message: `The controller answered ${r.status}.`, lines: [], received: 0 };
    if (page === 0) payload = r.text.slice(0, 20_000);
    const { records } = parseDahuaRecords(r.text);
    for (const rec of records) {
      received += 1;
      if (rec.Status && rec.Status !== '1') {
        aside.push({ original: originalOf(rec), reason: 'Not opened (a refused attempt)', id: rec.RecNo ? String(rec.RecNo) : null });
        continue;
      }
      const code = String(rec.UserID || rec.CardNo || '').trim();
      const t = readTime(Number(rec.CreateTime), 'epoch', ctx.zone);
      if (!code || !t) continue;
      const dir = /^entry$/i.test(rec.Type || '') ? '0' : /^exit$/i.test(rec.Type || '') ? '1' : '255';
      const verify = Number(rec.Method);
      lines.push(`${code}\t${t}\t${dir}\t${Number.isFinite(verify) ? verify : 0}`);
      sources.push(originalOf(rec));
      ids.push(rec.RecNo ? String(rec.RecNo) : null);
    }
    if (records.length < count) break;
    start += count;
  }
  return { ok: true, message: 'Success', lines, sources, ids, aside, received, payload };
}
