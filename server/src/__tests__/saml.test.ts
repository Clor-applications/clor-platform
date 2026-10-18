import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignedXml } from 'xml-crypto';

/**
 * SAML 2.0 sign-in: a provider stored under Settings, CLOR's service-provider
 * metadata, the redirect to the identity provider, and a signed assertion
 * posted back — made here with a throwaway certificate — that signs a person
 * in, or makes them when the provider is allowed to.
 */

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { samlClaims } = await import('../routes/sso.js');

const app = buildApp().listen(0);
let dir = '';
let keyPem = '';
let certPem = '';
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clor-saml-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-subj', '/CN=test-idp', '-days', '2'], { stdio: 'ignore' });
  keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8');
  certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
});
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await platformPrisma.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(domain: string): Promise<Ctx> {
  const email = `owner.${Date.now()}.${rnd()}@${domain}`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SAML Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
}

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A SAML Response with one assertion, signed the way an identity provider signs it. */
function signedResponse(opts: { acs: string; audience: string; issuer: string; email: string; name?: string; notOnOrAfterMs?: number; audienceOverride?: string; keyPem?: string }) {
  const aid = `_a${rnd()}${rnd()}`;
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${rnd()}" Version="2.0" IssueInstant="${iso(0)}" Destination="${opts.acs}">
  <saml:Issuer>${opts.issuer}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="${aid}" Version="2.0" IssueInstant="${iso(0)}">
    <saml:Issuer>${opts.issuer}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(opts.notOnOrAfterMs ?? 300_000)}" Recipient="${opts.acs}"/></saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(opts.notOnOrAfterMs ?? 300_000)}"><saml:AudienceRestriction><saml:Audience>${opts.audienceOverride || opts.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${iso(0)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>
    ${opts.name ? `<saml:AttributeStatement><saml:Attribute Name="http://schemas.microsoft.com/identity/claims/displayname"><saml:AttributeValue>${opts.name}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` : ''}
  </saml:Assertion>
</samlp:Response>`;
  const sig = new SignedXml({ privateKey: opts.keyPem || keyPem, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } } as any);
  return Buffer.from(sig.getSignedXml()).toString('base64');
}

describe('SAML sign-in', () => {
  it('a stored provider is active, publishes CLOR’s metadata, offers itself for its domain and sends people to the IdP', async () => {
    const domain = `saml${rnd()}.example.com`;
    const c = await makeOwner(domain);
    const made = await request(app).post(`/api/orgs/${c.orgId}/security/providers`).set(at(c)).send({ kind: 'SAML', name: 'Corp ADFS', entryPoint: 'https://idp.example.com/adfs/ls/', entityId: 'https://idp.example.com/adfs/services/trust', certificate: certPem, emailDomains: domain, autoProvision: true, enabled: true }).expect(201);
    const p = made.body.provider;
    expect(p.status).toBe('ACTIVE');
    expect(p.saml).toMatchObject({ acsUrl: expect.stringMatching(new RegExp(`/api/auth/sso/saml/${p.id}/acs$`)), spEntityId: expect.stringMatching(new RegExp(`/api/auth/sso/saml/${p.id}/metadata$`)) });

    const md = await request(app).get(`/api/auth/sso/saml/${p.id}/metadata`).expect(200);
    expect(md.type).toBe('application/xml');
    expect(md.text).toContain('EntityDescriptor');
    expect(md.text).toContain(`entityID="${p.saml.spEntityId}"`);
    expect(md.text).toContain(`Location="${p.saml.acsUrl}"`);

    const lookup = await request(app).get(`/api/auth/sso/lookup?email=${encodeURIComponent(`someone@${domain}`)}`).expect(200);
    expect(lookup.body.providers).toEqual([{ id: p.id, name: 'Corp ADFS', kind: 'SAML' }]);

    const start = await request(app).get(`/api/auth/sso/${p.id}/start?return=%2Fattendance`).expect(302);
    const url = new URL(start.headers.location);
    expect(url.origin + url.pathname).toBe('https://idp.example.com/adfs/ls/');
    expect(url.searchParams.get('SAMLRequest')).toBeTruthy();
    expect(url.searchParams.get('RelayState')).toBeTruthy();

    /* The assertion comes back: a new person at the domain is made and signed in. */
    const email = `asha.${rnd()}@${domain}`;
    const relay = url.searchParams.get('RelayState')!;
    const acs = await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: signedResponse({ acs: p.saml.acsUrl, audience: p.saml.spEntityId, issuer: 'https://idp.example.com/adfs/services/trust', email, name: 'Asha Rao' }), RelayState: relay }).expect(302);
    expect(acs.headers.location).toMatch(/\/attendance\?sso=ok$/);
    expect(String(acs.headers['set-cookie'] || '')).toMatch(/neev_rt=|refresh/i);
    const user = await platformPrisma.user.findFirst({ where: { email } });
    expect(user).toMatchObject({ fullName: 'Asha Rao', isActive: true });
    expect(await platformPrisma.userOrgMembership.count({ where: { orgId: c.orgId, userId: user!.id } })).toBe(1);
    expect((await platformPrisma.authProvider.findUnique({ where: { id: p.id } }))?.lastUsedAt).toBeTruthy();

    /* The same assertion posted a second time is refused. */
    const once = signedResponse({ acs: p.saml.acsUrl, audience: p.saml.spEntityId, issuer: 'https://idp.example.com/adfs/services/trust', email });
    expect((await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: once }).expect(302)).headers.location).toMatch(/sso=ok/);
    expect(decodeURIComponent((await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: once }).expect(302)).headers.location)).toMatch(/already used/);

    /* A person of another CLOR account at this domain is never signed in by this company's provider. */
    const other = await makeOwner(`elsewhere${rnd()}.example.com`);
    const stranger = `stranger.${rnd()}@${domain}`;
    await platformPrisma.user.update({ where: { email: other.email }, data: { email: stranger } });
    const takeover = await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: signedResponse({ acs: p.saml.acsUrl, audience: p.saml.spEntityId, issuer: 'https://idp.example.com/adfs/services/trust', email: stranger }) }).expect(302);
    expect(decodeURIComponent(takeover.headers.location)).toMatch(/not a member of the company/);
    expect(String(takeover.headers['set-cookie'] || '')).not.toMatch(/neev_rt=[^;]+;/);

    /* The owner, already a user, signs in the same way; no RelayState lands on the home page. */
    const again = await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: signedResponse({ acs: p.saml.acsUrl, audience: p.saml.spEntityId, issuer: 'https://idp.example.com/adfs/services/trust', email: c.email }) }).expect(302);
    expect(again.headers.location).toMatch(/\/\?sso=ok$/);

    /* Wrong audience, expired, another domain, a different key: all refused, with the reason on the provider. */
    const bad = async (b: string, why: RegExp) => {
      const r = await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: b }).expect(302);
      expect(decodeURIComponent(r.headers.location)).toMatch(/sso_error=/);
      expect(decodeURIComponent(r.headers.location)).toMatch(why);
    };
    const base = { acs: p.saml.acsUrl, audience: p.saml.spEntityId, issuer: 'https://idp.example.com/adfs/services/trust' };
    await bad(signedResponse({ ...base, email: `x@${domain}`, audienceOverride: 'https://other.example.com' }), /audience/i);
    await bad(signedResponse({ ...base, email: `x@${domain}`, notOnOrAfterMs: -600_000 }), /expired|NotOnOrAfter/i);
    await bad(signedResponse({ ...base, email: 'x@elsewhere.example.com' }), /not at a verified domain/);
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clor-saml2-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(otherDir, 'k.pem'), '-out', path.join(otherDir, 'c.pem'), '-subj', '/CN=other', '-days', '2'], { stdio: 'ignore' });
    await bad(signedResponse({ ...base, email: `x@${domain}`, keyPem: fs.readFileSync(path.join(otherDir, 'k.pem'), 'utf8') }), /signature|Invalid/i);
    fs.rmSync(otherDir, { recursive: true, force: true });
    expect((await platformPrisma.authProvider.findUnique({ where: { id: p.id } }))?.lastError).toBeTruthy();

    /* Switched off: nothing works. */
    await request(app).patch(`/api/orgs/${c.orgId}/security/providers/${p.id}`).set(at(c)).send({ kind: 'SAML', name: 'Corp ADFS', entryPoint: 'https://idp.example.com/adfs/ls/', entityId: 'https://idp.example.com/adfs/services/trust', emailDomains: domain, autoProvision: true, enabled: false }).expect(200);
    await request(app).get(`/api/auth/sso/${p.id}/start`).expect(404);
    expect((await request(app).get(`/api/auth/sso/lookup?email=${encodeURIComponent(`someone@${domain}`)}`).expect(200)).body.providers).toEqual([]);
  });

  it('reads the e-mail and name out of what providers send', () => {
    expect(samlClaims({ nameID: 'a@b.com', nameIDFormat: 'x' })).toEqual({ email: 'a@b.com', name: '' });
    expect(samlClaims({ nameID: 'opaque-id', nameIDFormat: 'x', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'A@B.com', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'A', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': 'B' })).toEqual({ email: 'a@b.com', name: 'A B' });
    expect(samlClaims({ nameID: 'opaque', nameIDFormat: 'x', attributes: { mail: ['m@c.com'], displayName: ['M C'] } })).toEqual({ email: 'm@c.com', name: 'M C' });
    expect(samlClaims({ nameID: 'opaque', nameIDFormat: 'x' })).toEqual({ email: '', name: '' });
  });
});

describe('domain proof', () => {
  it('a provider switches on only for domains its company proved, never public mail, never another account’s', async () => {
    const { dnsTxt } = await import('../services/ssoDomains.js');
    const prev = process.env.SSO_DOMAIN_VERIFY;
    const prevResolve = dnsTxt.resolve;
    process.env.SSO_DOMAIN_VERIFY = 'on';
    const published = new Map<string, string[][]>();
    dnsTxt.resolve = async (d: string) => published.get(d) || Promise.reject(new Error('ENODATA'));
    try {
      const domain = `proof${rnd()}.example.com`;
      const c = await makeOwner(domain);
      const sec = (path: string) => `/api/orgs/${c.orgId}/security/providers${path}`;
      const base = { kind: 'SAML', name: 'Corp IdP', entryPoint: 'https://idp.example.com/sso', entityId: 'https://idp.example.com', certificate: certPem, emailDomains: domain };
      expect((await request(app).post(sec('')).set(at(c)).send({ ...base, emailDomains: 'gmail.com' }).expect(400)).body.error).toMatch(/public mail/);
      expect((await request(app).post(sec('')).set(at(c)).send({ ...base, enabled: true }).expect(400)).body.error).toMatch(/switched off/);
      const made = (await request(app).post(sec('')).set(at(c)).send(base).expect(201)).body.provider;
      expect(made.domainVerification.record).toMatch(/^clor-domain-verification=/);
      expect(made.domainVerification.domains).toEqual([{ domain, verified: false }]);
      expect((await request(app).patch(sec(`/${made.id}`)).set(at(c)).send({ ...base, enabled: true }).expect(400)).body.error).toMatch(/verified/);
      /* Not offered for its domain while unproven. */
      expect((await request(app).get(`/api/auth/sso/lookup?email=a@${domain}`).expect(200)).body.providers).toEqual([]);
      const r1 = await request(app).post(sec(`/${made.id}/verify-domains`)).set(at(c)).expect(200);
      expect(r1.body.results).toEqual([{ domain, verified: false, reason: 'no TXT records found' }]);
      published.set(domain, [['v=spf1 -all'], [made.domainVerification.record]]);
      const r2 = await request(app).post(sec(`/${made.id}/verify-domains`)).set(at(c)).expect(200);
      expect(r2.body.results).toEqual([{ domain, verified: true }]);
      await request(app).patch(sec(`/${made.id}`)).set(at(c)).send({ ...base, enabled: true }).expect(200);
      expect((await request(app).get(`/api/auth/sso/lookup?email=a@${domain}`).expect(200)).body.providers).toHaveLength(1);
      /* Another account cannot claim the same domain, even with the record. */
      const rival = await makeOwner(`rival${rnd()}.example.com`);
      expect((await request(app).post(`/api/orgs/${rival.orgId}/security/providers`).set(at(rival)).send(base).expect(400)).body.error).toMatch(/another CLOR account/);
      /* Taking a domain off drops its proof. */
      const other = `second${rnd()}.example.com`;
      await request(app).patch(sec(`/${made.id}`)).set(at(c)).send({ ...base, emailDomains: other, enabled: false }).expect(200);
      expect((await platformPrisma.authProvider.findUnique({ where: { id: made.id } }))?.verifiedDomains).toBeNull();
    } finally {
      process.env.SSO_DOMAIN_VERIFY = prev;
      dnsTxt.resolve = prevResolve;
    }
  });
});
