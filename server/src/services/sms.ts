import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { decryptSecret, encryptSecret } from './mailer.js';

/**
 * CLOR's own text-message sender, for two-step sign-in codes (owner, 17 Nov
 * 2026). Set up in the operator console (Settings, Text messages) and kept in
 * the platform setting `sms.gateway`:
 *
 *   { provider: 'MSG91', enabled, templateId, senderId, authKeyEnc, authKeyHint }
 *
 * MSG91 sends to Indian numbers under India's DLT rules: CLOR registers as a
 * sender, gets a sender ID and an approved template with one variable for the
 * code, and pastes the template's MSG91 ID here. Until it is switched on with
 * a key and a template, nobody is offered SMS codes. The key is encrypted at
 * rest and only its last four characters ever leave the server.
 *
 * Under the test runner nothing is sent: messages land in `smsTestOutbox`.
 */
export const SMS_SETTING_KEY = 'sms.gateway';
export const SMS_PROVIDERS = ['MSG91'] as const;

export type SmsSetting = {
  provider: (typeof SMS_PROVIDERS)[number];
  enabled: boolean;
  templateId: string | null;
  senderId: string | null;
  authKeyEnc: string | null;
  authKeyHint: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function readSmsSetting(value: unknown): SmsSetting {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    provider: 'MSG91',
    enabled: v.enabled === true,
    templateId: str(v.templateId),
    senderId: str(v.senderId),
    authKeyEnc: str(v.authKeyEnc),
    authKeyHint: str(v.authKeyHint),
    lastTestAt: str(v.lastTestAt),
    lastTestOk: typeof v.lastTestOk === 'boolean' ? v.lastTestOk : null,
    lastTestMessage: str(v.lastTestMessage),
  };
}

export async function smsSetting(): Promise<SmsSetting> {
  const row = await outsideTenant('sms: CLOR’s text-message sender', () => platformPrisma.platformSetting.findUnique({ where: { key: SMS_SETTING_KEY } }));
  return readSmsSetting(row?.value);
}

/** Whether SMS codes can be offered: switched on, with a key and a template. */
export async function smsReady(): Promise<boolean> {
  const s = await smsSetting();
  return s.enabled && Boolean(s.authKeyEnc && s.templateId);
}

/** What the console may see: never the key itself. */
export function smsView(s: SmsSetting) {
  return {
    provider: s.provider,
    enabled: s.enabled,
    ready: s.enabled && Boolean(s.authKeyEnc && s.templateId),
    templateId: s.templateId,
    senderId: s.senderId,
    authKeySaved: Boolean(s.authKeyEnc),
    authKeyHint: s.authKeyHint,
    lastTestAt: s.lastTestAt,
    lastTestOk: s.lastTestOk,
    lastTestMessage: s.lastTestMessage,
  };
}

export type SmsInput = { enabled: boolean; templateId?: string | null; senderId?: string | null; authKey?: string | null };

/** Check what an operator typed against what is stored: the row to store, or the problems in plain words. */
export function checkSmsInput(input: SmsInput, before: SmsSetting): { value: SmsSetting; problems: string[] } {
  const problems: string[] = [];
  const templateId = str(input.templateId);
  const senderId = str(input.senderId)?.toUpperCase() ?? null;
  const authKey = str(input.authKey);
  if (templateId && !/^[A-Za-z0-9]{8,40}$/.test(templateId)) problems.push('The template ID is the letters and digits MSG91 shows beside the approved template.');
  if (senderId && !/^[A-Z]{6}$/.test(senderId)) problems.push('A sender ID is six capital letters, like CLORIN.');
  if (authKey && !/^[A-Za-z0-9]{16,64}$/.test(authKey)) problems.push('That does not look like an MSG91 auth key: copy it again from MSG91, API.');
  const authKeyEnc = authKey ? encryptSecret(authKey) : before.authKeyEnc;
  if (input.enabled) {
    if (!authKeyEnc) problems.push('Paste MSG91’s auth key to switch text messages on.');
    if (!templateId) problems.push('Enter the template ID of the approved sign-in code template.');
  }
  return {
    value: {
      ...before,
      enabled: Boolean(input.enabled),
      templateId,
      senderId,
      authKeyEnc,
      authKeyHint: authKey ? authKey.slice(-4) : before.authKeyHint,
    },
    problems,
  };
}

export async function saveSmsSetting(value: SmsSetting, userId: string) {
  await outsideTenant('sms: save CLOR’s text-message sender', () =>
    platformPrisma.platformSetting.upsert({
      where: { key: SMS_SETTING_KEY },
      create: { key: SMS_SETTING_KEY, value: value as any, updatedByUserId: userId },
      update: { value: value as any, updatedByUserId: userId },
    }),
  );
}

/**
 * An Indian mobile number in +91 form, or null. Ten digits starting 6 to 9,
 * with or without +91, 91 or a leading 0. DLT sending reaches India only.
 */
export function indianMobile(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[\s\-()]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

/** A number with all but its last three digits hidden, for "we sent a code to …". */
export const maskPhone = (phone: string | null | undefined) => (phone ? `+91 ••••• ••${phone.slice(-3)}` : null);

export const smsTestOutbox: Array<{ to: string; code: string; at: Date }> = [];
const underTest = () => process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

export class SmsError extends Error {}

/**
 * Send a sign-in code. MSG91's Flow API fills the approved template's
 * variable named `otp` with the code. Throws SmsError with a plain sentence
 * when it is not set up or MSG91 refuses.
 */
export async function sendSmsCode(phone: string, code: string, setting?: SmsSetting): Promise<void> {
  const s = setting || (await smsSetting());
  if (underTest()) {
    if (!(s.enabled && s.authKeyEnc && s.templateId)) throw new SmsError('Text messages are not set up.');
    smsTestOutbox.push({ to: phone, code, at: new Date() });
    return;
  }
  if (!s.authKeyEnc || !s.templateId) throw new SmsError('Text messages are not set up.');
  const authKey = decryptSecret(s.authKeyEnc);
  if (!authKey) throw new SmsError('The saved MSG91 key cannot be read. Save it again in the operator console.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ template_id: s.templateId, short_url: '0', recipients: [{ mobiles: phone.replace(/^\+/, ''), otp: code }] }),
      signal: controller.signal,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.type === 'error') throw new SmsError(`MSG91 did not send it: ${String(body?.message || res.status).slice(0, 160)}`);
  } catch (e) {
    if (e instanceof SmsError) throw e;
    throw new SmsError('MSG91 could not be reached. Try again in a minute.');
  } finally {
    clearTimeout(timer);
  }
}
