import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { SmsError, sendSmsCode } from './sms.js';

/**
 * One-time codes sent by text message for two-step sign-in (services/sms.ts
 * sends them). A code is six digits, works once, for five minutes; five wrong
 * tries spend it. Only a hash is kept, salted with the person and the purpose
 * so a code for one cannot be used for another.
 *
 * Each text costs money and can be abused to flood a number, so sending is
 * held back: a new code for the same person and purpose no sooner than 30
 * seconds after the last, at most five texts an hour per person and ten an
 * hour to any one number. Sending needs a correct password first (sign-in) or
 * a signed-in session plus the password (set-up).
 */
export type SmsPurpose = 'SETUP' | 'LOGIN' | 'DISABLE';

export const SMS_CODE_TTL_MS = 5 * 60_000;
export const SMS_RESEND_MS = 30_000;
const PER_USER_HOUR = 5;
const PER_PHONE_HOUR = 10;
const MAX_TRIES = 5;

const hashCode = (userId: string, purpose: SmsPurpose, code: string) => createHash('sha256').update(`${userId}:${purpose}:${code}`).digest('hex');

export class SmsLimitError extends Error {
  constructor(message: string, public retryAfterS: number) {
    super(message);
  }
}

/** Make and send a code. Throws SmsLimitError when held back, SmsError when it cannot be sent. */
export async function issueSmsCode(userId: string, phone: string, purpose: SmsPurpose): Promise<{ expiresIn: number; resendIn: number }> {
  return outsideTenant('sms: sign-in code', async () => {
    const now = Date.now();
    const hourAgo = new Date(now - 3_600_000);
    const last = await platformPrisma.smsCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last && now - last.createdAt.getTime() < SMS_RESEND_MS) {
      const wait = Math.ceil((SMS_RESEND_MS - (now - last.createdAt.getTime())) / 1000);
      throw new SmsLimitError(`A code was just sent. You can ask for another in ${wait} seconds.`, wait);
    }
    const [mine, theirs] = await Promise.all([
      platformPrisma.smsCode.count({ where: { userId, createdAt: { gte: hourAgo } } }),
      platformPrisma.smsCode.count({ where: { phone, createdAt: { gte: hourAgo } } }),
    ]);
    if (mine >= PER_USER_HOUR || theirs >= PER_PHONE_HOUR) {
      throw new SmsLimitError('Too many codes asked for in the last hour. Try again later, or use your authenticator app or a recovery code.', 3600);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    /* Earlier codes for the same purpose stop working: only the newest text counts. */
    await platformPrisma.smsCode.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date(now) } });
    const row = await platformPrisma.smsCode.create({
      data: { userId, purpose, phone, codeHash: hashCode(userId, purpose, code), expiresAt: new Date(now + SMS_CODE_TTL_MS) },
    });
    try {
      await sendSmsCode(phone, code);
    } catch (e) {
      /* Not sent: it must not count against the limits or be usable. */
      await platformPrisma.smsCode.delete({ where: { id: row.id } }).catch(() => undefined);
      throw e instanceof SmsError ? e : new SmsError('The code could not be sent.');
    }
    return { expiresIn: SMS_CODE_TTL_MS / 1000, resendIn: SMS_RESEND_MS / 1000 };
  });
}

/**
 * Spend the newest live code for this person and purpose if `raw` matches it.
 * Returns the number it was sent to, or null. A code works once, however many
 * requests race with it; every wrong try counts, and the fifth spends it.
 */
export async function useSmsCode(userId: string, purpose: SmsPurpose, raw: string): Promise<string | null> {
  const code = String(raw || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  return outsideTenant('sms: check a sign-in code', async () => {
    const live = await platformPrisma.smsCode.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!live) return null;
    const want = Buffer.from(live.codeHash, 'hex');
    const got = Buffer.from(hashCode(userId, purpose, code), 'hex');
    if (want.length === got.length && timingSafeEqual(want, got)) {
      const won = await platformPrisma.smsCode.updateMany({ where: { id: live.id, usedAt: null }, data: { usedAt: new Date() } });
      return won.count ? live.phone : null;
    }
    const tries = live.attempts + 1;
    await platformPrisma.smsCode.updateMany({ where: { id: live.id, usedAt: null }, data: tries >= MAX_TRIES ? { attempts: tries, usedAt: new Date() } : { attempts: tries } });
    return null;
  });
}
