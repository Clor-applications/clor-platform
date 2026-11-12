import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Cloud SQL runs migrations as a user without superuser. Postgres refuses a
// function-level `SET clor.x = ...` clause from such a user ("permission denied
// to set parameter"), so a migration with one passes locally (superuser) and
// fails on deploy. Functions switch a clor.* setting with set_config instead.
function migrationFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return migrationFiles(path);
    return name === 'migration.sql' ? [path] : [];
  });
}

describe('migrations', () => {
  it('never put a clor.* setting in a function header', () => {
    const root = join(__dirname, '..', '..', 'prisma');
    const offenders = migrationFiles(root).filter((file) =>
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[^$]*?\bSET\s+"?clor\./i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
