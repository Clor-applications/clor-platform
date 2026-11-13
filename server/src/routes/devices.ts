import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { COMMANDS, FACE, FETCH_TEMPLATE_COMMANDS, ONLINE_WINDOW_MS, SEQ, USERPIC, VERIFY_MODES, commandEffect, messageCommand, normaliseFirmware, pinKey, userCommandFor } from '../services/attendance/adms.js';
import { ISO_DATE, sendError, today } from '../services/attendance/days.js';
import { siteIdClash } from '../services/attendance/readerIds.js';
import { biometricPolicy } from '../services/attendance/biometrics.js';
import { CATALOGUE, SUPPORT_LABEL, TESTS, supportOf } from '../services/attendance/certification.js';
import { syncVendorConnection } from '../services/attendance/vendorSync.js';
import { moveIdAtSite, attachPunchesTo, copyAllTemplatesTo, servesArea } from '../services/attendance/readerSync.js';
import { pinMatcher, recomputeDeviceDay, shiftDayFor } from '../services/attendance/punches.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';
import { checkUrl } from '../services/outbound.js';
import { etoFetchPunches } from '../services/attendance/etimeoffice.js';
import { MAX_ALLOW_LIST, MAX_NETWORKS, inRange, networkOf, parseAllowList, showRange } from '../services/attendance/network.js';
import { randomBytes } from 'node:crypto';
import { can as can_, driverOf, publicDrivers, vendorsWith } from '../services/attendance/drivers.js';
import { mappingSchema, recordsOf, toAttlog, validZone } from '../services/attendance/punchMapping.js';
import { parseCsv } from '../services/attendance/csv.js';
import { hashToken } from './publicApi.js';
import { CredentialError, actorFrom, issueCredential, liveCredentialOf, revokeCredential, rotateCredential } from '../services/credentials.js';
import { liveCredentialFor } from '../services/credentialKinds.js';
import { MATRIX_COMMANDS, MATRIX_COMMAND_LABELS } from './matrix.js';
import { setTimeCommand } from '../services/attendance/adms.js';
import { ingestPunches } from '../services/attendance/punches.js';
import { todayIst } from '../utils/istDate.js';

/**
 * Biometric readers, as the company manages them: claim a reader by its serial
 * number, set its direction, send it staff, and match reader user IDs nobody
 * recognised to employees. The readers themselves talk to /iclock (routes/iclock.ts).
 */
export const devicesRouter = Router();
devicesRouter.use(requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, R.devices);
const base = '/orgs/:orgId/attendance/devices';
const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
/*
 * Serials CLOR makes up for readers that have none of their own — an API
 * key's (API-), push and pull sources, Matrix, eTimeOffice, file imports.
 * Claiming one by hand could stand in for another company's source (A-29).
 */
const RESERVED_SERIAL = /^(API|PUSH|MATRIX|HIK|HIKV|DAHU|BIOS|HTTP|ANVI|FILE|ETO)-/i;

const deviceSchema = z.object({
  serialNumber: z.string().trim().regex(SERIAL, 'The serial number is letters and digits, as printed on the reader.'),
  name: z.string().trim().min(1, 'Name the reader, e.g. "Main gate".').max(80),
  direction: z.enum(['both', 'in', 'out']).default('both'),
});

/* Never the stored credential. */
/** A network the reader called from in the last day, not approved yet. */
const APPROVE_WITHIN_MS = 24 * 3_600_000;
const awaiting = (d: any) =>
  can_(d.vendor, 'networkLock') && d.pendingNetwork && d.pendingNetworkAt && Date.now() - new Date(d.pendingNetworkAt).getTime() < APPROVE_WITHIN_MS ? d.pendingNetwork : null;

const shape = ({ apiSecret, claimNetwork, pendingNetwork, pendingNetworkAt, pushTokenHash, mappingJson, configJson, lastPayload, ...d }: any, extra: Record<string, unknown> = {}) => ({
  ...d,
  capabilities: driverOf(d.vendor).capabilities,
  driverLabel: driverOf(d.vendor).label,
  mapping: mappingJson ? JSON.parse(mappingJson) : null,
  config: configJson ? JSON.parse(configJson) : null,
  hasPayload: Boolean(lastPayload),
  firmware: normaliseFirmware(d.firmware),
  hasSecret: Boolean(apiSecret),
  ...(d.vendor === 'HTTP_PUSH' ? { signed: Boolean(apiSecret) } : {}),
  support: supportOf(d.vendor, d.model, d.firmware),
  online: Boolean(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS),
  networkVerified: Boolean(d.networkVerifiedAt),
  /* As a person would write them: a single address without its "/32". */
  ipAllowList: (d.ipAllowList || []).map(showRange),
  awaitingNetwork: awaiting({ ...d, pendingNetwork, pendingNetworkAt }),
  ...extra,
});

devicesRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const devices = await peoplePrisma.attendanceDevice.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const ids = devices.map((d) => d.id);
  const t = today();
  const [todayCounts, pending, unmatched] = await Promise.all([
    ids.length
      ? peoplePrisma.devicePunch.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: ids }, localTime: { startsWith: t } }, _count: { _all: true } })
      : [],
    ids.length ? peoplePrisma.deviceCommand.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: ids }, status: { in: ['PENDING', 'SENT'] } }, _count: { _all: true } }) : [],
    peoplePrisma.devicePunch.count({ where: { accountId, orgId, employeeId: null } }),
  ]);
  const n = (rows: any[], id: string) => rows.find((r) => r.deviceId === id)?._count._all || 0;
  res.json({
    devices: devices.map((d) => shape(d, { punchesToday: n(todayCounts as any[], d.id), commandsWaiting: n(pending as any[], d.id) })),
    unmatchedPunches: unmatched,
    /* So the screen can tell whoever is looking whether they are on a reader's network. */
    yourNetwork: networkOf(req),
    drivers: publicDrivers(),
    pushBase: `${process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || 'https://api.clor.in'}/ingest/`,
    hikvisionBase: `${process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || 'https://api.clor.in'}/hikvision/`,
    /* Matrix COSEC controllers are given this as their server URL; the token is the path. */
    matrixBase: `${process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || 'https://api.clor.in'}/matrix/`,
  });
});

const etoSchema = z.object({
  name: z.string().trim().min(1, 'Name the connection.').max(80),
  direction: z.enum(['both', 'in', 'out']).default('both'),
  apiUrl: z.string().trim().url('That is not a web address.').max(200).optional().nullable().or(z.literal('')),
  corporateId: z.string().trim().max(80).optional().nullable(),
  username: z.string().trim().min(1, 'The e-Time Office user name is needed.').max(120),
  password: z.string().min(1, 'The e-Time Office password is needed.').max(200),
});

/** Try e-Time Office credentials on today's punches before saving them. */
devicesRouter.post(`${base}/test-etimeoffice`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const parsed = etoSchema.safeParse({ name: 'test', ...req.body });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const b = parsed.data;
  const now = new Date();
  const midnight = new Date(`${todayIst(now)}T00:00:00+05:30`);
  const r = await etoFetchPunches({ apiUrl: b.apiUrl || null, corporateId: b.corporateId || null, username: b.username, password: b.password }, midnight, now);
  res.json({ ok: r.ok, message: r.message, punchesToday: r.punches.length });
});

const PULL_VENDORS = ['HIKVISION', 'DAHUA', 'BIOSTAR', 'HTTP_PULL', 'ANVIZ_CLOUD'] as const;
const pullConfigSchema = z
  .object({
    method: z.enum(['GET', 'POST']).optional(),
    url: z.string().trim().max(500).optional(),
    timeFormat: z.enum(['iso', 'local', 'date', 'epoch', 'epoch_ms', 'dmy']).optional(),
    auth: z.enum(['none', 'basic', 'digest', 'header']).optional(),
    body: z.string().max(4000).optional(),
  })
  .strict();
const pullSchema = z.object({
  vendor: z.enum(PULL_VENDORS),
  name: z.string().trim().min(1, 'Name the connection, e.g. "Hikvision gate".').max(80),
  direction: z.enum(['both', 'in', 'out']).default('both'),
  sourceTimezone: z.string().trim().max(60).default('Asia/Kolkata'),
  /* The device or server address; for "any software" the URL template can be in config.url instead. */
  baseUrl: z.string().trim().max(500).optional().nullable().or(z.literal('')),
  username: z.string().trim().max(200).optional().nullable(),
  password: z.string().max(500).optional().nullable(),
  config: pullConfigSchema.optional().nullable(),
  mapping: mappingSchema.optional().nullable(),
  areaId: z.string().min(1).nullable().optional(),
});
const pullUrlOk = (vendor: string, baseUrl: string | null | undefined, config: any) => {
  const url = vendor === 'HTTP_PULL' ? config?.url || baseUrl : baseUrl;
  if (!url) return vendor === 'HTTP_PULL' ? 'Give the URL to call.' : vendor === 'ANVIZ_CLOUD' ? 'Choose the CrossChex Cloud region.' : 'Give the device or server address, e.g. http://203.0.113.10:80.';
  if (vendor === 'ANVIZ_CLOUD' && !/^https:\/\/api\.(us|ap|eu)\.crosschexcloud\.com\/?$/.test(String(url))) return 'The CrossChex Cloud address is https://api.us.crosschexcloud.com/, api.ap… or api.eu….';
  return checkUrl(String(url).replace(/\{from\}|\{to\}/g, 'x'));
};

/** Try a pull connection on today's punches before saving it (or with a saved one's password when blank). */
devicesRouter.post(`${base}/test-pull`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const parsed = pullSchema.safeParse({ name: 'test', ...req.body });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const b = parsed.data;
  const bad = pullUrlOk(b.vendor, b.baseUrl, b.config);
  if (bad) return res.status(400).json({ error: bad });
  let password = b.password || '';
  if (!password && req.body?.deviceId) {
    const saved = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.body.deviceId), orgId: req.tenant!.orgId }, select: { apiSecret: true } });
    password = saved?.apiSecret ? decryptSecret(saved.apiSecret) : '';
  }
  const now = new Date();
  const midnight = new Date(`${todayIst(now)}T00:00:00+05:30`);
  const r = await syncVendorConnection(
    { id: 'test', vendor: b.vendor, apiUrl: b.baseUrl || null, apiCorporateId: null, apiUsername: b.username || null, apiSecret: password ? encryptSecret(password) : null, sourceTimezone: b.sourceTimezone, configJson: b.config ? JSON.stringify(b.config) : null, mappingJson: b.mapping ? JSON.stringify(b.mapping) : null, lastFetchedAt: null },
    { from: midnight, dryRun: true }
  );
  res.json({ ok: r.ok, message: r.message, punchesToday: r.received, readable: (r as any).readable ?? 0 });
});

const mappedSchema = z.object({
  name: z.string().trim().min(1, 'Name the source, e.g. "Hikvision gate" or "Monthly export".').max(80),
  direction: z.enum(['both', 'in', 'out']).default('both'),
  sourceTimezone: z.string().trim().max(60).default('Asia/Kolkata'),
  mapping: mappingSchema.optional().nullable(),
  areaId: z.string().min(1).nullable().optional(),
});
const newPushToken = () => `clorp_${randomBytes(24).toString('base64url')}`;

devicesRouter.post(base, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  if (req.body?.vendor === 'HTTP_PUSH' || req.body?.vendor === 'FILE' || req.body?.vendor === 'MATRIX_COSEC' || req.body?.vendor === 'HIKVISION_PUSH') {
    const vendor = String(req.body.vendor);
    const p = mappedSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
    const b = p.data;
    if (!validZone(b.sourceTimezone)) return res.status(400).json({ error: 'That is not a timezone name (e.g. Asia/Kolkata, Asia/Dubai).' });
    /* A push source is known by its URL token (shown once); a Matrix controller's own serial arrives with its first login. */
    const token = vendor === 'FILE' ? null : newPushToken();
    const serialNumber = `${vendor === 'HTTP_PUSH' ? 'PUSH' : vendor === 'MATRIX_COSEC' ? 'MATRIX' : vendor === 'HIKVISION_PUSH' ? 'HIK' : 'FILE'}-${randomBytes(6).toString('hex').toUpperCase()}`;
    const device = await peoplePrisma.attendanceDevice.create({
      data: {
        accountId,
        orgId,
        serialNumber,
        name: b.name,
        direction: b.direction,
        vendor,
        sourceTimezone: b.sourceTimezone,
        mappingJson: b.mapping ? JSON.stringify(b.mapping) : null,
        areaId: b.areaId ?? null,
        pushTokenHash: token ? hashToken(token) : null,
        pushTokenPrefix: token ? token.slice(0, 12) : null,
        createdByUserId: req.auth!.userId,
      },
    });
    /* Batch 5: registered beside the reader; a missed write is repaired on first push. */
    if (token)
      await issueCredential({ kind: 'DEVICE_PUSH', accountId, orgId, ownerId: device.id, token, tokenPrefix: token.slice(0, 12), label: device.name, createdByUserId: req.auth!.userId }, actorFrom(req)).catch((e) =>
        console.error('[credentials] reader registered on first push instead:', (e as Error).message)
      );
    /* The push URL token is shown once; only its hash is kept. */
    return res.status(201).json({ device: shape(device), seenBefore: null, pushToken: token });
  }
  if ((PULL_VENDORS as readonly string[]).includes(String(req.body?.vendor || ''))) {
    const p = pullSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
    const b = p.data;
    if (!validZone(b.sourceTimezone)) return res.status(400).json({ error: 'That is not a timezone name (e.g. Asia/Kolkata, Asia/Dubai).' });
    const bad = pullUrlOk(b.vendor, b.baseUrl, b.config);
    if (bad) return res.status(400).json({ error: bad });
    const device = await peoplePrisma.attendanceDevice.create({
      data: {
        accountId,
        orgId,
        serialNumber: `${b.vendor.slice(0, 4)}-${randomBytes(6).toString('hex').toUpperCase()}`,
        name: b.name,
        direction: b.direction,
        vendor: b.vendor,
        sourceTimezone: b.sourceTimezone,
        apiUrl: b.baseUrl || null,
        apiUsername: b.username || null,
        apiSecret: b.password ? encryptSecret(b.password) : null,
        configJson: b.config ? JSON.stringify(b.config) : null,
        mappingJson: b.mapping ? JSON.stringify(b.mapping) : null,
        areaId: b.areaId ?? null,
        createdByUserId: req.auth!.userId,
      },
    });
    return res.status(201).json({ device: shape(device), seenBefore: null, pushToken: null });
  }
  if (req.body?.vendor === 'ETIMEOFFICE') {
    const p = etoSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
    const b = p.data;
    /* One connection per e-Time Office account, across all companies. */
    const serialNumber = `ETO-${(b.corporateId || b.username).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36)}`;
    const taken = await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber } });
    if (taken) return res.status(409).json({ error: taken.orgId === orgId ? 'This e-Time Office account is already connected.' : 'This e-Time Office account cannot be connected. Contact support if it is yours.' });
    const device = await peoplePrisma.attendanceDevice.create({
      data: {
        accountId,
        orgId,
        serialNumber,
        name: b.name,
        direction: b.direction,
        vendor: 'ETIMEOFFICE',
        apiUrl: b.apiUrl || null,
        apiCorporateId: b.corporateId || null,
        apiUsername: b.username,
        apiSecret: encryptSecret(b.password),
        createdByUserId: req.auth!.userId,
      },
    });
    return res.status(201).json({ device: shape(device), seenBefore: null });
  }
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reader.' });
  const b = parsed.data;
  if (RESERVED_SERIAL.test(b.serialNumber)) {
    return res.status(400).json({ error: 'That is not a reader serial number. Enter the serial printed on the reader.' });
  }
  const taken = await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber: b.serialNumber } });
  if (taken) {
    return res.status(409).json({
      /* Never say whose it is: an answer naming another company tells anyone which serials are in use. */
      error: taken.orgId === orgId ? 'This reader is already added.' : 'This serial number cannot be added. Contact support if the reader is yours.',
    });
  }
  /* A reader already pointed at us shows up as "seen" straight away. */
  const seen = await peoplePrisma.unclaimedReader.findUnique({ where: { serialNumber: b.serialNumber } });
  /*
   * Ownership is proved by being on the reader's network (see allowedNetworks):
   * added from the network it already calls from, it is approved now; else
   * it is approved when it calls in from this network, or by "approve" from its own.
   */
  const net = networkOf(req);
  const proven = Boolean(net && seen?.network === net);
  try {
    const device = await peoplePrisma.attendanceDevice.create({
      data: {
        accountId,
        orgId,
        ...b,
        ip: seen?.ip || null,
        lastSeenAt: seen?.lastSeenAt || null,
        claimNetwork: net,
        ...(proven ? { allowedNetworks: [net!], networkVerifiedAt: new Date() } : {}),
        createdByUserId: req.auth!.userId,
      },
    });
    if (seen) await peoplePrisma.unclaimedReader.delete({ where: { serialNumber: b.serialNumber } }).catch(() => undefined);
    res.status(201).json({ device: shape(device), seenBefore: seen ? seen.lastSeenAt : null });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Approve the network a reader is calling from — only from that network: the
 * admin's own connection must come from the same address. Someone elsewhere
 * who claimed the serial can see the address but can never approve it.
 */
devicesRouter.post(`${base}/:id/approve-network`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId, vendor: { in: vendorsWith('networkLock') } } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  const net = networkOf(req);
  if (!net || awaiting(d) !== net) {
    return res.status(409).json({
      error: 'Approve it from the reader’s own network: open CLOR on a computer or phone on the same internet connection as the reader (the office Wi-Fi, not mobile data) while the reader is on.',
      code: 'NOT_ON_READER_NETWORK',
    });
  }
  const device = await peoplePrisma.attendanceDevice.update({
    where: { id: d.id },
    data: {
      allowedNetworks: [...d.allowedNetworks.filter((x) => x !== net), net].slice(-MAX_NETWORKS),
      networkVerifiedAt: d.networkVerifiedAt ?? new Date(),
      pendingNetwork: null,
      pendingNetworkAt: null,
    },
  });
  res.json({ device: shape(device) });
});

/** Stop taking data from a network (an office that moved, a line given up). */
devicesRouter.delete(`${base}/:id/networks`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId, vendor: { in: vendorsWith('networkLock') } } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  const network = String(req.body?.network || '');
  if (!d.allowedNetworks.includes(network)) return res.status(404).json({ error: 'That network is not approved for this reader.' });
  const rest = d.allowedNetworks.filter((x) => x !== network);
  /* With none left, the next network must be approved from that network — never taken on trust. */
  const device = await peoplePrisma.attendanceDevice.update({
    where: { id: d.id },
    data: { allowedNetworks: rest, ...(rest.length ? {} : { networkVerifiedAt: null, claimNetwork: null }) },
  });
  res.json({ device: shape(device) });
});

devicesRouter.put(`${base}/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such reader.' });
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      direction: z.enum(['both', 'in', 'out']),
      isActive: z.boolean().optional(),
      /* A site's reader takes only that area's staff; null = everyone. */
      areaId: z.string().min(1).nullable().optional(),
      /* e-Time Office only; a blank password keeps the stored one. */
      apiUrl: z.string().trim().url().max(200).optional().nullable().or(z.literal('')),
      corporateId: z.string().trim().max(80).optional().nullable(),
      username: z.string().trim().max(120).optional(),
      password: z.string().max(200).optional(),
      /* Mapped sources (HTTP push, file, HTTP pull). */
      sourceTimezone: z.string().trim().max(60).optional(),
      mapping: mappingSchema.optional().nullable(),
      /* Pull connections. */
      baseUrl: z.string().trim().max(500).optional().nullable().or(z.literal('')),
      config: pullConfigSchema.optional().nullable(),
      /* Pull readers on the office LAN: which on-site connector reaches them. */
      agentId: z.string().min(1).nullable().optional(),
      /* Push readers: only accept punches from these network addresses or ranges; empty = no rule of its own. */
      ipAllowList: z.array(z.string().trim().max(60)).max(MAX_ALLOW_LIST, `List at most ${MAX_ALLOW_LIST} network addresses.`).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Name the reader and choose its direction.' });
  const { apiUrl, corporateId, username, password, areaId, sourceTimezone, mapping, baseUrl, config, agentId, ipAllowList, ...common } = parsed.data;
  let allowList: { ipAllowList: string[] } | Record<string, never> = {};
  if (ipAllowList !== undefined && can_(existing.vendor, 'networkLock')) {
    const r = parseAllowList(ipAllowList);
    if ('bad' in r) {
      return res.status(400).json({ error: `“${r.bad.slice(0, 60)}” is not a network address. Write one like 203.0.113.7, or a range like 203.0.113.0/24.`, code: 'BAD_NETWORK_ADDRESS' });
    }
    allowList = { ipAllowList: r.list };
  }
  if (agentId && !(await peoplePrisma.siteAgent.findFirst({ where: { id: agentId, orgId }, select: { id: true } }))) return res.status(400).json({ error: 'That connector is not in this organisation.' });
  const viaAgent = agentId !== undefined && (PULL_VENDORS as readonly string[]).includes(existing.vendor) ? { agentId } : {};
  const pullFields = (PULL_VENDORS as readonly string[]).includes(existing.vendor)
    ? {
        ...(baseUrl !== undefined ? { apiUrl: baseUrl || null } : {}),
        ...(username !== undefined ? { apiUsername: username || null } : {}),
        ...(password ? { apiSecret: encryptSecret(password) } : {}),
        ...(config !== undefined ? { configJson: config ? JSON.stringify(config) : null } : {}),
        ...(sourceTimezone !== undefined ? { sourceTimezone } : {}),
      }
    : {};
  /* Through a connector the address is on the customer's LAN, which the cloud never calls: only its shape is checked. */
  const viaAgentNow = (viaAgent as any).agentId !== undefined ? (viaAgent as any).agentId : existing.agentId;
  /* Leaving a connector puts the cloud back in charge of the address: it is checked again, as on any change. */
  const leftAgent = Boolean(existing.agentId) && (viaAgent as any).agentId === null;
  if ((pullFields.apiUrl !== undefined || pullFields.configJson !== undefined || leftAgent) && !viaAgentNow && (PULL_VENDORS as readonly string[]).includes(existing.vendor)) {
    const bad = pullUrlOk(existing.vendor, (pullFields as any).apiUrl ?? existing.apiUrl, config === undefined ? JSON.parse(existing.configJson || 'null') : config);
    if (bad) return res.status(400).json({ error: bad });
  }
  if (sourceTimezone !== undefined && !validZone(sourceTimezone)) return res.status(400).json({ error: 'That is not a timezone name (e.g. Asia/Kolkata, Asia/Dubai).' });
  const mapped = driverOf(existing.vendor).capabilities.includes('mapping')
    ? { ...(sourceTimezone !== undefined ? { sourceTimezone } : {}), ...(mapping !== undefined ? { mappingJson: mapping ? JSON.stringify(mapping) : null } : {}) }
    : (existing.vendor === 'MATRIX_COSEC' || existing.vendor === 'HIKVISION_PUSH') && sourceTimezone !== undefined
      ? { sourceTimezone }
      : {};
  if (areaId && !(await peoplePrisma.area.findFirst({ where: { id: areaId, orgId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'That area is not in this organisation.' });
  }
  const vendorFields =
    existing.vendor !== 'ETIMEOFFICE'
      ? {}
      : {
          ...(apiUrl !== undefined ? { apiUrl: apiUrl || null } : {}),
          ...(corporateId !== undefined ? { apiCorporateId: corporateId || null } : {}),
          ...(username ? { apiUsername: username } : {}),
          ...(password ? { apiSecret: encryptSecret(password) } : {}),
        };
  const device = await peoplePrisma.attendanceDevice.update({
    where: { id: existing.id },
    data: { ...common, ...vendorFields, ...mapped, ...pullFields, ...viaAgent, ...allowList, ...(existing.vendor !== 'ETIMEOFFICE' && areaId !== undefined ? { areaId } : {}) },
  });
  /*
   * A list that leaves out the address the reader itself last called from would refuse the real
   * reader. It is saved as asked (the office may be moving line), and the screen says so.
   */
  const readerAt = device.allowedNetworks[device.allowedNetworks.length - 1] || null;
  const readerOutside = 'ipAllowList' in allowList && device.ipAllowList.length && readerAt && !device.ipAllowList.some((r) => inRange(readerAt, r)) ? readerAt : null;
  /* A new area changes who belongs on it; Sync status shows the gaps and the extras. */
  res.json({ device: shape(device), areaChanged: areaId !== undefined && (areaId ?? null) !== (existing.areaId ?? null), readerOutsideAllowList: readerOutside });
});

devicesRouter.delete(`${base}/:id`, can(PermissionAction.DELETE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such reader.' });
  if (await peoplePrisma.devicePunch.findFirst({ where: { orgId, deviceId: existing.id }, select: { id: true } })) {
    return res.status(409).json({ error: 'This reader has punches on record. Switch it off instead; its punches stay.' });
  }
  await peoplePrisma.deviceCommand.deleteMany({ where: { orgId, deviceId: existing.id } });
  await peoplePrisma.deviceUser.deleteMany({ where: { orgId, deviceId: existing.id } });
  await peoplePrisma.attendanceDevice.delete({ where: { id: existing.id } });
  /* GAP-010: its push address stops now, not at the nightly orphan sweep. */
  const cred = await liveCredentialOf('DEVICE_PUSH', existing.id, orgId);
  if (cred) await revokeCredential(cred.id, orgId, actorFrom(req), 'owner_deleted');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

devicesRouter.post(`${base}/:id/commands`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const action = String(req.body?.action || '');
  if (!can_(device.vendor, 'commands')) return res.status(400).json({ error: 'This source takes no commands; it only sends punches.' });
  const queue = (command: string, sequence: number = SEQ.OTHER) => ({ accountId, orgId, deviceId: device.id, serialNumber: device.serialNumber, command, sequence, createdByUserId: req.auth!.userId });

  if (device.vendor === 'MATRIX_COSEC') {
    /* A controller takes reboot and a user count; the time goes as configuration on its next poll (routes/matrix.ts). */
    if (action === 'SET_TIME') {
      const st = JSON.parse(device.configJson || '{}');
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { configJson: JSON.stringify({ ...st, forceClock: true }) } });
      return res.json({ queued: 1 });
    }
    if (action === 'REBOOT' || action === 'INFO') {
      await peoplePrisma.deviceCommand.create({ data: queue(MATRIX_COMMANDS[action]) });
      return res.json({ queued: 1 });
    }
    /* Users go to it as configuration (config-id 10); fingerprints, cards and palms are enrolled at the door. */
    if (action !== 'SEND_STAFF') return res.status(400).json({ error: 'A Matrix controller takes Restart, Report user count, Set the time and Send new staff.' });
  }
  if (action === 'SET_TIME') {
    /* ADMS: the reader's clock set to now (IST, which is what its punches are read as). Drift is measured again from its next live punch. */
    await peoplePrisma.deviceCommand.create({ data: queue(setTimeCommand(new Date())) });
    return res.json({ queued: 1 });
  }
  if (action === 'FETCH_PUNCHES' || action === 'FETCH_USERS' || action === 'REBOOT' || action === 'INFO') {
    await peoplePrisma.deviceCommand.create({ data: queue(COMMANDS[action]) });
    return res.json({ queued: 1 });
  }
  if (action === 'MESSAGE') {
    /* A line on the reader's screen: for everyone, or for one person when they punch. */
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Say what the reader should show.' });
    const minutes = Number(req.body?.minutes) || 60;
    let pin: string | null = null;
    if (req.body?.employeeId) {
      const e = await peoplePrisma.employee.findFirst({ where: { id: String(req.body.employeeId), orgId }, select: { id: true, devicePin: true, code: true } });
      if (!e) return res.status(404).json({ error: 'No such employee.' });
      pin = (await pinMatcher(orgId)).pinFor(e, device.areaId) || null;
      if (!pin) return res.status(400).json({ error: 'This person has no Reader ID or employee code to address the message to.' });
    }
    await peoplePrisma.deviceCommand.create({ data: queue(messageCommand(text, minutes, pin)) });
    return res.json({ queued: 1, to: pin ? 'person' : 'everyone' });
  }
  if (action === 'READ_ALL') {
    /* Learn what the reader holds — its users, fingerprints, faces, counts — so Sync status is true for a reader set up before CLOR. */
    const copying = (await biometricPolicy(orgId)).copy;
    const cmds = [COMMANDS.INFO, COMMANDS.FETCH_USERS, ...(copying ? FETCH_TEMPLATE_COMMANDS : [])];
    await peoplePrisma.deviceCommand.createMany({ data: cmds.map((c) => queue(c)) });
    return res.json({ queued: cmds.length });
  }
  if (action === 'FETCH_TEMPLATES') {
    /* What it sends back is stored and, if new, copied to the other readers. */
    if (!(await biometricPolicy(orgId)).copy) return res.status(409).json({ error: 'CLOR keeps no copies of fingerprints and faces for this company. Switch copying on under Data protection first.' });
    await peoplePrisma.deviceCommand.createMany({ data: FETCH_TEMPLATE_COMMANDS.map((c) => queue(c)) });
    return res.json({ queued: FETCH_TEMPLATE_COMMANDS.length });
  }
  if (action === 'COPY_TEMPLATES') {
    if (!(await biometricPolicy(orgId)).copy) return res.status(409).json({ error: 'CLOR keeps no copies of fingerprints and faces for this company. Switch copying on under Data protection first.' });
    const r = await copyAllTemplatesTo(device, req.auth!.userId);
    return res.json({ queued: r.commands, people: r.people });
  }
  if (action === 'SEND_STAFF') {
    /*
     * Adds people the reader does not have yet, under their Reader ID (else
     * their employee code). People already on the reader are left alone: the
     * command carries an empty password and card, which would wipe ones set at
     * the reader. Fingerprints and faces are still enrolled at the reader.
     */
    const [people, onReader] = await Promise.all([
      peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true, devicePin: true, areaId: true, cardNumber: true } }),
      peoplePrisma.deviceUser.findMany({ where: { orgId, deviceId: device.id }, select: { pin: true } }),
    ]);
    const have = new Set(onReader.map((u) => pinKey(u.pin)));
    /* Already on their way (queued when the person was added or changed): not twice. */
    for (const c of await peoplePrisma.deviceCommand.findMany({ where: { deviceId: device.id, status: { in: ['PENDING', 'SENT'] } }, select: { command: true } })) {
      const e = commandEffect(c.command);
      if (e?.what === 'user') have.add(pinKey(e.pin));
    }
    const match = await pinMatcher(orgId);
    const toSend = people
      .filter((p) => servesArea(device, p.areaId))
      .map((p) => ({ pin: match.pinFor(p, device.areaId), name: p.name, card: p.cardNumber }))
      .filter((p) => p.pin && !have.has(pinKey(p.pin)));
    if (toSend.length) await peoplePrisma.deviceCommand.createMany({ data: toSend.map((p) => queue(userCommandFor(device.vendor, p.pin, p.name, { card: p.card }), SEQ.USER)) });
    return res.json({ queued: toSend.length, skippedWithoutId: people.filter((p) => !p.devicePin && !p.code).length, knownUsers: onReader.length });
  }
  return res.status(400).json({ error: 'Unknown action.' });
});

devicesRouter.get(`${base}/:id/commands`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, areaId: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const status = String(req.query.status || '').toUpperCase();
  const where: any = { orgId, deviceId: device.id, ...(['PENDING', 'SENT', 'DONE', 'FAILED', 'CANCELLED'].includes(status) ? { status } : {}) };
  const [commands, counts] = await Promise.all([
    peoplePrisma.deviceCommand.findMany({ where, orderBy: { id: 'desc' }, take: 200 }),
    peoplePrisma.deviceCommand.groupBy({ by: ['status'], where: { orgId, deviceId: device.id }, _count: { _all: true } }),
  ]);
  const match = await pinMatcher(orgId);
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  res.json({
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    /* User and template commands are long, and templates are biometric data: the screen gets the gist and who it is for. */
    commands: commands.map((c) => {
      const e = commandEffect(c.command);
      return {
        id: c.id,
        status: c.status,
        attempts: c.attempts,
        returnCode: c.returnCode,
        lastError: c.lastError,
        createdAt: c.createdAt,
        sentAt: c.sentAt,
        doneAt: c.doneAt,
        what: describeCommand(c.command),
        pin: e?.pin || null,
        employeeName: e ? names.get(match(e.pin, device.areaId)?.id || '') || null : null,
      };
    }),
  });
});

const describeCommand = (command: string) => {
  const e = commandEffect(command);
  if (e) {
    return {
      user: 'Add or update user',
      finger: `Add fingerprint ${e.no ?? ''}`.trim(),
      face: 'Add face',
      removeUser: 'Remove user',
      removeFingers: 'Remove fingerprints',
      removeFace: 'Remove face',
    }[e.what];
  }
  const head = command.split('\t')[0];
  if (head.startsWith('SET OPTIONS DateTime=')) return 'Set the time';
  return (
    {
      [COMMANDS.FETCH_PUNCHES]: 'Send all punches',
      [COMMANDS.FETCH_USERS]: 'Send its users',
      [COMMANDS.REBOOT]: 'Restart',
      [COMMANDS.INFO]: 'Report counts and capacity',
      ...MATRIX_COMMAND_LABELS,
      'DATA QUERY FINGERTMP': 'Send fingerprints',
      'DATA QUERY FACE': 'Send faces',
      'DATA QUERY BIODATA': 'Send biometric data',
    } as Record<string, string>
  )[head] || head;
};

/** Send failed commands again (all, or the ones picked). */
devicesRouter.post(`${base}/:id/commands/retry`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  const r = await peoplePrisma.deviceCommand.updateMany({
    where: { orgId, deviceId: device.id, status: 'FAILED', ...(ids ? { id: { in: ids } } : {}) },
    data: { status: 'PENDING', attempts: 0, lastError: null, returnCode: null, doneAt: null, sentAt: null },
  });
  res.json({ retried: r.count });
});

/** Drop changes still waiting for the reader (all, or the ones picked). */
devicesRouter.post(`${base}/:id/commands/cancel`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  const r = await peoplePrisma.deviceCommand.updateMany({
    where: { orgId, deviceId: device.id, status: 'PENDING', ...(ids ? { id: { in: ids } } : {}) },
    data: { status: 'CANCELLED', doneAt: new Date() },
  });
  res.json({ cancelled: r.count });
});

devicesRouter.get(`${base}/:id/users`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, areaId: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const users = await peoplePrisma.deviceUser.findMany({ where: { orgId, deviceId: device.id }, orderBy: { pin: 'asc' } });
  const match = await pinMatcher(orgId);
  const names = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true } })).map((e) => [e.id, e.name])
  );
  res.json({ users: users.map((u) => ({ ...u, employeeId: match(u.pin, device.areaId)?.id || null, employeeName: names.get(match(u.pin, device.areaId)?.id || '') || null })) });
});

// ---------------------------------------------------------------------------
// Punches nobody was matched to
// ---------------------------------------------------------------------------

devicesRouter.get('/orgs/:orgId/attendance/punches/unmatched', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const [rows, readers, areas] = await Promise.all([
    peoplePrisma.devicePunch.groupBy({ by: ['pin', 'deviceId'], where: { accountId, orgId, employeeId: null }, _count: { _all: true }, _min: { localTime: true }, _max: { localTime: true } }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, areaId: true } }),
    peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const areaOf = new Map(readers.map((r) => [r.id, r.areaId]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const users = await peoplePrisma.deviceUser.findMany({ where: { orgId, pin: { in: rows.map((r) => r.pin) } }, select: { pin: true, name: true } });
  const nameOf = new Map(users.filter((u) => u.name).map((u) => [u.pin, u.name]));
  /* One line per ID per site: 105 at the depot and 105 at the factory may be two people. */
  const byKey = new Map<string, { pin: string; areaId: string | null; areaName: string | null; readerName: string | null; punches: number; first: string | null; last: string | null }>();
  for (const r of rows) {
    const areaId = areaOf.get(r.deviceId) || null;
    const k = `${areaId || ''}|${r.pin}`;
    const g = byKey.get(k) || { pin: r.pin, areaId, areaName: areaId ? areaName.get(areaId) || null : null, readerName: nameOf.get(r.pin) || null, punches: 0, first: null, last: null };
    g.punches += r._count._all;
    if (r._min.localTime && (!g.first || r._min.localTime < g.first)) g.first = r._min.localTime;
    if (r._max.localTime && (!g.last || r._max.localTime > g.last)) g.last = r._max.localTime;
    byKey.set(k, g);
  }
  res.json({ pins: [...byKey.values()].sort((a, b) => String(b.last).localeCompare(String(a.last))) });
});

// ---------------------------------------------------------------------------
// Reader IDs per site (services/attendance/readerIds.ts)
// ---------------------------------------------------------------------------

/** Every site ID in the company, for the ID mapping screen. */
devicesRouter.get('/orgs/:orgId/attendance/reader-ids/sites', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const [rows, people, areas] = await Promise.all([
    peoplePrisma.readerIdAtSite.findMany({ where: { orgId }, orderBy: [{ areaId: 'asc' }, { pin: 'asc' }] }),
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true, code: true, devicePin: true, status: true } }),
    peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  res.json({
    sites: rows.map((r) => {
      const p = person.get(r.employeeId);
      return { id: r.id, employeeId: r.employeeId, name: p?.name || 'Unknown', code: p?.code || null, companyId: p ? p.devicePin || p.code || null : null, left: p?.status === 'LEFT', areaId: r.areaId, areaName: areaName.get(r.areaId) || 'Unknown site', pin: r.pin };
    }),
  });
});

/** One person's IDs: company-wide, and per site where it differs. */
devicesRouter.get('/orgs/:orgId/attendance/employees/:id/reader-ids', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const e = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, code: true, devicePin: true } });
  if (!e) return res.status(404).json({ error: 'No such employee.' });
  const sites = await peoplePrisma.readerIdAtSite.findMany({ where: { orgId, employeeId: e.id }, select: { areaId: true, pin: true } });
  res.json({ companyId: e.devicePin || e.code || null, fromCode: !e.devicePin && Boolean(e.code), sites });
});

/** Replace one person's site IDs. Each changed site's readers are told at once. */
devicesRouter.put('/orgs/:orgId/attendance/employees/:id/reader-ids', can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ sites: z.array(z.object({ areaId: z.string().min(1), pin: z.string().trim().min(1, 'Give the ID.').max(40) })).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the site IDs.' });
  const e = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, name: true, code: true, devicePin: true } });
  if (!e) return res.status(404).json({ error: 'No such employee.' });
  const wanted = new Map<string, string>();
  for (const s of parsed.data.sites) {
    if (wanted.has(s.areaId)) return res.status(400).json({ error: 'One ID per site.' });
    wanted.set(s.areaId, s.pin);
  }
  const areas = await peoplePrisma.area.findMany({ where: { orgId, id: { in: [...wanted.keys()] } }, select: { id: true, name: true } });
  if (areas.length !== wanted.size) return res.status(400).json({ error: 'A site is not in this organisation.' });
  const company = String(e.devicePin || e.code || '').trim();
  for (const [areaId, pin] of wanted) {
    if (pin === company) wanted.delete(areaId); // the same as everywhere: no site ID needed
    else {
      const clash = await siteIdClash(orgId, areaId, pin, e.id);
      if (clash) return res.status(409).json({ error: `${areas.find((a) => a.id === areaId)?.name}: ${clash}` });
    }
  }
  const before = await peoplePrisma.readerIdAtSite.findMany({ where: { orgId, employeeId: e.id } });
  const had = new Map(before.map((b) => [b.areaId, b.pin]));
  const changed = [...new Set([...had.keys(), ...wanted.keys()])].filter((a) => had.get(a) !== wanted.get(a));
  await peoplePrisma.$transaction([
    peoplePrisma.readerIdAtSite.deleteMany({ where: { orgId, employeeId: e.id, areaId: { in: changed } } }),
    peoplePrisma.readerIdAtSite.createMany({ data: changed.filter((a) => wanted.has(a)).map((areaId) => ({ accountId, orgId, employeeId: e.id, areaId, pin: wanted.get(areaId)!, createdByUserId: req.auth!.userId })) }),
  ]);
  for (const areaId of changed) {
    await moveIdAtSite(orgId, e.id, areaId, had.get(areaId) || company, req.auth!.userId);
    /* Punches already made there under the new ID, by nobody yet, are theirs. */
    if (wanted.has(areaId)) await attachPunchesTo(accountId, orgId, { id: e.id, branchId: null }, wanted.get(areaId)!, areaId);
  }
  const sites = await peoplePrisma.readerIdAtSite.findMany({ where: { orgId, employeeId: e.id }, select: { areaId: true, pin: true } });
  res.json({ companyId: company || null, sites, changed: changed.length });
});

devicesRouter.post('/orgs/:orgId/attendance/punches/match', can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ pin: z.string().trim().min(1).max(40), employeeId: z.string().min(1), areaId: z.string().min(1).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose the employee for this reader ID.' });
  const { pin, employeeId, areaId } = parsed.data;
  try {
    const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, accountId, orgId }, select: { id: true, branchId: true, areaId: true, devicePin: true, code: true, name: true } });
    if (!employee) return res.status(404).json({ error: 'No such employee.' });
    if (areaId) {
      /* Only at this site: the ID becomes their site ID there, and only that site's punches move. */
      const area = await peoplePrisma.area.findFirst({ where: { id: areaId, orgId }, select: { id: true } });
      if (!area) return res.status(400).json({ error: 'That site is not in this organisation.' });
      const own = await peoplePrisma.readerIdAtSite.findFirst({ where: { orgId, areaId, employeeId: employee.id } });
      if (own && own.pin !== pin) return res.status(409).json({ error: `${employee.name} already has ID ${own.pin} at this site. Change it under their reader IDs first.` });
      const clash = await siteIdClash(orgId, areaId, pin, employee.id);
      if (clash) return res.status(409).json({ error: clash });
      if (!own) await peoplePrisma.readerIdAtSite.create({ data: { accountId, orgId, employeeId: employee.id, areaId, pin, createdByUserId: req.auth!.userId } });
      const siteReaders = (await peoplePrisma.attendanceDevice.findMany({ where: { orgId, areaId }, select: { id: true } })).map((d) => d.id);
      await peoplePrisma.biometricTemplate.updateMany({ where: { orgId, pin, employeeId: null, scope: '', sourceDeviceId: { in: siteReaders } }, data: { employeeId: employee.id, scope: areaId } });
      return res.json(await attachPunchesTo(accountId, orgId, employee, pin, areaId));
    }
    const holder = await peoplePrisma.employee.findFirst({ where: { orgId, devicePin: pin, id: { not: employee.id } }, select: { name: true } });
    if (holder) return res.status(409).json({ error: `Reader ID ${pin} already belongs to ${holder.name}.` });
    if (employee.devicePin && employee.devicePin !== pin) {
      return res.status(409).json({ error: `${employee.name} already has Reader ID ${employee.devicePin}. Change it on their employee file first.` });
    }
    await peoplePrisma.employee.update({ where: { id: employee.id }, data: { devicePin: pin } });
    await peoplePrisma.biometricTemplate.updateMany({ where: { orgId, pin, employeeId: null }, data: { employeeId: employee.id } });
    res.json(await attachPunchesTo(accountId, orgId, employee, pin));
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Fingerprints and faces: counts only — template data never leaves the server
// ---------------------------------------------------------------------------

devicesRouter.get('/orgs/:orgId/attendance/biometrics', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.biometricTemplate.groupBy({ by: ['pin', 'employeeId', 'type'], where: { accountId, orgId }, _count: { _all: true }, _max: { updatedAt: true } });
  const names = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e])
  );
  const byPin = new Map<string, any>();
  for (const r of rows) {
    const e = r.employeeId ? names.get(r.employeeId) : null;
    const row = byPin.get(r.pin) || { pin: r.pin, employeeId: r.employeeId, employeeName: e?.name || null, employeeCode: e?.code || null, fingers: 0, faces: 0, other: 0, photo: false, updatedAt: null };
    if (r.type === FACE) row.faces += r._count._all;
    else if (r.type === 1) row.fingers += r._count._all;
    else if (r.type === USERPIC) row.photo = true;
    else row.other += r._count._all;
    if (!row.updatedAt || (r._max.updatedAt && r._max.updatedAt > row.updatedAt)) row.updatedAt = r._max.updatedAt;
    byPin.set(r.pin, row);
  }
  res.json({ people: [...byPin.values()].sort((a, b) => String(a.employeeName || a.pin).localeCompare(String(b.employeeName || b.pin))) });
});

/** The photo a reader holds for one Reader ID (USERPIC), as a data URL. */
devicesRouter.get('/orgs/:orgId/attendance/biometrics/photo', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const pin = String(req.query.pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'Which Reader ID?' });
  const t = await peoplePrisma.biometricTemplate.findFirst({ where: { accountId, orgId, pin, type: USERPIC }, orderBy: { updatedAt: 'desc' }, select: { data: true, updatedAt: true } });
  if (!t) return res.status(404).json({ error: 'No photo from a reader for this person.' });
  res.json({ pin, photo: `data:image/jpeg;base64,${t.data}`, updatedAt: t.updatedAt });
});

// ---------------------------------------------------------------------------
// Transactions: punches exactly as the readers sent them (ClorTime's Transaction view)
// ---------------------------------------------------------------------------

const range = (q: any) => {
  const t = today();
  const to = ISO_DATE.test(String(q.to || '')) ? String(q.to) : t;
  const from = ISO_DATE.test(String(q.from || '')) ? String(q.from) : to;
  return { from, to };
};
const LIMIT = 5000;

devicesRouter.get('/orgs/:orgId/attendance/transactions', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const { from, to } = range(req.query);
  const employeeId = String(req.query.employeeId || '').trim();
  const deviceId = String(req.query.deviceId || '').trim();
  const unmatched = req.query.unmatched === 'true';
  const where: any = {
    accountId,
    orgId,
    localTime: { gte: `${from} 00:00:00`, lte: `${to} 23:59:59` },
    ...(deviceId ? { deviceId } : {}),
    ...(unmatched ? { employeeId: null } : employeeId ? { employeeId } : {}),
  };
  const [rows, total, devices, people] = await Promise.all([
    peoplePrisma.devicePunch.findMany({ where, orderBy: { at: 'desc' }, take: LIMIT }),
    peoplePrisma.devicePunch.count({ where }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true, code: true } }),
  ]);
  /* For an unmatched ID, the name the reader has for it helps say who it is. */
  const unmatchedPins = [...new Set(rows.filter((r) => !r.employeeId).map((r) => r.pin))];
  const onReader = unmatchedPins.length
    ? await peoplePrisma.deviceUser.findMany({ where: { orgId, pin: { in: unmatchedPins } }, select: { deviceId: true, pin: true, name: true } })
    : [];
  const readerName = (deviceId: string, pin: string) =>
    onReader.find((u) => u.deviceId === deviceId && u.pin === pin)?.name || onReader.find((u) => u.pin === pin && u.name)?.name || null;
  const fenceIds = [...new Set(rows.map((r) => r.geofenceId).filter(Boolean))] as string[];
  const fences = fenceIds.length ? await peoplePrisma.geofence.findMany({ where: { orgId, id: { in: fenceIds } }, select: { id: true, name: true } }) : [];
  const site = new Map(fences.map((f) => [f.id, f.name]));
  const dev = new Map(devices.map((d) => [d.id, d.name]));
  const emp = new Map(people.map((p) => [p.id, p]));
  res.json({
    from,
    to,
    total,
    truncated: total > rows.length,
    transactions: rows.map((r) => ({
      id: r.id,
      pin: r.pin,
      localTime: r.localTime,
      kind: r.kind,
      state: r.state,
      verifyMode: r.verifyMode,
      verify: VERIFY_MODES[r.verifyMode] || `Code ${r.verifyMode}`,
      workCode: r.workCode ?? null,
      deviceId: r.deviceId,
      deviceName: dev.get(r.deviceId) || r.serialNumber,
      employeeId: r.employeeId,
      employeeName: r.employeeId ? emp.get(r.employeeId)?.name || null : null,
      employeeCode: r.employeeId ? emp.get(r.employeeId)?.code || null : null,
      nameOnReader: r.employeeId ? null : readerName(r.deviceId, r.pin),
      shiftDate: r.shiftDate,
      /* Phone punches: where, which site, and the selfie while it is kept. */
      latitude: r.latitude,
      longitude: r.longitude,
      accuracyM: r.accuracyM,
      siteName: r.geofenceId ? site.get(r.geofenceId) || null : null,
      photoId: r.photoId,
    })),
  });
});

devicesRouter.get('/orgs/:orgId/attendance/device-logs', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const { from, to } = range(req.query);
  const kind = req.query.kind === 'ERROR' ? 'ERROR' : 'OPERATION';
  const deviceId = String(req.query.deviceId || '').trim();
  const where: any = { accountId, orgId, kind, localTime: { gte: `${from} 00:00:00`, lte: `${to} 23:59:59` }, ...(deviceId ? { deviceId } : {}) };
  const [rows, devices] = await Promise.all([
    peoplePrisma.deviceLog.findMany({ where, orderBy: { localTime: 'desc' }, take: LIMIT }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const dev = new Map(devices.map((d) => [d.id, d.name]));
  res.json({ from, to, kind, logs: rows.map((r) => ({ ...r, deviceName: dev.get(r.deviceId) || '—' })) });
});

/** Pull from a vendor cloud now; `from` (YYYY-MM-DD, up to 31 days back) fetches older punches. */
devicesRouter.post(`${base}/:id/sync`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!device) return res.status(404).json({ error: 'No such connection.' });
  if (!can_(device.vendor, 'pull')) return res.status(400).json({ error: 'This source sends its punches itself; there is nothing to pull.' });
  let from: Date | undefined;
  if (req.body?.from) {
    if (!ISO_DATE.test(String(req.body.from))) return res.status(400).json({ error: 'Dates are YYYY-MM-DD.' });
    from = new Date(`${req.body.from}T00:00:00+05:30`);
    if (Date.now() - from.getTime() > 31 * 86_400_000) return res.status(400).json({ error: 'Go back at most 31 days at a time.' });
  }
  const r = await syncVendorConnection(device, { from });
  res.status(r.ok ? 200 : 502).json(r.ok ? r : { error: r.message, ...r });
});

// ---------------------------------------------------------------------------
// Mapped sources: HTTP push and file import (services/attendance/punchMapping.ts)
// ---------------------------------------------------------------------------

const mappedDevice = async (req: any, res: any) => {
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId: req.tenant.accountId, orgId: req.tenant.orgId } });
  if (!d) {
    res.status(404).json({ error: 'No such reader.' });
    return null;
  }
  if (!driverOf(d.vendor).capabilities.includes('mapping')) {
    res.status(400).json({ error: 'This reader has no field mapping; it speaks its own protocol.' });
    return null;
  }
  return d;
};

/** A new push URL; the old one stops working at once. */
/**
 * Signing for a push reader: a secret its pushes are signed with (routes/ingest.ts),
 * shown once. `{ on: false }` stops requiring it.
 */
/** Which brands and devices CLOR supports, and how far (services/attendance/certification.ts). */
devicesRouter.get('/orgs/:orgId/attendance/reader-compatibility', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  res.json({ catalogue: CATALOGUE.map((c) => ({ ...c, label: SUPPORT_LABEL[c.support] })), tests: TESTS });
});

/**
 * One reader against the certification tests, from what CLOR has seen of it.
 * PASS has evidence here; OPEN has none yet (not a failure); NA does not apply.
 */
devicesRouter.get(`${base}/:id/certification`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  const [punches, runs, refetch, sited, crossed, unknownDir, logs] = await Promise.all([
    peoplePrisma.devicePunch.count({ where: { orgId, deviceId: d.id } }),
    peoplePrisma.ingestRun.aggregate({ where: { orgId, deviceId: d.id }, _sum: { duplicates: true }, _count: { _all: true } }),
    peoplePrisma.deviceCommand.count({ where: { deviceId: d.id, command: { startsWith: 'DATA QUERY ATTLOG' }, status: 'DONE' } }),
    d.areaId ? peoplePrisma.readerIdAtSite.count({ where: { orgId, areaId: d.areaId } }) : Promise.resolve(0),
    /* Night-shift exits: punches whose shift day is the day before the date on the punch. */
    peoplePrisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM "DevicePunch" WHERE "orgId" = ${orgId} AND "deviceId" = ${d.id} AND "shiftDate" IS NOT NULL AND "shiftDate" <> substring("localTime", 1, 10)`.then((x) => Number(x[0]?.n || 0)).catch(() => 0),
    peoplePrisma.devicePunch.count({ where: { orgId, deviceId: d.id, kind: null } }),
    peoplePrisma.deviceLog.count({ where: { orgId, deviceId: d.id } }),
  ]);
  const late = await peoplePrisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM "DevicePunch" WHERE "orgId" = ${orgId} AND "deviceId" = ${d.id} AND "createdAt" - "at" > interval '30 minutes'`.catch(() => [{ n: 0n }]);
  const isPush = ['ADMS', 'HTTP_PUSH', 'HIKVISION_PUSH', 'MATRIX_COSEC'].includes(d.vendor);
  const r = (id: string, status: 'PASS' | 'OPEN' | 'NA', evidence: string) => ({ id, label: TESTS.find((t) => t.id === id)!.label, status, evidence });
  const tests = [
    r('T-01', d.model && d.firmware ? 'PASS' : 'OPEN', d.model ? `${d.model}${d.firmware ? `, firmware ${d.firmware}` : ', firmware not reported'}` : 'The reader has not said what it is.'),
    r('T-02', d.vendor === 'ADMS' ? (d.networkVerifiedAt ? 'PASS' : 'OPEN') : d.pushTokenHash || d.apiSecret ? 'PASS' : 'OPEN', d.vendor === 'ADMS' ? (d.networkVerifiedAt ? 'Data taken only from its approved network.' : 'Network not approved yet.') : d.vendor === 'HTTP_PUSH' ? (d.apiSecret ? 'Own URL and signed pushes.' : 'Own secret URL; signing is off.') : 'Own credentials, kept encrypted.'),
    r('T-03', punches ? 'PASS' : 'OPEN', `${punches} punch${punches === 1 ? '' : 'es'} received.`),
    r('T-04', d.vendor === 'ADMS' ? (refetch ? 'PASS' : 'OPEN') : isPush ? 'NA' : d.lastFetchedAt ? 'PASS' : 'OPEN', d.vendor === 'ADMS' ? (refetch ? 'Its whole log was fetched again.' : 'Not fetched again yet (Readers → Fetch punches).') : isPush ? 'This kind of reader only pushes.' : 'Fetched by time window, with overlap.'),
    r('T-05', (runs._sum.duplicates || 0) > 0 ? 'PASS' : 'OPEN', `${runs._sum.duplicates || 0} resent punch${(runs._sum.duplicates || 0) === 1 ? '' : 'es'} dropped as repeats across ${runs._count._all} deliveries.`),
    r('T-06', Number(late[0]?.n || 0) > 0 ? 'PASS' : 'OPEN', Number(late[0]?.n || 0) ? `${late[0].n} punch${Number(late[0].n) === 1 ? '' : 'es'} arrived more than 30 minutes after they were made.` : 'No late delivery seen yet.'),
    r('T-07', d.clockCheckedAt ? 'PASS' : 'OPEN', d.clockCheckedAt ? `Clock ${Math.abs(d.clockOffsetSec || 0)} s ${(d.clockOffsetSec || 0) >= 0 ? 'ahead' : 'behind'} when last measured.` : 'Not measured yet.'),
    r('T-08', 'PASS', `Times without a zone read as ${d.sourceTimezone}.`),
    r('T-09', crossed ? 'PASS' : 'OPEN', crossed ? `${crossed} night-shift exit${crossed === 1 ? '' : 's'} put on the night they started.` : 'No night-shift exit seen yet.'),
    r('T-10', d.areaId ? 'PASS' : 'NA', d.areaId ? `Site reader; ${sited} site ID${sited === 1 ? '' : 's'} in use there.` : 'Not tied to a site: company-wide IDs.'),
    r('T-11', 'PASS', unknownDir ? `${unknownDir} punch${unknownDir === 1 ? '' : 'es'} without in/out, paired by order.` : 'Every punch said in or out.'),
    r('T-12', d.lastSeenAt ? 'PASS' : 'OPEN', d.lastSeenAt ? 'Watched on Reader health.' : 'Not heard from yet.'),
    r('T-13', 'PASS', `Original of every punch kept (13 months); ${logs} reader log entr${logs === 1 ? 'y' : 'ies'}.`),
    r('T-14', 'PASS', 'Speaks the reader’s own protocol; no vendor SDK.'),
  ];
  res.json({ ...supportOf(d.vendor, d.model, d.firmware), model: d.model, firmware: d.firmware, tests });
});

/** What a reader sent, as it came: punches, refused lines and events set aside (ReaderEvent). */
devicesRouter.get(`${base}/:id/events`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  const outcome = String(req.query.outcome || '').toUpperCase();
  const where: any = { orgId, deviceId: d.id, ...(['NEW', 'REJECTED', 'IGNORED'].includes(outcome) ? { outcome } : {}) };
  const [rows, counts] = await Promise.all([
    peoplePrisma.readerEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, take: 200 }),
    peoplePrisma.readerEvent.groupBy({ by: ['outcome'], where: { orgId, deviceId: d.id }, _count: { _all: true } }),
  ]);
  res.json({ counts: Object.fromEntries(counts.map((c) => [c.outcome, c._count._all])), events: rows.map(({ accountId: _a, orgId: _o, ...e }) => ({ ...e, original: e.original.slice(0, 2_000) })) });
});

devicesRouter.post(`${base}/:id/signing`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, vendor: true } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  if (d.vendor !== 'HTTP_PUSH') return res.status(400).json({ error: 'Only readers that push to their own URL can sign.' });
  if (req.body?.on === false) {
    await peoplePrisma.attendanceDevice.update({ where: { id: d.id }, data: { apiSecret: null } });
    return res.json({ signing: false });
  }
  const secret = `clors_${randomBytes(24).toString('base64url')}`;
  await peoplePrisma.attendanceDevice.update({ where: { id: d.id }, data: { apiSecret: encryptSecret(secret) } });
  res.json({ signing: true, secret });
});

devicesRouter.post(`${base}/:id/rotate-token`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  if (d.vendor !== 'HTTP_PUSH' && d.vendor !== 'MATRIX_COSEC' && d.vendor !== 'HIKVISION_PUSH') return res.status(400).json({ error: 'Only a source that pushes to a URL has one.' });
  const token = newPushToken();
  /* Batch 5: the registry first — if the rotation cannot be recorded, the old URL keeps working and this fails (KTD4). */
  try {
    const live = await liveCredentialFor('DEVICE_PUSH', d.id, { hash: d.pushTokenHash, prefix: d.pushTokenPrefix, accountId, orgId, createdByUserId: d.createdByUserId, label: d.name }, actorFrom(req));
    if (live) await rotateCredential(live.id, orgId, { token, tokenPrefix: token.slice(0, 12) }, actorFrom(req), req.body?.reason ? String(req.body.reason).slice(0, 200) : null);
  } catch (e) {
    if (e instanceof CredentialError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  await peoplePrisma.attendanceDevice.update({ where: { id: d.id }, data: { pushTokenHash: hashToken(token), pushTokenPrefix: token.slice(0, 12) } });
  res.json({ pushToken: token });
});

/** The last thing the source sent, so the mapping can be checked against it. */
devicesRouter.get(`${base}/:id/last-payload`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!d) return res.status(404).json({ error: 'No such reader.' });
  if (!driverOf(d.vendor).capabilities.includes('mapping') && d.vendor !== 'HIKVISION_PUSH') return res.status(400).json({ error: 'This reader keeps no last payload.' });
  res.json({ payload: d.lastPayload || null, at: d.lastPayloadAt || null });
});

const previewSchema = z.object({
  mapping: mappingSchema,
  sourceTimezone: z.string().trim().max(60).optional(),
  /** A JSON body (HTTP push) or CSV text (file); when absent, the last payload the source sent. */
  sample: z.string().max(2_000_000).optional(),
  save: z.boolean().optional(),
});

/** Run a mapping over a sample (or the last payload) without saving punches; `save` writes the punches too (file import). */
devicesRouter.post(`${base}/:id/preview`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const d = await mappedDevice(req, res);
  if (!d) return;
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the mapping.' });
  const { mapping, sample, save } = parsed.data;
  const zone = parsed.data.sourceTimezone || d.sourceTimezone;
  if (!validZone(zone)) return res.status(400).json({ error: 'That is not a timezone name.' });
  const text = sample ?? d.lastPayload ?? '';
  if (!text.trim()) return res.status(400).json({ error: d.vendor === 'FILE' ? 'Choose a file first.' : 'Nothing has been sent to this URL yet. Send one punch from the reader, then come back.' });
  let records: unknown[];
  let headers: string[] = [];
  if (d.vendor === 'FILE' || !/^\s*[\[{]/.test(text)) {
    const csv = parseCsv(text);
    headers = csv.headers;
    records = csv.rows;
  } else {
    try {
      records = recordsOf(JSON.parse(text), mapping);
    } catch {
      return res.status(400).json({ error: 'That is not JSON.' });
    }
    const first = records[0];
    headers = first && typeof first === 'object' ? Object.keys(first as object) : [];
  }
  const out = toAttlog(records, mapping, zone);
  let added = 0;
  if (save && out.lines.length) {
    added = await ingestPunches(d, out.lines.join('\n'), { sources: out.sources, aside: out.aside });
    await peoplePrisma.attendanceDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), lastFetchedAt: new Date(), mappingJson: JSON.stringify(mapping), sourceTimezone: zone } });
  }
  res.json({ records: records.length, readable: out.lines.length, skipped: out.skipped, errors: out.errors, sample: out.sample, headers, ...(save ? { added, duplicates: out.lines.length - added } : {}) });
});
