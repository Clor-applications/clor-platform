import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A missing JWT_SECRET in production must stop signing, not fall back to a key
 * anyone can read in this repository. Every signer guards its 'dev-secret'
 * with isDevOrTest(); routes/sso.ts did not, so SSO state tokens would have
 * been forgeable on a misconfigured server.
 */
const src = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'generated' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

describe('development secret fallback', () => {
  it('is only ever used in dev or test', () => {
    const unguarded = files(src).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${path.slice(src.length + 1)}:${i + 1}` }))
        .filter(({ line }) => line.includes("'dev-secret'") && !/isDevOrTest\(\)\s*\?\s*'dev-secret'/.test(line))
        .map(({ at }) => at)
    );
    expect(unguarded).toEqual([]);
  });
});
