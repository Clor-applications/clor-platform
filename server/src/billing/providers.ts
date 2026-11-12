import QRCode from 'qrcode';

import type { PaymentProvider } from '../generated/platform/index.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { CashfreeGateway } from './cashfree.js';
import { ManualGateway, __gatewayOverride, manualProblems, setActiveGateway, type ConnectionResult, type ManualDetails, type PaymentGateway } from './gateway.js';
import { RazorpayGateway } from './razorpay.js';
import type { Fetcher } from './webhookKit.js';

/**
 * How customers pay CLOR, set up in the operator console (Payments) and
 * nowhere else: which providers are on, which one is active (one at a time),
 * Test or Live, the keys for each mode, and the manual payment details.
 *
 * Secrets are encrypted with encryptSecret (AES-256-GCM, services/mailer.ts)
 * as one JSON blob per provider. They are decrypted only here, only to build
 * an adapter, and never returned, logged or put on the operator log: the
 * console is shown the last four characters of each.
 *
 * Env (PAYMENT_GATEWAY and the provider's keys) is read only when no
 * provider is active in the database: a silent fallback for a developer's
 * machine, never something staff are asked to set.
 */
export const PROVIDER_CODES = ['cashfree', 'razorpay', 'manual'] as const;
export type ProviderCode = (typeof PROVIDER_CODES)[number];
export type Mode = 'TEST' | 'LIVE';
export const PROVIDER_NAMES: Record<ProviderCode, string> = { cashfree: 'Cashfree', razorpay: 'Razorpay', manual: 'Manual: UPI and bank transfer' };

/** The fields each provider takes per mode: the ID shown in full, and the secrets shown only as their last four. */
export const KEY_FIELDS = {
  cashfree: { id: 'appId', secrets: ['secretKey'] },
  razorpay: { id: 'keyId', secrets: ['keySecret', 'webhookSecret'] },
} as const;
type KeyCode = keyof typeof KEY_FIELDS;
const isKeyed = (c: ProviderCode): c is KeyCode => c !== 'manual';
const lower = (m: Mode) => (m === 'LIVE' ? 'live' : 'test') as 'live' | 'test';

export class PaymentsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

type Secrets = Partial<Record<'test' | 'live', Record<string, string>>>;
const secretsOf = (row: Pick<PaymentProvider, 'secretsEnc'> | null): Secrets => {
  if (!row?.secretsEnc) return {};
  try {
    return JSON.parse(decryptSecret(row.secretsEnc) || '{}');
  } catch {
    return {};
  }
};
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

export const isCode = (c: string): c is ProviderCode => (PROVIDER_CODES as readonly string[]).includes(c);

/** The webhook address to paste into the provider's dashboard. */
export const webhookUrl = (code: ProviderCode) => `${(process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || 'https://api.clor.in').replace(/\/$/, '')}/api/billing/webhook/${code}`;

/** What the console may see of a provider: never a secret, only its last four characters. */
export function providerView(code: ProviderCode, row: PaymentProvider | null) {
  const config = obj(row?.config);
  const hints = obj(row?.secretHints);
  const base = {
    code,
    name: PROVIDER_NAMES[code],
    enabled: row?.enabled ?? false,
    active: row?.active ?? false,
    mode: (row?.mode as Mode) ?? 'TEST',
    lastTest: row?.lastTestAt ? { at: row.lastTestAt, ok: row.lastTestOk, message: row.lastTestMessage, mode: row.lastTestMode } : null,
    updatedAt: row?.updatedAt ?? null,
  };
  if (!isKeyed(code)) return { ...base, manual: manualOf(config), problems: manualProblems(manualOf(config)) };
  const f = KEY_FIELDS[code];
  const keysFor = (m: 'test' | 'live') => ({ [f.id]: obj(config[m])[f.id] || '', saved: Object.fromEntries(f.secrets.map((s) => [s, obj(hints[m])[s] || null])) });
  return { ...base, webhookUrl: webhookUrl(code), test: keysFor('test'), live: keysFor('live') };
}

const manualOf = (config: Record<string, any>): ManualDetails => ({
  upiId: config.upiId || null,
  payeeName: config.payeeName || null,
  qrImage: config.qrImage || null,
  bank: config.bank ? { accountName: config.bank.accountName || null, accountNumber: config.bank.accountNumber || null, ifsc: config.bank.ifsc || null, bankName: config.bank.bankName || null, branch: config.bank.branch || null } : null,
  instructions: config.instructions || null,
});

export async function providerRows() {
  const rows = await platformPrisma.paymentProvider.findMany();
  return PROVIDER_CODES.map((c) => ({ code: c, row: rows.find((r) => r.code === c) ?? null }));
}

/* ------------------------------------------------------------ checking input */

const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NO = /^\d{9,18}$/;
const QR = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const QR_MAX = 400_000;

export type KeyInput = { id?: string; secrets?: Record<string, string | undefined> };
export type ProviderInput = { enabled?: boolean; test?: KeyInput; live?: KeyInput; manual?: ManualDetails };

function checkKeys(code: KeyCode, m: 'test' | 'live', k: KeyInput, problems: string[]) {
  const id = k.id?.trim();
  if (code === 'razorpay' && id && !new RegExp(`^rzp_${m}_[A-Za-z0-9]{6,40}$`).test(id)) problems.push(`The ${m} Key ID starts with rzp_${m}_ and has no spaces.`);
  if (code === 'cashfree' && id && !/^[A-Za-z0-9_-]{6,100}$/.test(id)) problems.push(`The ${m} App ID is letters and numbers, with no spaces.`);
  for (const [name, v] of Object.entries(k.secrets || {})) {
    if (v == null || v === '') continue;
    if (!(KEY_FIELDS[code].secrets as readonly string[]).includes(name)) problems.push(`${name} is not a ${PROVIDER_NAMES[code]} key.`);
    else if (/\s/.test(v.trim()) || v.trim().length < 6 || v.length > 300) problems.push(`The ${m} ${name === 'webhookSecret' ? 'webhook secret' : 'secret'} looks wrong: copy it again, without spaces.`);
  }
}

function checkManual(d: ManualDetails, problems: string[]): ManualDetails {
  const t = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const out: ManualDetails = {
    upiId: t(d.upiId, 300),
    payeeName: t(d.payeeName),
    qrImage: typeof d.qrImage === 'string' && d.qrImage ? d.qrImage : null,
    bank: {
      accountName: t(d.bank?.accountName),
      accountNumber: t(d.bank?.accountNumber, 30)?.replace(/\s/g, '') || null,
      ifsc: t(d.bank?.ifsc, 20)?.toUpperCase() || null,
      bankName: t(d.bank?.bankName),
      branch: t(d.bank?.branch),
    },
    instructions: t(d.instructions, 600),
  };
  if (out.upiId && !VPA.test(out.upiId)) problems.push('A UPI ID looks like clor@okaxis: a name, then @, then the bank’s handle.');
  if (out.bank!.ifsc && !IFSC.test(out.bank!.ifsc)) problems.push('An IFSC code is 11 characters, like HDFC0001234: four letters, a zero, then six letters or digits.');
  if (out.bank!.accountNumber && !ACCOUNT_NO.test(out.bank!.accountNumber)) problems.push('A bank account number is 9 to 18 digits.');
  if (out.qrImage && (!QR.test(out.qrImage) || out.qrImage.length > QR_MAX)) problems.push('The QR image must be a PNG or JPEG under 300 KB.');
  if (!Object.values(out.bank!).some(Boolean)) out.bank = null;
  return out;
}

/* ------------------------------------------------------------------ changes */

async function rowOf(code: ProviderCode) {
  return platformPrisma.paymentProvider.findUnique({ where: { code } });
}

/**
 * Save a provider's settings. A secret left blank keeps the one saved; a
 * secret typed replaces it. Returns the names of what changed (never values),
 * for the operator log.
 */
export async function saveProvider(code: ProviderCode, input: ProviderInput, userId: string): Promise<{ changed: string[] }> {
  const problems: string[] = [];
  const row = await rowOf(code);
  const config = { ...obj(row?.config) };
  const hints = { ...obj(row?.secretHints) };
  const secrets = secretsOf(row);
  const changed: string[] = [];
  let keysChanged = false;
  let secretsChanged = false;

  if (isKeyed(code)) {
    for (const m of ['test', 'live'] as const) {
      const k = input[m];
      if (!k) continue;
      checkKeys(code, m, k, problems);
      const idField = KEY_FIELDS[code].id;
      if (k.id !== undefined && (k.id.trim() || '') !== (obj(config[m])[idField] || '')) {
        config[m] = { ...obj(config[m]), [idField]: k.id.trim() };
        changed.push(`${m} ${idField}`);
        keysChanged ||= lower((row?.mode as Mode) ?? 'TEST') === m;
      }
      for (const [name, v] of Object.entries(k.secrets || {})) {
        if (v == null || v.trim() === '') continue;
        secrets[m] = { ...(secrets[m] || {}), [name]: v.trim() };
        hints[m] = { ...obj(hints[m]), [name]: v.trim().slice(-4) };
        changed.push(`${m} ${name}`);
        keysChanged ||= lower((row?.mode as Mode) ?? 'TEST') === m;
        secretsChanged = true;
      }
    }
  } else if (input.manual) {
    const before = JSON.stringify(manualOf(config));
    const next = checkManual(input.manual, problems);
    if (JSON.stringify(next) !== before) {
      const was = manualOf(config);
      for (const k of ['upiId', 'payeeName', 'qrImage', 'instructions'] as const) if ((was[k] || null) !== (next[k] || null)) changed.push(k);
      if (JSON.stringify(was.bank || null) !== JSON.stringify(next.bank || null)) changed.push('bank');
      Object.assign(config, next);
      keysChanged = true;
    }
  }
  if (problems.length) throw new PaymentsError('Check the details.', 400, problems);

  const enabled = input.enabled ?? row?.enabled ?? false;
  if (input.enabled !== undefined && input.enabled !== (row?.enabled ?? false)) changed.push(enabled ? 'turned on' : 'turned off');
  const active = enabled && (row?.active ?? false);
  if (row?.active && !active) changed.push('no longer the active provider');

  const data = {
    enabled,
    active,
    config,
    secretHints: hints,
    ...(secretsChanged ? { secretsEnc: encryptSecret(JSON.stringify(secrets)) } : {}),
    updatedByUserId: userId,
    ...(keysChanged ? { lastTestAt: null, lastTestOk: null, lastTestMessage: null, lastTestMode: null } : {}),
  };
  await platformPrisma.paymentProvider.upsert({ where: { code }, create: { code, mode: 'TEST', ...data }, update: data });
  clearProviderCache();
  return { changed };
}

/** Test or Live. Live is confirmed twice in the console; the server asks for the word too. */
export async function setMode(code: ProviderCode, mode: Mode, userId: string) {
  if (!isKeyed(code)) throw new PaymentsError('Manual payments have no Test or Live mode.');
  const row = await rowOf(code);
  if ((row?.mode ?? 'TEST') === mode) return { from: mode, to: mode };
  await platformPrisma.paymentProvider.upsert({
    where: { code },
    create: { code, mode, updatedByUserId: userId },
    update: { mode, updatedByUserId: userId, lastTestAt: null, lastTestOk: null, lastTestMessage: null, lastTestMode: null },
  });
  clearProviderCache();
  return { from: (row?.mode as Mode) ?? 'TEST', to: mode };
}

/** What is still missing before a provider can take payments, in plain sentences. */
export function readiness(code: ProviderCode, row: PaymentProvider | null): string[] {
  const out: string[] = [];
  if (!row?.enabled) out.push(`Turn ${PROVIDER_NAMES[code]} on first.`);
  if (!isKeyed(code)) return [...out, ...manualProblems(manualOf(obj(row?.config)))];
  const m = lower((row?.mode as Mode) ?? 'TEST');
  const f = KEY_FIELDS[code];
  const s = secretsOf(row)[m] || {};
  if (!obj(obj(row?.config)[m])[f.id]) out.push(`Save the ${m} ${code === 'razorpay' ? 'Key ID' : 'App ID'}.`);
  if (!s[f.secrets[0]]) out.push(`Save the ${m} ${code === 'razorpay' ? 'Key secret' : 'secret key'}.`);
  if (code === 'razorpay' && !s.webhookSecret) out.push(`Save the ${m} webhook secret.`);
  if (!out.length && !(row?.lastTestOk === true && row.lastTestMode === row.mode)) out.push(`Press Test connection and get a pass with the ${m} keys.`);
  return out;
}

/** Make one provider the active one; the one before it stops being active. */
export async function activate(code: ProviderCode, userId: string) {
  const row = await rowOf(code);
  const missing = readiness(code, row);
  if (missing.length) throw new PaymentsError(`${PROVIDER_NAMES[code]} is not ready yet.`, 409, missing);
  const before = await platformPrisma.paymentProvider.findFirst({ where: { active: true } });
  await platformPrisma.$transaction([
    platformPrisma.paymentProvider.updateMany({ where: { active: true, NOT: { code } }, data: { active: false } }),
    platformPrisma.paymentProvider.update({ where: { code }, data: { active: true, updatedByUserId: userId } }),
  ]);
  clearProviderCache();
  return { previous: before?.code ?? null };
}

/** Ask the provider whether the saved keys work, and keep the answer for the console. */
export async function testProvider(code: ProviderCode, fetcher?: Fetcher): Promise<ConnectionResult & { mode: Mode }> {
  const row = await rowOf(code);
  const mode = ((row?.mode as Mode) ?? 'TEST') as Mode;
  const g = gatewayFromRow(code, row, fetcher);
  const result = g.testConnection ? await g.testConnection() : { ok: true, message: 'Nothing to test.' };
  await platformPrisma.paymentProvider.upsert({
    where: { code },
    create: { code, lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message, lastTestMode: mode },
    update: { lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message, lastTestMode: mode },
  });
  return { ...result, mode };
}

/* ----------------------------------------------------------------- adapters */

/** The adapter for a provider as saved, in its current mode. */
export function gatewayFromRow(code: ProviderCode, row: PaymentProvider | null, fetcher?: Fetcher): PaymentGateway {
  const config = obj(row?.config);
  if (!isKeyed(code)) return new ManualGateway(manualOf(config));
  const mode = ((row?.mode as Mode) ?? 'TEST') as Mode;
  const m = lower(mode);
  const s = secretsOf(row)[m] || {};
  const id = obj(config[m])[KEY_FIELDS[code].id] || '';
  if (code === 'cashfree') return new CashfreeGateway({ mode, appId: id, secretKey: s.secretKey || '' }, fetcher);
  return new RazorpayGateway({ mode, keyId: id, keySecret: s.keySecret || '', webhookSecret: s.webhookSecret || null }, fetcher);
}

/** A developer's machine only: the provider named in env, when none is active in the database. */
function envGateway(): PaymentGateway | null {
  const e = process.env;
  const name = String(e.PAYMENT_GATEWAY || '')
    .trim()
    .toLowerCase();
  const mode: Mode = /^live$/i.test(e.PAYMENT_GATEWAY_MODE || '') ? 'LIVE' : 'TEST';
  if (name === 'cashfree' && e.CASHFREE_APP_ID && e.CASHFREE_SECRET_KEY) return new CashfreeGateway({ mode, appId: e.CASHFREE_APP_ID, secretKey: e.CASHFREE_SECRET_KEY });
  if (name === 'razorpay' && e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET) return new RazorpayGateway({ mode, keyId: e.RAZORPAY_KEY_ID, keySecret: e.RAZORPAY_KEY_SECRET, webhookSecret: e.RAZORPAY_WEBHOOK_SECRET || null });
  return null;
}

let cached: { at: number; gateway: PaymentGateway } | null = null;
const CACHE_MS = 15_000;
export function clearProviderCache() {
  cached = null;
}

/** The active gateway, read from the database (env only when none is active), kept 15 seconds. */
export async function activeGateway(): Promise<PaymentGateway> {
  const override = __gatewayOverride();
  if (override) return override;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.gateway;
  const row = await platformPrisma.paymentProvider.findFirst({ where: { active: true } });
  const gateway = row && isCode(row.code) ? gatewayFromRow(row.code, row) : (envGateway() ?? new ManualGateway());
  cached = { at: Date.now(), gateway };
  setActiveGateway(gateway);
  return gateway;
}

/**
 * The adapter a webhook for this provider is checked with: the provider as
 * saved, if it is turned on. Env only on a developer's machine with nothing
 * saved. Null with the reason when the event cannot be used.
 */
export async function webhookGateway(code: ProviderCode): Promise<{ gateway: PaymentGateway } | { reason: string }> {
  const override = __gatewayOverride();
  if (override && override.name === code) return { gateway: override };
  const row = await rowOf(code);
  if (row?.enabled) return { gateway: gatewayFromRow(code, row) };
  if (!row) {
    const env = envGateway();
    if (env?.name === code) return { gateway: env };
  }
  return { reason: `${PROVIDER_NAMES[code]} is turned off in Payments, so this event was not used.` };
}

/** The gateway a subscription was made with, to cancel it there; the active one when it names none. */
export async function gatewayNamed(name: string | null | undefined): Promise<PaymentGateway> {
  const override = __gatewayOverride();
  if (override) return override;
  if (name && isCode(name)) return gatewayFromRow(name, await rowOf(name));
  return activeGateway();
}

/**
 * What a customer paying by hand is shown: CLOR's UPI ID with a QR to scan
 * (the uploaded one, or one drawn from the UPI ID), and the bank account.
 * Null when manual payments are not set up.
 */
export async function manualPayTo(gateway: PaymentGateway) {
  if (!(gateway instanceof ManualGateway)) return null;
  const d = gateway.details;
  if (manualProblems(d).length) return null;
  const upiLink = d.upiId ? `upi://pay?pa=${encodeURIComponent(d.upiId)}&pn=${encodeURIComponent(d.payeeName || 'CLOR')}&cu=INR` : null;
  const qr = d.qrImage || (upiLink ? await QRCode.toDataURL(upiLink, { margin: 1, width: 240 }) : null);
  return { upiId: d.upiId || null, payeeName: d.payeeName || null, upiLink, qr, bank: d.bank || null, instructions: d.instructions || null };
}
