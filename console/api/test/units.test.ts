import { describe, expect, it } from 'vitest';

import { missingSettings, readConfig } from '../src/config.js';
import { blocksConsoleMerge, marksFor, writtenBy } from '../src/marks.js';
import { seal, unseal } from '../src/seal.js';
import { codeAt, verifyCode } from '../src/totp.js';

describe('marks', () => {
  // protects=the path table of the spec, section 6.3; fails_when=a path of one kind is given another mark or none; no_claim=none beyond protects
  it('marks each kind of path', () => {
    expect(marksFor(['server/prisma/platform/migrations/2026_x/migration.sql'])).toEqual(['MIGRATION']);
    expect(marksFor(['.github/workflows/release.yml'])).toEqual(['WORKFLOW']);
    expect(marksFor(['.github/CODEOWNERS'])).toEqual(['WORKFLOW']);
    expect(marksFor(['scripts/release.sh', 'deploy/cloudrun.service.yaml', 'cloudbuild.cloudrun.yaml'])).toEqual(['RELEASE']);
    expect(marksFor(['server/src/middleware/operator.ts', 'server/src/routes/auth.ts'])).toEqual(['ACCESS']);
    expect(marksFor(['console/api/src/app.ts'])).toEqual(['ACCESS']);
    expect(marksFor(['apps/accounting/src/App.jsx'])).toEqual(['BOOKS']);
    expect(marksFor(['apps/people/src/Home.jsx', 'scripts/release-notes.mjs', 'docs/x.md'])).toEqual([]);
  });

  // protects=which marks keep a pull request out of the Console's merge; fails_when=Migration or Books blocks, or Workflow, Release or Access does not; no_claim=none beyond protects
  it('blocks a Console merge for workflow, release and access only', () => {
    expect(blocksConsoleMerge(['MIGRATION', 'BOOKS'])).toBe(false);
    for (const m of ['WORKFLOW', 'RELEASE', 'ACCESS'] as const) expect(blocksConsoleMerge([m])).toBe(true);
  });

  // protects=who a pull request is said to be written by; fails_when=an agent branch reads as a person or Dependabot as an agent; no_claim=a person can name a branch claude/, so this is a label, not proof
  it('tells an agent, Dependabot and a person apart', () => {
    expect(writtenBy('claude/x', 'suresh-3333', false)).toBe('AGENT');
    expect(writtenBy('dependabot/npm_and_yarn/vite', 'dependabot', true)).toBe('DEPENDABOT');
    expect(writtenBy('ui-audit-fixes', 'suresh-3333', false)).toBe('PERSON');
  });
});

describe('sealing and codes', () => {
  // protects=a sealed value opens only with the same secret and purpose, and not if altered; fails_when=a session opens as an authenticator secret, or a tampered value opens; no_claim=none beyond protects
  it('opens only what it sealed, for the purpose it was sealed for', () => {
    const sealed = seal('k'.repeat(40), 'session', { uid: '1' });
    expect(unseal('k'.repeat(40), 'session', sealed)).toEqual({ uid: '1' });
    expect(unseal('k'.repeat(40), 'totp', sealed)).toBeNull();
    expect(unseal('j'.repeat(40), 'session', sealed)).toBeNull();
    expect(unseal('k'.repeat(40), 'session', `${sealed.slice(0, -2)}AA`)).toBeNull();
    expect(unseal('k'.repeat(40), 'session', 'garbage')).toBeNull();
  });

  // protects=the codes match RFC 6238's published SHA-1 test values; fails_when=the arithmetic drifts from what authenticator apps compute; no_claim=none beyond protects
  it('computes the RFC 6238 test codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(codeAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(verifyCode(secret, '287082', null, 59_000)).toBe(1);
    expect(verifyCode(secret, '287082', 1, 59_000)).toBeNull();
    expect(verifyCode(secret, '28708', null, 59_000)).toBeNull();
  });
});

describe('settings', () => {
  // protects=the Console starts only when somebody can get in as an owner, with any one sign-in method, and names what is missing otherwise; no method is required in particular; fails_when=it starts with no owner, demands GitHub, or accepts half-set GitHub; no_claim=index.ts acting on the list is not run here
  it('needs a session secret, a database and a first owner, by any sign-in method', () => {
    const base = { CONSOLE_SESSION_SECRET: 's'.repeat(32), CONSOLE_DATABASE_URL: 'x' };
    const github = { CONSOLE_GITHUB_APP_ID: '1', CONSOLE_GITHUB_PRIVATE_KEY: 'k', CONSOLE_GITHUB_INSTALLATION_ID: '1', CONSOLE_GITHUB_CLIENT_ID: 'c', CONSOLE_GITHUB_CLIENT_SECRET: 's' };
    const password = { CONSOLE_OWNER_EMAILS: 'Owner@Clor.in', CONSOLE_OWNER_SETUP_CODE: 'a-long-setup-code-123' };
    expect(missingSettings(readConfig({ CONSOLE_SESSION_SECRET: 'short' }))).toEqual(expect.arrayContaining(['CONSOLE_SESSION_SECRET', 'CONSOLE_DATABASE_URL']));
    expect(missingSettings(readConfig(base)).join()).toMatch(/a first owner/);
    expect(missingSettings(readConfig({ ...base, ...password }))).toEqual([]);
    expect(missingSettings(readConfig({ ...base, ...github, CONSOLE_OWNER_GITHUB_IDS: '1' }))).toEqual([]);
    expect(missingSettings(readConfig({ ...base, ...github })).join()).toMatch(/a first owner/);
    expect(missingSettings(readConfig({ ...base, ...password, CONSOLE_OWNER_SETUP_CODE: 'short' })).join()).toMatch(/a first owner/);
    expect(missingSettings(readConfig({ ...base, ...password, CONSOLE_GITHUB_APP_ID: '1' })).join()).toMatch(/all five CONSOLE_GITHUB/);
    expect(readConfig({ ...password }).ownerEmails).toEqual(['owner@clor.in']);
  });
});
