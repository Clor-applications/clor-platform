import { createHash, randomBytes } from 'node:crypto';

import { guardedRequest, type GuardedResponse } from '../outbound.js';

/**
 * HTTP Digest authentication (RFC 7616, MD5 — what Hikvision and Dahua
 * devices speak), on top of the guarded outbound request so a device address
 * is checked the same way a webhook URL is. One challenge round: the first
 * request without credentials, the second with the computed response. Basic
 * is answered too, for devices set to it.
 */

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function parseChallenge(header: string) {
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

/** The Authorization header answering a Digest challenge. */
export function digestAuthorization(challenge: string, method: string, uri: string, username: string, password: string, cnonce = randomBytes(8).toString('hex')) {
  const c = parseChallenge(challenge);
  const realm = c.realm || '';
  const nonce = c.nonce || '';
  const algorithm = (c.algorithm || 'MD5').toUpperCase();
  const qop = (c.qop || '').split(',').map((s) => s.trim()).includes('auth') ? 'auth' : '';
  const nc = '00000001';
  let ha1 = md5(`${username}:${realm}:${password}`);
  if (algorithm === 'MD5-SESS') ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    ...(c.opaque ? [`opaque="${c.opaque}"`] : []),
  ];
  return `Digest ${parts.join(', ')}`;
}

/** A request that answers a Digest or Basic challenge with the device's credentials. */
export async function authedRequest(method: string, url: string, username: string, password: string, opts: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<GuardedResponse> {
  const first = await guardedRequest(method, url, opts);
  if (first.status !== 401) return first;
  const challenge = String(first.headers['www-authenticate'] || '');
  const u = new URL(url);
  const uri = `${u.pathname}${u.search}`;
  let authorization: string;
  if (/^digest/i.test(challenge)) authorization = digestAuthorization(challenge, method, uri, username, password);
  else if (/^basic/i.test(challenge) || !challenge) authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  else return first;
  return guardedRequest(method, url, { ...opts, headers: { ...(opts.headers || {}), Authorization: authorization } });
}
