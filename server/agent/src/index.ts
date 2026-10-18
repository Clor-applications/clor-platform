#!/usr/bin/env node
/**
 * CLOR on-site connector.
 *
 * A single file (built with esbuild from this folder and the cloud's own
 * reader drivers) that runs on a machine inside the customer's network and
 * does, every minute, what the cloud cannot reach:
 *
 *   - pulls punches from readers on the LAN (Hikvision, Dahua, BioStar, any
 *     JSON API) with the same drivers the cloud uses, and sends them up;
 *   - posts Tally vouchers CLOR has queued to Tally's HTTP port;
 *   - syncs Active Directory / LDAP users into CLOR over SCIM.
 *
 * It only ever calls out — to CLOR over HTTPS, and to the LAN devices. It
 * keeps a small state file (the SCIM token it was handed once, and which
 * people it created) next to its config.
 *
 *   node clor-agent.cjs --token clora_… [--api https://api.clor.in] [--state ./clor-agent.json] [--once]
 *   CLOR_AGENT_TOKEN / CLOR_API_URL / CLOR_AGENT_STATE do the same.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { pullByVendor } from '../../src/services/attendance/pull/drivers.js';
import type { PullContext } from '../../src/services/attendance/pull/common.js';
import { adActive, planLdapSync, pullWindow, readTallyReply, type DirectoryUser, type ScimUser } from './plan.js';

/* The cloud's guards refuse private addresses; here the LAN is the point. */
process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';

const VERSION = '1.0.0';

const arg = (name: string, env: string, dflt = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return (i !== -1 && process.argv[i + 1]) || process.env[env] || dflt;
};
const TOKEN = arg('token', 'CLOR_AGENT_TOKEN');
const API = arg('api', 'CLOR_API_URL', 'https://api.clor.in').replace(/\/+$/, '');
const STATE = arg('state', 'CLOR_AGENT_STATE', path.join(process.cwd(), 'clor-agent.json'));
const ONCE = process.argv.includes('--once');

if (!TOKEN) {
  console.error('Give the connector token: --token clora_… (made under Attendance → Integrations → On-site connectors).');
  process.exit(2);
}

type State = { scimToken?: string; created?: string[] };
const loadState = (): State => {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
};
const saveState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function cloud(method: string, p: string, body?: unknown) {
  const r = await fetch(`${API}/agent/v1${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Clor-Agent': VERSION }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!r.ok) throw new Error(json?.error || `CLOR answered ${r.status} for ${p}`);
  return json;
}

/* ------------------------------------------------------------------ readers */

async function pullReader(r: any): Promise<string> {
  const { from, to } = pullWindow(r.lastFetchedAt);
  const ctx: PullContext = { baseUrl: String(r.baseUrl || '').replace(/\/+$/, ''), username: r.username || '', password: r.password || '', zone: r.zone || 'Asia/Kolkata', config: r.config || {}, mapping: r.mapping, from, to };
  let result;
  try {
    result = await pullByVendor(r.vendor, ctx);
  } catch (e: any) {
    result = { ok: false, message: String(e?.message || e).slice(0, 300), lines: [], received: 0 };
  }
  const up = await cloud('POST', `/readers/${r.id}/punches`, { ok: result.ok, message: result.message, lines: result.lines, received: result.received, payload: result.payload });
  return result.ok ? `${r.name}: ${result.received} read, ${up.added} new` : `${r.name}: ${result.message}`;
}

/* -------------------------------------------------------------------- Tally */

function postToTally(host: string, port: number, xml: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method: 'POST', path: '/', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml) }, timeout: 30_000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('Tally did not answer within 30 s — is it open with the company loaded, and is its HTTP port on?')));
    req.on('error', (e) => reject(new Error(`Could not reach Tally at ${host}:${port}: ${e.message}`)));
    req.end(xml);
  });
}

async function runJob(job: any, tally: any): Promise<string> {
  if (job.kind === 'TALLY_XML') {
    if (!tally?.host) {
      await cloud('POST', `/jobs/${job.id}/result`, { ok: false, result: 'No Tally address is set for this connector.' });
      return `${job.payload?.label || job.id}: no Tally address`;
    }
    try {
      const reply = await postToTally(tally.host, Number(tally.port) || 9000, job.payload.xml);
      const r = readTallyReply(reply);
      await cloud('POST', `/jobs/${job.id}/result`, { ok: r.ok, result: r.message });
      return `${job.payload?.label || job.id}: ${r.message}`;
    } catch (e: any) {
      await cloud('POST', `/jobs/${job.id}/result`, { ok: false, result: String(e?.message || e) });
      return `${job.payload?.label || job.id}: ${String(e?.message || e)}`;
    }
  }
  await cloud('POST', `/jobs/${job.id}/result`, { ok: false, result: `This connector (v${VERSION}) does not know job kind ${job.kind}; update it.` });
  return `${job.id}: unknown kind ${job.kind}`;
}

/* --------------------------------------------------------------------- LDAP */

async function readDirectory(ldap: any): Promise<DirectoryUser[]> {
  const { Client } = await import('ldapts');
  const client = new Client({ url: ldap.url, timeout: 30_000, connectTimeout: 15_000, tlsOptions: ldap.url.startsWith('ldaps://') ? { rejectUnauthorized: ldap.rejectUnauthorized !== false } : undefined });
  const emailAttr = ldap.emailAttr || 'mail';
  try {
    await client.bind(ldap.bindDn, ldap.bindPassword || '');
    const { searchEntries } = await client.search(ldap.baseDn, {
      scope: 'sub',
      filter: ldap.filter || `(&(objectClass=user)(${emailAttr}=*)(!(objectClass=computer)))`,
      attributes: [emailAttr, 'displayName', 'givenName', 'sn', 'cn', 'userAccountControl'],
      paged: { pageSize: 500 },
    });
    const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    return searchEntries
      .map((e: any) => {
        const email = String(one(e[emailAttr]) || '').trim().toLowerCase();
        const name = String(one(e.displayName) || `${one(e.givenName) || ''} ${one(e.sn) || ''}`.trim() || one(e.cn) || email.split('@')[0]).slice(0, 120);
        return { email, name, active: adActive(one(e.userAccountControl)) };
      })
      .filter((u: DirectoryUser) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email));
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function scim(token: string, base: string, method: string, p: string, body?: unknown) {
  const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!r.ok) throw new Error(json?.detail || `SCIM ${method} ${p} answered ${r.status}`);
  return json;
}

async function syncDirectory(ldap: any, state: State): Promise<string> {
  if (!state.scimToken) return 'LDAP: waiting for the SCIM token from CLOR (make a new connector token if this persists)';
  const base = ldap.scimBase;
  const directory = await readDirectory(ldap);
  const existing: ScimUser[] = [];
  for (let start = 1; start < 100_000; start += 200) {
    const page = await scim(state.scimToken, base, 'GET', `/Users?startIndex=${start}&count=200`);
    existing.push(...(page.Resources || []));
    if (!page.Resources?.length || existing.length >= page.totalResults) break;
  }
  const ours = new Set((state.created || []).map((e) => e.toLowerCase()));
  const plan = planLdapSync(directory, existing, ours, ldap.deactivateMissing === true);
  let created = 0;
  let failed = 0;
  for (const u of plan.create) {
    try {
      await scim(state.scimToken, base, 'POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: u.email, name: { formatted: u.name }, displayName: u.name, emails: [{ value: u.email, primary: true }], active: true });
      ours.add(u.email);
      created += 1;
    } catch (e: any) {
      failed += 1;
      log('LDAP create failed', u.email, String(e?.message || e));
    }
  }
  for (const s of plan.setActive) {
    try {
      await scim(state.scimToken, base, 'PATCH', `/Users/${s.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: s.active }] });
    } catch (e: any) {
      failed += 1;
      log('LDAP active failed', s.email, String(e?.message || e));
    }
  }
  for (const r of plan.rename) {
    try {
      await scim(state.scimToken, base, 'PATCH', `/Users/${r.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'name.formatted', value: r.name }] });
    } catch (e: any) {
      failed += 1;
    }
  }
  state.created = [...ours];
  saveState(state);
  return `LDAP: ${directory.length} in directory, ${created} added, ${plan.setActive.length} switched on/off, ${plan.rename.length} renamed, ${plan.unchanged} unchanged${failed ? `, ${failed} failed` : ''}`;
}

/* -------------------------------------------------------------------- rounds */

let ldapLastAt = 0;

async function round() {
  const state = loadState();
  const cfg = await cloud('GET', `/config?version=${VERSION}&hostname=${encodeURIComponent(os.hostname())}`);
  if (cfg.once?.scimToken) {
    state.scimToken = cfg.once.scimToken;
    saveState(state);
    log('received the SCIM token for directory sync');
  }
  const notes: string[] = [];
  let error: string | null = null;
  for (const r of cfg.readers || []) {
    try {
      notes.push(await pullReader(r));
    } catch (e: any) {
      notes.push(`${r.name}: ${String(e?.message || e)}`);
    }
  }
  for (const j of cfg.jobs || []) {
    try {
      notes.push(await runJob(j, cfg.tally));
    } catch (e: any) {
      notes.push(`${j.id}: ${String(e?.message || e)}`);
    }
  }
  /* The directory changes slowly: once an hour, or every round with --once. */
  if (cfg.ldap && (ONCE || Date.now() - ldapLastAt > 3_600_000)) {
    ldapLastAt = Date.now();
    try {
      notes.push(await syncDirectory(cfg.ldap, state));
    } catch (e: any) {
      error = `LDAP: ${String(e?.message || e)}`;
      notes.push(error);
    }
  }
  const summary = notes.join(' · ').slice(0, 500) || 'Nothing to do';
  await cloud('POST', '/report', { summary, error });
  log(summary);
  if (cfg.agent?.latestVersion && cfg.agent.latestVersion !== VERSION) log(`a newer connector (${cfg.agent.latestVersion}) is available at ${API}/agent/v1/download`);
  return Number(cfg.agent?.pollSeconds) || 60;
}

async function main() {
  log(`CLOR connector ${VERSION} on ${os.hostname()} → ${API}`);
  for (;;) {
    let wait = 60;
    try {
      wait = await round();
    } catch (e: any) {
      log('round failed:', String(e?.message || e));
      wait = 60;
    }
    if (ONCE) return;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
