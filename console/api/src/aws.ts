import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Cloud, PagesState, ServiceState } from './cloud.js';
import type { Config } from './config.js';

/**
 * The Console's reads on AWS, where the API has run since 23 Nov 2026
 * (deploy/aws). Reads only, as on Google Cloud:
 *
 *  - which releases exist: the image store (ECR), one image per release,
 *    tagged with seven characters of its commit;
 *  - which one is serving, and how the last migration went: two small files
 *    the server's own release script writes (deploy/aws/clor-server.sh,
 *    state/serving.json and state/migration.json), mounted read-only here;
 *  - the database's backups: RDS, the latest moment it can be restored to.
 *
 * The Console runs on the API server itself, so it signs its requests with
 * the server's role (instance metadata) and needs no key of its own. Signing
 * is done here, by hand, to keep the Console's dependencies to what they were.
 */

type Fetcher = typeof fetch;
interface Keys { accessKeyId: string; secretAccessKey: string; token: string; expiresAt: number }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();

/** AWS Signature Version 4 for one request. Exported for the tests. */
export function sign(opts: { method: string; url: string; service: string; region: string; headers: Record<string, string>; body: string; keys: Pick<Keys, 'accessKeyId' | 'secretAccessKey' | 'token'>; now?: Date }): Record<string, string> {
  const u = new URL(opts.url);
  const stamp = (opts.now || new Date()).toISOString().replace(/[-:]|\.\d{3}/g, ''); // 20261124T101500Z
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = { ...opts.headers, host: u.host, 'x-amz-date': stamp };
  if (opts.keys.token) headers['x-amz-security-token'] = opts.keys.token;
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const query = [...u.searchParams.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort().join('&');
  const canonical = [opts.method, u.pathname || '/', query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), sha256(opts.body)].join('\n');
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${opts.keys.secretAccessKey}`, day), opts.region), opts.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${opts.keys.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

const METADATA = 'http://169.254.169.254/latest';

export function awsCloud(config: Config, fetcher: Fetcher = fetch, read: (file: string) => Promise<string> = (f) => readFile(f, 'utf8')): Cloud {
  const { region, repository, dbInstance, stateDir } = config.aws;
  let keys: Keys | null = null;

  async function serverKeys(): Promise<Keys> {
    if (keys && keys.expiresAt - Date.now() > 5 * 60_000) return keys;
    const t = await fetcher(`${METADATA}/api/token`, { method: 'PUT', headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '300' }, signal: AbortSignal.timeout(3000) });
    if (!t.ok) throw new Error(`The server gave no sign-in token (${t.status})`);
    const h = { 'x-aws-ec2-metadata-token': await t.text() };
    const role = await fetcher(`${METADATA}/meta-data/iam/security-credentials/`, { headers: h, signal: AbortSignal.timeout(3000) });
    if (!role.ok) throw new Error(`The server has no role (${role.status})`);
    const name = (await role.text()).trim().split('\n')[0];
    const c = await fetcher(`${METADATA}/meta-data/iam/security-credentials/${name}`, { headers: h, signal: AbortSignal.timeout(3000) });
    if (!c.ok) throw new Error(`The server gave no keys (${c.status})`);
    const j = (await c.json()) as { AccessKeyId: string; SecretAccessKey: string; Token: string; Expiration: string };
    keys = { accessKeyId: j.AccessKeyId, secretAccessKey: j.SecretAccessKey, token: j.Token, expiresAt: Date.parse(j.Expiration) };
    return keys;
  }

  async function aws(service: string, method: string, url: string, headers: Record<string, string>, body = ''): Promise<Response> {
    const signed = sign({ method, url, service, region, headers, body, keys: await serverKeys() });
    const { host: _host, ...send } = signed; // fetch sets Host itself
    const res = await fetcher(url, { method, headers: send, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`AWS answered ${res.status}`);
    return res;
  }

  async function state<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await read(path.join(stateDir, name))) as T;
    } catch {
      return null; // not written yet: nothing released or migrated through the script so far
    }
  }

  return {
    /* One "revision" per image in the store. Its name is the image's tag; rel-<tag> is how the Console names a release. */
    async service(): Promise<ServiceState> {
      const res = await aws('ecr', 'POST', `https://api.ecr.${region}.amazonaws.com/`, { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AmazonEC2ContainerRegistry_V20150921.DescribeImages' }, JSON.stringify({ repositoryName: repository, maxResults: 100 }));
      const j = (await res.json()) as { imageDetails?: Array<{ imageTags?: string[]; imagePushedAt?: number }> };
      const revisions = (j.imageDetails || [])
        .flatMap((d) => (d.imageTags || []).map((tag) => ({ name: tag, createdAt: new Date((d.imagePushedAt || 0) * 1000).toISOString(), image: `${repository}:${tag}`, tags: [`rel-${tag}`] })))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 15);
      const now = await state<{ tag: string }>('serving.json');
      return { serving: now?.tag ? [{ revision: now.tag, percent: 100 }] : [], revisions };
    },
    async ready() {
      const res = await fetcher(config.readyUrl, { signal: AbortSignal.timeout(10000) });
      return { ok: res.status === 200, status: res.status };
    },
    /* RDS backs up continuously; the latest moment it can restore to says the backups are arriving. */
    async lastBackup() {
      const res = await aws('rds', 'GET', `https://rds.${region}.amazonaws.com/?Action=DescribeDBInstances&DBInstanceIdentifier=${encodeURIComponent(dbInstance)}&Version=2014-10-31`, {});
      const xml = await res.text();
      const at = /<LatestRestorableTime>([^<]+)<\/LatestRestorableTime>/.exec(xml)?.[1];
      if (!at) return null;
      const fresh = Date.now() - Date.parse(at) < 60 * 60_000;
      return { status: fresh ? 'SUCCESSFUL' : 'STALE', endedAt: at };
    },
    async lastMigration() {
      const m = await state<{ ok: boolean; endedAt: string }>('migration.json');
      return m ? { ok: Boolean(m.ok), endedAt: m.endedAt } : null;
    },
    async pages(projectName): Promise<PagesState | null> {
      if (!config.cloudflare.accountId || !config.cloudflare.token) throw new Error('Cloudflare is not connected to the Console yet.');
      const res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/pages/projects/${projectName}/deployments?env=production&per_page=1`, {
        headers: { authorization: `Bearer ${config.cloudflare.token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Cloudflare answered ${res.status}`);
      const j = (await res.json()) as { result?: any[] };
      const d = j.result?.[0];
      return d ? { commit: d.deployment_trigger?.metadata?.commit_hash || '', createdAt: d.created_on, url: d.url } : null;
    },
  };
}
