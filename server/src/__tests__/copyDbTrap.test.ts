import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/*
 * A-38: copy_db.sh turns FORCE row-level security off on the destination so
 * the owner can load every company's rows, and turned it back on only at the
 * end. With `set -e`, a failed COPY ended the script there and left every
 * table without FORCE — the database's tenant backstop off, silently.
 *
 * Runs the real script against a stand-in `psql` that records every statement
 * and fails on the copy.
 */

const script = resolve(__dirname, '../../prisma/platform/rollout/copy_db.sh');

function run(failCopy: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'copydb-'));
  const log = join(dir, 'log.txt');
  writeFileSync(log, '');
  const psql = join(dir, 'psql');
  writeFileSync(
    psql,
    `#!/bin/zsh
args="$*"
print -r -- "$args" >> ${JSON.stringify(log)}
case "$args" in
  *"select tablename from pg_tables where schemaname='public' and tablename<>"*) print "Employee"; print "Invoice" ;;
  *"select string_agg(tablename"*) print "Employee Invoice" ;;
  *"select count(*)"*) print 0 ;;
  *relforcerowsecurity*) print "Employee"; print "Invoice" ;;
  *"select string_agg(column_name"*) print "id orgId" ;;
  *"select column_name from information_schema.columns"*) print "id"; print "orgId" ;;
  *"from stdin"*) ${failCopy ? 'cat >/dev/null; exit 3' : 'cat >/dev/null'} ;;
  *"to stdout"*) print "1\\torg" ;;
esac
exit 0
`
  );
  chmodSync(psql, 0o755);
  let status = 0;
  try {
    execFileSync('zsh', [script, 'postgres://src', 'postgres://dst', 'test', dir], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdio: 'pipe' });
  } catch (e: any) {
    status = e.status ?? 1;
  }
  return { status, statements: readFileSync(log, 'utf8') };
}

/* The script is zsh; a runner without zsh skips rather than fails. */
const hasZsh = spawnSync('zsh', ['-c', 'true']).status === 0;

describe.skipIf(!hasZsh)('copy_db.sh', () => {
  it('turns FORCE row-level security back on when a copy fails', () => {
    const { status, statements } = run(true);
    expect(status).not.toBe(0);
    expect(statements).toContain('ALTER TABLE "Employee" NO FORCE ROW LEVEL SECURITY');
    expect(statements).toContain('ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY');
    expect(statements).toContain('ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY');
  });

  it('still turns it back on, once, when the copy succeeds', () => {
    const { status, statements } = run(false);
    expect(status).toBe(0);
    expect(statements.split('\n').filter((l) => l.includes('ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY')).length).toBe(1);
  });
});
