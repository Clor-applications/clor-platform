/**
 * The pure parts of the connector: what to do with what it found, with no
 * network in the way, so they can be tested without a domain controller.
 */

export type DirectoryUser = { email: string; name: string; active: boolean };
export type ScimUser = { id: string; userName: string; active: boolean; name?: { formatted?: string } };

export type LdapPlan = {
  create: DirectoryUser[];
  /** SCIM id → active flag to set */
  setActive: Array<{ id: string; email: string; active: boolean }>;
  rename: Array<{ id: string; email: string; name: string }>;
  /** e-mails of directory users with no change */
  unchanged: number;
};

/**
 * Directory → CLOR. A person in the directory who is not in CLOR is created
 * (only when active: a disabled account is never brought in). One who is in
 * both follows the directory's enabled flag and display name. People CLOR has
 * that the directory lacks are switched off only when asked
 * (`deactivateMissing`) and only if this connector made them (`ours`): the
 * owner and anyone added by hand are never touched by a directory that does
 * not know them.
 */
export function planLdapSync(directory: DirectoryUser[], scim: ScimUser[], ours: Set<string>, deactivateMissing: boolean): LdapPlan {
  const byEmail = new Map(scim.map((u) => [u.userName.toLowerCase(), u]));
  const plan: LdapPlan = { create: [], setActive: [], rename: [], unchanged: 0 };
  const seen = new Set<string>();
  for (const d of directory) {
    const email = d.email.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const have = byEmail.get(email);
    if (!have) {
      if (d.active) plan.create.push({ ...d, email });
      continue;
    }
    let changed = false;
    if (have.active !== d.active) {
      plan.setActive.push({ id: have.id, email, active: d.active });
      changed = true;
    }
    if (d.name && have.name?.formatted && have.name.formatted !== d.name) {
      plan.rename.push({ id: have.id, email, name: d.name });
      changed = true;
    }
    if (!changed) plan.unchanged += 1;
  }
  if (deactivateMissing) {
    for (const u of scim) {
      const email = u.userName.toLowerCase();
      if (!seen.has(email) && ours.has(email) && u.active) plan.setActive.push({ id: u.id, email, active: false });
    }
  }
  return plan;
}

/** AD's userAccountControl bit 2 is ACCOUNTDISABLE. */
export const adActive = (uac: unknown) => {
  const n = Number(uac);
  return !Number.isFinite(n) || (n & 2) === 0;
};

/** The window to pull a reader for: from its last fetch less ten minutes (late punches), or from midnight IST today. */
export function pullWindow(lastFetchedAt: string | null | undefined, now = new Date()) {
  const midnight = new Date(`${new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00+05:30`);
  const from = lastFetchedAt ? new Date(new Date(lastFetchedAt).getTime() - 10 * 60_000) : midnight;
  return { from, to: now };
}

/** Tally's answer to an import: how many went in, or what it refused. */
export function readTallyReply(xml: string): { ok: boolean; message: string } {
  const created = /<CREATED>(\d+)<\/CREATED>/i.exec(xml)?.[1];
  const altered = /<ALTERED>(\d+)<\/ALTERED>/i.exec(xml)?.[1];
  const errors = /<ERRORS>(\d+)<\/ERRORS>/i.exec(xml)?.[1];
  const lineError = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/i.exec(xml)?.[1]?.trim();
  if (errors && Number(errors) > 0) return { ok: false, message: lineError ? `Tally refused it: ${lineError}` : `Tally reported ${errors} error(s).` };
  if (created || altered) return { ok: true, message: `Tally took it (${created || 0} created, ${altered || 0} altered).` };
  if (lineError) return { ok: false, message: `Tally refused it: ${lineError}` };
  return { ok: false, message: `Tally gave no import count: ${xml.replace(/\s+/g, ' ').slice(0, 200)}` };
}

/* ------------------------------------------------------------- reader clocks */

/** Hikvision writes zones POSIX-style, sign inverted: IST (+05:30) is "CST-5:30:00". */
export function hikvisionTimeZone(offsetMinutes: number) {
  const sign = offsetMinutes > 0 ? '-' : '+';
  const a = Math.abs(offsetMinutes);
  return `CST${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}:00`;
}

/** Minutes a zone is ahead of UTC at an instant. */
export function zoneOffsetMinutes(zone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).reduce<Record<string, string>>((m, p) => ((m[p.type] = p.value), m), {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "YYYY-MM-DDTHH:mm:ss" of an instant in a zone. */
export function localStamp(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).reduce<Record<string, string>>((m, p) => ((m[p.type] = p.value), m), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** A device's reported local time ("YYYY-MM-DD HH:mm:ss" or ISO with/without offset) → seconds its clock is ahead of now. */
export function clockOffsetSeconds(reported: string, zone: string, now = new Date()): number | null {
  const s = String(reported || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  let at: number;
  if (m[7]) at = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`);
  else {
    const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    at = guess - zoneOffsetMinutes(zone, new Date(guess)) * 60_000;
  }
  if (!Number.isFinite(at)) return null;
  return Math.round((at - now.getTime()) / 1000);
}

/** Set the reader's time when it is this far out, and not again within ten minutes. */
export const CLOCK_SET_SEC = 60;
export function clockSetDue(offsetSec: number | null, lastSetAt: number | null, now = Date.now()) {
  if (offsetSec === null || Math.abs(offsetSec) < CLOCK_SET_SEC) return false;
  return !lastSetAt || now - lastSetAt > 10 * 60_000;
}
