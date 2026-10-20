import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import express from 'express';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';

import { platformPrisma } from '../utils/platformPrisma.js';
import { createSession, clientIp, recordAuthEvent } from '../services/auth.js';
import { decryptSecret } from '../services/mailer.js';
import { setRefreshCookie } from '../utils/refreshCookie.js';
import { providerSpeaksFor } from '../services/ssoDomains.js';
import { ssoLimiter } from '../middleware/rateLimit.js';
import { isDevOrTest } from '../utils/devMode.js';

/**
 * Single sign-on, OpenID Connect.
 *
 * A company configures a provider under Settings → Sign-in methods (an issuer
 * or discovery URL, a client id and secret, the e-mail domains it owns). From
 * then on, an e-mail at one of those domains typed on the sign-in screen is
 * offered "Continue with <provider>", which runs the authorisation-code flow
 * with PKCE here and ends with the same refresh cookie a password sign-in
 * ends with — the shell picks the session up from it like any other.
 *
 * Who may sign in this way: an existing CLOR user whose e-mail the provider
 * asserts, or — when the provider says so — a new user made on the spot, a
 * member of that company with the provider's default role. Nothing else: the
 * provider vouches for the e-mail, the company vouches for the person.
 *
 * SAML 2.0 (Microsoft Entra, Okta, ADFS, Google) goes the same way: CLOR is
 * the service provider, its metadata at /saml/<id>/metadata, the assertion
 * posted back to /saml/<id>/acs and checked against the provider's
 * certificate. Both end in finishSignIn: one rule for who gets in.
 */
export const ssoRouter = Router();

const STATE_COOKIE = 'clor_sso';
const STATE_TTL_S = 10 * 60;
/* Like every other signer: no JWT_SECRET outside dev/test means SSO refuses, not a guessable key. */
const secret = () => process.env.JWT_SECRET || (isDevOrTest() ? 'dev-secret' : '');
const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
/** Where the provider sends the person back: this API's own public address. */
export const callbackUrl = () => `${(process.env.API_PUBLIC_URL || process.env.API_URL || appUrl()).replace(/\/$/, '')}/api/auth/sso/callback`;
const isProduction = () => String(process.env.NODE_ENV || '') === 'production';

const domainOf = (email: string) => String(email || '').trim().toLowerCase().split('@')[1] || '';
/* A provider speaks only for domains its company has proved it owns (services/ssoDomains.ts). */

/** Providers that own this e-mail's domain, enabled — the ones a sign-in screen may offer. */
export async function providersForEmail(email: string) {
  const domain = domainOf(email);
  if (!domain) return [];
  const rows = await platformPrisma.authProvider.findMany({ where: { enabled: true, kind: { in: ['OIDC', 'SAML'] } }, select: { id: true, name: true, kind: true, orgId: true, emailDomains: true, verifiedDomains: true } });
  return rows.filter((p) => providerSpeaksFor(p, domain)).map((p) => ({ id: p.id, name: p.name, kind: p.kind }));
}

/** The sign-in screen asks which providers an e-mail may use. Public, so it says nothing but names. */
ssoRouter.get('/lookup', ...ssoLimiter, async (req, res) => {
  const email = String(req.query.email || '');
  res.json({ providers: await providersForEmail(email) });
});

async function configFor(p: { issuer: string | null; discoveryUrl: string | null; clientId: string | null; clientSecretEnc: string | null }) {
  const issuer = new URL(p.discoveryUrl || p.issuer || '');
  const secretValue = p.clientSecretEnc ? decryptSecret(p.clientSecretEnc) : undefined;
  const options: Partial<oidc.DiscoveryRequestOptions> = {};
  if (!isProduction()) options.execute = [oidc.allowInsecureRequests];
  return oidc.discovery(issuer, String(p.clientId || ''), secretValue ? { client_secret: secretValue } : undefined, undefined, options as any);
}

/* ---------------------------------------------------------------- SAML */

const samlBase = () => `${(process.env.API_PUBLIC_URL || process.env.API_URL || appUrl()).replace(/\/$/, '')}/api/auth/sso/saml`;
/** Where the identity provider posts the assertion (its "Reply URL" / "ACS URL"). */
export const samlAcsUrl = (providerId: string) => `${samlBase()}/${providerId}/acs`;
/** CLOR's name as a service provider (its "Identifier" / "Audience"), also where its metadata is. */
export const samlEntityId = (providerId: string) => `${samlBase()}/${providerId}/metadata`;

function samlFor(p: { id: string; entryPoint: string | null; certificate: string | null; entityId: string | null }) {
  if (!p.entryPoint || !p.certificate) throw new Error('This SAML provider has no sign-in URL or certificate');
  return new SAML({
    callbackUrl: samlAcsUrl(p.id),
    entryPoint: p.entryPoint,
    issuer: samlEntityId(p.id),
    idpCert: p.certificate.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
    ...(p.entityId ? { idpIssuer: p.entityId } : {}),
    audience: samlEntityId(p.id),
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    /* No request cache across API instances: the assertion's own window and signature are the check. */
    validateInResponseTo: ValidateInResponseTo.never,
    acceptedClockSkewMs: 5 * 60_000,
  });
}

const CLAIM = {
  email: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'email', 'mail', 'emailAddress', 'urn:oid:0.9.2342.19200300.100.1.3'],
  name: ['http://schemas.microsoft.com/identity/claims/displayname', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name', 'displayName', 'name', 'cn'],
  given: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', 'givenName', 'firstName'],
  family: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname', 'sn', 'surname', 'lastName'],
};
const claimOf = (profile: Record<string, any>, keys: string[]) => {
  for (const k of keys) {
    const v = profile[k] ?? profile.attributes?.[k];
    if (v) return String(Array.isArray(v) ? v[0] : v).trim();
  }
  return '';
};

/** What the assertion says about the person, in the shape finishSignIn takes. */
export function samlClaims(profile: Record<string, any>) {
  const nameID = String(profile.nameID || '').trim();
  const email = (claimOf(profile, CLAIM.email) || (nameID.includes('@') ? nameID : '')).toLowerCase();
  const name = claimOf(profile, CLAIM.name) || `${claimOf(profile, CLAIM.given)} ${claimOf(profile, CLAIM.family)}`.trim();
  return { email, name };
}

/** CLOR's service-provider metadata, for the identity provider's "import from URL". */
ssoRouter.get('/saml/:providerId/metadata', async (req, res) => {
  const p = await platformPrisma.authProvider.findFirst({ where: { id: String(req.params.providerId), kind: 'SAML' } });
  if (!p) return res.status(404).json({ error: 'No such sign-in method.' });
  const saml = new SAML({ callbackUrl: samlAcsUrl(p.id), entryPoint: p.entryPoint || 'https://example.invalid/', issuer: samlEntityId(p.id), idpCert: 'MIIB', identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' });
  res.type('application/xml').send(saml.generateServiceProviderMetadata(null, null));
});

/** A safe place to send someone after sign-in: a path on the app, never another site. */
const safeReturn = (v: unknown) => {
  const s = String(v || '').trim();
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
};

/** Step 1: off to the provider, with PKCE, state and nonce kept in a short-lived signed cookie. */
ssoRouter.get('/:providerId/start', ...ssoLimiter, async (req, res) => {
  const p = await platformPrisma.authProvider.findFirst({ where: { id: String(req.params.providerId), enabled: true, kind: { in: ['OIDC', 'SAML'] } } });
  if (!p) return res.status(404).json({ error: 'No such sign-in method.' });
  try {
    if (p.kind === 'SAML') {
      /* The return path rides in RelayState, signed, since the provider posts back without our cookie in some browsers. */
      const relay = jwt.sign({ typ: 'saml', pid: p.id, r: safeReturn(req.query.return) }, secret(), { expiresIn: STATE_TTL_S });
      const url = await samlFor(p).getAuthorizeUrlAsync(relay, undefined, {});
      return res.redirect(url);
    }
    const config = await configFor(p);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl(),
      scope: p.scopes || 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      ...(req.query.hint ? { login_hint: String(req.query.hint) } : {}),
    });
    const ticket = jwt.sign({ typ: 'sso', pid: p.id, v: codeVerifier, s: state, n: nonce, r: safeReturn(req.query.return) }, secret(), { expiresIn: STATE_TTL_S });
    res.cookie(STATE_COOKIE, ticket, { httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/api/auth/sso', maxAge: STATE_TTL_S * 1000 });
    res.redirect(url.href);
  } catch (e: any) {
    await platformPrisma.authProvider.update({ where: { id: p.id }, data: { lastError: String(e?.message || e).slice(0, 500) } }).catch(() => {});
    res.redirect(`${appUrl()}/?sso_error=${encodeURIComponent('That sign-in method could not be reached. Ask your administrator.')}`);
  }
});

/** Step 2: back from the provider with a code; exchange it, find or make the person, start their session. */
ssoRouter.get('/callback', async (req: Request, res: Response) => {
  const fail = (msg: string) => res.redirect(`${appUrl()}/?sso_error=${encodeURIComponent(msg)}`);
  let ticket: any;
  try {
    ticket = jwt.verify(String((req as any).cookies?.[STATE_COOKIE] || ''), secret());
  } catch {
    return fail('The sign-in took too long or started elsewhere. Try again.');
  }
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/sso' });
  const p = await platformPrisma.authProvider.findFirst({ where: { id: String(ticket.pid), enabled: true, kind: 'OIDC' } });
  if (!p) return fail('That sign-in method is no longer available.');
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] as string | undefined;
  try {
    const config = await configFor(p);
    const current = new URL(req.originalUrl, callbackUrl());
    const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: String(ticket.v), expectedState: String(ticket.s), expectedNonce: String(ticket.n) });
    const claims = (tokens.claims() || {}) as Record<string, any>;
    const email = String(claims.email || '').trim().toLowerCase();
    if (!email) throw new Error('The provider did not give an e-mail address');
    if (claims.email_verified === false) throw new Error('The provider says that e-mail is not verified');
    const name = String(claims.name || `${claims.given_name || ''} ${claims.family_name || ''}`.trim() || '');
    return finishSignIn(p, { email, name }, req, res, String(ticket.r || '/'));
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await platformPrisma.authProvider.update({ where: { id: p.id }, data: { lastError: msg.slice(0, 500) } }).catch(() => {});
    await recordAuthEvent({ eventType: 'LOGIN_FAILED', ip, userAgent, detail: `SSO ${p.name}: ${msg}` });
    return fail(`Sign-in with ${p.name} did not complete: ${msg}`);
  }
});

/**
 * The one rule for who gets in, whatever vouched for the e-mail: an existing
 * CLOR user at a domain the provider owns, or — when the provider says so — a
 * new one made on the spot as a member of that company with its default role.
 */
async function finishSignIn(p: { id: string; name: string; accountId: string; orgId: string; emailDomains: string | null; verifiedDomains: string | null; autoProvision: boolean; defaultRoleId: string | null }, who: { email: string; name: string }, req: Request, res: Response, back: string) {
  const fail = (msg: string) => res.redirect(`${appUrl()}/?sso_error=${encodeURIComponent(msg)}`);
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] as string | undefined;
  const email = who.email;
  if (!providerSpeaksFor(p, domainOf(email))) throw new Error(`${email} is not at a verified domain of this sign-in method`);

  let user = await platformPrisma.user.findFirst({ where: { email }, select: { id: true, accountId: true, isActive: true, fullName: true } });
  if (user && !user.isActive) throw new Error('This user is switched off');
  if (!user) {
    if (!p.autoProvision) {
      await recordAuthEvent({ email, eventType: 'LOGIN_FAILED', ip, userAgent, detail: `SSO ${p.name}: no CLOR user for this e-mail` });
      return fail(`${email} has no CLOR login yet. Ask your administrator to invite you.`);
    }
    /* Made on the spot: a member of the provider's company, with its default role, and a password nobody knows. */
    const fullName = String(who.name || email.split('@')[0]).slice(0, 120);
    user = await platformPrisma.user.create({
      data: { accountId: p.accountId, email, fullName, passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 10), emailVerifiedAt: new Date() },
      select: { id: true, accountId: true, isActive: true, fullName: true },
    });
    await platformPrisma.userOrgMembership.create({ data: { accountId: p.accountId, orgId: p.orgId, userId: user.id } });
    if (p.defaultRoleId) await platformPrisma.userRoleAssignment.create({ data: { accountId: p.accountId, orgId: p.orgId, userId: user.id, roleId: p.defaultRoleId, createdByUserId: user.id } }).catch(() => {});
    await recordAuthEvent({ accountId: p.accountId, userId: user.id, email, eventType: 'USER_PROVISIONED', ip, userAgent, detail: `SSO ${p.name}` });
  } else {
    /*
     * A provider vouches only for its own company's people. Someone who is not a
     * member of the provider's organisation is refused — whatever the provider
     * asserts — unless they belong to the provider's own account and it may add
     * people. Signing in a user of another account would hand one company's
     * identity provider the keys to another company's logins.
     */
    const member = await platformPrisma.userOrgMembership.findFirst({ where: { orgId: p.orgId, userId: user.id }, select: { id: true } });
    if (!member) {
      if (user.accountId !== p.accountId || !p.autoProvision) {
        await recordAuthEvent({ email, eventType: 'LOGIN_FAILED', ip, userAgent, detail: `SSO ${p.name}: not a member of the provider's organisation` });
        return fail(`${email} is not a member of the company this sign-in method belongs to.`);
      }
      await platformPrisma.userOrgMembership.create({ data: { accountId: p.accountId, orgId: p.orgId, userId: user.id } });
    }
  }
  const { refreshToken } = await createSession({ accountId: user.accountId, userId: user.id, ip, userAgent });
  await platformPrisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  await platformPrisma.authProvider.update({ where: { id: p.id }, data: { lastUsedAt: new Date(), lastError: null } });
  await recordAuthEvent({ accountId: user.accountId, userId: user.id, email, eventType: 'LOGIN_SUCCESS', ip, userAgent, detail: `SSO ${p.name}` });
  setRefreshCookie(res, refreshToken);
  return res.redirect(`${appUrl()}${back}${back.includes('?') ? '&' : '?'}sso=ok`);
}

/** SAML step 2: the provider posts the signed assertion here. */
ssoRouter.post('/saml/:providerId/acs', ...ssoLimiter, express.urlencoded({ extended: false, limit: '256kb' }), async (req: Request, res: Response) => {
  const fail = (msg: string) => res.redirect(`${appUrl()}/?sso_error=${encodeURIComponent(msg)}`);
  const p = await platformPrisma.authProvider.findFirst({ where: { id: String(req.params.providerId), enabled: true, kind: 'SAML' } });
  if (!p) return fail('That sign-in method is no longer available.');
  let back = '/';
  try {
    const relay: any = jwt.verify(String(req.body?.RelayState || ''), secret());
    if (relay?.pid === p.id) back = safeReturn(relay.r);
  } catch {
    /* No usable RelayState (IdP-initiated sign-in): land on the home page. */
  }
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] as string | undefined;
  try {
    const { profile, loggedOut } = await samlFor(p).validatePostResponseAsync(req.body || {});
    if (loggedOut || !profile) throw new Error('The provider sent no assertion');
    /* Each assertion signs in once: a captured one posted again is refused until it would have expired anyway. */
    const assertionXml = typeof (profile as any).getAssertionXml === 'function' ? String((profile as any).getAssertionXml() || '') : '';
    const assertionId = String(/<(?:[\w-]+:)?Assertion\b[^>]*\sID="([^"]+)"/.exec(assertionXml)?.[1] || (profile as any).sessionIndex || '').slice(0, 200);
    if (!assertionId) throw new Error('The assertion carries no ID');
    await platformPrisma.ssoAssertionSeen.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    try {
      await platformPrisma.ssoAssertionSeen.create({ data: { id: `${p.id}:${assertionId}`, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    } catch {
      throw new Error('This sign-in was already used; start again');
    }
    const who = samlClaims(profile as any);
    if (!who.email) throw new Error('The assertion carries no e-mail address (NameID or an e-mail claim is needed)');
    return await finishSignIn(p, who, req, res, back);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await platformPrisma.authProvider.update({ where: { id: p.id }, data: { lastError: msg.slice(0, 500) } }).catch(() => {});
    await recordAuthEvent({ eventType: 'LOGIN_FAILED', ip, userAgent, detail: `SSO ${p.name}: ${msg}` });
    return fail(`Sign-in with ${p.name} did not complete: ${msg}`);
  }
});
