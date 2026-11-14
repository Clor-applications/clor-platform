import { generateKeyPairSync } from 'node:crypto';

import pg from 'pg';

import { createApp } from './app.js';
import { realCloud } from './cloud.js';
import { missingSettings, readConfig } from './config.js';
import { fakeCloud, fakeGitHub } from './fakes.js';
import { realGitHub } from './github.js';
import { memoryStore, pgStore } from './store.js';

const config = readConfig();

if (config.devFakes) {
  if (config.production) {
    console.error('CONSOLE_DEV_FAKES is set in production. The Console will not start with canned answers and a sign-in without GitHub.');
    process.exit(1);
  }
  config.sessionSecret ||= 'local-preview-only-secret-not-for-production-use';
  if (!config.ownerGithubIds.length) config.ownerGithubIds = ['1001'];
  /* So the CLOR sign-in button shows in preview. No pass is ever checked against it: /api/auth/dev?via=clor stands in. */
  config.clor.grantPublicKey ||= generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const store = memoryStore();
  await store.createMember({ name: 'owner', role: 'OWNER', githubUserId: '1001', githubLogin: 'owner', clorUserId: null, clorEmail: 'owner@clor.in', addedBy: null });
  await store.createMember({ name: 'dev-engineer', role: 'ENGINEER', githubUserId: '1002', githubLogin: 'dev-engineer', clorUserId: null, clorEmail: null, addedBy: null });
  await store.createMember({ name: 'dev-viewer', role: 'VIEWER', githubUserId: '1003', githubLogin: 'dev-viewer', clorUserId: null, clorEmail: null, addedBy: null });
  createApp({ config, store, github: fakeGitHub(), cloud: fakeCloud() }).listen(config.port, '127.0.0.1', () => console.log(`Console API, local preview with canned answers, on http://127.0.0.1:${config.port}`));
} else {
  const missing = missingSettings(config);
  if (missing.length) {
    console.error(`The Console cannot start. Missing or too short: ${missing.join(', ')}`);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
  createApp({ config, store: pgStore(pool), github: realGitHub(config), cloud: realCloud(config) }).listen(config.port, () => console.log(`Console API on port ${config.port}`));
}
