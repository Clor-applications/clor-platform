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
 * people it created) next to its config, and beside it a spool of punches
 * CLOR could not take yet (clor-agent-spool.jsonl), sent again every round.
 *
 *   node clor-agent.cjs --token clora_… [--api https://api.clor.in] [--state ./clor-agent.json] [--once]
 *   node clor-agent.cjs --install --token clora_…     keeps the token in the state file and registers
 *                                                     a service (systemd / launchd / Task Scheduler)
 *   CLOR_AGENT_TOKEN / CLOR_API_URL / CLOR_AGENT_STATE do the same.
 *
 * When CLOR has a newer connector it downloads it over itself and restarts
 * (unless --no-update), so a customer's box stays current without a visit —
 * but only a file whose Ed25519 signature checks out against the key built
 * into this one (signing.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { pullByVendor } from '../../src/services/attendance/pull/drivers.js';
import type { PullContext } from '../../src/services/attendance/pull/common.js';
import { authedRequest } from '../../src/services/attendance/digest.js';
import { appendSpool, flushSpool, readSpool, retryableStatus, spooledLines, type SpoolBatch } from './spool.js';
import { verifyAgentSignature } from './signing.js';
import { adActive, clockOffsetSeconds, clockSetDue, hikvisionTimeZone, localStamp, planLdapSync, pullWindow, readTallyReply, zoneOffsetMinutes, type DirectoryUser, type ScimUser } from './plan.js';

/* The cloud's guards refuse private addresses; here the LAN is the point. */
process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';

const VERSION = '1.0.0';

const arg = (name: string, env: string, dflt = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return (i !== -1 && process.argv[i + 1]) || process.env[env] || dflt;
};
const SELF = path.resolve(process.argv[1] || 'clor-agent.cjs');
const STATE = arg('state', 'CLOR_AGENT_STATE', path.join(path.dirname(SELF), 'clor-agent.json'));
const SPOOL = path.join(path.dirname(STATE), 'clor-agent-spool.jsonl');
const ONCE = process.argv.includes('--once');
const NO_UPDATE = process.argv.includes('--no-update');

type State = { token?: string; api?: string; scimToken?: string; created?: string[] };
const loadState = (): State => {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
};
const saveState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });

/* The token and address: from the command line or environment, else from the state file a previous --install wrote. */
const stored = loadState();
const TOKEN = arg('token', 'CLOR_AGENT_TOKEN') || stored.token || '';
const API = (arg('api', 'CLOR_API_URL') || stored.api || 'https://api.clor.in').replace(/\/+$/, '');

if (!TOKEN) {
  console.error('Give the connector token: --token clora_… (made under Attendance → Integrations → On-site connectors).');
  process.exit(2);
}

/* ------------------------------------------------------------------ install */

/** Keep the token here and register a service that starts at boot and comes back after a crash. */
function install() {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  saveState({ ...loadState(), token: TOKEN, api: API });
  const node = process.execPath;
  const run = `"${node}" "${SELF}" --state "${STATE}"`;
  const plat = process.platform;
  try {
    if (plat === 'win32') {
      /* Task Scheduler: at start-up as SYSTEM, restarted every minute if it is not running. */
      execFileSync('schtasks', ['/Create', '/F', '/SC', 'ONSTART', '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/TN', 'CLOR connector', '/TR', run], { stdio: 'inherit' });
      execFileSync('schtasks', ['/Change', '/TN', 'CLOR connector', '/RI', '1', '/DU', '9999:59'], { stdio: 'ignore' });
      execFileSync('schtasks', ['/Run', '/TN', 'CLOR connector'], { stdio: 'inherit' });
      console.log('Installed as the scheduled task "CLOR connector" (starts at boot, runs as SYSTEM). Remove with: schtasks /Delete /TN "CLOR connector" /F');
    } else if (plat === 'darwin') {
      const plist = path.join(os.homedir(), 'Library/LaunchAgents/in.clor.agent.plist');
      fs.mkdirSync(path.dirname(plist), { recursive: true });
      fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>in.clor.agent</string>\n<key>ProgramArguments</key><array><string>${node}</string><string>${SELF}</string><string>--state</string><string>${STATE}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${path.join(path.dirname(SELF), 'clor-agent.log')}</string><key>StandardErrorPath</key><string>${path.join(path.dirname(SELF), 'clor-agent.log')}</string>\n</dict></plist>\n`);
      execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' });
      execFileSync('launchctl', ['load', plist], { stdio: 'inherit' });
      console.log(`Installed as a launch agent (${plist}); it starts at login and is kept alive. Remove with: launchctl unload "${plist}"`);
    } else {
      const unit = '/etc/systemd/system/clor-agent.service';
      const text = `[Unit]\nDescription=CLOR on-site connector\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nExecStart=${run}\nRestart=always\nRestartSec=10\nWorkingDirectory=${path.dirname(SELF)}\n\n[Install]\nWantedBy=multi-user.target\n`;
      try {
        fs.writeFileSync(unit, text);
        execFileSync('systemctl', ['daemon-reload'], { stdio: 'inherit' });
        execFileSync('systemctl', ['enable', '--now', 'clor-agent'], { stdio: 'inherit' });
        console.log('Installed as the systemd service clor-agent (sudo systemctl status clor-agent). Remove with: sudo systemctl disable --now clor-agent');
      } catch (e: any) {
        console.log(`Could not write ${unit} (run with sudo?). The unit it would write:\n\n${text}`);
        throw e;
      }
    }
  } catch (e: any) {
    console.error('Install did not finish:', String(e?.message || e));
    process.exit(1);
  }
}
if (process.argv.includes('--install')) {
  install();
  process.exit(0);
}

/* ------------------------------------------------------------- self-update */

/**
 * CLOR has a newer connector: fetch it and its signature, and only when the
 * signature checks out against the key built into this one, write it over
 * this file and start again. The service manager (or our own respawn on
 * Windows) brings it back. Anything wrong and this version keeps running.
 */
async function selfUpdate(latest: string) {
  const r = await fetch(`${API}/agent/v1/download`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`download answered ${r.status}`);
  const code = Buffer.from(await r.arrayBuffer());
  if (code.length < 100_000 || !code.subarray(0, 200).toString().includes('node')) throw new Error('the download does not look like the connector');
  const s = await fetch(`${API}/agent/v1/download.sig`, { signal: AbortSignal.timeout(30_000) });
  if (!s.ok) throw new Error(`the new connector has no signature (download.sig answered ${s.status}); not installing it`);
  if (!verifyAgentSignature(code, await s.text())) throw new Error('the new connector\'s signature does not check out; not installing it');
  const tmp = `${SELF}.new`;
  fs.writeFileSync(tmp, code, { mode: 0o755 });
  fs.renameSync(tmp, SELF);
  log(`updated to ${latest}; restarting`);
  if (process.platform === 'win32' || ONCE) {
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    spawn(process.execPath, [SELF, '--state', STATE], { detached: true, stdio: 'ignore', cwd: path.dirname(SELF) }).unref();
  }
  process.exit(0);
}

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
  if (!r.ok) throw Object.assign(new Error(json?.error || `CLOR answered ${r.status} for ${p}`), { status: r.status });
  return json;
}

/** Not reaching CLOR, or CLOR busy/down: worth keeping the work and trying again. A refusal (401, 404…) is not. */
const unreachable = (e: any) => typeof e?.status !== 'number' || retryableStatus(e.status);

/* ------------------------------------------------------------------- spool */

/** Send one spooled batch again. `replay` keeps CLOR from moving the reader's pull cursor: these lines are old. */
async function sendSpooled(b: SpoolBatch): Promise<number> {
  const r = await fetch(`${API}/agent/v1/readers/${b.readerId}/punches`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Clor-Agent': VERSION }, body: JSON.stringify({ ok: true, replay: true, lines: b.lines, received: b.lines.length }), signal: AbortSignal.timeout(60_000) });
  await r.text().catch(() => '');
  return r.status;
}

/*
 * Where to pull a reader from while its lines are sitting in the spool. CLOR's
 * cursor (lastFetchedAt) only moves when it takes a live batch, so without this
 * every round of an outage would read the same stretch again and spool it again.
 * Kept in memory: after a restart the reader is read from CLOR's cursor, and
 * CLOR drops the repeats.
 */
const spooledUpTo = new Map<string, Date>();

/* ------------------------------------------------------------------ readers */

async function pullReader(r: any): Promise<string> {
  const local = spooledUpTo.get(r.id);
  const cursor = local && (!r.lastFetchedAt || local > new Date(r.lastFetchedAt)) ? local.toISOString() : r.lastFetchedAt;
  const { from, to } = pullWindow(cursor);
  const ctx: PullContext = { baseUrl: String(r.baseUrl || '').replace(/\/+$/, ''), username: r.username || '', password: r.password || '', zone: r.zone || 'Asia/Kolkata', config: r.config || {}, mapping: r.mapping, from, to };
  let result;
  try {
    result = await pullByVendor(r.vendor, ctx);
  } catch (e: any) {
    result = { ok: false, message: String(e?.message || e).slice(0, 300), lines: [], received: 0 };
  }
  let up;
  try {
    up = await cloud('POST', `/readers/${r.id}/punches`, { ok: result.ok, message: result.message, lines: result.lines, sources: result.sources, ids: result.ids, aside: result.aside, received: result.received, payload: result.payload });
  } catch (e: any) {
    if (!result.ok || !result.lines.length || !unreachable(e)) throw e;
    /* CLOR could not take them now: keep them on disk and send them next round. */
    const waiting = appendSpool(SPOOL, { readerId: r.id, lines: result.lines, firstTriedAt: new Date().toISOString(), attempts: 1 }, log);
    spooledUpTo.set(r.id, to);
    return `${r.name}: ${result.received} read, kept to send later (${String(e?.message || e).slice(0, 120)}; ${waiting} waiting)`;
  }
  if (result.ok) spooledUpTo.delete(r.id);
  return result.ok ? `${r.name}: ${result.received} read, ${up.added} new` : `${r.name}: ${result.message}`;
}


/* ------------------------------------------------------------- reader clocks */

const clockSetAt = new Map<string, number>();

/** Read the reader's own clock and, when it is a minute or more out, set it. Hikvision (ISAPI) and Dahua (CGI) only. */
async function checkClock(r: any): Promise<string | null> {
  if (r.vendor !== 'HIKVISION' && r.vendor !== 'DAHUA') return null;
  const base = String(r.baseUrl || '').replace(/\/+$/, '');
  const zone = r.zone || 'Asia/Kolkata';
  let offset: number | null = null;
  try {
    if (r.vendor === 'HIKVISION') {
      const g = await authedRequest('GET', `${base}/ISAPI/System/time`, r.username, r.password, { timeoutMs: 10_000 });
      if (g.status !== 200) throw new Error(`time read answered ${g.status}`);
      const local = /<localTime>([^<]+)<\/localTime>/.exec(g.text)?.[1] || '';
      offset = clockOffsetSeconds(local, zone);
    } else {
      const g = await authedRequest('GET', `${base}/cgi-bin/global.cgi?action=getCurrentTime`, r.username, r.password, { timeoutMs: 10_000 });
      if (g.status !== 200) throw new Error(`time read answered ${g.status}`);
      offset = clockOffsetSeconds(/result=(.+)/.exec(g.text)?.[1]?.trim() || '', zone);
    }
    if (offset === null) throw new Error('the reader gave a time in a form the connector does not read');
    if (!clockSetDue(offset, clockSetAt.get(r.id) ?? null) || r.config?.setClock === false) {
      await cloud('POST', `/readers/${r.id}/clock`, { offsetSec: offset });
      return Math.abs(offset) >= 60 ? `${r.name}: clock ${offset > 0 ? 'fast' : 'slow'} by ${Math.abs(offset)} s (set recently, waiting)` : null;
    }
    const now = new Date();
    if (r.vendor === 'HIKVISION') {
      const body = `<?xml version="1.0" encoding="UTF-8"?><Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><timeMode>manual</timeMode><localTime>${localStamp(now, zone)}</localTime><timeZone>${hikvisionTimeZone(zoneOffsetMinutes(zone, now))}</timeZone></Time>`;
      const p = await authedRequest('PUT', `${base}/ISAPI/System/time`, r.username, r.password, { headers: { 'Content-Type': 'application/xml' }, body, timeoutMs: 10_000 });
      if (p.status < 200 || p.status >= 300) throw new Error(`time set answered ${p.status}`);
    } else {
      const p = await authedRequest('GET', `${base}/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(localStamp(now, zone).replace('T', ' '))}`, r.username, r.password, { timeoutMs: 10_000 });
      if (p.status !== 200 || !/OK/i.test(p.text)) throw new Error(`time set answered ${p.status} ${p.text.slice(0, 40)}`);
    }
    clockSetAt.set(r.id, Date.now());
    await cloud('POST', `/readers/${r.id}/clock`, { offsetSec: offset, set: true });
    return `${r.name}: clock was ${offset > 0 ? 'fast' : 'slow'} by ${Math.abs(offset)} s, set`;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    await cloud('POST', `/readers/${r.id}/clock`, { ...(offset !== null ? { offsetSec: offset } : {}), error: `clock: ${msg}` }).catch(() => {});
    return `${r.name}: clock ${msg}`;
  }
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
/* The last work list CLOR gave, in memory only: while CLOR cannot be reached, the readers are still read and their punches spooled. */
let lastConfig: any = null;
/* A version whose download was refused (bad or missing signature), and when: tried again hourly, not every minute. */
let refusedUpdate: { version: string; at: number } | null = null;

/** CLOR out of reach: read the readers from the last work list and keep what they give for later. */
async function offlineRound(why: string) {
  const notes: string[] = [];
  for (const r of lastConfig.readers || []) {
    try {
      notes.push(await pullReader(r));
    } catch (e: any) {
      notes.push(`${r.name}: ${String(e?.message || e)}`);
    }
  }
  log(`CLOR out of reach (${why}); readers read from the last work list:`, notes.join(' · ') || 'none');
  return Number(lastConfig.agent?.pollSeconds) || 60;
}

async function round() {
  const state = loadState();
  /* First what earlier rounds could not send, oldest first, before reading anything new. */
  try {
    const flushed = await flushSpool(SPOOL, sendSpooled, log);
    if (flushed.sent || flushed.dropped) log(`spool: sent ${flushed.sent} batch(es)${flushed.dropped ? `, dropped ${flushed.dropped}` : ''}; ${flushed.waitingLines} line(s) still waiting`);
  } catch (e: any) {
    log(`spool: could not use ${SPOOL}:`, String(e?.message || e));
  }
  let cfg;
  try {
    cfg = await cloud('GET', `/config?version=${VERSION}&hostname=${encodeURIComponent(os.hostname())}`);
  } catch (e: any) {
    if (lastConfig && unreachable(e)) return offlineRound(String(e?.message || e).slice(0, 200));
    throw e;
  }
  lastConfig = cfg;
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
      const c = await checkClock(r);
      if (c) notes.push(c);
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
  const spooled = spooledLines(readSpool(SPOOL));
  if (spooled) notes.unshift(`${spooled} punch line(s) waiting to send`);
  const summary = notes.join(' · ').slice(0, 500) || 'Nothing to do';
  await cloud('POST', '/report', { summary, error, spooled });
  log(summary);
  if (cfg.agent?.latestVersion && cfg.agent.latestVersion !== VERSION) {
    const latest = String(cfg.agent.latestVersion);
    if (NO_UPDATE) log(`a newer connector (${latest}) is available at ${API}/agent/v1/download`);
    else if (!(refusedUpdate?.version === latest && Date.now() - refusedUpdate.at < 3_600_000)) {
      try {
        await selfUpdate(latest);
      } catch (e: any) {
        refusedUpdate = { version: latest, at: Date.now() };
        log(`self-update to ${latest} failed, staying on ${VERSION}:`, String(e?.message || e));
      }
    }
  }
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
