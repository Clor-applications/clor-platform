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
  /** When set, every request but /api/health must carry it in x-console-edge: only Cloudflare's forwarder does. */
  edgeSecret: string;
  ownerGithubIds: string[];
  /**
   * Sign-in with an email address and password. The first owners are named
   * here by address; each chooses a password once with `ownerSetupCode`.
   */
  ownerEmails: string[];
  ownerSetupCode: string;
  /** CLOR staff logins that are owners from their first CLOR sign-in, by address. Bound to the CLOR user id then. */
  ownerClorEmails: string[];
  databaseUrl: string;
  github: { owner: string; repo: string; appId: string; privateKey: string; installationId: string; clientId: string; clientSecret: string };
  /** Where the API runs: `aws` since 23 Nov 2026 (deploy/aws); `gcp` is Cloud Run, as before. */
  cloud: 'aws' | 'gcp';
  gcp: { project: string; region: string; service: string; stagingService: string; migrateJob: string; sqlInstance: string };
  /** `stateDir` holds serving.json and migration.json, written by deploy/aws/clor-server.sh on the server. */
  aws: { region: string; repository: string; dbInstance: string; stateDir: string };
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
    edgeSecret: env.CONSOLE_EDGE_SECRET || '',
    ownerGithubIds: list(env.CONSOLE_OWNER_GITHUB_IDS),
    ownerEmails: list(env.CONSOLE_OWNER_EMAILS).map((e) => e.toLowerCase()),
    ownerSetupCode: env.CONSOLE_OWNER_SETUP_CODE || '',
    ownerClorEmails: list(env.CONSOLE_OWNER_CLOR_EMAILS).map((e) => e.toLowerCase()),
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
    cloud: env.CONSOLE_CLOUD === 'aws' ? 'aws' : 'gcp',
    aws: {
      region: env.CONSOLE_AWS_REGION || 'ap-south-1',
      repository: env.CONSOLE_AWS_REPOSITORY || 'clor/api',
      dbInstance: env.CONSOLE_AWS_DB_INSTANCE || 'clor-pg',
      stateDir: env.CONSOLE_AWS_STATE_DIR || '/state',
    },
    gcp: {
      project: env.CONSOLE_GCP_PROJECT || 'clor-apps-511409',
      region: env.CONSOLE_GCP_REGION || 'asia-south1',
      service: env.CONSOLE_GCP_SERVICE || 'clor-api',
      /* There is no staging on AWS: empty there, and the Overview leaves the row out. */
      stagingService: env.CONSOLE_CLOUD === 'aws' ? '' : env.CONSOLE_GCP_STAGING_SERVICE || 'clor-api-staging',
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

/** Which outside services are set up. Each is optional; the Console says "not connected" for one that is not. */
export const githubOn = (c: Config) => Boolean(c.github.appId && c.github.privateKey && c.github.installationId && c.github.clientId && c.github.clientSecret);
export const cloudflareOn = (c: Config) => Boolean(c.cloudflare.accountId && c.cloudflare.token);
export const clorOn = (c: Config) => Boolean(c.clor.grantPublicKey);
export const passwordOn = (c: Config) => Boolean(c.ownerEmails.length && c.ownerSetupCode.length >= 16);

/**
 * What is missing for a real start. Empty means ready. No sign-in method is
 * required in particular: GitHub, CLOR login and email with password are each
 * switched on by their own settings. What is required is that somebody can
 * get in as an owner.
 */
export function missingSettings(c: Config): string[] {
  const missing: string[] = [];
  if (c.sessionSecret.length < 32) missing.push('CONSOLE_SESSION_SECRET');
  if (!c.databaseUrl) missing.push('CONSOLE_DATABASE_URL');
  const byGithub = githubOn(c) && c.ownerGithubIds.length > 0;
  const byClor = clorOn(c) && c.ownerClorEmails.length > 0;
  if (!byGithub && !byClor && !passwordOn(c)) missing.push('a first owner: CONSOLE_OWNER_EMAILS with CONSOLE_OWNER_SETUP_CODE (16 characters or more), or CONSOLE_OWNER_CLOR_EMAILS with CONSOLE_CLOR_GRANT_PUBLIC_KEY, or the CONSOLE_GITHUB_* settings with CONSOLE_OWNER_GITHUB_IDS');
  /* Half-set GitHub is a mistake, not "off". */
  const g = c.github;
  const some = [g.appId, g.privateKey, g.installationId, g.clientId, g.clientSecret].filter(Boolean).length;
  if (some > 0 && some < 5) missing.push('all five CONSOLE_GITHUB_* settings, or none');
  return missing;
}
