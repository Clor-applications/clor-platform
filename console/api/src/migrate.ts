import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * Applies console/api/migrations in name order, each once, each in its own
 * transaction. Run it as the database owner before a new revision starts:
 * `npm run migrate` with CONSOLE_DATABASE_URL set.
 */
const url = process.env.CONSOLE_DATABASE_URL;
if (!url) {
  console.error('CONSOLE_DATABASE_URL is not set.');
  process.exit(1);
}
const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS console_migration (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await client.query('SELECT name FROM console_migration')).rows.map((r) => r.name as string));
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(`${dir}${name}`, 'utf8'));
      await client.query('INSERT INTO console_migration (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  console.log('Migrations are up to date.');
} finally {
  await client.end();
}
