/**
 * Every setting the Console reads, in one place. Nothing here is a default
 * that could pass for a real value in production: a missing setting stops the
 * start (index.ts), it does not fall back.
 */
export interface Config {
  port: number;
  production: boolean;
  /** Local preview only: canned GitHub and cloud answers, and a sign-in without GitHub. Refused in production. */
  devFakes: boolean;
  webOrigin: string;
  /** Where this API is reached from a browser. Its routes all sit under /api. */
  apiOrigin: string;
  sessionSecret: string;
  ownerGithubIds: string[];
  databaseUrl: string;
  github: { owner: string; repo: string; appId: string; privateKey: string; installationId: string; clientId: string; clientSecret: string };
  gcp: { project: string; region: string; service: string; stagingService: string; migrateJob: string; sqlInstance: string };
  cloudflare: { accountId: string; token: string; webProject: string; siteProject: string };
  /** Sign-in with a CLOR staff login. Off until the public key is set. */
  clor: { opsOrigin: string; grantPublicKey: string };
  readyUrl: string;
  workflows: { ci: string; release: string; rollback: string };
}

const list = (v: string | undefined) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT || 4010),
    production: env.NODE_ENV === 'production',
    devFakes: env.CONSOLE_DEV_FAKES === '1',
    webOrigin: env.CONSOLE_WEB_ORIGIN || 'http://127.0.0.1:5191',
    apiOrigin: env.CONSOLE_API_ORIGIN || env.CONSOLE_WEB_ORIGIN || 'http://127.0.0.1:5191',
    sessionSecret: env.CONSOLE_SESSION_SECRET || '',
    ownerGithubIds: list(env.CONSOLE_OWNER_GITHUB_IDS),
    databaseUrl: env.CONSOLE_DATABASE_URL || '',
    github: {
      owner: env.CONSOLE_GITHUB_OWNER || 'Clor-applications',
      repo: env.CONSOLE_GITHUB_REPO || 'clor-platform',
      appId: env.CONSOLE_GITHUB_APP_ID || '',
      privateKey: (env.CONSOLE_GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      installationId: env.CONSOLE_GITHUB_INSTALLATION_ID || '',
      clientId: env.CONSOLE_GITHUB_CLIENT_ID || '',
      clientSecret: env.CONSOLE_GITHUB_CLIENT_SECRET || '',
    },
    gcp: {
      project: env.CONSOLE_GCP_PROJECT || 'clor-apps-511409',
      region: env.CONSOLE_GCP_REGION || 'asia-south1',
      service: env.CONSOLE_GCP_SERVICE || 'clor-api',
      stagingService: env.CONSOLE_GCP_STAGING_SERVICE || 'clor-api-staging',
      migrateJob: env.CONSOLE_GCP_MIGRATE_JOB || 'clor-api-migrate',
      sqlInstance: env.CONSOLE_GCP_SQL_INSTANCE || 'clor-pg',
    },
    cloudflare: {
      accountId: env.CONSOLE_CF_ACCOUNT_ID || '',
      token: env.CONSOLE_CF_READ_TOKEN || '',
      webProject: env.CONSOLE_CF_WEB_PROJECT || 'clor-app',
      siteProject: env.CONSOLE_CF_SITE_PROJECT || 'clor',
    },
    clor: { opsOrigin: env.CONSOLE_CLOR_OPS_ORIGIN || 'https://ops.clor.in', grantPublicKey: (env.CONSOLE_CLOR_GRANT_PUBLIC_KEY || '').replace(/\\n/g, '\n') },
    readyUrl: env.CONSOLE_READY_URL || 'https://api.clor.in/ready',
    workflows: { ci: 'ci.yml', release: 'release.yml', rollback: 'rollback.yml' },
  };
}

/** What is missing for a real start. Empty means ready. */
export function missingSettings(c: Config): string[] {
  const need: Array<[string, string]> = [
    ['CONSOLE_SESSION_SECRET', c.sessionSecret.length >= 32 ? 'ok' : ''],
    ['CONSOLE_OWNER_GITHUB_IDS', c.ownerGithubIds.join(',')],
    ['CONSOLE_DATABASE_URL', c.databaseUrl],
    ['CONSOLE_GITHUB_APP_ID', c.github.appId],
    ['CONSOLE_GITHUB_PRIVATE_KEY', c.github.privateKey],
    ['CONSOLE_GITHUB_INSTALLATION_ID', c.github.installationId],
    ['CONSOLE_GITHUB_CLIENT_ID', c.github.clientId],
    ['CONSOLE_GITHUB_CLIENT_SECRET', c.github.clientSecret],
    ['CONSOLE_CF_ACCOUNT_ID', c.cloudflare.accountId],
    ['CONSOLE_CF_READ_TOKEN', c.cloudflare.token],
  ];
  return need.filter(([, v]) => !v).map(([k]) => k);
}
