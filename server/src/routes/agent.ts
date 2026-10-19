import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';
import { istLocal } from '../services/attendance/punchMapping.js';
import { hashToken } from './publicApi.js';
import { ingestPunches } from './iclock.js';
import { isFeatureEnabled } from '../services/features.js';

/**
 * /agent/v1 — what the on-site connector (server/agent) talks to. A small
 * service on a customer's network, holding one token, that every minute:
 *
 *   GET  /config                 what to do: readers to pull (with their
 *                                credentials, in the clear over HTTPS), the
 *                                Tally target, LDAP settings, jobs waiting,
 *                                and the SCIM token once
 *   POST /readers/:id/punches    lines a reader gave it, as ingestPunches takes
 *                                (replay: true for lines it kept while CLOR was
 *                                out of reach: taken, but the cursor stays put)
 *   POST /jobs/:id/result        how a job went
 *
 * The agent is the client; CLOR never reaches into the customer's network.
 */
export const agentRouter = Router();

export const newAgentToken = () => `clora_${randomBytes(24).toString('base64url')}`;
export const AGENT_VERSION = '1.0.0';

type Agent = NonNullable<Awaited<ReturnType<typeof peoplePrisma.siteAgent.findUnique>>>;
declare module 'express-serve-static-core' {
  interface Request {
    agent?: Agent;
  }
}

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

export const agentConfig = (a: { configJson: string }) => {
  try {
    return JSON.parse(a.configJson || '{}') as Record<string, any>;
  } catch {
    return {};
  }
};
export const agentSecrets = (a: { secretsEnc: string | null }): Record<string, string> => {
  try {
    return a.secretsEnc ? JSON.parse(decryptSecret(a.secretsEnc)) : {};
  } catch {
    return {};
  }
};

/* The download of the connector itself needs no token: it holds nothing. */
agentRouter.get('/download', (_req, res) => {
  const file = path.resolve(process.cwd(), 'dist-agent/clor-agent.cjs');
  if (!fs.existsSync(file)) return fail(res, 404, 'The connector is not built on this server.');
  res.setHeader('Content-Disposition', 'attachment; filename="clor-agent.cjs"');
  res.type('application/javascript').send(fs.readFileSync(file));
});

/* Its Ed25519 signature (scripts/sign-agent.mjs). A connector installs an update only when this checks out. */
agentRouter.get('/download.sig', (_req, res) => {
  const file = path.resolve(process.cwd(), 'dist-agent/clor-agent.cjs.sig');
  if (!fs.existsSync(file)) return fail(res, 404, 'The connector on this server is not signed, so connectors will not update to it. Sign it with npm run agent:sign before deploying.');
  res.type('text/plain').send(fs.readFileSync(file, 'utf8'));
});

agentRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  const m = /^Bearer\s+(clora_[A-Za-z0-9_-]{20,})$/i.exec(String(req.headers.authorization || ''));
  if (!m) return fail(res, 401, 'Send the connector token as "Authorization: Bearer <token>".');
  const a = await peoplePrisma.siteAgent.findUnique({ where: { tokenHash: hashToken(m[1]) } });
  if (!a) return fail(res, 401, 'This connector token is not valid (revoked, or made for another server).');
  if (!a.isActive) return fail(res, 403, 'This connector is switched off in CLOR.');
  if (!(await isFeatureEnabled(a.accountId, a.orgId, 'attendance'))) return fail(res, 403, 'Attendance is not switched on for this organisation.');
  req.agent = a;
  next();
});

/** Everything the agent needs for one round. */
agentRouter.get('/config', async (req, res) => {
  const a = req.agent!;
  const now = new Date();
  const version = String(req.query.version || req.headers['x-clor-agent'] || '').slice(0, 40) || null;
  const hostname = String(req.query.hostname || '').slice(0, 120) || null;
  const cfg = agentConfig(a);
  const secrets = agentSecrets(a);

  /* Secrets kept for the first fetch only (the SCIM token): handed over, then forgotten here. */
  let once: Record<string, string> = {};
  if (a.pendingEnc) {
    try {
      once = JSON.parse(decryptSecret(a.pendingEnc));
    } catch {
      once = {};
    }
  }
  await peoplePrisma.siteAgent.update({ where: { id: a.id }, data: { lastSeenAt: now, ...(version ? { version } : {}), ...(hostname ? { hostname } : {}), ...(a.pendingEnc ? { pendingEnc: null } : {}) } });

  const readers = await peoplePrisma.attendanceDevice.findMany({ where: { orgId: a.orgId, agentId: a.id, isActive: true } });
  const jobs = await peoplePrisma.agentJob.findMany({ where: { agentId: a.id, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 20 });
  if (jobs.length) await peoplePrisma.agentJob.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } } });

  res.json({
    agent: { id: a.id, name: a.name, pollSeconds: Number(cfg.pollSeconds) || 60, latestVersion: AGENT_VERSION },
    readers: readers.map((d) => ({
      id: d.id,
      name: d.name,
      vendor: d.vendor,
      baseUrl: d.apiUrl,
      username: d.apiUsername,
      password: d.apiSecret ? decryptSecret(d.apiSecret) : '',
      zone: d.sourceTimezone,
      config: d.configJson ? JSON.parse(d.configJson) : {},
      mapping: d.mappingJson ? JSON.parse(d.mappingJson) : null,
      /* Pull from here (ten minutes' overlap is the agent's job). */
      lastFetchedAt: d.lastFetchedAt,
      /* What the cloud knows of its clock; the connector reads the real thing and sets it when a minute or more out. */
      clockOffsetSec: d.clockOffsetSec,
      clockCheckedAt: d.clockCheckedAt,
    })),
    tally: cfg.tally && cfg.tally.host ? { host: cfg.tally.host, port: Number(cfg.tally.port) || 9000, company: cfg.tally.company || null } : null,
    ldap: cfg.ldap && cfg.ldap.url ? { ...cfg.ldap, bindPassword: secrets.ldapBindPassword || '', scimBase: `${process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || 'https://api.clor.in'}/scim/v2` } : null,
    once,
    jobs: jobs.map((j) => ({ id: j.id, kind: j.kind, payload: JSON.parse(j.payloadJson) })),
  });
});

/** Punches a reader on the LAN gave the agent, as ADMS-style lines. */
agentRouter.post('/readers/:id/punches', async (req, res) => {
  const a = req.agent!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), orgId: a.orgId, agentId: a.id } });
  if (!device) return fail(res, 404, 'That reader is not assigned to this connector.');
  const body = req.body || {};
  const now = new Date();
  /* Each line with the vendor record and event id behind it, when the connector sends them (same order). */
  const rawLines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
  const kept = rawLines
    .map((l, i) => ({ l: String(l), source: Array.isArray(body.sources) && body.sources[i] != null ? String(body.sources[i]).slice(0, 8_000) : undefined, id: Array.isArray(body.ids) && body.ids[i] != null ? String(body.ids[i]).slice(0, 120) : null }))
    .filter((x) => /^[^\t]+\t\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\t/.test(x.l))
    .slice(0, 5000);
  const lines = kept.map((x) => x.l);
  const aside = (Array.isArray(body.aside) ? body.aside : []).slice(0, 2000).map((a: any) => ({ original: String(a?.original ?? '').slice(0, 8_000), reason: String(a?.reason ?? 'Set aside').slice(0, 200), id: a?.id != null ? String(a.id).slice(0, 120) : null }));
  const seen = body.payload ? { lastPayload: String(body.payload).slice(0, 20_000), lastPayloadAt: now } : {};
  if (body.ok === false) {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastError: String(body.message || 'The connector could not read the reader.').slice(0, 300), ...seen } });
    return res.json({ added: 0 });
  }
  const added = lines.length || aside.length ? await ingestPunches(device, lines.join('\n'), { sources: kept.map((x) => x.source ?? x.l), ids: kept.map((x) => x.id), aside }) : 0;
  /* Old lines from the connector's spool say nothing about how far, or when, the reader was last read: leave the reader's row alone. */
  if (body.replay === true) return res.json({ added, received: lines.length });
  await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastFetchedAt: now, lastSeenAt: now, lastError: null, ...seen } });
  res.json({ added, received: lines.length });
});

/** The reader's clock as the connector read it (and set it, when it was out). */
agentRouter.post('/readers/:id/clock', async (req, res) => {
  const a = req.agent!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), orgId: a.orgId, agentId: a.id } });
  if (!device) return fail(res, 404, 'That reader is not assigned to this connector.');
  const now = new Date();
  const offset = Number(req.body?.offsetSec);
  const set = req.body?.set === true;
  const data: Record<string, unknown> = { lastSeenAt: now };
  if (Number.isFinite(offset)) Object.assign(data, { clockOffsetSec: set ? 0 : Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.round(offset))), clockCheckedAt: now });
  if (req.body?.error) data.lastError = String(req.body.error).slice(0, 300);
  await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data });
  if (set || req.body?.error) {
    await peoplePrisma.deviceLog.create({
      data: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, kind: req.body?.error ? 'ERROR' : 'OPERATION', code: 'CLOCK_SET', localTime: istLocal(now), details: req.body?.error ? `Could not set the time: ${String(req.body.error).slice(0, 300)}` : `Time set by the connector (was ${Math.round(offset)} s out).` },
    });
  }
  res.json({ ok: true });
});

/** How a job went. */
agentRouter.post('/jobs/:id/result', async (req, res) => {
  const a = req.agent!;
  const job = await peoplePrisma.agentJob.findFirst({ where: { id: String(req.params.id), agentId: a.id } });
  if (!job) return fail(res, 404, 'No such job for this connector.');
  const ok = req.body?.ok === true;
  await peoplePrisma.agentJob.update({ where: { id: job.id }, data: { status: ok ? 'DONE' : 'FAILED', doneAt: new Date(), result: String(req.body?.result || (ok ? 'Done' : 'Failed')).slice(0, 2000) } });
  res.json({ ok: true });
});

/** A word on how the round went, for the Integrations screen. (`spooled`, the punch lines it is still holding, is already in the summary.) */
agentRouter.post('/report', async (req, res) => {
  const a = req.agent!;
  await peoplePrisma.siteAgent.update({ where: { id: a.id }, data: { lastSeenAt: new Date(), lastSummary: String(req.body?.summary || '').slice(0, 500) || null, lastError: req.body?.error ? String(req.body.error).slice(0, 500) : null } });
  res.json({ ok: true });
});

/* ---- Making agents: for routes/integrations.ts ---- */

/** A SCIM token for the agent's LDAP sync, made once and handed over on its next poll. */
export async function ensureScimForAgent(a: { id: string; accountId: string; orgId: string; scimTokenId: string | null; pendingEnc: string | null; createdByUserId: string }, defaultRoleId: string | null) {
  if (a.scimTokenId && (await platformPrisma.scimToken.findUnique({ where: { id: a.scimTokenId } }))) {
    if (defaultRoleId !== undefined) await platformPrisma.scimToken.update({ where: { id: a.scimTokenId }, data: { defaultRoleId } });
    return a.scimTokenId;
  }
  const { newScimToken } = await import('./scim.js');
  const token = newScimToken();
  const row = await platformPrisma.scimToken.create({ data: { accountId: a.accountId, orgId: a.orgId, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), defaultRoleId, createdByUserId: a.createdByUserId } });
  let pending: Record<string, string> = {};
  try {
    pending = a.pendingEnc ? JSON.parse(decryptSecret(a.pendingEnc)) : {};
  } catch {
    pending = {};
  }
  await peoplePrisma.siteAgent.update({ where: { id: a.id }, data: { scimTokenId: row.id, pendingEnc: encryptSecret(JSON.stringify({ ...pending, scimToken: token })) } });
  return row.id;
}

agentRouter.use((_req, res) => fail(res, 404, 'No such connector endpoint.'));
