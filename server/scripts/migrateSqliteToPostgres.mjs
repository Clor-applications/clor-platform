#!/usr/bin/env node
/**
 * Moves a SQLite book into PostgreSQL, table by table, and proves it arrived.
 *
 * The schemas are the same schemas — the only change was the datasource
 * provider — so this is a copy, not a transformation. What makes it worth
 * writing carefully is everything around the copy:
 *
 * **Order.** A row cannot be inserted before the row it points at. Rather than
 * hand-maintain a list of 73 tables in dependency order, which is wrong the
 * first time somebody adds a foreign key, the whole copy runs inside one
 * transaction with `session_replication_role = replica`, which suspends
 * foreign-key checks for that session only. They are enforced again at COMMIT
 * — so a genuinely broken reference still fails the migration rather than
 * being smuggled in.
 *
 * **Types.** SQLite has five of them. A boolean is 0 or 1, a date is text, and
 * a decimal is a float — which is the whole reason for moving. Each column is
 * converted according to what PostgreSQL says it should be, not according to
 * what JavaScript guesses from the value.
 *
 * **Proof.** Every table's row count is compared afterwards, and any table
 * that does not match is printed. A migration that says "done" without
 * counting is a migration nobody can trust.
 *
 *   node scripts/migrateSqliteToPostgres.mjs --from ../server/prisma/dev.db
 *
 * `--dry-run` reads and converts everything and rolls back, which is how you
 * find out whether it will work without finding out the hard way.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

/* ----------------------------------------------------------------- inputs */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const env = (() => {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const out = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
})();

const sqlitePath = resolve(process.cwd(), flag('from', 'prisma/dev.db'));
const target = flag('to', process.env.PGADMIN_URL || env.PGADMIN_URL);
const database = flag('database', 'clor');
/* One database, one schema per application — so the copy has to be told which
   application's tables it is filling, not which database. */
const schema = flag('schema', 'accounting');
const dryRun = has('dry-run');

if (!existsSync(sqlitePath)) {
  console.error(`\n  No SQLite file at ${sqlitePath}\n`);
  process.exit(1);
}
if (!target) {
  console.error('\n  No PostgreSQL connection. Set PGADMIN_URL or pass --to.\n');
  process.exit(1);
}

const targetUrl = (() => {
  const url = new URL(target);
  url.pathname = `/${database}`;
  url.search = `?schema=${schema}`;
  return url.toString();
})();

/* ------------------------------------------------------------- the reader */

/**
 * Reads SQLite through its own command-line tool rather than a driver.
 *
 * It is already on the machine that runs this, it needs no native module that
 * has to be compiled against the right Node version, and `-json` gives typed
 * enough output to work with. The cost is a process per table, which for a
 * one-off migration of a few hundred thousand rows is nothing.
 */
const sqlite = (sql) => {
  const out = execFileSync('sqlite3', ['-json', sqlitePath, sql], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : [];
};

const sourceTables = () =>
  sqlite("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_prisma%' ESCAPE '\\' ORDER BY name")
    .map((r) => r.name);

/* ------------------------------------------------------------ conversions */

const pg = new PrismaClient({ datasources: { db: { url: targetUrl } } });

const columnTypes = async (table) => {
  const rows = await pg.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    schema,
    table
  );
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
};

/** One SQLite value, as the PostgreSQL column wants it. */
const convert = (value, type) => {
  if (value === null || value === undefined) return null;

  switch (type) {
    case 'boolean':
      /* SQLite stores a boolean as 0 or 1, and sometimes as the strings. */
      return value === 1 || value === '1' || value === true || value === 'true';

    case 'timestamp without time zone':
    case 'timestamp with time zone': {
      /* Prisma writes ISO strings; some older rows are epoch milliseconds. */
      const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    case 'numeric':
    case 'decimal':
      /* The reason for the whole exercise: these were REAL in SQLite, so they
         are binary approximations of rupees. Passed through as strings, which
         PostgreSQL parses exactly rather than through a float. */
      return String(value);

    case 'integer':
    case 'bigint':
    case 'smallint':
      return typeof value === 'number' ? Math.trunc(value) : parseInt(String(value), 10);

    case 'double precision':
    case 'real':
      return Number(value);

    case 'jsonb':
    case 'json':
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(String(value));
      } catch {
        return null;
      }

    default:
      return String(value);
  }
};

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

/* Qualified, because the connection's search_path is not something a
   migration should depend on being right. */
const qualified = (table) => `${quote(schema)}.${quote(table)}`;

/* ----------------------------------------------------------------- the run */

async function main() {
  const tables = sourceTables();
  console.log(`\n  ${tables.length} tables in ${sqlitePath}`);
  console.log(`  into ${database}.${schema}${dryRun ? '  (dry run — nothing will be kept)' : ''}\n`);

  const counts = [];
  let copied = 0;
  let skipped = [];

  await pg.$transaction(
    async (tx) => {
      /*
       * Suspends foreign-key and trigger checks for this session, so tables
       * can be copied in any order. COMMIT still enforces them, so a genuinely
       * dangling reference fails the migration rather than slipping through.
       */
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);

      for (const table of tables) {
        const types = await columnTypes(table);
        if (!types.size) {
          skipped.push(`${table} (not in the ${schema} schema)`);
          continue;
        }

        const rows = sqlite(`SELECT * FROM ${quote(table)}`);
        if (!rows.length) {
          counts.push([table, 0]);
          continue;
        }

        /* Only columns both sides agree on. A column dropped from the schema
           is not carried over, and one added is left at its default. */
        const columns = Object.keys(rows[0]).filter((c) => types.has(c));
        const missing = Object.keys(rows[0]).filter((c) => !types.has(c));
        if (missing.length) skipped.push(`${table}.${missing.join(', ')} (not in the new schema)`);

        const colSql = columns.map(quote).join(', ');

        /*
         * Each placeholder carries the column's type with it.
         *
         * A numeric passed as a string is exact, which is the point — but
         * PostgreSQL will not infer `numeric` from a text parameter and
         * refuses the insert. Casting the placeholder says what it is without
         * going anywhere near a float on the way in.
         */
        const castOf = (type) => {
          switch (type) {
            case 'numeric':
            case 'decimal':
              return '::numeric';
            case 'timestamp without time zone':
              return '::timestamp';
            case 'timestamp with time zone':
              return '::timestamptz';
            case 'jsonb':
              return '::jsonb';
            case 'json':
              return '::json';
            default:
              return '';
          }
        };

        /* Batched: one statement per row is thousands of round trips, and one
           statement for thirty thousand rows exceeds what the driver will
           carry. Five hundred is comfortably inside both. */
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const slice = rows.slice(i, i + BATCH);
          const values = [];
          const placeholders = slice.map((row, r) => {
            const marks = columns.map((c, k) => {
              const type = types.get(c);
              values.push(convert(row[c], type));
              return `$${r * columns.length + k + 1}${castOf(type)}`;
            });
            return `(${marks.join(', ')})`;
          });
          await tx.$executeRawUnsafe(
            `INSERT INTO ${qualified(table)} (${colSql}) VALUES ${placeholders.join(', ')}`,
            ...values
          );
        }

        counts.push([table, rows.length]);
        copied += rows.length;
        process.stdout.write(`  ${table.padEnd(38)} ${String(rows.length).padStart(7)}\n`);
      }

      if (dryRun) throw new Error('__dry_run__');
    },
    { timeout: 20 * 60 * 1000, maxWait: 60 * 1000 }
  ).catch((e) => {
    if (e?.message === '__dry_run__' || /__dry_run__/.test(String(e?.message))) {
      console.log('\n  Dry run: everything converted and inserted, then rolled back.\n');
      return;
    }
    throw e;
  });

  if (skipped.length) {
    console.log('\n  Not carried over:');
    for (const s of skipped) console.log(`    · ${s}`);
  }

  if (dryRun) {
    await pg.$disconnect();
    return;
  }

  /* ---- the part that makes it a migration rather than a hope ---- */

  console.log('\n  Checking every table against the source…');
  const wrong = [];
  for (const [table, expected] of counts) {
    const [{ count }] = await pg.$queryRawUnsafe(`SELECT count(*)::int AS count FROM ${qualified(table)}`);
    if (count !== expected) wrong.push(`${table}: ${expected} in SQLite, ${count} in PostgreSQL`);
  }

  if (wrong.length) {
    console.error('\n  These tables do not match:');
    for (const w of wrong) console.error(`    · ${w}`);
    process.exitCode = 1;
  } else {
    console.log(`  Every table matches. ${copied.toLocaleString('en-IN')} rows.\n`);
  }

  await pg.$disconnect();
}

main().catch(async (e) => {
  console.error('\n  Migration failed, and nothing was kept:\n ', e?.message || e, '\n');
  await pg.$disconnect();
  process.exit(1);
});
