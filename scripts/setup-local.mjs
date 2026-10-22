/** Local PostgreSQL bootstrap. Creates a new DB only; never resets existing data. */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = new URL('../server/.env', import.meta.url);
if (!existsSync(env)) {
  const dbName = 'clor_local';
  try {
    const exists = execFileSync('psql', ['postgres', '-Atc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`], { encoding: 'utf8' }).trim();
    if (!exists) execFileSync('createdb', [dbName], { stdio: 'inherit' });
  } catch {
    console.error('Local PostgreSQL is not available. Start PostgreSQL and ensure psql/createdb are installed, then run npm run setup:local again.');
    process.exit(1);
  }
  const host = `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/${dbName}`;
  const lines = Object.entries({ DATABASE_URL: `${host}?schema=accounting`, PAYROLL_DATABASE_URL: `${host}?schema=payroll`, PEOPLE_DATABASE_URL: `${host}?schema=people`, PLATFORM_DATABASE_URL: `${host}?schema=platform`, PORT: '4001', JWT_SECRET: randomBytes(48).toString('base64url'), JWT_ISSUER: 'clor', JWT_AUDIENCE: 'clor-web', MAIL_SECRET_KEY: randomBytes(32).toString('base64'), APP_URL: 'http://127.0.0.1:5173', CORS_ORIGIN: 'http://127.0.0.1:5173' }).map(([k, v]) => `${k}=${v}`);
  writeFileSync(env, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log('Created server/.env for local PostgreSQL.');
} else console.log('Keeping existing server/.env and databases.');
for (const script of ['prisma:generate', 'prisma:deploy']) execFileSync('npm', ['--prefix', 'server', 'run', script], { cwd: root, stdio: 'inherit' });
console.log('Local database setup complete. Run npm run dev.');
