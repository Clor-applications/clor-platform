import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
const __dirname = __f(new URL('.', import.meta.url));
import { join } from 'node:path';

/** Reads e2e/live/.env.live (untracked) into process.env, without overriding. */
export function loadLiveEnv() {
  const file = join(__dirname, '..', '.env.live');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export const SITES = {
  marketing: process.env.QA_MARKETING_URL || 'https://clor.in',
  app: process.env.QA_APP_URL || 'https://app.clor.in',
  books: process.env.QA_BOOKS_URL || 'https://books.clor.in',
  ops: process.env.QA_OPS_URL || 'https://ops.clor.in',
  people: 'https://people.clor.in',
  payroll: 'https://payroll.clor.in',
  attendance: 'https://attendance.clor.in',
  api: process.env.QA_API_URL || 'https://api.clor.in',
};

export type QaAccount = { label: string; site?: keyof typeof SITES; email: string; password: string; totpSecret?: string; company?: string };

/** QA_ACCOUNTS is a JSON array of QaAccount, from .env.live. Empty means public pages only. */
export function accounts(): QaAccount[] {
  const raw = process.env.QA_ACCOUNTS;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('QA_ACCOUNTS in e2e/live/.env.live is not valid JSON');
  }
}

export const writesAllowed = process.env.QA_LIVE_WRITES === '1';
export const writeCompanies = (process.env.QA_WRITE_COMPANIES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
