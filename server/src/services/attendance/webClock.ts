import { BlockList, isIP } from 'node:net';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isMinor } from './biometrics.js';

/**
 * Clock-in from a browser (POST /attendance/clock), under the same punch
 * policy as the other doors (attendance audit, 7 Nov 2026, #6). Before this the
 * route took no position, site or address, so anyone whose punches go through
 * the phone with a work-site check could clock in from home instead.
 *
 * In this order:
 * 1. The company may switch browser clock-in off: then only readers and phone punches count.
 * 2. Someone HR set to punch from their phone (Portal access) punches there, with their
 *    position checked against the work sites; the plain clock is not theirs.
 * 3. With an address list, a clock-in counts only from one of those addresses (the office line).
 */

export type ClockRefusal = { code: 'WEB_CLOCK_OFF' | 'USE_PHONE_PUNCH' | 'WEB_CLOCK_ADDRESS'; message: string };

/** The list as stored: one entry a line (commas allowed too), blanks and duplicates dropped. */
export const parseAddressList = (text: unknown): string[] =>
  [...new Set(String(text ?? '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];

/** An address or a CIDR block ("49.205.10.4", "49.205.10.0/24", "2401:4900::/32"). */
export function validEntry(entry: string): boolean {
  const [addr, bits, extra] = entry.split('/');
  if (extra !== undefined) return false;
  const family = isIP(addr);
  if (!family) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  const n = Number(bits);
  return family === 4 ? n >= 0 && n <= 32 : n >= 0 && n <= 128;
}

/** An address as Express gives it, plain: "::ffff:1.2.3.4" is 1.2.3.4. */
export const plainIp = (ip: unknown) => {
  const s = String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return isIP(s) ? s : null;
};

/** Whether the address is one of the entries. No address (unknown) never matches a list. */
export function addressAllowed(ip: string | null, entries: string[]): boolean {
  if (!entries.length) return true;
  if (!ip) return false;
  const list = new BlockList();
  for (const e of entries) {
    if (!validEntry(e)) continue;
    const [addr, bits] = e.split('/');
    const type = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(addr, type);
    else list.addSubnet(addr, Number(bits), type);
  }
  return list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

export async function webClockSettings(orgId: string) {
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { webClockAllowed: true, webClockIps: true } });
  return { allowed: s?.webClockAllowed ?? true, addresses: parseAddressList(s?.webClockIps) };
}

/** Why this person may not clock in from this browser now, or null when they may. */
export async function webClockRefusal(
  employee: { orgId: string; mobilePunch?: boolean | null; dateOfBirth?: string | null },
  ip: string | null,
  settings?: { allowed: boolean; addresses: string[] },
): Promise<ClockRefusal | null> {
  const s = settings ?? (await webClockSettings(employee.orgId));
  if (!s.allowed) return { code: 'WEB_CLOCK_OFF', message: 'Clocking in from a browser is switched off here. Punch at a reader, or from your phone if HR set that up for you.' };
  /* Under 18 the phone never reads a location, so their phone punch is off and the plain clock is the way (phonePunch.ts). */
  if (employee.mobilePunch && !isMinor(employee.dateOfBirth)) {
    return { code: 'USE_PHONE_PUNCH', message: 'Your punches are made from your phone, at your work site. Use Punch on My attendance in the app.' };
  }
  if (!addressAllowed(ip, s.addresses)) return { code: 'WEB_CLOCK_ADDRESS', message: 'Clock-in from a browser counts only from the office network. Punch at a reader, or ask HR.' };
  return null;
}
