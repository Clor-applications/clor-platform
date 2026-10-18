import { createHash, createSign } from 'node:crypto';
import { guardedRequest } from '../outbound.js';

/**
 * Adapters to the HR and payroll tools a company also runs.
 *
 * Each adapter states what it can do; a connection may only ask for that,
 * and the sync says plainly when something is not possible rather than
 * logging a success that moved nothing (the ClorTime lesson). Credentials
 * come in as `config` (plain) and `secrets` (decrypted just for the call).
 */
export type Punch = { code: string; readerId: string; time: string; direction: 'IN' | 'OUT' | null; verifyMode: number };
export type RemoteEmployee = { externalId: string; code: string | null; name: string; email: string | null; department: string | null; active: boolean };
export type Field = { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; required?: boolean };
export type PushResult = { accepted: number; rejected: Array<{ key: string; error: string }>; retryAll?: boolean };

export interface HrAdapter {
  id: string;
  label: string;
  blurb: string;
  docsUrl: string;
  capabilities: Array<'pushPunches' | 'pullEmployees'>;
  fields: Field[];
  /** Fast proof the credentials work; never writes. */
  test(config: Record<string, string>, secrets: Record<string, string>): Promise<{ ok: boolean; message: string }>;
  pushPunches?(config: Record<string, string>, secrets: Record<string, string>, punches: Array<Punch & { key: string }>): Promise<PushResult>;
  pullEmployees?(config: Record<string, string>, secrets: Record<string, string>): Promise<RemoteEmployee[]>;
}

const need = (o: Record<string, string>, k: string, label: string) => {
  const v = String(o[k] || '').trim();
  if (!v) throw new Error(`${label} is not set`);
  return v;
};
const host = (v: string) => v.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
/** A bare host becomes https://host; a full URL (a proxy, a test double) is taken as given. */
const site = (v: string) => (/^https?:\/\//.test(v.trim()) ? v.trim().replace(/\/$/, '') : `https://${host(v)}`);

/** apiBase replaces a vendor's host: for a proxy or a test double, never in production (stored secrets would follow it). */
export const apiBaseAllowed = () => process.env.NODE_ENV !== 'production' || process.env.HR_ALLOW_API_BASE === 'true';
const ZOHO_DCS = new Set(['in', 'com', 'eu', 'com.au', 'jp', 'ca', 'sa', 'uk', 'com.cn']);
/** Settings that decide which host the stored secrets are sent to. */
export const HOST_FIELDS = ['apiBase', 'dc', 'domain', 'tenant', 'server', 'sandbox'];
/** Why a connection's host settings are not acceptable, or null. */
export function hostProblem(adapterId: string, config: Record<string, string>) {
  if (config.apiBase && !apiBaseAllowed()) return 'An API base URL override is not allowed here.';
  if (adapterId === 'ZOHO_PEOPLE' && config.dc && !ZOHO_DCS.has(String(config.dc).trim())) return `Zoho data centre must be one of: ${[...ZOHO_DCS].join(', ')}.`;
  if (adapterId === 'KEKA') {
    if (config.server && !/^[a-z0-9-]{2,40}$/i.test(String(config.server).trim())) return 'Keka attendance server is a short name like cin01.';
    if (config.tenant && !/^[a-z0-9-]{1,63}$/i.test(String(config.tenant).trim())) return 'Keka subdomain is the part before .keka.com.';
  }
  if (adapterId === 'GREYTHR' && config.domain && !apiBaseAllowed() && !/^[a-z0-9-]+\.greythr\.com$/i.test(host(String(config.domain)))) return 'The greytHR address ends in .greythr.com.';
  return null;
}

/* ---------------------------------------------------------------- greytHR */

/** `YYYY-MM-DDTHH:mm:ss,empcode,door,1|0` per swipe — 1 in, 0 out — signed SHA1-with-RSA with the swipe API's private key. */
export const greythrSwipeLines = (punches: Punch[]) =>
  punches.map((p) => `${p.time.replace(' ', 'T')},${p.code},${p.readerId.slice(0, 20)},${p.direction === 'OUT' ? 0 : 1}`).join('\n');
export const greythrSign = (privateKeyPem: string, swipes: string) => createSign('RSA-SHA1').update(swipes).end().sign(privateKeyPem, 'base64');

const greythr: HrAdapter = {
  id: 'GREYTHR',
  label: 'greytHR',
  blurb: 'Punches go to greytHR as attendance swipes (its swipe-upload API, self-serve from the greytHR admin).',
  docsUrl: 'https://www.greythr.com/help-admin/attendance-management/generate-api-key-attendance-swipe/',
  capabilities: ['pushPunches'],
  fields: [
    { key: 'domain', label: 'greytHR address', placeholder: 'yourcompany.greythr.com', required: true },
    { key: 'apiId', label: 'Attendance swipe API ID', required: true, help: 'greytHR admin → Attendance → Swipe API key' },
    { key: 'privateKey', label: 'Private key (PEM)', secret: true, required: true, help: 'The key greytHR gave with the API ID; kept encrypted' },
  ],
  async test(config, secrets) {
    need(config, 'domain', 'greytHR address');
    need(config, 'apiId', 'API ID');
    const pem = need(secrets, 'privateKey', 'Private key');
    try {
      greythrSign(pem, 'test');
    } catch {
      return { ok: false, message: 'The private key is not a valid PEM key.' };
    }
    /* No read endpoint comes with the swipe key; an empty, signed upload proves the address and the key. */
    const r = await this.pushPunches!(config, secrets, []);
    return r.retryAll ? { ok: false, message: r.rejected[0]?.error || 'greytHR did not accept the request.' } : { ok: true, message: 'greytHR accepted a signed request.' };
  },
  async pushPunches(config, secrets, punches) {
    const swipes = greythrSwipeLines(punches);
    const body = new URLSearchParams({ id: config.apiId, swipes, sign: greythrSign(secrets.privateKey, swipes) }).toString();
    const res = await guardedRequest('POST', `${site(config.domain)}/v2/attendance/asca/swipes`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body,
      timeoutMs: 20_000,
    });
    if (res.status >= 200 && res.status < 300) return { accepted: punches.length, rejected: [] };
    return { accepted: 0, rejected: punches.map((p) => ({ key: p.key, error: `greytHR answered ${res.status}` })), retryAll: res.status >= 500 || res.status === 429 || res.status === 0 };
  },
};

/* ---------------------------------------------------------------- Keka */

const kekaToken = async (config: Record<string, string>, secrets: Record<string, string>) => {
  const body = new URLSearchParams({ grant_type: 'kekaapi', scope: 'kekaapi', client_id: need(config, 'clientId', 'Client ID'), client_secret: need(secrets, 'clientSecret', 'Client secret'), api_key: need(secrets, 'apiKey', 'API key') }).toString();
  const res = await guardedRequest('POST', `${config.apiBase ? site(config.apiBase) : `https://${config.sandbox === 'yes' ? 'login.kekademo.com' : 'login.keka.com'}`}/connect/token`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, timeoutMs: 20_000 });
  if (res.status !== 200) throw new Error(`Keka refused the credentials (${res.status})`);
  const token = String((JSON.parse(res.text || '{}') as any).access_token || '');
  if (!token) throw new Error('Keka gave no token');
  return token;
};

const keka: HrAdapter = {
  id: 'KEKA',
  label: 'Keka',
  blurb: 'Punches go in as attendance logs; people can be read from Keka so the two lists match.',
  docsUrl: 'https://developers.keka.com/',
  capabilities: ['pushPunches', 'pullEmployees'],
  fields: [
    { key: 'tenant', label: 'Keka subdomain', placeholder: 'yourcompany', required: true, help: 'yourcompany.keka.com' },
    { key: 'server', label: 'Attendance server', placeholder: 'cin01', required: true, help: 'From Keka’s attendance-log API guide; India is cin01 or cin02' },
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
    { key: 'apiKey', label: 'API key', secret: true, required: true, help: 'Keka → Settings → Integrations → API' },
    { key: 'attendanceApiKey', label: 'Attendance-log API key', secret: true, required: true, help: 'Issued by Keka support for log ingestion' },
    { key: 'deviceId', label: 'Device ID shown in Keka', placeholder: 'CLOR', required: true },
    { key: 'sandbox', label: 'Sandbox (kekademo)', placeholder: 'no' },
    { key: 'apiBase', label: 'API base URL override', help: 'Leave blank. Only for a proxy or a test double; replaces every Keka host.' },
  ],
  async test(config, secrets) {
    try {
      await kekaToken(config, secrets);
      return { ok: true, message: 'Keka accepted the credentials.' };
    } catch (e: any) {
      return { ok: false, message: String(e?.message || e) };
    }
  },
  async pushPunches(config, secrets, punches) {
    const body = JSON.stringify(punches.map((p) => ({ deviceId: config.deviceId, attendanceNumber: p.code, timestamp: p.time.replace(' ', 'T'), status: p.direction === 'OUT' ? 1 : 0 })));
    const res = await guardedRequest('POST', `${config.apiBase ? site(config.apiBase) : `https://${host(config.server)}.a.keka.com`}/v1/logs`, { headers: { 'Content-Type': 'application/json', 'X-API-Key': need(secrets, 'attendanceApiKey', 'Attendance-log API key') }, body, timeoutMs: 20_000 });
    if (res.status >= 200 && res.status < 300) return { accepted: punches.length, rejected: [] };
    return { accepted: 0, rejected: punches.map((p) => ({ key: p.key, error: `Keka answered ${res.status}` })), retryAll: res.status >= 500 || res.status === 429 || res.status === 0 };
  },
  async pullEmployees(config, secrets) {
    const token = await kekaToken(config, secrets);
    const out: RemoteEmployee[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const res = await guardedRequest('GET', `${config.apiBase ? site(config.apiBase) : `https://${host(config.tenant)}.keka.com`}/api/v1/hris/employees?pageNumber=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeoutMs: 30_000 });
      if (res.status !== 200) throw new Error(`Keka answered ${res.status} when listing employees`);
      const j: any = JSON.parse(res.text || '{}');
      const rows: any[] = j.data || j.employees || [];
      for (const e of rows) {
        out.push({
          externalId: String(e.id || e.employeeId || ''),
          code: e.employeeNumber ? String(e.employeeNumber) : null,
          name: String(e.displayName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.employeeNumber || ''),
          email: e.email ? String(e.email) : null,
          department: e.department?.name || (Array.isArray(e.groups) ? e.groups.find((g: any) => /depart/i.test(String(g.groupType || g.type || '')))?.title : null) || null,
          active: !(e.employmentStatus === 1 || e.exitStatus === 1 || e.isExited === true),
        });
      }
      if (rows.length < 100 || (j.totalPages && page >= j.totalPages)) break;
    }
    return out;
  },
};

/* ---------------------------------------------------------------- Zoho People */

/** Access tokens from a refresh token, kept per connection until they expire. */
const zohoTokens = new Map<string, { token: string; exp: number }>();
const zohoAccounts = (config: Record<string, string>) => (config.apiBase ? site(config.apiBase) : `https://accounts.zoho.${config.dc || 'in'}`);
const zohoPeople = (config: Record<string, string>) => (config.apiBase ? site(config.apiBase) : `https://people.zoho.${config.dc || 'in'}`);

export const zohoToken = async (config: Record<string, string>, secrets: Record<string, string>) => {
  const key = createHash('sha256').update(`${config.clientId}|${secrets.clientSecret}|${secrets.refreshToken}`).digest('hex');
  const have = zohoTokens.get(key);
  if (have && have.exp > Date.now() + 60_000) return have.token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: need(config, 'clientId', 'Client ID'), client_secret: need(secrets, 'clientSecret', 'Client secret'), refresh_token: need(secrets, 'refreshToken', 'Refresh token') }).toString();
  const res = await guardedRequest('POST', `${zohoAccounts(config)}/oauth/v2/token`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, timeoutMs: 20_000 });
  const j: any = JSON.parse(res.text || '{}');
  if (res.status !== 200 || !j.access_token) throw new Error(j.error ? `Zoho refused the refresh token (${j.error})` : `Zoho answered ${res.status} for the token`);
  zohoTokens.set(key, { token: String(j.access_token), exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return String(j.access_token);
};

/** `[{ empId, checkIn }]` / `[{ empId, checkOut }]` — Zoho wants one or the other per record. A punch with no direction goes as a check-in. */
export const zohoRecords = (punches: Punch[]) => punches.map((p) => ({ empId: p.code, ...(p.direction === 'OUT' ? { checkOut: p.time } : { checkIn: p.time }) }));

const zoho: HrAdapter = {
  id: 'ZOHO_PEOPLE',
  label: 'Zoho People',
  blurb: 'Punches go in as check-ins and check-outs (the attendance bulk-import API); people can be read from Zoho so the two lists match. Needs a Zoho API client with a refresh token.',
  docsUrl: 'https://www.zoho.com/people/api/attendance-bulkimport.html',
  capabilities: ['pushPunches', 'pullEmployees'],
  fields: [
    { key: 'dc', label: 'Zoho data centre', placeholder: 'in', required: true, help: 'in for zoho.in (India), com for zoho.com, eu, com.au, jp' },
    { key: 'clientId', label: 'Client ID', required: true, help: 'api-console.zoho.in → Self Client' },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true, required: true, help: 'Generated once with scopes ZOHOPEOPLE.attendance.ALL and ZOHOPEOPLE.forms.READ' },
    { key: 'apiBase', label: 'API base URL override', help: 'Leave blank. Only for a proxy or a test double; replaces the accounts and people hosts.' },
  ],
  async test(config, secrets) {
    try {
      const token = await zohoToken(config, secrets);
      const res = await guardedRequest('GET', `${zohoPeople(config)}/people/api/forms/employee/getRecords?sIndex=1&limit=1`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeoutMs: 20_000 });
      if (res.status !== 200) return { ok: false, message: `Zoho People answered ${res.status} when reading one employee — check the scopes on the token.` };
      return { ok: true, message: 'Zoho People accepted the token.' };
    } catch (e: any) {
      return { ok: false, message: String(e?.message || e) };
    }
  },
  async pushPunches(config, secrets, punches) {
    const token = await zohoToken(config, secrets);
    const body = new URLSearchParams({ data: JSON.stringify(zohoRecords(punches)), dateFormat: 'yyyy-MM-dd HH:mm:ss' }).toString();
    const res = await guardedRequest('POST', `${zohoPeople(config)}/people/api/attendance/bulkImport`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, timeoutMs: 30_000 });
    let j: any = {};
    try {
      j = JSON.parse(res.text || '{}');
    } catch {
      /* not JSON */
    }
    if (res.status >= 200 && res.status < 300 && (j.response === 'success' || j.response?.status === 0)) {
      /* Employee IDs Zoho does not know come back as skipped: those punches are rejected for good, the rest went in. */
      const skipped = new Set<string>((Array.isArray(j.skippedEmpInfo) ? j.skippedEmpInfo : []).map(String));
      const rejected = punches.filter((p) => skipped.has(p.code)).map((p) => ({ key: p.key, error: `Zoho People has no employee ${p.code}` }));
      return { accepted: punches.length - rejected.length, rejected };
    }
    const why = j.response?.message || j.message || j.error || `Zoho People answered ${res.status}`;
    return { accepted: 0, rejected: punches.map((p) => ({ key: p.key, error: String(why) })), retryAll: res.status >= 500 || res.status === 429 || res.status === 0 };
  },
  async pullEmployees(config, secrets) {
    const token = await zohoToken(config, secrets);
    const out: RemoteEmployee[] = [];
    for (let sIndex = 1; sIndex <= 10_001; sIndex += 200) {
      const res = await guardedRequest('GET', `${zohoPeople(config)}/people/api/forms/employee/getRecords?sIndex=${sIndex}&limit=200`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeoutMs: 30_000 });
      if (res.status !== 200) throw new Error(`Zoho People answered ${res.status} when listing employees`);
      const j: any = JSON.parse(res.text || '{}');
      const result: any[] = Array.isArray(j.response?.result) ? j.response.result : [];
      let n = 0;
      for (const wrapper of result) {
        for (const [zohoId, recs] of Object.entries(wrapper || {})) {
          const e: any = Array.isArray(recs) ? recs[0] : recs;
          if (!e) continue;
          n += 1;
          out.push({
            externalId: String(zohoId),
            code: e.EmployeeID ? String(e.EmployeeID) : null,
            name: String(`${e.FirstName || ''} ${e.LastName || ''}`.trim() || e.EmployeeID || ''),
            email: e.EmailID ? String(e.EmailID) : null,
            department: e.Department ? String(e.Department) : null,
            active: !/inactive|resign|terminat|exit/i.test(String(e.Employeestatus || 'Active')),
          });
        }
      }
      if (n < 200) break;
    }
    return out;
  },
};

export const ADAPTERS: HrAdapter[] = [greythr, keka, zoho];
export const adapterOf = (id: string) => ADAPTERS.find((a) => a.id === String(id || '').toUpperCase()) || null;
export const publicAdapter = (a: HrAdapter) => ({ id: a.id, label: a.label, blurb: a.blurb, docsUrl: a.docsUrl, capabilities: a.capabilities, fields: a.fields });
