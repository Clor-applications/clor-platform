#!/usr/bin/env node
/**
 * Prepares .env for `docker compose`.
 *
 * Creates it from .env.docker.example when missing, then fills any secret that
 * is still blank with a generated value. Existing values are never overwritten,
 * so running this repeatedly is safe and will not invalidate live sessions.
 *
 * This exists because copying the example alone leaves JWT_SECRET empty, and
 * compose then fails with "required variable JWT_SECRET is missing a value" —
 * a first-run failure that told the user to go and hand-edit a file.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.docker.example');

/** Keys that must hold a secret, and how to generate one. */
const GENERATED = {
  JWT_SECRET: () => randomBytes(48).toString('base64'),
  // Separate from JWT_SECRET so rotating one does not invalidate the other:
  // this key decrypts stored SMTP passwords.
  MAIL_SECRET_KEY: () => randomBytes(32).toString('base64'),
  POSTGRES_PASSWORD: () => randomBytes(24).toString('base64url'),
};

if (!existsSync(examplePath)) {
  console.error('Cannot find .env.docker.example — run this from the project root.');
  process.exit(1);
}

let created = false;
if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  created = true;
}

const original = readFileSync(envPath, 'utf8');
const lines = original.split('\n');
const filled = [];

const next = lines.map((line) => {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) return line;

  const [, key, value] = match;
  if (!GENERATED[key]) return line;
  // Only fill a blank; a value already set is the operator's choice.
  if (value.trim() !== '') return line;

  filled.push(key);
  return `${key}=${GENERATED[key]()}`;
});

// A key absent from the file entirely still needs a value.
for (const key of Object.keys(GENERATED)) {
  if (!next.some((l) => l.startsWith(`${key}=`))) {
    next.push(`${key}=${GENERATED[key]()}`);
    filled.push(key);
  }
}

const updated = next.join('\n');
if (updated !== original) writeFileSync(envPath, updated, 'utf8');

if (created) console.log('Created .env from .env.docker.example');
if (filled.length) console.log(`Generated a value for: ${filled.join(', ')}`);
if (!created && !filled.length) console.log('.env already has its secrets — nothing to do');
