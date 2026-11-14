import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

export type Role = 'OWNER' | 'ENGINEER' | 'VIEWER';
export const ROLES: Role[] = ['VIEWER', 'ENGINEER', 'OWNER'];
export const atLeast = (have: Role, need: Role) => ROLES.indexOf(have) >= ROLES.indexOf(need);

/** A person. They sign in with GitHub, with their CLOR staff login, or both. */
export interface Member {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  githubUserId: string | null;
  githubLogin: string | null;
  /** The CLOR platform user id, bound the first time they sign in with CLOR. */
  clorUserId: string | null;
  /** The address they were added by. It decides access only until `clorUserId` is bound. */
  clorEmail: string | null;
  /** For sign-in with a password. Lower case. */
  email: string | null;
  passwordHash: string | null;
  /** Hash of the one-time code that lets them choose a password, and when it stops working. */
  setupCodeHash: string | null;
  setupExpiresAt: Date | null;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  addedBy: string | null;
  createdAt: Date;
}

export interface AuditEvent {
  id: string;
  at: Date;
  memberId: string;
  actor: string;
  action: string;
  target: string;
  reason: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
}

export interface AuditFilter {
  action?: string;
  memberId?: string;
  limit: number;
}

export type NewMember = Pick<Member, 'name' | 'role' | 'githubUserId' | 'githubLogin' | 'clorUserId' | 'clorEmail' | 'addedBy'> & Partial<Pick<Member, 'email' | 'setupCodeHash' | 'setupExpiresAt'>>;
export type MemberPatch = Partial<Pick<Member, 'name' | 'role' | 'active' | 'githubUserId' | 'githubLogin' | 'clorUserId' | 'clorEmail' | 'email' | 'passwordHash' | 'setupCodeHash' | 'setupExpiresAt'>>;

/** Everything the Console keeps for itself. Two implementations: Postgres, and memory for tests and local preview. */
export interface Store {
  ping(): Promise<void>;
  getMember(id: string): Promise<Member | null>;
  findByGithub(githubUserId: string): Promise<Member | null>;
  findByClor(clorUserId: string): Promise<Member | null>;
  findByEmail(email: string): Promise<Member | null>;
  /** A member added by this address who has not signed in with CLOR yet. */
  findWaitingByClorEmail(email: string): Promise<Member | null>;
  listMembers(): Promise<Member[]>;
  createMember(m: NewMember): Promise<Member>;
  updateMember(id: string, patch: MemberPatch): Promise<Member>;
  setTotp(id: string, t: { secretEnc: string | null; enabledAt: Date | null; lastStep: number | null }): Promise<void>;
  setTotpLastStep(id: string, step: number): Promise<void>;
  addAudit(e: Omit<AuditEvent, 'id' | 'at'>): Promise<AuditEvent>;
  listAudit(f: AuditFilter): Promise<AuditEvent[]>;
}

const same = (a: string | null, b: string) => (a || '').toLowerCase() === b.toLowerCase();

export function memoryStore(now: () => number = Date.now): Store & { audit: AuditEvent[] } {
  const members = new Map<string, Member>();
  const audit: AuditEvent[] = [];
  const find = (test: (m: Member) => boolean) => {
    const m = [...members.values()].find(test);
    return m ? { ...m } : null;
  };
  return {
    audit,
    async ping() {},
    async getMember(id) {
      return find((m) => m.id === id);
    },
    async findByGithub(githubUserId) {
      return find((m) => m.githubUserId === githubUserId);
    },
    async findByClor(clorUserId) {
      return find((m) => m.clorUserId === clorUserId);
    },
    async findByEmail(email) {
      return find((m) => Boolean(m.email) && same(m.email, email));
    },
    async findWaitingByClorEmail(email) {
      return find((m) => !m.clorUserId && same(m.clorEmail, email));
    },
    async listMembers() {
      return [...members.values()].map((m) => ({ ...m })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async createMember(m) {
      for (const other of members.values()) {
        if (m.githubUserId && other.githubUserId === m.githubUserId) throw new Error('That GitHub account already belongs to a member.');
        if (m.clorUserId && other.clorUserId === m.clorUserId) throw new Error('That CLOR login already belongs to a member.');
        if (m.email && same(other.email, m.email)) throw new Error('That email address already belongs to a member.');
      }
      const row: Member = { email: null, setupCodeHash: null, setupExpiresAt: null, ...m, passwordHash: null, id: randomUUID(), active: true, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, createdAt: new Date(now()) };
      members.set(row.id, row);
      return { ...row };
    },
    async updateMember(id, patch) {
      const m = members.get(id);
      if (!m) throw new Error('No such member.');
      for (const other of members.values()) {
        if (other.id === id) continue;
        if (patch.githubUserId && other.githubUserId === patch.githubUserId) throw new Error('That GitHub account already belongs to a member.');
        if (patch.clorUserId && other.clorUserId === patch.clorUserId) throw new Error('That CLOR login already belongs to a member.');
        if (patch.email && same(other.email, patch.email)) throw new Error('That email address already belongs to a member.');
      }
      Object.assign(m, patch);
      return { ...m };
    },
    async setTotp(id, t) {
      const m = members.get(id);
      if (m) Object.assign(m, { totpSecretEnc: t.secretEnc, totpEnabledAt: t.enabledAt, totpLastStep: t.lastStep });
    },
    async setTotpLastStep(id, step) {
      const m = members.get(id);
      if (m) m.totpLastStep = step;
    },
    async addAudit(e) {
      const row: AuditEvent = { ...e, id: String(audit.length + 1), at: new Date(now()) };
      audit.push(row);
      return row;
    },
    async listAudit(f) {
      return audit
        .filter((e) => (!f.action || e.action === f.action) && (!f.memberId || e.memberId === f.memberId))
        .slice()
        .reverse()
        .slice(0, f.limit);
    },
  };
}

const toMember = (r: Record<string, unknown>): Member => ({
  id: String(r.id),
  name: String(r.name),
  role: r.role as Role,
  active: Boolean(r.active),
  githubUserId: r.github_user_id == null ? null : String(r.github_user_id),
  githubLogin: (r.github_login as string) ?? null,
  clorUserId: (r.clor_user_id as string) ?? null,
  clorEmail: (r.clor_email as string) ?? null,
  email: (r.email as string) ?? null,
  passwordHash: (r.password_hash as string) ?? null,
  setupCodeHash: (r.setup_code_hash as string) ?? null,
  setupExpiresAt: (r.setup_expires_at as Date) ?? null,
  totpSecretEnc: (r.totp_secret_enc as string) ?? null,
  totpEnabledAt: (r.totp_enabled_at as Date) ?? null,
  totpLastStep: r.totp_last_step == null ? null : Number(r.totp_last_step),
  addedBy: r.added_by == null ? null : String(r.added_by),
  createdAt: r.created_at as Date,
});

const toAudit = (r: Record<string, unknown>): AuditEvent => ({
  id: String(r.id),
  at: r.at as Date,
  memberId: String(r.member_id),
  actor: String(r.actor),
  action: String(r.action),
  target: String(r.target),
  reason: (r.reason as string) ?? null,
  detail: (r.detail as Record<string, unknown>) ?? {},
  ip: (r.ip as string) ?? null,
});

const COLUMN: Record<keyof MemberPatch, string> = { name: 'name', role: 'role', active: 'active', githubUserId: 'github_user_id', githubLogin: 'github_login', clorUserId: 'clor_user_id', clorEmail: 'clor_email', email: 'email', passwordHash: 'password_hash', setupCodeHash: 'setup_code_hash', setupExpiresAt: 'setup_expires_at' };

export function pgStore(pool: Pool): Store {
  const q = (text: string, values: unknown[] = []) => pool.query(text, values);
  const one = async (text: string, values: unknown[]) => {
    const r = await q(text, values);
    return r.rows[0] ? toMember(r.rows[0]) : null;
  };
  /* A second member with the same GitHub account or CLOR login is refused by the unique columns. */
  const taken = (e: unknown) => {
    if ((e as { code?: string })?.code !== '23505') throw e;
    throw new Error('That sign-in already belongs to a member.');
  };
  return {
    async ping() {
      await q('SELECT 1');
    },
    getMember: (id) => one('SELECT * FROM console_member WHERE id = $1', [id]),
    findByGithub: (id) => one('SELECT * FROM console_member WHERE github_user_id = $1', [id]),
    findByClor: (id) => one('SELECT * FROM console_member WHERE clor_user_id = $1', [id]),
    findByEmail: (email) => one('SELECT * FROM console_member WHERE lower(email) = lower($1)', [email]),
    findWaitingByClorEmail: (email) => one('SELECT * FROM console_member WHERE clor_user_id IS NULL AND lower(clor_email) = lower($1)', [email]),
    async listMembers() {
      return (await q('SELECT * FROM console_member ORDER BY created_at')).rows.map(toMember);
    },
    async createMember(m) {
      const r = await q(
        `INSERT INTO console_member (id, name, role, github_user_id, github_login, clor_user_id, clor_email, added_by, email, setup_code_hash, setup_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [randomUUID(), m.name, m.role, m.githubUserId, m.githubLogin, m.clorUserId, m.clorEmail, m.addedBy, m.email ?? null, m.setupCodeHash ?? null, m.setupExpiresAt ?? null],
      ).catch(taken);
      return toMember(r!.rows[0]);
    },
    async updateMember(id, patch) {
      const keys = Object.keys(patch) as Array<keyof MemberPatch>;
      if (!keys.length) return (await this.getMember(id))!;
      const sets = keys.map((k, i) => `${COLUMN[k]} = $${i + 2}`);
      const r = await q(`UPDATE console_member SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => patch[k])]).catch(taken);
      if (!r!.rows[0]) throw new Error('No such member.');
      return toMember(r!.rows[0]);
    },
    async setTotp(id, t) {
      await q('UPDATE console_member SET totp_secret_enc = $2, totp_enabled_at = $3, totp_last_step = $4 WHERE id = $1', [id, t.secretEnc, t.enabledAt, t.lastStep]);
    },
    async setTotpLastStep(id, step) {
      await q('UPDATE console_member SET totp_last_step = $2 WHERE id = $1', [id, step]);
    },
    async addAudit(e) {
      const r = await q(
        `INSERT INTO console_audit_event (member_id, actor, action, target, reason, detail, ip) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [e.memberId, e.actor, e.action, e.target, e.reason, JSON.stringify(e.detail), e.ip],
      );
      return toAudit(r.rows[0]);
    },
    async listAudit(f) {
      const where: string[] = [];
      const values: unknown[] = [];
      if (f.action) where.push(`action = $${values.push(f.action)}`);
      if (f.memberId) where.push(`member_id = $${values.push(f.memberId)}`);
      values.push(f.limit);
      const r = await q(`SELECT * FROM console_audit_event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT $${values.length}`, values);
      return r.rows.map(toAudit);
    },
  };
}
