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
/**
 * One setting on a connection. `where` says where in the vendor's own admin
 * the value is found (from the vendor's documentation); `group` splits what
 * attendance needs from what is optional (reading employees); `options`
 * makes it a choice rather than free text.
 */
export type Field = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  where?: string;
  required?: boolean;
  group?: 'Connection' | 'Sending punches' | 'Reading employees' | 'Advanced';
  options?: Array<{ value: string; label: string }>;
  default?: string;
};
export type PushResult = { accepted: number; rejected: Array<{ key: string; error: string }>; retryAll?: boolean };

export interface HrAdapter {
  id: string;
  label: string;
  blurb: string;
  docsUrl: string;
  /** What the company needs on the vendor's side first (plan, add-on, who issues a key). */
  prerequisites?: string[];
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

/**
 * greytHR's swipe lines (its Attendance Swipe API page): `2017-03-10T13:46:58.260+05:30,658,Main Door,1`
 * — an ISO time with the offset, the employee code, the door, 1 in / 0 out — one per line, CRLF, the
 * whole text signed SHA1-with-RSA with the swipe key and sent as `id`, `swipes`, `sign`.
 */
export const greythrSwipeLines = (punches: Punch[]) =>
  punches.map((p) => `${p.time.replace(' ', 'T')}.000+05:30,${p.code},${p.readerId.replace(/,/g, ' ').slice(0, 20)},${p.direction === 'OUT' ? 0 : 1}`).join('\r\n');
export const greythrSign = (privateKeyPem: string, swipes: string) => createSign('RSA-SHA1').update(swipes).end().sign(privateKeyPem, 'base64');

/** greytHR REST API v2: an API user's name and password (Basic) for a token, sent back as ACCESS-TOKEN with the domain header. */
const greythrRestBase = (config: Record<string, string>) => (config.apiBase ? site(config.apiBase) : 'https://api.greythr.com');
const greythrTokens = new Map<string, { token: string; exp: number }>();
export const greythrToken = async (config: Record<string, string>, secrets: Record<string, string>) => {
  const user = need(config, 'apiUser', 'API user name');
  const pass = need(secrets, 'apiPassword', 'API user password');
  const domain = host(need(config, 'domain', 'greytHR address'));
  const key = createHash('sha256').update(`${domain}|${user}|${pass}`).digest('hex');
  const have = greythrTokens.get(key);
  if (have && have.exp > Date.now() + 60_000) return { token: have.token, domain };
  const res = await guardedRequest('POST', `${greythrRestBase(config)}/oauth2/v2/client-token`, {
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`, 'x-greythr-domain': domain },
    body: '',
    timeoutMs: 20_000,
  });
  const j: any = (() => { try { return JSON.parse(res.text || '{}'); } catch { return {}; } })();
  if (res.status !== 200 || !j.access_token) throw new Error(`greytHR refused the API user (${res.status})`);
  greythrTokens.set(key, { token: String(j.access_token), exp: Date.now() + (Number(j.expires_in) || 3599) * 1000 });
  return { token: String(j.access_token), domain };
};

const greythr: HrAdapter = {
  id: 'GREYTHR',
  label: 'greytHR',
  blurb: 'Punches go to greytHR as attendance swipes (its signed swipe-upload API). With an API user as well, CLOR can read greytHR’s employee list so the two match.',
  docsUrl: 'https://www.greythr.com/help-admin/attendance-management/generate-api-key-attendance-swipe/',
  prerequisites: [
    'The Attendance Swipe API is available on greytHR’s Growth and Enterprise plans.',
    'greytHR accepts one upload every 10 seconds; CLOR sends in batches, about once a minute.',
    'Employee codes in CLOR must match greytHR’s employee numbers.',
  ],
  capabilities: ['pushPunches', 'pullEmployees'],
  fields: [
    { key: 'domain', label: 'greytHR address', placeholder: 'yourcompany.greythr.com', required: true, group: 'Connection', where: 'The address you sign in to greytHR at (the Domain URL on the API Details page).' },
    { key: 'apiId', label: 'API ID', required: true, group: 'Sending punches', where: 'greytHR admin → Settings → My Account → API Details → + → Attendance Swipe API Key → Generate. The API ID is shown only once: copy it then.' },
    { key: 'privateKey', label: 'Private key', secret: true, required: true, group: 'Sending punches', where: 'Same screen → Download Private Key. Open the downloaded file and paste everything, including the BEGIN and END lines.', help: 'Kept encrypted. Used to sign each upload; never sent to greytHR.' },
    { key: 'apiUser', label: 'API user name', group: 'Reading employees', where: 'greytHR admin → Settings → My Account → API Users → Create API User, with the Employee API role.', help: 'Optional. Only needed to read greytHR’s employee list.' },
    { key: 'apiPassword', label: 'API user password', secret: true, group: 'Reading employees', where: 'Shown once when the API user is created.' },
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
    if (r.retryAll) return { ok: false, message: r.rejected[0]?.error || 'greytHR did not accept the request.' };
    if (String(config.apiUser || '').trim()) {
      try {
        await greythrToken(config, secrets);
      } catch (e: any) {
        return { ok: false, message: `The swipe key works, but ${String(e?.message || e)}.` };
      }
      return { ok: true, message: 'greytHR accepted the swipe key and the API user.' };
    }
    return { ok: true, message: 'greytHR accepted a signed request.' };
  },
  async pullEmployees(config, secrets) {
    if (!String(config.apiUser || '').trim()) throw new Error('Reading employees needs a greytHR API user (Settings → My Account → API Users).');
    const { token, domain } = await greythrToken(config, secrets);
    const out: RemoteEmployee[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const res = await guardedRequest('GET', `${greythrRestBase(config)}/employee/v2/employees?page=${page}&size=100&state=ALL`, { headers: { 'ACCESS-TOKEN': token, 'x-greythr-domain': domain, Accept: 'application/json' }, timeoutMs: 30_000 });
      if (res.status !== 200) throw new Error(`greytHR answered ${res.status} when listing employees`);
      const j: any = JSON.parse(res.text || '{}');
      const rows: any[] = Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : [];
      for (const e of rows) {
        out.push({
          externalId: String(e.employeeId ?? e.employeeNo ?? ''),
          code: e.employeeNo ? String(e.employeeNo) : null,
          name: String(e.name || e.employeeNo || ''),
          email: e.email ? String(e.email) : null,
          department: null,
          active: !(e.leftorg === true || e.leavingDate),
        });
      }
      const pages = Number(j.pages?.totalPages ?? j.totalPages ?? 0);
      if (!rows.length || (pages && page >= pages) || rows.length < 100) break;
    }
    return out;
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
  /* Keka suggests a browser-like User-Agent for server clients (its token reference). */
  const res = await guardedRequest('POST', `${config.apiBase ? site(config.apiBase) : `https://${config.sandbox === 'yes' ? 'login.kekademo.com' : 'login.keka.com'}`}/connect/token`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (compatible; CLOR)' }, body, timeoutMs: 20_000 });
  if (res.status !== 200) throw new Error(`Keka refused the credentials (${res.status})`);
  const token = String((JSON.parse(res.text || '{}') as any).access_token || '');
  if (!token) throw new Error('Keka gave no token');
  return token;
};

const keka: HrAdapter = {
  id: 'KEKA',
  label: 'Keka',
  blurb: 'Punches go in as attendance logs (Keka’s log-ingestion API); people can be read from Keka so the two lists match.',
  docsUrl: 'https://developers.keka.com/',
  prerequisites: [
    'Keka’s API access is a paid add-on; only a Global admin can create keys.',
    'The attendance-log key and device identifier are issued by Keka support on request, after the device is added under Attendance in Keka.',
    'Keka matches people by their attendance number. Choose below whether that is the employee code or the reader ID in CLOR.',
  ],
  capabilities: ['pushPunches', 'pullEmployees'],
  fields: [
    { key: 'tenant', label: 'Keka company name', placeholder: 'yourcompany', required: true, group: 'Connection', where: 'The first part of your Keka address: yourcompany.keka.com.' },
    { key: 'sandbox', label: 'Environment', group: 'Connection', options: [{ value: 'no', label: 'Live (keka.com)' }, { value: 'yes', label: 'Sandbox (kekademo.com)' }], default: 'no' },
    { key: 'clientId', label: 'Client ID', required: true, group: 'Reading employees', where: 'Keka → Global Settings → Integrations & Automation → API access → Create New Key. Shown once.' },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: true, group: 'Reading employees', where: 'Same screen, shown once with the client ID.' },
    { key: 'apiKey', label: 'API key', secret: true, required: true, group: 'Reading employees', where: 'Same screen (API access).' },
    { key: 'server', label: 'Attendance server', placeholder: 'cin01', required: true, group: 'Sending punches', where: 'Given by Keka support with the attendance-log key; Indian accounts are usually cin01 or cin02.' },
    { key: 'attendanceApiKey', label: 'Attendance-log API key (X-API-Key)', secret: true, required: true, group: 'Sending punches', where: 'Issued by Keka support for log ingestion. Different from the API key above.' },
    { key: 'deviceId', label: 'Device identifier', placeholder: 'CLOR', required: true, group: 'Sending punches', where: 'Issued by Keka support with the key; it is the device as Keka knows it.' },
    { key: 'matchBy', label: 'Keka attendance number is', group: 'Sending punches', options: [{ value: 'code', label: 'The employee code in CLOR' }, { value: 'readerId', label: 'The reader ID in CLOR' }], default: 'code', help: 'Keka files each log under the employee whose attendance number this matches.' },
    { key: 'apiBase', label: 'API base URL override', group: 'Advanced', help: 'Leave blank. Only for a proxy or a test double; replaces every Keka host.' },
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
    /* The field names Keka's attendance-log guide gives: DeviceIdentifier, EmployeeAttendanceNumber, Timestamp, Status (0 in, 1 out). */
    const body = JSON.stringify(punches.map((p) => ({ DeviceIdentifier: config.deviceId, EmployeeAttendanceNumber: config.matchBy === 'readerId' ? p.readerId : p.code, Timestamp: `${p.time.replace(' ', 'T')}+05:30`, Status: p.direction === 'OUT' ? 1 : 0 })));
    const res = await guardedRequest('POST', `${config.apiBase ? site(config.apiBase) : `https://${host(config.server)}.a.keka.com`}/v1/logs`, { headers: { 'Content-Type': 'application/json', 'X-API-Key': need(secrets, 'attendanceApiKey', 'Attendance-log API key') }, body, timeoutMs: 20_000 });
    if (res.status >= 200 && res.status < 300) return { accepted: punches.length, rejected: [] };
    return { accepted: 0, rejected: punches.map((p) => ({ key: p.key, error: `Keka answered ${res.status}` })), retryAll: res.status >= 500 || res.status === 429 || res.status === 0 };
  },
  async pullEmployees(config, secrets) {
    const token = await kekaToken(config, secrets);
    const out: RemoteEmployee[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const res = await guardedRequest('GET', `${config.apiBase ? site(config.apiBase) : `https://${host(config.tenant)}.keka.com`}/api/v1/hris/employees?pageNumber=${page}&pageSize=200`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CLOR)' }, timeoutMs: 30_000 });
      if (res.status !== 200) throw new Error(`Keka answered ${res.status} when listing employees`);
      const j: any = JSON.parse(res.text || '{}');
      const rows: any[] = j.data || j.employees || [];
      for (const e of rows) {
        out.push({
          externalId: String(e.id || e.employeeId || ''),
          code: e.employeeNumber ? String(e.employeeNumber) : e.attendanceNumber ? String(e.attendanceNumber) : null,
          name: String(e.displayName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.employeeNumber || ''),
          email: e.email ? String(e.email) : null,
          department: e.department?.name || (Array.isArray(e.groups) ? e.groups.find((g: any) => /depart/i.test(String(g.groupType || g.type || '')))?.title : null) || null,
          active: !(e.employmentStatus === 1 || e.exitStatus === 1 || e.isExited === true),
        });
      }
      if (rows.length < 200 || (j.totalPages && page >= j.totalPages)) break;
    }
    return out;
  },
};

/* ---------------------------------------------------------------- Zoho People */

/** Access tokens from a refresh token, kept per connection until they expire. */
const zohoTokens = new Map<string, { token: string; exp: number }>();
/* Zoho's data centres; Canada lives on zohocloud.ca rather than zoho.ca. */
const zohoHost = (dc: string) => (dc === 'ca' ? 'zohocloud.ca' : `zoho.${dc || 'in'}`);
const zohoAccounts = (config: Record<string, string>) => (config.apiBase ? site(config.apiBase) : `https://accounts.${zohoHost(config.dc)}`);
const zohoPeople = (config: Record<string, string>) => (config.apiBase ? site(config.apiBase) : `https://people.${zohoHost(config.dc)}`);

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
  blurb: 'Punches go in as check-ins and check-outs (Zoho’s attendance bulk-import API); people can be read from Zoho so the two lists match.',
  docsUrl: 'https://www.zoho.com/people/api/attendance-bulkimport.html',
  prerequisites: [
    'A Zoho API client (Self Client) in the Zoho account that owns Zoho People.',
    'Employee codes in CLOR must match Zoho’s Employee ID.',
    'Zoho takes up to 10 bulk uploads a minute; CLOR sends about one a minute.',
  ],
  capabilities: ['pushPunches', 'pullEmployees'],
  fields: [
    { key: 'dc', label: 'Zoho data centre', required: true, group: 'Connection', default: 'in', where: 'The domain you sign in to Zoho at.', options: [
      { value: 'in', label: 'India (zoho.in)' }, { value: 'com', label: 'United States (zoho.com)' }, { value: 'eu', label: 'Europe (zoho.eu)' },
      { value: 'com.au', label: 'Australia (zoho.com.au)' }, { value: 'jp', label: 'Japan (zoho.jp)' }, { value: 'ca', label: 'Canada (zohocloud.ca)' },
      { value: 'com.cn', label: 'China (zoho.com.cn)' }, { value: 'sa', label: 'Saudi Arabia (zoho.sa)' }, { value: 'uk', label: 'United Kingdom (zoho.uk)' },
    ] },
    { key: 'clientId', label: 'Client ID', required: true, group: 'Connection', where: 'api-console.zoho.in (your data centre) → Add Client → Self Client → Client Secret tab.' },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: true, group: 'Connection', where: 'Same tab, beside the client ID.' },
    { key: 'refreshToken', label: 'Refresh token', secret: true, required: true, group: 'Connection', where: 'Self Client → Generate Code with scopes ZOHOPEOPLE.attendance.ALL,ZOHOPEOPLE.forms.READ, then exchange the code for a refresh token (Zoho’s OAuth steps page).', help: 'Kept encrypted. Zoho refresh tokens do not expire unless revoked.' },
    { key: 'apiBase', label: 'API base URL override', group: 'Advanced', help: 'Leave blank. Only for a proxy or a test double; replaces the accounts and people hosts.' },
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
export const publicAdapter = (a: HrAdapter) => ({ id: a.id, label: a.label, blurb: a.blurb, docsUrl: a.docsUrl, prerequisites: a.prerequisites || [], capabilities: a.capabilities, fields: a.fields });
