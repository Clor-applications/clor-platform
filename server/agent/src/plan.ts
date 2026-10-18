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
