/**
 * @vitest-environment node
 *
 * This file reads the lock files, it does not install anything.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * What ships to customers — the web bundle, the Android apps, the API image —
 * carries only permissive licences. A copyleft package in it can oblige CLOR
 * to publish its own source; `country-state-city` (GPL-3.0) was in the web
 * bundle until 20 Oct 2026. Development-only packages are not shipped and are
 * not checked.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COPYLEFT = /\b(A?GPL|SSPL|BUSL|EUPL|OSL|CC-BY-NC)\b/i;

const shipped = (lockPath) => {
  const lock = JSON.parse(readFileSync(join(root, lockPath), 'utf8'));
  return Object.entries(lock.packages || {})
    .filter(([path, info]) => path && !info.dev && !info.devOptional)
    .map(([path, info]) => ({ name: path.replace(/^.*node_modules\//, ''), licence: String(info.license || '') }));
};

describe('licences of shipped packages', () => {
  for (const lock of ['package-lock.json', 'server/package-lock.json']) {
    it(`${lock} has no copyleft production dependency`, () => {
      const bad = shipped(lock).filter((p) => COPYLEFT.test(p.licence) && !/\bLGPL\b/i.test(p.licence));
      expect(bad).toEqual([]);
    });
  }
});
