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
  { subject: 'Leave balance shows 13 days instead of 12', body: 'Anita Rao has 13 casual leave days this year; the policy gives 12. Where did the extra day come from?', category: 'PROBLEM', app: 'people' },
  { subject: 'Can we import last year\'s attendance?', body: 'We kept attendance in a spreadsheet until October. Can it come into CLOR so the year is complete?', category: 'DATA', app: 'attendance' },
  { subject: 'Payslip PDF cuts off the last column', body: 'On the November payslips the Net pay column is cut off when printed on A4.', category: 'PROBLEM', app: 'payroll' },
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


/* ------------------------------------------------------------------ apps
 * Something on every Workspace page that reads the apps (Inbox, Home's Today card, Activity):
 * People switched on, departments, twelve people, leave waiting for a decision, and recent notices.
 */
const STAFF = [
  ['Anita', 'Rao', 'Operations'], ['Bharat', 'Mehta', 'Operations'], ['Chitra', 'Pillai', 'Finance'], ['Dev', 'Sharma', 'Sales'],
  ['Esha', 'Gupta', 'Sales'], ['Gopal', 'Naidu', 'Warehouse'], ['Hema', 'Krishnan', 'Finance'], ['Irfan', 'Ali', 'Warehouse'],
  ['Jaya', 'Menon', 'Operations'], ['Karan', 'Bose', 'Sales'], ['Leela', 'Thomas', 'Warehouse'], ['Manoj', 'Hegde', 'Operations'],
] as const;

const NOTICES = [
  { kind: 'people.joined', title: 'Leela Thomas joins on Monday', body: 'Her joining checklist has 6 open items.', link: { app: 'people', screen: 'employees' }, hoursAgo: 2 },
  { kind: 'payroll.bank_change', title: 'Bank details changed for Irfan Ali', body: 'Waiting for a second person to check them before the next pay run.', link: { app: 'payroll', screen: 'employees' }, hoursAgo: 5 },
  { kind: 'workspace.member', title: 'Divya Iyer accepted your invitation', body: 'She can now open People and Books in Sundaram Traders.', link: { app: 'admin', screen: 'members' }, hoursAgo: 20, read: true },
  { kind: 'billing.invoice', title: 'Your CLOR invoice for November is ready', body: '₹4,720 including GST. Due on 3 December.', link: { app: 'admin', screen: 'invoices' }, hoursAgo: 30 },
  { kind: 'attendance.reader', title: 'Front gate reader went quiet', body: 'No punches from the Mysuru office reader since 9:40 am.', link: { app: 'attendance', screen: 'devices' }, hoursAgo: 52, read: true },
  { kind: 'support.reply', title: 'CLOR support replied to your ticket', body: '"Invoice for October shows the wrong address": we have corrected the address.', link: { app: 'admin', screen: 'support' }, hoursAgo: 75 },
  { kind: 'people.document_expiring', title: 'Two passports expire in 30 days', body: 'Dev Sharma and Esha Gupta.', link: { app: 'people', screen: 'documents' }, hoursAgo: 120, read: true },
];

async function apps(c: Ctx) {
  const peopleApi = (path: string) => `/api/orgs/${c.orgId}/people${path}`;
  const f = await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } });
  if (f.status >= 300) note(false, 'apps switched on', f);

  const depts: Record<string, string> = {};
  for (const d of (await request(app).get(peopleApi('/structure/departments')).set(at(c))).body?.items || []) depts[d.name] = d.id;
  for (const name of new Set(STAFF.map((x) => x[2]))) {
    if (depts[name]) continue;
    const r = await request(app).post(peopleApi('/structure/departments')).set(at(c)).send({ name });
    if (r.status < 300) depts[name] = r.body.item.id;
    note(r.status < 300, `department ${name}`, r);
  }

  const have = new Map<string, any>((((await request(app).get(peopleApi('/employees?limit=500')).set(at(c))).body?.employees) || []).map((e: any) => [e.code, e]));
  const ids: string[] = [];
  for (const [i, [firstName, lastName, dept]] of STAFF.entries()) {
    const code = `ST-${String(i + 1).padStart(3, '0')}`;
    if (have.has(code)) { ids.push(have.get(code).id); continue; }
    /* Most joined over the last two years; the last two join this month and next, so their checklists are open. */
    const join = i >= STAFF.length - 2 ? new Date(Date.now() + (i - STAFF.length + 2) * 7 * 86400000) : new Date(2024, i % 12, 3 + i);
    const r = await request(app).post(peopleApi('/employees')).set(at(c)).send({
      firstName, lastName, code, departmentId: depts[dept], dateOfJoining: join.toISOString().slice(0, 10),
      email: `${firstName}.${lastName}@sundaram.test`.toLowerCase(), phone: `97${String(31000000 + i * 7919).slice(0, 8)}`, gender: i % 2 ? 'FEMALE' : 'MALE',
    });
    if (r.status < 300) ids.push(r.body?.employee?.id || r.body?.id);
    note(r.status < 300, `person ${firstName} ${lastName}`, r);
  }

  /* Leave waiting for a decision: four people, the next few weeks. */
  const leaveBase = `/api/orgs/${c.orgId}/attendance/leave`;
  let types: any[] = (await request(app).get(`${leaveBase}/types`).set(at(c))).body?.types || [];
  for (const t of [{ name: 'Casual leave', code: 'CL', annualDays: 12 }, { name: 'Sick leave', code: 'SL', annualDays: 8 }]) {
    if (types.some((x) => x.name === t.name)) continue;
    const r = await request(app).post(`${leaveBase}/types`).set(at(c)).send({ ...t, isPaid: true, accrual: 'YEARLY' });
    note(r.status < 300, `leave type ${t.name}`, r);
  }
  types = (await request(app).get(`${leaveBase}/types`).set(at(c))).body?.types || [];
  const type = types.find((t) => t.name === 'Casual leave') || types[0];
  const pending = (await request(app).get(`/api/orgs/${c.orgId}/attendance/leave/requests?status=PENDING`).set(at(c))).body;
  const asked = new Set((pending?.requests || pending?.items || []).map((r: any) => r.employeeId || r.employee?.id));
  if (type) {
    const day = (n: number) => { const d = new Date(Date.now() + n * 86400000); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const asks = [[0, 9, 9, 'Family function in Mangaluru'], [2, 12, 13, 'Fever, doctor advised rest'], [4, 16, 16, 'Bank work'], [7, 20, 22, 'Sister\'s wedding']] as const;
    for (const [who, from, to, reason] of asks) {
      if (!ids[who] || asked.has(ids[who])) continue;
      const r = await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: ids[who], leaveTypeId: type.id, fromDate: day(from), toDate: day(to), reason });
      note(r.status < 300, `leave for ${STAFF[who][0]} ${STAFF[who][1]}`, r);
    }
  } else if (!type) note(false, 'leave requests', { status: 0, body: { error: 'no leave type' } });

  /* Recent notices for the owner: the Inbox's Updates and the bell. */
  const me = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`)).body;
  const userId = me?.user?.id || me?.id;
  const org = await platformPrisma.org.findFirst({ where: { id: c.orgId }, select: { accountId: true } }).catch(() => null);
  if (userId && org?.accountId) {
    for (const n of NOTICES) {
      const dedupeKey = `seed:${n.kind}:${n.title}`;
      if (await platformPrisma.notification.findFirst({ where: { orgId: c.orgId, userId, dedupeKey }, select: { id: true } })) continue;
      const at_ = new Date(Date.now() - n.hoursAgo * 3600000);
      await platformPrisma.notification.create({ data: { accountId: org.accountId, orgId: c.orgId, userId, kind: n.kind, title: n.title, body: n.body, linkJson: JSON.stringify(n.link), dedupeKey, createdAt: at_, readAt: n.read ? at_ : null } });
      made.push(`notice "${n.title}"`);
    }
  } else note(false, 'notices', { status: 0, body: { error: 'owner or account not found' } });
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
  await apps(head);

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
