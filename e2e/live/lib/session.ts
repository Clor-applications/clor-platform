import { createHmac } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES, type QaAccount } from './env';

const STATE = join(fileURLToPath(new URL('.', import.meta.url)), '..', '.state');
export function statePath(acc: QaAccount) { mkdirSync(STATE, { recursive: true }); return join(STATE, `${acc.label}.json`); }

/** A page already signed in as acc (session saved by auth.setup.ts). */
export async function pageAs(browser: Browser, acc: QaAccount) {
  const ctx = await browser.newContext({ storageState: statePath(acc), viewport: { width: 1440, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
  return ctx.newPage();
}
/* 2FA codes work once: wait for a fresh 30-second step before each sign-in. */
const lastStep: Record<string, number> = {};

function base32Decode(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 6238 code for the QA account's authenticator secret (from .env.live only). */
export function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

/** Signs in through the real sign-in screen of the account's site (app.clor.in or ops.clor.in). */
export async function signIn(page: Page, acc: QaAccount) {
  const host = SITES[acc.site || 'app'];
  await page.goto(host + '/signin', { waitUntil: 'networkidle' });
  await page.getByLabel(/email or username|email/i).first().fill(acc.email);
  await page.getByLabel('Password', { exact: true }).fill(acc.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  const code = page.locator('#signin-code');
  await Promise.race([
    code.waitFor({ timeout: 20_000 }).catch(() => {}),
    page.waitForURL(/\/o\/\d{10}|ops\.clor\.in\/(?!signin)/, { timeout: 20_000 }).catch(() => {}),
  ]);
  if (await code.isVisible().catch(() => false)) {
    if (!acc.totpSecret) throw new Error(`${acc.label}: two-factor code asked; add totpSecret for this account in .env.live`);
    const step = Math.floor(Date.now() / 30000);
    if (step === lastStep[acc.label]) await page.waitForTimeout(30_500 - (Date.now() % 30_000));
    lastStep[acc.label] = Math.floor(Date.now() / 30000);
    await code.fill(totp(acc.totpSecret));
    await page.getByRole('button', { name: /verify|continue|sign in/i }).first().click();
  }
  await expect(page).not.toHaveURL(/\/signin/, { timeout: 30_000 });
}
