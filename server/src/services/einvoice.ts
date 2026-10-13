import { constants, createCipheriv, createDecipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { encryptSecret, decryptSecret } from './mailer.js';

/**
 * e-Invoice (IRP) integration.
 *
 * The GST network's Invoice Registration Portal is reached through a GSP /
 * API-gateway REST endpoint (MasterGST, ClearTax, Cygnet, a self-hosted NIC
 * proxy, or the NIC sandbox). The org stores its gateway URL and credentials
 * once; registering an invoice POSTs the NIC INV-01 payload and stores the
 * returned IRN + signed QR on the invoice row.
 *
 * The HTTP transport is injectable so the whole flow is testable without a
 * live IRP.
 */

export type EInvoiceConfig = {
  mode: string;
  provider: string; // GSP | NIC
  baseUrl: string;
  gstin: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  publicKeyPem: string;
  headers: Record<string, string>;
  autoRegister: boolean;
};

const SANDBOX_HINT =
  'No e-Invoice gateway configured. Set the IRP/GSP endpoint and credentials under Settings → Tax & Compliance.';

export async function getEInvoiceSetting(orgId: string) {
  return prisma.eInvoiceSetting.findUnique({ where: { orgId } });
}

export async function getEInvoiceConfig(orgId: string): Promise<EInvoiceConfig | null> {
  const row = await getEInvoiceSetting(orgId);
  if (!row || !String(row.baseUrl || '').trim()) return null;

  let headers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(row.headersJson || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
    }
  } catch {
    headers = {};
  }

  return {
    mode: String(row.mode || 'SANDBOX'),
    provider: String(row.provider || 'GSP'),
    baseUrl: String(row.baseUrl || '').replace(/\/+$/, ''),
    gstin: String(row.gstin || ''),
    username: String(row.username || ''),
    password: row.passwordEnc ? decryptSecret(row.passwordEnc) : '',
    clientId: String(row.clientId || ''),
    clientSecret: row.clientSecretEnc ? decryptSecret(row.clientSecretEnc) : '',
    publicKeyPem: String(row.publicKeyPem || ''),
    headers,
    autoRegister: Boolean(row.autoRegister),
  };
}

export async function saveEInvoiceSetting(
  accountId: string,
  orgId: string,
  userId: string,
  input: {
    mode?: string;
    provider?: string;
    baseUrl?: string | null;
    gstin?: string | null;
    username?: string | null;
    password?: string | null;
    clientId?: string | null;
    clientSecret?: string | null;
    publicKeyPem?: string | null;
    headersJson?: string | null;
    autoRegister?: boolean;
  }
) {
  const data: Record<string, unknown> = {
    accountId,
    orgId,
    updatedByUserId: userId,
  };
  if (input.mode !== undefined) data.mode = input.mode === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  if (input.provider !== undefined) data.provider = input.provider === 'NIC' ? 'NIC' : 'GSP';
  if (input.publicKeyPem !== undefined) data.publicKeyPem = input.publicKeyPem ? String(input.publicKeyPem) : null;
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl ? String(input.baseUrl).trim() : null;
  if (input.gstin !== undefined) data.gstin = input.gstin ? String(input.gstin).trim().toUpperCase() : null;
  if (input.username !== undefined) data.username = input.username ? String(input.username).trim() : null;
  if (input.clientId !== undefined) data.clientId = input.clientId ? String(input.clientId).trim() : null;
  if (input.headersJson !== undefined) data.headersJson = input.headersJson ? String(input.headersJson) : null;
  if (input.autoRegister !== undefined) data.autoRegister = Boolean(input.autoRegister);
  // Blank secret = leave stored secret untouched; the settings form never
  // echoes secrets back, so an untouched field arrives empty.
  if (input.password) data.passwordEnc = encryptSecret(String(input.password));
  if (input.clientSecret) data.clientSecretEnc = encryptSecret(String(input.clientSecret));

  const { accountId: _a, orgId: _o, ...update } = data;
  return prisma.eInvoiceSetting.upsert({
    where: { orgId },
    create: data as any,
    update: update as any,
  });
}

// ---------------------------------------------------------------------------
// IRP calls
// ---------------------------------------------------------------------------

export type IrpResult = {
  ok: boolean;
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  signedQr?: string;
  signedInvoice?: string;
  error?: string;
  raw?: unknown;
};

type FetchLike = (url: string, init?: any) => Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }>;

const authHeaders = (cfg: EInvoiceConfig): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(cfg.username ? { username: cfg.username } : {}),
  ...(cfg.password ? { password: cfg.password } : {}),
  ...(cfg.clientId ? { client_id: cfg.clientId } : {}),
  ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
  ...(cfg.gstin ? { gstin: cfg.gstin } : {}),
  ...cfg.headers,
});

/** Pull IRN fields out of the many response shapes gateways use. */
const parseIrpResponse = (body: any): IrpResult => {
  // Gateways wrap the NIC response differently: {data: {...}}, {result: {...}},
  // or the NIC shape itself {Status, Data|ErrorDetails}.
  const layers = [body, body?.data, body?.result, body?.Data, body?.response].filter(
    (x) => x && typeof x === 'object'
  );
  for (const layer of layers) {
    const irn = layer.Irn || layer.irn || layer.IRN;
    if (irn) {
      return {
        ok: true,
        irn: String(irn),
        ackNo: String(layer.AckNo ?? layer.ackNo ?? layer.ack_no ?? ''),
        ackDate: String(layer.AckDt ?? layer.ackDt ?? layer.ack_dt ?? layer.AckDate ?? ''),
        signedQr: String(layer.SignedQRCode ?? layer.signedQRCode ?? layer.signed_qr_code ?? ''),
        signedInvoice: String(layer.SignedInvoice ?? layer.signedInvoice ?? layer.signed_invoice ?? ''),
        raw: body,
      };
    }
  }

  const errors =
    body?.ErrorDetails || body?.errorDetails || body?.error_details || body?.errors || body?.error || body?.message;
  let error = '';
  if (Array.isArray(errors)) {
    error = errors
      .map((e: any) => String(e?.ErrorMessage ?? e?.error_message ?? e?.message ?? JSON.stringify(e)))
      .join('; ');
  } else if (errors && typeof errors === 'object') {
    error = String((errors as any).ErrorMessage ?? (errors as any).message ?? JSON.stringify(errors));
  } else if (errors) {
    error = String(errors);
  }
  return { ok: false, error: error || 'IRP did not return an IRN', raw: body };
};

// ---------------------------------------------------------------------------
// NIC direct API (einv-apisandbox.nic.in / einvoice1.gst.gov.in spec)
//
// Auth (POST {base}/eivital/v1.04/auth):
//   Data = RSA-PKCS1(base64(JSON{UserName, Password, AppKey, ForceRefreshAccessToken}))
//   → { AuthToken, Sek } where Sek is AES-256-ECB encrypted with the AppKey.
// Generate IRN (POST {base}/eicore/v1.03/Invoice):
//   Data = base64(AES-256-ECB(SEK, INV-01 JSON)); response Data decrypts the
//   same way. Errors arrive as base64 ErrorDetails.
// ---------------------------------------------------------------------------

export const nicCrypto = {
  rsaEncrypt(publicKeyPem: string, plain: Buffer): string {
    return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, plain).toString('base64');
  },
  aesEncrypt(key: Buffer, plain: Buffer): string {
    const cipher = createCipheriv('aes-256-ecb', key, null);
    return Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64');
  },
  aesDecrypt(key: Buffer, b64: string): Buffer {
    const decipher = createDecipheriv('aes-256-ecb', key, null);
    return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]);
  },
};

type NicSession = { authToken: string; sek: Buffer; expiresAt: number };
const nicSessions = new Map<string, NicSession>();

/** Exposed for tests: a stale cache must never leak across orgs or runs. */
export function clearNicSessions() {
  nicSessions.clear();
}

const nicBaseHeaders = (cfg: EInvoiceConfig): Record<string, string> => ({
  'Content-Type': 'application/json',
  client_id: cfg.clientId,
  client_secret: cfg.clientSecret,
  Gstin: cfg.gstin,
  ...cfg.headers,
});

const nicErrors = (body: any): string => {
  let details = body?.ErrorDetails;
  if (typeof details === 'string') {
    // Errors usually arrive base64-encoded; sometimes as plain JSON text.
    try {
      details = JSON.parse(Buffer.from(details, 'base64').toString('utf8'));
    } catch {
      try {
        details = JSON.parse(details);
      } catch {
        return String(details);
      }
    }
  }
  if (Array.isArray(details)) {
    return details.map((e: any) => String(e?.ErrorMessage ?? e?.error_message ?? JSON.stringify(e))).join('; ');
  }
  return details ? String((details as any).ErrorMessage ?? JSON.stringify(details)) : 'NIC API error';
};

async function nicAuthenticate(orgId: string, cfg: EInvoiceConfig, doFetch: FetchLike): Promise<NicSession | { error: string }> {
  const cached = nicSessions.get(orgId);
  if (cached && cached.expiresAt > Date.now() + 2 * 60 * 1000) return cached;

  if (!cfg.publicKeyPem.trim()) {
    return { error: 'NIC provider needs the e-Invoice system public key (PEM). Download it from the portal and paste it in settings.' };
  }

  const appKey = randomBytes(32);
  const authJson = JSON.stringify({
    UserName: cfg.username,
    Password: cfg.password,
    AppKey: appKey.toString('base64'),
    ForceRefreshAccessToken: false,
  });

  let data: string;
  try {
    data = nicCrypto.rsaEncrypt(cfg.publicKeyPem, Buffer.from(Buffer.from(authJson, 'utf8').toString('base64'), 'utf8'));
  } catch (err: any) {
    return { error: `Could not encrypt the auth payload — check the public key PEM: ${String(err?.message || err)}` };
  }

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`${cfg.baseUrl}/eivital/v1.04/auth`, {
      method: 'POST',
      headers: nicBaseHeaders(cfg),
      body: JSON.stringify({ Data: data }),
    });
  } catch (err: any) {
    return { error: `Could not reach the NIC e-Invoice API: ${String(err?.message || err)}` };
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { error: `NIC auth answered ${res.status} with a non-JSON body` };
  }
  if (String(body?.Status) !== '1' || !body?.Data?.AuthToken) {
    return { error: `NIC auth failed: ${nicErrors(body)}` };
  }

  let sek: Buffer;
  try {
    sek = nicCrypto.aesDecrypt(appKey, String(body.Data.Sek));
  } catch (err: any) {
    return { error: `Could not decrypt the session key (Sek): ${String(err?.message || err)}` };
  }

  const session: NicSession = {
    authToken: String(body.Data.AuthToken),
    sek,
    // Sandbox tokens live 60 minutes; refresh a little early regardless of
    // what TokenExpiry parses to.
    expiresAt: Date.now() + 55 * 60 * 1000,
  };
  nicSessions.set(orgId, session);
  return session;
}

/** Decrypt a NIC response `Data` field: AES → (maybe base64 →) JSON. */
const nicDecryptData = (sek: Buffer, dataB64: string): any => {
  const plain = nicCrypto.aesDecrypt(sek, dataB64).toString('utf8');
  try {
    return JSON.parse(plain);
  } catch {
    return JSON.parse(Buffer.from(plain, 'base64').toString('utf8'));
  }
};

async function nicCall(
  orgId: string,
  cfg: EInvoiceConfig,
  path: string,
  payload: unknown,
  doFetch: FetchLike
): Promise<IrpResult> {
  const session = await nicAuthenticate(orgId, cfg, doFetch);
  if ('error' in session) return { ok: false, error: session.error };

  const data = nicCrypto.aesEncrypt(session.sek, Buffer.from(JSON.stringify(payload), 'utf8'));

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...nicBaseHeaders(cfg), user_name: cfg.username, AuthToken: session.authToken },
      body: JSON.stringify({ Data: data }),
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach the NIC e-Invoice API: ${String(err?.message || err)}` };
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `NIC API answered ${res.status} with a non-JSON body` };
  }

  if (String(body?.Status) !== '1') {
    // An expired token comes back as an auth error; drop the session so the
    // next attempt re-authenticates instead of failing forever.
    nicSessions.delete(orgId);
    return { ok: false, error: nicErrors(body), raw: body };
  }

  let decoded: any;
  try {
    decoded = nicDecryptData(session.sek, String(body.Data));
  } catch (err: any) {
    return { ok: false, error: `Could not decrypt the NIC response: ${String(err?.message || err)}`, raw: body };
  }

  return {
    ok: true,
    irn: decoded?.Irn ? String(decoded.Irn) : undefined,
    ackNo: decoded?.AckNo != null ? String(decoded.AckNo) : '',
    ackDate: decoded?.AckDt ? String(decoded.AckDt) : '',
    signedQr: decoded?.SignedQRCode ? String(decoded.SignedQRCode) : '',
    signedInvoice: decoded?.SignedInvoice ? String(decoded.SignedInvoice) : '',
    raw: decoded,
  };
}

/**
 * Register one INV-01 payload on the IRP. `doFetch` defaults to global fetch;
 * tests inject a stub.
 */
export async function registerOnIrp(
  orgId: string,
  payload: unknown,
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<IrpResult> {
  const cfg = await getEInvoiceConfig(orgId);
  if (!cfg) return { ok: false, error: SANDBOX_HINT };

  if (cfg.provider === 'NIC') {
    const result = await nicCall(orgId, cfg, '/eicore/v1.03/Invoice', payload, doFetch);
    if (result.ok && !result.irn) return { ok: false, error: 'NIC accepted the call but returned no IRN', raw: result.raw };
    return result;
  }

  const url = `${cfg.baseUrl}/invoice`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach the e-Invoice gateway: ${String(err?.message || err)}` };
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `Gateway answered ${res.status} with a non-JSON body${text ? `: ${text.slice(0, 200)}` : ''}` };
  }

  if (res.status >= 400) {
    const parsed = parseIrpResponse(body);
    return { ok: false, error: parsed.error || `Gateway answered ${res.status}`, raw: body };
  }
  return parseIrpResponse(body);
}

/**
 * Cancel a registered IRN. NIC allows this only within 24 hours of
 * registration; reason codes: 1 duplicate, 2 data entry mistake,
 * 3 order cancelled, 4 others.
 */
export async function cancelIrnOnIrp(
  orgId: string,
  irn: string,
  { reason, remarks }: { reason: string; remarks?: string },
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<IrpResult> {
  const cfg = await getEInvoiceConfig(orgId);
  if (!cfg) return { ok: false, error: SANDBOX_HINT };

  const payload = { Irn: String(irn), CnlRsn: String(reason || '2'), CnlRem: String(remarks || 'Cancelled').slice(0, 100) };

  if (cfg.provider === 'NIC') {
    const result = await nicCall(orgId, cfg, '/eicore/v1.03/Invoice/Cancel', payload, doFetch);
    if (!result.ok) return result;
    const decoded: any = result.raw || {};
    // Cancel responses answer with the Irn + CancelDate rather than an Ack.
    return { ok: true, irn: String(decoded.Irn || irn), ackDate: String(decoded.CancelDate || ''), raw: decoded };
  }

  // GSP gateways expose a plain cancel endpoint next to /invoice.
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`${cfg.baseUrl}/invoice/cancel`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach the e-Invoice gateway: ${String(err?.message || err)}` };
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Gateway answered ${res.status} with a non-JSON body` };
  }
  if (res.status >= 400) {
    const parsed = parseIrpResponse(body);
    return { ok: false, error: parsed.error || `Gateway answered ${res.status}`, raw: body };
  }
  return { ok: true, irn, raw: body };
}

/**
 * Generate an e-Way Bill from an already-registered IRN (NIC /eiewb API).
 * `details` carries transport fields: Distance, TransId, TransName, TransMode,
 * VehNo, VehType, TransDocNo, TransDocDt — all per the EWB-by-IRN spec.
 */
export async function generateEwbByIrn(
  orgId: string,
  irn: string,
  details: Record<string, unknown> = {},
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<IrpResult & { ewbNo?: string; ewbDate?: string; ewbValidTill?: string }> {
  const cfg = await getEInvoiceConfig(orgId);
  if (!cfg) return { ok: false, error: SANDBOX_HINT };
  if (cfg.provider !== 'NIC') {
    return { ok: false, error: 'e-Way Bill by IRN is available on the NIC provider. GSP gateways expose their own EWB endpoint.' };
  }

  const result = await nicCall(orgId, cfg, '/eiewb/v1.03/ewaybill', { Irn: irn, Distance: 0, ...details }, doFetch);
  if (!result.ok) return result;
  const decoded: any = result.raw || {};
  return {
    ...result,
    ewbNo: decoded?.EwbNo != null ? String(decoded.EwbNo) : '',
    ewbDate: decoded?.EwbDt ? String(decoded.EwbDt) : '',
    ewbValidTill: decoded?.EwbValidTill ? String(decoded.EwbValidTill) : '',
  };
}

/**
 * Test button. GSP: any HTTP answer proves DNS/TLS/network. NIC: run the real
 * auth handshake — it proves credentials AND the public key in one shot.
 */
export async function testIrpConnection(
  orgId: string,
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getEInvoiceConfig(orgId);
  if (!cfg) return { ok: false, error: SANDBOX_HINT };

  if (cfg.provider === 'NIC') {
    nicSessions.delete(orgId); // force a fresh handshake, not a cached token
    const session = await nicAuthenticate(orgId, cfg, doFetch);
    return 'error' in session ? { ok: false, error: session.error } : { ok: true };
  }

  try {
    const res = await doFetch(cfg.baseUrl, { method: 'GET', headers: authHeaders(cfg) });
    return res.status < 500 ? { ok: true } : { ok: false, error: `Gateway answered ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `Could not reach the e-Invoice gateway: ${String(err?.message || err)}` };
  }
}
