import 'dotenv/config';
/**
 * A Workspace account for local development and browser checks: two companies,
 * branches, members in every state, invitations, a custom role and support
 * tickets, so no Workspace page is looked at empty. Synthetic only: nothing
 * here is a real person or business.
 *
 * Goes through the HTTP API, as seedUiQa.ts and seedPeopleDev.ts do, so every
 * record passes the rules a person's would. One exception, said plainly: an
 * invitation's link is only ever in the email, so to accept one here the seed
 * gives the invitation a link of its own (a hash write) and then accepts it
 * through the same route a person does.
 *
 * Idempotent by identity: the owner's email is fixed, so a second run signs in
 * and adds only what is missing.
 *
 * A company asks its owners to sign in with an authenticator, so the seed sets
 * one up for the owner, as a person would under My profile. To sign in at the
 * web app afterwards, ask the seed for the code the authenticator would show:
 *
 * Run:
 *   cd server && npx tsx src/scripts/seedWorkspaceDev.ts
 *   cd server && npx tsx src/scripts/seedWorkspaceDev.ts --code
 *
 * Sign in at the web app with the owner below. The password is a local test
 * value for this seeded account only.
 */
import { createHash } from 'node:crypto';

import request from 'supertest';

import { buildApp } from '../app.js';
import { decryptSecret } from '../services/mailer.js';
import { codeAt } from '../services/totp.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/* Never against a database that is not on this machine. */
for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL']) {
  const url = String(process.env[key] || '');
  const local = /^file:/.test(url) || /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (!local || String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(`\n  Refused: ${key} is not a local database. This seed is for a developer's own machine.\n`);
    process.exit(1);
  }
}

const app = buildApp();

export const WORKSPACE_DEV_OWNER = { email: 'workspace.dev@clor.test', password: 'Workspace-Dev-2026!', name: 'Kavya Raman' };
const MEMBER_PASSWORD = 'Workspace-Member-2026!';
/* A real GSTIN shape with a correct check digit (the fixture seedUiQa.ts uses): the API refuses an invented one. */
const HEAD = { companyName: 'Sundaram Traders Pvt Ltd', state: 'Karnataka', gstin: '29AABCU9603R1ZJ' };
/* No GSTIN, on purpose: Home's "needs your attention" and the Companies list both have something to say. */
const SECOND = { companyName: 'Sundaram Exports', state: 'Maharashtra' };

const BRANCHES = [
  { branchCode: 'MYS', branchName: 'Mysuru office', addressLine1: '14 Sayyaji Rao Road', city: 'Mysuru', state: 'Karnataka' },
  { branchCode: 'HBL', branchName: 'Hubballi office', addressLine1: '7 Lamington Road', city: 'Hubballi', state: 'Karnataka' },
];

/* Who is asked in, as what, and what becomes of them. */
const PEOPLE: { email: string; name: string; accountRole: 'ADMIN' | 'BILLING_ADMIN' | 'MEMBER'; then: 'joined' | 'suspended' | 'pending' }[] = [
  { email: 'imran.khan@sundaram.test', name: 'Imran Khan', accountRole: 'ADMIN', then: 'joined' },
  { email: 'meera.nair@sundaram.test', name: 'Meera Nair', accountRole: 'BILLING_ADMIN', then: 'joined' },
  { email: 'ravi.kumar@sundaram.test', name: 'Ravi Kumar', accountRole: 'MEMBER', then: 'joined' },
  { email: 'divya.iyer@sundaram.test', name: 'Divya Iyer', accountRole: 'MEMBER', then: 'joined' },
  { email: 'arjun.das@sundaram.test', name: 'Arjun Das', accountRole: 'MEMBER', then: 'suspended' },
  { email: 'pooja.shah@sundaram.test', name: 'Pooja Shah', accountRole: 'MEMBER', then: 'pending' },
  { email: 'farah.reddy@sundaram.test', name: 'Farah Reddy', accountRole: 'MEMBER', then: 'pending' },
];

const TICKETS = [
  { subject: 'How do I move a person to another company?', body: 'Ravi works for both companies from next month. Where do I give him access to the second one?', category: 'QUESTION' },
  { subject: 'Invoice for October shows the wrong address', body: 'The CLOR invoice for October still has our old Bengaluru address. Please correct it and send it again.', category: 'BILLING', urgent: true },
];

type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const made: string[] = [];
const skipped: string[] = [];
/** A step that did not go through is said, not thrown: the rest of the account is still worth having. */
const note = (ok: boolean, what: string, res?: { status: number; body: any }) => (ok ? made : skipped).push(ok ? what : `${what} (${res?.status}: ${res?.body?.error || 'no reason given'})`);

/** The six digits the owner's authenticator shows now; null before one is set up. The last-used mark is cleared so the seed can sign in twice within one half-minute. */
async function ownerCode(): Promise<string | null> {
  const u = await platformPrisma.user.findFirst({ where: { email: WORKSPACE_DEV_OWNER.email }, select: { id: true, totpSecretEnc: true, totpEnabledAt: true } });
  if (!u?.totpSecretEnc || !u.totpEnabledAt) return null;
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpLastStep: null } });
  return codeAt(decryptSecret(u.totpSecretEnc), Math.floor(Date.now() / 30_000));
}

/** Sets up the owner's authenticator through the same two calls My profile makes. */
async function authenticator(c: Ctx) {
  const setup = await request(app).post(`/api/orgs/${c.orgId}/security/two-factor/setup`).set(at(c)).send({ password: WORKSPACE_DEV_OWNER.password });
  if (setup.status === 409) return;
  if (setup.status !== 200) return note(false, 'owner authenticator', setup);
  const on = await request(app).post(`/api/orgs/${c.orgId}/security/two-factor/enable`).set(at(c)).send({ code: codeAt(setup.body.secret, Math.floor(Date.now() / 30_000)) });
  note(on.status < 300, 'owner authenticator', on);
}

async function owner(): Promise<{ token: string; orgs: any[] }> {
  let login = await request(app).post('/api/auth/login').send({ email: WORKSPACE_DEV_OWNER.email, password: WORKSPACE_DEV_OWNER.password });
  if (login.status === 200 && login.body?.twoFactorRequired) {
    login = await request(app).post('/api/auth/login/two-factor').send({ challenge: login.body.challenge, code: await ownerCode() });
    if (login.status !== 200) throw new Error(`two-factor sign-in failed: ${login.status} ${JSON.stringify(login.body)}`);
  } else if (login.status !== 200) {
    const signup = await request(app).post('/api/auth/signup').send(WORKSPACE_DEV_OWNER);
    if (signup.status !== 200) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
    login = signup;
  }
  const token = login.body.token;
  if (!token) throw new Error(`sign-in gave no token: ${JSON.stringify(login.body)}`);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  return { token, orgs: me.body?.orgs || [] };
}

async function company(token: string, orgs: any[], spec: { companyName: string; state: string; gstin?: string }): Promise<Ctx> {
  const have = orgs.find((m) => m.org?.name === spec.companyName);
  if (have) return { token, orgId: have.orgId, branchId: have.branchId || '' };
  const r = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${token}`).send(spec);
  if (r.status !== 200) throw new Error(`setup-company failed for ${spec.companyName}: ${r.status} ${JSON.stringify(r.body)}`);
  made.push(`company ${spec.companyName}`);
  return { token, orgId: r.body.company.orgId, branchId: r.body.branch.id };
}

async function branches(c: Ctx) {
  const have = new Set(((await request(app).get(`/api/orgs/${c.orgId}/branches`).set(at(c))).body?.branches || []).map((b: any) => b.branchCode || b.code));
  for (const b of BRANCHES) {
    if (have.has(b.branchCode)) continue;
    const r = await request(app).post(`/api/orgs/${c.orgId}/branches`).set(at(c)).send({ ...b, branchType: 'SERVICE', country: 'India' });
    note(r.status < 300, `branch ${b.branchName}`, r);
  }
}

async function people(c: Ctx, second: Ctx) {
  const members = (await request(app).get('/api/account/members').set(at(c))).body?.members || [];
  const invitations = (await request(app).get('/api/account/invitations').set(at(c))).body?.invitations || [];
  const inAccount = new Map<string, any>(members.map((m: any) => [String(m.email || '').toLowerCase(), m]));
  const invited = new Set(invitations.filter((i: any) => i.status === 'PENDING').map((i: any) => String(i.email).toLowerCase()));

  for (const p of PEOPLE) {
    if (inAccount.has(p.email) || invited.has(p.email)) continue;
    const grants = [{ orgId: c.orgId, branchIds: [], roleIds: [] }, ...(p.accountRole === 'ADMIN' ? [{ orgId: second.orgId, branchIds: [], roleIds: [] }] : [])];
    let r = await request(app).post('/api/account/invitations').set(at(c)).send({ email: p.email, accountRole: p.accountRole, grants });
    /* A grant this build does not take as written: ask them in with none, which the Members page can add to. */
    if (r.status >= 400) r = await request(app).post('/api/account/invitations').set(at(c)).send({ email: p.email, accountRole: p.accountRole });
    note(r.status < 300, `invitation to ${p.name}`, r);
    if (r.status >= 300 || p.then === 'pending') continue;

    /* The link is only in the email: give this invitation one the seed knows, then accept it as the person would. */
    const link = `seed-${sha256(p.email).slice(0, 40)}`;
    await platformPrisma.accountInvitation.updateMany({ where: { email: p.email, status: 'PENDING' }, data: { tokenHash: sha256(link) } });
    const accepted = await request(app).post('/api/invitations/accept').send({ token: link, fullName: p.name, password: MEMBER_PASSWORD });
    note(accepted.status < 300, `${p.name} joined`, accepted);
  }

  const now = (await request(app).get('/api/account/members').set(at(c))).body?.members || [];
  for (const p of PEOPLE.filter((x) => x.then === 'suspended')) {
    const m = now.find((x: any) => String(x.email || '').toLowerCase() === p.email);
    if (!m || m.status === 'SUSPENDED') continue;
    const r = await request(app).post(`/api/account/members/${m.userId || m.id}/suspend`).set(at(c)).send({ reason: 'Left the company' });
    note(r.status < 300, `${p.name} suspended`, r);
  }
}

async function role(c: Ctx) {
  const have = ((await request(app).get(`/api/orgs/${c.orgId}/roles`).set(at(c))).body?.roles || []).some((r: any) => r.name === 'Dispatch clerk');
  if (have) return;
  const r = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(at(c)).send({ name: 'Dispatch clerk', description: 'Packs and sends orders; sees no prices.', roleType: 'CUSTOM', permissions: [] });
  note(r.status < 300, 'role Dispatch clerk', r);
}

async function tickets(c: Ctx) {
  const have = new Set(((await request(app).get('/api/support/tickets').set(at(c))).body?.tickets || []).map((t: any) => t.subject));
  for (const t of TICKETS) {
    if (have.has(t.subject)) continue;
    const r = await request(app).post('/api/support/tickets').set(at(c)).send(t);
    note(r.status < 300, `ticket "${t.subject}"`, r);
  }
}

async function main() {
  if (process.argv.includes('--code')) {
    const code = await ownerCode();
    console.log(code ? `\n  ${WORKSPACE_DEV_OWNER.email} sign-in code: ${code} (good for about ${30 - (Math.floor(Date.now() / 1000) % 30)} s)\n` : '\n  No authenticator yet: run the seed once without --code.\n');
    return;
  }
  const { token, orgs } = await owner();
  const head = await company(token, orgs, HEAD);
  const second = await company(token, orgs, SECOND);
  await authenticator(head);
  await branches(head);
  await people(head, second);
  await role(head);
  await tickets(head);

  console.log(`\n  Workspace dev account: ${WORKSPACE_DEV_OWNER.email} (password in this file).`);
  console.log(`  Added ${made.length}: ${made.join('; ') || 'nothing new, it was all there'}.`);
  if (skipped.length) console.log(`  Not added ${skipped.length}:\n    ${skipped.join('\n    ')}`);
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n  The Workspace dev account could not be made:', e?.stack || e, '\n');
    process.exit(1);
  });
