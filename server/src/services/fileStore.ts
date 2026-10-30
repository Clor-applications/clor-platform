import { createHash, createHmac } from 'node:crypto';

/**
 * Where people's files live (GAP-012, R2 plan: tenant-platform-upgrade-2026-10-23/2026-10-24-r2-file-storage-plan.md).
 *
 *   FILE_STORE unset or `db` — in the database row, as before.
 *   FILE_STORE=r2            — a private Cloudflare R2 bucket (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *                              R2_SECRET_ACCESS_KEY, R2_BUCKET), spoken to over the S3 API.
 *   FILE_STORE=memory        — in this process; the test suite runs on it so every suite that
 *                              touches a file goes through the same path production does.
 *
 * Every key is `org/<orgId>/<kind>/<id>`, and the store refuses any key outside
 * the company asked for: a wrong id can never reach another company's file.
 * Nothing here makes a public or presigned URL; files leave only through the
 * API routes that check company and person (GAP-012).
 */

export type FileKind = 'employee-documents' | 'punch-photos' | 'compliance-evidence' | 'expense-bills';

export interface FileStore {
  readonly name: 'r2' | 'memory';
  put(orgId: string, key: string, bytes: Buffer, mime?: string): Promise<void>;
  get(orgId: string, key: string): Promise<Buffer | null>;
  delete(orgId: string, key: string): Promise<void>;
  /** Every key under the company's prefix (for the orphan check and closure). */
  list(orgId: string): Promise<string[]>;
  deleteAll(orgId: string): Promise<number>;
}

export const prefixOf = (orgId: string) => `org/${orgId}/`;
export const keyFor = (orgId: string, kind: FileKind, id: string) => `${prefixOf(orgId)}${kind}/${id}`;

export class FileStoreError extends Error {}

function guard(orgId: string, key: string) {
  if (!orgId || !key.startsWith(prefixOf(orgId)) || key.includes('..')) {
    throw new FileStoreError(`File key outside company ${orgId || '(none)'}.`);
  }
}

/* ------------------------------------------------------------------ memory */

const memory = new Map<string, Buffer>();
const memoryStore: FileStore = {
  name: 'memory',
  async put(orgId, key, bytes) {
    guard(orgId, key);
    memory.set(key, Buffer.from(bytes));
  },
  async get(orgId, key) {
    guard(orgId, key);
    const b = memory.get(key);
    return b ? Buffer.from(b) : null;
  },
  async delete(orgId, key) {
    guard(orgId, key);
    memory.delete(key);
  },
  async list(orgId) {
    return [...memory.keys()].filter((k) => k.startsWith(prefixOf(orgId)));
  },
  async deleteAll(orgId) {
    const keys = await this.list(orgId);
    keys.forEach((k) => memory.delete(k));
    return keys.length;
  },
};

/* ---------------------------------------------------------------------- r2 */

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();
/** RFC 3986, as SigV4 wants: everything but unreserved characters encoded. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

type R2Config = { accountId: string; accessKeyId: string; secret: string; bucket: string };

/** AWS Signature Version 4 for one request: the Authorization header value. Pure, so it is tested against AWS's own example. */
export function sigv4(r: { method: string; host: string; path: string; query?: string; headers: Record<string, string>; payloadHash: string; amzDate: string; region: string; service: string; accessKeyId: string; secret: string }) {
  const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: r.host };
  const signed = Object.keys(headers).sort();
  const canonical = [r.method, r.path, r.query || '', signed.map((h) => `${h}:${headers[h]}\n`).join(''), signed.join(';'), r.payloadHash].join('\n');
  const day = r.amzDate.slice(0, 8);
  const scope = `${day}/${r.region}/${r.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', r.amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${r.secret}`, day), r.region), r.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${r.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
}

/** One signed S3 request to R2 (region `auto`). */
async function r2Request(c: R2Config, method: string, key: string, opts: { query?: Record<string, string>; body?: Buffer; contentType?: string } = {}) {
  const host = `${c.accountId}.r2.cloudflarestorage.com`;
  const path = `/${enc(c.bucket)}${key ? `/${key.split('/').map(enc).join('/')}` : ''}`;
  const query = Object.entries(opts.query || {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  const body = opts.body ?? Buffer.alloc(0);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(opts.contentType ? { 'content-type': opts.contentType } : {}) };
  const authorization = sigv4({ method, host, path, query, headers, payloadHash, amzDate, region: 'auto', service: 's3', accessKeyId: c.accessKeyId, secret: c.secret });
  return fetch(`https://${host}${path}${query ? `?${query}` : ''}`, {
    method,
    headers: { ...headers, authorization },
    body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : new Uint8Array(body),
  });
}

function r2Store(c: R2Config): FileStore {
  const fail = async (what: string, r: Response) => {
    throw new FileStoreError(`R2 ${what} failed: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  };
  const store: FileStore = {
    name: 'r2',
    async put(orgId, key, bytes, mime) {
      guard(orgId, key);
      const r = await r2Request(c, 'PUT', key, { body: bytes, contentType: mime || 'application/octet-stream' });
      if (!r.ok) await fail('put', r);
    },
    async get(orgId, key) {
      guard(orgId, key);
      const r = await r2Request(c, 'GET', key);
      if (r.status === 404) return null;
      if (!r.ok) await fail('get', r);
      return Buffer.from(await r.arrayBuffer());
    },
    async delete(orgId, key) {
      guard(orgId, key);
      const r = await r2Request(c, 'DELETE', key);
      if (!r.ok && r.status !== 404) await fail('delete', r);
    },
    async list(orgId) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const r = await r2Request(c, 'GET', '', { query: { 'list-type': '2', prefix: prefixOf(orgId), ...(token ? { 'continuation-token': token } : {}) } });
        if (!r.ok) await fail('list', r);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] : undefined;
      } while (token);
      return keys;
    },
    async deleteAll(orgId) {
      const keys = await store.list(orgId);
      for (const k of keys) await store.delete(orgId, k);
      return keys.length;
    },
  };
  return store;
}

/* ------------------------------------------------------------------ choose */

let cached: { mode: string; store: FileStore | null } | null = null;

/** The configured store, or null when files stay in the database. */
export function fileStore(): FileStore | null {
  const mode = String(process.env.FILE_STORE || 'db').toLowerCase();
  if (cached?.mode === mode) return cached.store;
  let store: FileStore | null = null;
  if (mode === 'memory') store = memoryStore;
  if (mode === 'r2') {
    const c = { accountId: process.env.R2_ACCOUNT_ID || '', accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secret: process.env.R2_SECRET_ACCESS_KEY || '', bucket: process.env.R2_BUCKET || '' };
    const missing = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new FileStoreError(`FILE_STORE=r2 needs ${missing.join(', ')}.`);
    store = r2Store(c);
  }
  cached = { mode, store };
  return store;
}

/** For tests: forget the chosen store so a changed FILE_STORE takes effect. */
export function resetFileStore() {
  cached = null;
}
