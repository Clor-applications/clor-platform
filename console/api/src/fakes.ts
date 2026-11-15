import type { Cloud, ServiceState } from './cloud.js';
import type { GitHub, Pull, Run } from './github.js';

/**
 * Canned answers standing in for GitHub and the cloud: for the tests, and for
 * looking at the screens on a laptop (CONSOLE_DEV_FAKES=1). Every write is
 * recorded in `calls` and changes nothing anywhere. index.ts refuses to use
 * this file in production.
 */
const HEAD = 'c5fbc8eb1a2b3c4d5e6f708192a3b4c5d6e7f809';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const samplePull = (over: Partial<Pull> = {}): Pull => ({
  number: 301,
  title: 'People: leave balance on the profile',
  url: 'https://github.com/Clor-applications/clor-platform/pull/301',
  body: 'Shows the leave balance on the profile page.',
  draft: false,
  branch: 'claude/leave-balance',
  headSha: 'aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1',
  author: 'suresh-3333',
  authorIsBot: false,
  additions: 120,
  deletions: 14,
  changedFiles: 4,
  files: ['apps/people/src/Profile.jsx', 'apps/people/src/profile.test.jsx'],
  filesTruncated: false,
  labels: [],
  createdAt: hoursAgo(30),
  pushedAt: hoursAgo(3),
  checks: 'GREEN',
  ...over,
});

export const sampleRun = (over: Partial<Run> = {}): Run => ({
  id: 9001,
  workflow: 'ci.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  headSha: HEAD,
  title: 'CI',
  actor: 'suresh-3333',
  createdAt: hoursAgo(2),
  updatedAt: hoursAgo(1.5),
  url: 'https://github.com/Clor-applications/clor-platform/actions/runs/9001',
  ...over,
});

export interface FakeGitHub extends GitHub {
  calls: Array<{ what: string; args: unknown[] }>;
  state: { head: string; pulls: Pull[]; ci: Run[]; release: Run[]; down: boolean; failWrites: boolean; users: Record<string, string>; pending: Record<number, Array<{ environmentId: number; environment: string; canApprove: boolean }>> };
}

export function fakeGitHub(): FakeGitHub {
  const state: FakeGitHub['state'] = {
    head: HEAD,
    pulls: [
      samplePull(),
      samplePull({ number: 302, title: 'Release script: retry the ready check', branch: 'claude/release-retry', files: ['scripts/release.sh'], changedFiles: 1, additions: 8, deletions: 2, headSha: 'bbbbbbb2bbbbbbb2bbbbbbb2bbbbbbb2bbbbbbb2' }),
      samplePull({ number: 303, title: 'Bump vite from 8.2.1 to 8.3.8', branch: 'dependabot/npm_and_yarn/vite-8.3.8', author: 'dependabot', authorIsBot: true, files: ['package.json', 'package-lock.json'], checks: 'RED', headSha: 'ccccccc3ccccccc3ccccccc3ccccccc3ccccccc3', createdAt: hoursAgo(90), pushedAt: hoursAgo(90) }),
      samplePull({ number: 304, title: 'Attendance: shift swap approvals', branch: 'claude/shift-swaps', files: ['apps/attendance/src/Swaps.jsx', 'server/prisma/people/migrations/20261114_swaps/migration.sql'], changedFiles: 9, additions: 410, deletions: 22, checks: 'RUNNING', headSha: 'ddddddd4ddddddd4ddddddd4ddddddd4ddddddd4', createdAt: hoursAgo(6), pushedAt: hoursAgo(0.2) }),
    ],
    ci: [sampleRun(), sampleRun({ id: 9000, event: 'schedule', headSha: 'e'.repeat(40), createdAt: hoursAgo(9), updatedAt: hoursAgo(8) })],
    release: [sampleRun({ id: 8000, workflow: 'release.yml', title: 'Release go rel-8a8ed97', headSha: '8a8ed97a00000000000000000000000000000000', createdAt: hoursAgo(26), updatedAt: hoursAgo(25.7) })],
    down: false,
    failWrites: false,
    users: { 'suresh-3333': '1001', 'dev-engineer': '1002', 'dev-viewer': '1003' },
    pending: {},
  };
  const calls: FakeGitHub['calls'] = [];
  const up = () => {
    if (state.down) throw new Error('GitHub could not be reached');
  };
  const write = (what: string, ...args: unknown[]) => {
    up();
    if (state.failWrites) throw new Error('GitHub answered 500');
    calls.push({ what, args });
  };
  return {
    calls,
    state,
    authorizeUrl: (s) => `https://github.example/authorize?state=${s}`,
    async exchangeCode(code) {
      up();
      return { token: `token-for-${code}`, expiresAt: Date.now() + 8 * 3600_000 };
    },
    async whoAmI(token) {
      up();
      const login = token.replace('token-for-', '');
      return { id: state.users[login] || '9999', login };
    },
    async userByLogin(login) {
      up();
      return state.users[login] ? { id: state.users[login], login } : null;
    },
    async mainHead() {
      up();
      return { sha: state.head, message: 'Merge pull request #269 from Clor-applications/claude/web-guidelines-fixes', date: hoursAgo(4) };
    },
    async openPulls() {
      up();
      return state.pulls.map((p) => ({ ...p }));
    },
    async runs(workflow) {
      up();
      if (workflow === 'ci.yml') return state.ci;
      if (workflow === 'release.yml') return state.release;
      if (workflow === 'security.yml') return [sampleRun({ id: 7000, workflow, event: 'schedule' })];
      return [];
    },
    async runSteps() {
      up();
      return ['2. Back up the database', '3. Build the API image', '4. Apply the migrations, in their own job', '5. Start it on Cloud Run with no traffic', '6. Tag the revision', '7. Is it ready?'].map((name, i) => ({ job: 'release', name, status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'queued', conclusion: i < 3 ? 'success' : null }));
    },
    async pendingDeployments(runId) {
      up();
      return state.pending[runId] || [];
    },
    async releaseTags() {
      up();
      return [
        { name: 'rel-8a8ed97', sha: '8a8ed97a00000000000000000000000000000000', date: hoursAgo(26), by: 'suresh-3333', message: 'Release rel-8a8ed97: Cloud Run revision clor-api-00131-abc' },
        { name: 'rel-70e780f', sha: '70e780f300000000000000000000000000000000', date: hoursAgo(50), by: 'suresh-3333', message: 'Release rel-70e780f: Cloud Run revision clor-api-00127-622' },
      ];
    },
    async waitingSince() {
      up();
      return { commits: 4, pulls: [{ number: 269, title: 'clor.in: Web Interface Guidelines fixes' }, { number: 268, title: 'Outbox: log failures' }], files: ['website/src/pages/Pages.jsx', 'server/src/services/outbox.ts'], filesTruncated: false };
    },
    async dispatch(_t, workflow, inputs) {
      write('dispatch', workflow, inputs);
    },
    async approveRun(_t, runId, environmentIds, comment) {
      write('approveRun', runId, environmentIds, comment);
    },
    async addLabel(_t, pull, label) {
      write('addLabel', pull, label);
    },
    async merge(_t, pull, headSha) {
      write('merge', pull, headSha);
    },
    async close(_t, pull, comment) {
      write('close', pull, comment);
    },
  };
}

export interface FakeCloud extends Cloud {
  state: { down: boolean; service: ServiceState };
}

export function fakeCloud(): FakeCloud {
  const state: FakeCloud['state'] = {
    down: false,
    service: {
      serving: [{ revision: 'clor-api-00131-abc', percent: 100 }],
      revisions: [
        { name: 'clor-api-00131-abc', createdAt: hoursAgo(26), image: 'asia-south1-docker.pkg.dev/p/clor/api:8a8ed97', tags: ['rel-8a8ed97'] },
        { name: 'clor-api-00127-622', createdAt: hoursAgo(50), image: 'asia-south1-docker.pkg.dev/p/clor/api:70e780f', tags: ['rel-70e780f'] },
        { name: 'clor-api-00120-xyz', createdAt: hoursAgo(98), image: 'asia-south1-docker.pkg.dev/p/clor/api:ec503eb', tags: [] },
      ],
    },
  };
  const up = () => {
    if (state.down) throw new Error('Google Cloud could not be reached');
  };
  return {
    state,
    async service(name) {
      up();
      return name.endsWith('staging') ? { serving: [{ revision: 'clor-api-staging-00044-qrs', percent: 100 }], revisions: [{ name: 'clor-api-staging-00044-qrs', createdAt: hoursAgo(5), image: 'api:c5fbc8e', tags: [] }] } : state.service;
    },
    async ready() {
      up();
      return { ok: true, status: 200 };
    },
    async lastBackup() {
      up();
      return { status: 'SUCCESSFUL', endedAt: hoursAgo(7) };
    },
    async lastMigration() {
      up();
      return { ok: true, endedAt: hoursAgo(26) };
    },
    async pages(project) {
      up();
      return { commit: '8a8ed97a00000000000000000000000000000000', createdAt: hoursAgo(25.5), url: `https://${project}.pages.dev` };
    },
  };
}
