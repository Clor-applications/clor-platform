import type { Config } from './config.js';

export interface ServiceState {
  serving: Array<{ revision: string; percent: number }>;
  /** Newest first. `tags` are the Cloud Run traffic tags on the revision, e.g. rel-1a2b3c4. */
  revisions: Array<{ name: string; createdAt: string; image: string; tags: string[] }>;
}

export interface PagesState {
  commit: string;
  createdAt: string;
  url: string;
}

/**
 * Everything the Console reads from Google Cloud and Cloudflare. Reads only:
 * its service account holds viewer roles and its Cloudflare token is
 * read-only, so there is nothing here that could change production even if
 * this code were wrong.
 */
export interface Cloud {
  service(name: string): Promise<ServiceState>;
  ready(): Promise<{ ok: boolean; status: number }>;
  lastBackup(): Promise<{ status: string; endedAt: string } | null>;
  lastMigration(): Promise<{ ok: boolean; endedAt: string } | null>;
  pages(project: string): Promise<PagesState | null>;
}

const short = (name: string) => name.split('/').pop() || name;

export function realCloud(config: Config, fetcher: typeof fetch = fetch): Cloud {
  const { project, region } = config.gcp;
  let token: { value: string; expiresAt: number } | null = null;

  async function gcpToken() {
    if (token && token.expiresAt - Date.now() > 60_000) return token.value;
    const res = await fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Google Cloud gave no token (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return token.value;
  }
  async function gcp(url: string) {
    const res = await fetcher(url, { headers: { authorization: `Bearer ${await gcpToken()}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Google Cloud answered ${res.status}`);
    return res.json() as Promise<any>;
  }
  const run = `https://run.googleapis.com/v2/projects/${project}/locations/${region}`;

  return {
    async service(name) {
      const [svc, revs] = await Promise.all([gcp(`${run}/services/${name}`), gcp(`${run}/services/${name}/revisions?pageSize=15`)]);
      const statuses: any[] = svc.trafficStatuses || [];
      const tagsOf = (revision: string) => statuses.filter((t) => t.tag && short(t.revision || '') === revision).map((t) => t.tag as string);
      return {
        serving: statuses.filter((t) => (t.percent || 0) > 0).map((t) => ({ revision: short(t.revision || svc.latestReadyRevision || ''), percent: t.percent })).sort((a, b) => b.percent - a.percent),
        revisions: (revs.revisions || []).map((r: any) => ({ name: short(r.name), createdAt: r.createTime, image: r.containers?.[0]?.image || '', tags: tagsOf(short(r.name)) })),
      };
    },
    async ready() {
      const res = await fetcher(config.readyUrl, { signal: AbortSignal.timeout(10000) });
      return { ok: res.status === 200, status: res.status };
    },
    async lastBackup() {
      const j = await gcp(`https://sqladmin.googleapis.com/v1/projects/${project}/instances/${config.gcp.sqlInstance}/backupRuns?maxResults=1`);
      const b = j.items?.[0];
      return b ? { status: b.status, endedAt: b.endTime || b.startTime } : null;
    },
    async lastMigration() {
      const j = await gcp(`${run}/jobs/${config.gcp.migrateJob}/executions?pageSize=1`);
      const e = j.executions?.[0];
      return e ? { ok: (e.succeededCount || 0) > 0 && !(e.failedCount > 0), endedAt: e.completionTime || e.createTime } : null;
    },
    async pages(projectName) {
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
