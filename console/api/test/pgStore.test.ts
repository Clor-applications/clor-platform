import { readFileSync } from 'node:fs';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pgStore, type Store } from '../src/store.js';

/*
 * The Postgres store against a real server. Runs when
 * CONSOLE_TEST_POSTGRES_URL names one (CI: the job's PostgreSQL on 5434);
 * it makes its own database, applies the migration, and drops it after.
 */
const server = process.env.CONSOLE_TEST_POSTGRES_URL;
const name = `clor_console_test_${process.pid}`;

describe.skipIf(!server)('the Postgres store', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let store: Store;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: server });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(server!);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await pool.query(readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));
    store = pgStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.end();
  });

  // protects=a member is found by either sign-in, GitHub's numeric id is kept exactly (beyond 32 bits), and each sign-in belongs to one member only; fails_when=an id is rounded, a lookup misses, or a second member takes the same GitHub account or CLOR login; no_claim=none beyond protects
  it('keeps a member under both sign-ins, each belonging to one member', async () => {
    const gh = '9007199254740993';
    const m = await store.createMember({ name: 'big-id', role: 'ENGINEER', githubUserId: gh, githubLogin: 'big-id', clorUserId: null, clorEmail: 'Dev@Clor.in', addedBy: null });
    expect((await store.findByGithub(gh))!.id).toBe(m.id);
    expect((await store.findWaitingByClorEmail('dev@clor.in'))!.id).toBe(m.id);
    await store.updateMember(m.id, { clorUserId: 'clor-user-1', clorEmail: 'dev@clor.in' });
    expect(await store.findWaitingByClorEmail('dev@clor.in')).toBeNull();
    expect((await store.findByClor('clor-user-1'))!.githubUserId).toBe(gh);
    await store.setTotp(m.id, { secretEnc: 'sealed', enabledAt: new Date('2026-11-14T00:00:00Z'), lastStep: 59 });
    await store.setTotpLastStep(m.id, 60);
    await store.updateMember(m.id, { role: 'VIEWER', active: false });
    expect(await store.getMember(m.id)).toMatchObject({ role: 'VIEWER', active: false, totpSecretEnc: 'sealed', totpLastStep: 60 });
    await expect(store.createMember({ name: 'again', role: 'VIEWER', githubUserId: gh, githubLogin: 'again', clorUserId: null, clorEmail: null, addedBy: null })).rejects.toThrow(/already belongs/);
    const other = await store.createMember({ name: 'other', role: 'VIEWER', githubUserId: '7', githubLogin: 'other', clorUserId: null, clorEmail: null, addedBy: null });
    await expect(store.updateMember(other.id, { clorUserId: 'clor-user-1' })).rejects.toThrow(/already belongs/);
    await expect(pool.query("INSERT INTO console_member (id, name, role) VALUES ('x', 'nobody', 'VIEWER')")).rejects.toThrow(/check/);
    expect((await store.listMembers()).map((x) => x.name)).toEqual(['big-id', 'other']);
  });

  // protects=the log is append-only in the database itself: no line can be changed, removed or emptied, by anyone; fails_when=an UPDATE, DELETE or TRUNCATE succeeds; no_claim=a superuser can still drop the trigger; the production role must not own the table (SETUP.md)
  it('refuses to change, remove or empty the log', async () => {
    const who = { memberId: 'm-1', actor: 'owner', ip: null };
    await store.addAudit({ ...who, action: 'RELEASE_STAGED', target: 'c5fbc8e', reason: null, detail: { sha: 'c5fbc8e' } });
    await store.addAudit({ ...who, action: 'ROLLED_BACK', target: 'clor-api-00127-622', reason: 'Errors', detail: {} });
    for (const sql of ["UPDATE console_audit_event SET reason = 'edited'", 'DELETE FROM console_audit_event', 'TRUNCATE console_audit_event']) await expect(pool.query(sql), sql).rejects.toThrow(/append-only/);
    const all = await store.listAudit({ limit: 10 });
    expect(all.map((e) => e.action)).toEqual(['ROLLED_BACK', 'RELEASE_STAGED']);
    expect(all[1].detail).toEqual({ sha: 'c5fbc8e' });
    expect((await store.listAudit({ action: 'ROLLED_BACK', limit: 10 })).map((e) => e.reason)).toEqual(['Errors']);
    expect(await store.listAudit({ memberId: 'm-42', limit: 10 })).toEqual([]);
  });
});
