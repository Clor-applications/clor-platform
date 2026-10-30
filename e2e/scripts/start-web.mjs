/**
 * The web app for a local end-to-end run, proxying /api to this run's API.
 *
 * Built and served with `vite preview` by default: the built app is what
 * people get, and it loads in a handful of files instead of the dev server's
 * ~600, so pages settle faster and tests wait less. E2E_WEB=dev serves the
 * dev server instead (no build; handy while writing a test against a change).
 * E2E_SKIP_BUILD=1 reuses dist-e2e/ from an earlier build.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { apiPort, webPort } from './env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
/* /api on the same origin, proxied to this run's API: .env.production names the live API, which a test must never reach. */
const env = { ...process.env, VITE_API_BASE: '/api', VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` };
const outDir = 'dist-e2e';
const dev = process.env.E2E_WEB === 'dev';

if (!dev && process.env.E2E_SKIP_BUILD !== '1') {
  const started = Date.now();
  const r = spawnSync('npx', ['vite', 'build', '--logLevel', 'error', '--outDir', outDir], { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log(`[e2e web] built in ${Math.round((Date.now() - started) / 1000)}s`);
}

const args = dev
  ? ['vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort']
  : ['vite', 'preview', '--outDir', outDir, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'];
const child = spawn('npx', args, { cwd: root, env, stdio: 'inherit' });
const stop = (signal) => () => child.kill(signal);
process.on('SIGTERM', stop('SIGTERM'));
process.on('SIGINT', stop('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
