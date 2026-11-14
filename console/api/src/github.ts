import { createSign } from 'node:crypto';

import type { Config } from './config.js';

export type Checks = 'GREEN' | 'RED' | 'RUNNING' | 'NONE';

export interface Pull {
  number: number;
  title: string;
  url: string;
  body: string;
  draft: boolean;
  branch: string;
  headSha: string;
  author: string;
  authorIsBot: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Paths changed. If `filesTruncated`, GitHub listed only the first hundred. */
  files: string[];
  filesTruncated: boolean;
  labels: string[];
  createdAt: string;
  pushedAt: string;
  checks: Checks;
}

export interface Run {
  id: number;
  workflow: string;
  event: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  title: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface RunStep {
  job: string;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface PendingDeployment {
  environmentId: number;
  environment: string;
  canApprove: boolean;
}

export interface ReleaseTag {
  name: string;
  sha: string;
  date: string;
  by: string;
  message: string;
}

export interface Waiting {
  commits: number;
  pulls: Array<{ number: number; title: string }>;
  files: string[];
  filesTruncated: boolean;
}

/**
 * Everything the Console asks of GitHub. Reads go as the GitHub App (its
 * installation on this one repository). Writes go as the signed-in person,
 * with their own token, so GitHub's record names a human and GitHub's own
 * rules for that human still apply.
 */
export interface GitHub {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ token: string; expiresAt: number }>;
  whoAmI(userToken: string): Promise<{ id: string; login: string }>;
  userByLogin(login: string): Promise<{ id: string; login: string } | null>;

  mainHead(): Promise<{ sha: string; message: string; date: string }>;
  openPulls(): Promise<Pull[]>;
  runs(workflow: string, opts?: { branch?: string; perPage?: number }): Promise<Run[]>;
  runSteps(runId: number): Promise<RunStep[]>;
  pendingDeployments(runId: number, userToken: string): Promise<PendingDeployment[]>;
  releaseTags(): Promise<ReleaseTag[]>;
  waitingSince(tag: string | null): Promise<Waiting>;

  dispatch(userToken: string, workflow: string, inputs: Record<string, string>): Promise<void>;
  approveRun(userToken: string, runId: number, environmentIds: number[], comment: string): Promise<void>;
  addLabel(userToken: string, pull: number, label: string): Promise<void>;
  merge(userToken: string, pull: number, headSha: string): Promise<void>;
  close(userToken: string, pull: number, comment: string): Promise<void>;
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const API = 'https://api.github.com';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

const PULLS_QUERY = `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){pullRequests(states:OPEN,first:60,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
  number title url bodyText isDraft headRefName headRefOid additions deletions changedFiles createdAt
  author{login __typename}
  labels(first:20){nodes{name}}
  files(first:100){totalCount nodes{path}}
  commits(last:1){nodes{commit{committedDate pushedDate statusCheckRollup{state}}}}
}}}}`;

const TAGS_QUERY = `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){refs(refPrefix:"refs/tags/",query:"rel-",first:20,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){nodes{
  name target{__typename oid ... on Tag{message tagger{name date} target{oid}} ... on Commit{committedDate messageHeadline author{name}}}
}}}}`;

const rollup = (state: string | undefined): Checks =>
  state === 'SUCCESS' ? 'GREEN' : state === 'FAILURE' || state === 'ERROR' ? 'RED' : state === 'PENDING' || state === 'EXPECTED' ? 'RUNNING' : 'NONE';

export function realGitHub(config: Config, fetcher: typeof fetch = fetch): GitHub {
  const g = config.github;
  const repo = `${API}/repos/${g.owner}/${g.repo}`;
  let installation: { token: string; expiresAt: number } | null = null;

  const appJwt = () => {
    const now = Math.floor(Date.now() / 1000);
    const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: g.appId })}`;
    return `${head}.${createSign('RSA-SHA256').update(head).sign(g.privateKey).toString('base64url')}`;
  };

  async function call(token: string, method: string, url: string, body?: unknown) {
    const res = await fetcher(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'clor-console', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      let message = `GitHub answered ${res.status}`;
      try {
        const j = (await res.json()) as { message?: string };
        if (j.message) message = `${message}: ${j.message}`;
      } catch {
        /* no body */
      }
      throw new GitHubError(res.status, message);
    }
    return res.status === 204 ? null : res.json();
  }

  async function appToken() {
    if (installation && installation.expiresAt - Date.now() > 120_000) return installation.token;
    const j = (await call(appJwt(), 'POST', `${API}/app/installations/${g.installationId}/access_tokens`)) as { token: string; expires_at: string };
    installation = { token: j.token, expiresAt: Date.parse(j.expires_at) };
    return installation.token;
  }
  const read = async (url: string) => call(await appToken(), 'GET', url);
  const graph = async (query: string) => {
    const j = (await call(await appToken(), 'POST', `${API}/graphql`, { query, variables: { owner: g.owner, repo: g.repo } })) as { data?: any; errors?: Array<{ message: string }> };
    if (j.errors?.length || !j.data) throw new GitHubError(502, `GitHub answered: ${j.errors?.[0]?.message || 'no data'}`);
    return j.data.repository;
  };
  const toRun = (workflow: string) => (r: any): Run => ({
    id: r.id,
    workflow,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    headSha: r.head_sha,
    title: r.display_title || r.name || '',
    actor: r.triggering_actor?.login || r.actor?.login || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    url: r.html_url,
  });

  return {
    authorizeUrl: (state) => `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(g.clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(`${config.apiOrigin}/api/auth/callback`)}`,

    async exchangeCode(code) {
      const res = await fetcher('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: g.clientId, client_secret: g.clientSecret, code }),
        signal: AbortSignal.timeout(15000),
      });
      const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
      if (!j.access_token) throw new GitHubError(401, j.error_description || 'GitHub did not sign you in.');
      return { token: j.access_token, expiresAt: Date.now() + (j.expires_in ? j.expires_in * 1000 : 8 * 3600_000) };
    },

    async whoAmI(userToken) {
      const j = (await call(userToken, 'GET', `${API}/user`)) as { id: number; login: string };
      return { id: String(j.id), login: j.login };
    },

    async userByLogin(login) {
      try {
        const j = (await read(`${API}/users/${encodeURIComponent(login)}`)) as { id: number; login: string; type: string };
        return j.type === 'User' ? { id: String(j.id), login: j.login } : null;
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return null;
        throw e;
      }
    },

    async mainHead() {
      const j = (await read(`${repo}/commits/main`)) as any;
      return { sha: j.sha, message: String(j.commit.message).split('\n')[0], date: j.commit.committer.date };
    },

    async openPulls() {
      const r = await graph(PULLS_QUERY);
      return r.pullRequests.nodes.map((p: any): Pull => {
        const last = p.commits.nodes[0]?.commit;
        return {
          number: p.number,
          title: p.title,
          url: p.url,
          body: String(p.bodyText || '').slice(0, 4000),
          draft: p.isDraft,
          branch: p.headRefName,
          headSha: p.headRefOid,
          author: p.author?.login || 'ghost',
          authorIsBot: p.author?.__typename === 'Bot',
          additions: p.additions,
          deletions: p.deletions,
          changedFiles: p.changedFiles,
          files: p.files.nodes.map((f: any) => f.path),
          filesTruncated: p.files.totalCount > p.files.nodes.length,
          labels: p.labels.nodes.map((l: any) => l.name),
          createdAt: p.createdAt,
          pushedAt: last?.pushedDate || last?.committedDate || p.createdAt,
          checks: rollup(last?.statusCheckRollup?.state),
        };
      });
    },

    async runs(workflow, opts = {}) {
      const q = new URLSearchParams({ per_page: String(opts.perPage || 20) });
      if (opts.branch) q.set('branch', opts.branch);
      const j = (await read(`${repo}/actions/workflows/${workflow}/runs?${q}`)) as { workflow_runs: any[] };
      return j.workflow_runs.map(toRun(workflow));
    },

    async runSteps(runId) {
      const j = (await read(`${repo}/actions/runs/${runId}/jobs?per_page=30`)) as { jobs: any[] };
      return j.jobs.flatMap((job) => (job.steps || []).map((s: any): RunStep => ({ job: job.name, name: s.name, status: s.status, conclusion: s.conclusion })));
    },

    async pendingDeployments(runId, userToken) {
      const j = (await call(userToken, 'GET', `${repo}/actions/runs/${runId}/pending_deployments`)) as any[];
      return j.map((d) => ({ environmentId: d.environment.id, environment: d.environment.name, canApprove: Boolean(d.current_user_can_approve) }));
    },

    async releaseTags() {
      const r = await graph(TAGS_QUERY);
      return r.refs.nodes.map((n: any): ReleaseTag =>
        n.target.__typename === 'Tag'
          ? { name: n.name, sha: n.target.target.oid, date: n.target.tagger?.date || '', by: n.target.tagger?.name || '', message: String(n.target.message || '').split('\n')[0] }
          : { name: n.name, sha: n.target.oid, date: n.target.committedDate, by: n.target.author?.name || '', message: n.target.messageHeadline || '' },
      );
    },

    async waitingSince(tag) {
      if (!tag) return { commits: 0, pulls: [], files: [], filesTruncated: false };
      const j = (await read(`${repo}/compare/${encodeURIComponent(tag)}...main?per_page=100`)) as { total_commits: number; commits: any[]; files?: any[] };
      const pulls = j.commits
        .map((c) => {
          const [first, , ...rest] = String(c.commit.message).split('\n');
          const m = /^Merge pull request #(\d+)/.exec(first);
          return m ? { number: Number(m[1]), title: rest.find((l) => l.trim()) || first } : null;
        })
        .filter((p): p is { number: number; title: string } => Boolean(p))
        .reverse();
      const files = (j.files || []).map((f) => f.filename);
      return { commits: j.total_commits, pulls, files, filesTruncated: files.length >= 300 || j.total_commits > j.commits.length };
    },

    async dispatch(userToken, workflow, inputs) {
      await call(userToken, 'POST', `${repo}/actions/workflows/${workflow}/dispatches`, { ref: 'main', inputs });
    },
    async approveRun(userToken, runId, environmentIds, comment) {
      await call(userToken, 'POST', `${repo}/actions/runs/${runId}/pending_deployments`, { environment_ids: environmentIds, state: 'approved', comment });
    },
    async addLabel(userToken, pull, label) {
      await call(userToken, 'POST', `${repo}/issues/${pull}/labels`, { labels: [label] });
    },
    async merge(userToken, pull, headSha) {
      await call(userToken, 'PUT', `${repo}/pulls/${pull}/merge`, { sha: headSha, merge_method: 'merge' });
    },
    async close(userToken, pull, comment) {
      await call(userToken, 'POST', `${repo}/issues/${pull}/comments`, { body: comment });
      await call(userToken, 'PATCH', `${repo}/pulls/${pull}`, { state: 'closed' });
    },
  };
}
