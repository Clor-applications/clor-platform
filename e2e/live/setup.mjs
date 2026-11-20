#!/usr/bin/env node
/**
 * Makes the QA world on LIVE CLOR, once: QA companies, their users (owner, HR,
 * manager, accountant, employee) and staff, with 2FA switched on for every login.
 * Passwords are made up here and saved only in e2e/live/.env.live (git ignores it).
 *
 * Run by the owner:  npm run qa:live:setup
 * It asks for one inbox you own (plus-addresses go to it) and waits while you
 * click the verification email for each company owner. Safe to run again: it
 * reuses what .env.live already has.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '.env.live');
const API = (process.env.QA_API_URL || 'https://api.clor.in') + '/api';
const rl = createInterface({ input: process.stdin, output: process.stdout });

const COMPANIES = [
  { key: 'knockbell', name: 'Knockbell Logistics QA', state: 'Maharashtra', prefix: 'KBL',
    people: [['Arvind', 'Patil', 'Operations', 'Operations Head'], ['Sneha', 'Kulkarni', 'Operations', 'Fleet Supervisor', 0], ['Rohit', 'Shinde', 'Operations', 'Driver', 1], ['Pooja', 'Desai', 'Operations', 'Dispatcher', 1], ['Imran', 'Shaikh', 'Warehouse', 'Warehouse Lead', 0], ['Kiran', 'More', 'Warehouse', 'Loader', 4], ['Meera', 'Joshi', 'Finance', 'Accounts Executive']] },
  { key: 'ags', name: 'AGS Consultants QA', state: 'Karnataka', prefix: 'AGS',
    people: [['Ganesh', 'Rao', 'Advisory', 'Partner'], ['Divya', 'Hegde', 'Advisory', 'Senior Consultant', 0], ['Nikhil', 'Shetty', 'Advisory', 'Consultant', 1], ['Ayesha', 'Khan', 'Audit', 'Audit Manager', 0], ['Prakash', 'Gowda', 'Audit', 'Article Assistant', 3], ['Lavanya', 'Murthy', 'Admin', 'Office Manager']] },
  { key: 'vels', name: 'Vels Traders QA', state: 'Tamil Nadu', prefix: 'VEL',
    people: [['Senthil', 'Kumar', 'Sales', 'Sales Manager'], ['Selvi', 'Raman', 'Sales', 'Sales Executive', 0], ['Karthik', 'Murugan', 'Stores', 'Storekeeper', 0]] },
];
/* Web users per company beside the owner: role picked by name from the company's own roles. */
const USERS = [['hr', /hr/i, 'Hema HR'], ['manager', /team manager|manager/i, 'Manoj Manager'], ['accountant', /account|finance/i, 'Anita Accounts'], ['employee', /^employee|self/i, 'Esha Employee']];

const pw = () => randomBytes(12).toString('base64url') + 'Qa9!';
function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, v = 0; const key = [];
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { key.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', Buffer.from(key)).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
async function call(method, path, body, s = {}) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(s.token ? { authorization: `Bearer ${s.token}` } : {}), ...(s.orgId ? { 'x-org-id': s.orgId } : {}), ...(s.branchId ? { 'x-branch-id': s.branchId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t }; }
  return { status: r.status, ok: r.ok, body: j };
}
const must = async (p, what) => { const r = await p; if (!r.ok) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body; };

async function login(acc) {
  const r = await must(call('POST', '/auth/login', { email: acc.email, password: acc.password }), `sign in ${acc.label}`);
  if (!r.twoFactorRequired) return r.token;
  if (!acc.totpSecret) throw new Error(`${acc.label} asks for 2FA but no totpSecret saved`);
  return (await must(call('POST', '/auth/login/two-factor', { challenge: r.challenge, code: totp(acc.totpSecret) }), `2FA ${acc.label}`)).token;
}
async function ensure2fa(acc, s) {
  if (acc.totpSecret) return;
  const r = await call('POST', `/orgs/${s.orgId}/security/two-factor/setup`, { password: acc.password }, s);
  if (r.status === 409) return console.log(`  ${acc.label}: 2FA already on (key unknown; turn it off in the app and re-run)`);
  if (!r.ok) return console.log(`  ${acc.label}: 2FA setup skipped (${r.status} ${r.body.error || ''})`);
  acc.totpSecret = r.body.secret;
  await new Promise((ok) => setTimeout(ok, 1500));
  await must(call('POST', `/orgs/${s.orgId}/security/two-factor/enable`, { code: totp(acc.totpSecret) }, s), `enable 2FA ${acc.label}`);
  console.log(`  ${acc.label}: 2FA on (waiting for a fresh code)`);
  /* A code works once: the next sign-in must wait for the next 30-second step. */
  await new Promise((ok) => setTimeout(ok, 31_000 - (Date.now() % 30_000)));
}

const saved = (() => { if (!existsSync(ENV)) return []; const m = readFileSync(ENV, 'utf8').match(/^QA_ACCOUNTS=(.*)$/m); return m ? JSON.parse(m[1]) : []; })();
const byLabel = Object.fromEntries(saved.map((a) => [a.label, a]));
function save() {
  const accs = Object.values(byLabel);
  const companies = COMPANIES.map((c) => c.name).join(',');
  writeFileSync(ENV, `# Made by e2e/live/setup.mjs on ${new Date().toISOString().slice(0, 10)}. Never commit.\nQA_ACCOUNTS=${JSON.stringify(accs)}\nQA_LIVE_WRITES=1\nQA_WRITE_COMPANIES=${companies}\n`, { mode: 0o600 });
}

console.log(`\nThis makes QA companies and logins on LIVE CLOR (${API}).`);
const inbox = (await rl.question('Inbox you own for verification mails (e.g. you@gmail.com): ')).trim();
const [local, domain] = inbox.split('@');
if (!domain) { console.log('Need a full email address.'); process.exit(1); }
const mail = (tag) => `${local}+clorqa-${tag}@${domain}`;

for (const c of COMPANIES) {
  console.log(`\n${c.name}`);
  const ownerLabel = `${c.key}-owner`;
  const owner = byLabel[ownerLabel] ||= { label: ownerLabel, role: 'owner', company: c.name, email: mail(`${c.key}-owner`), password: pw() };
  save();
  const su = await call('POST', '/auth/signup', { email: owner.email, password: owner.password, name: `${c.name.replace(/ QA$/, '')} Owner` });
  if (su.ok) console.log(`  signed up ${owner.email}`);
  else if (su.status !== 409) throw new Error(`sign up ${c.name}: ${su.status} ${JSON.stringify(su.body).slice(0, 200)}`);

  let token = await login(owner);
  const me = await must(call('GET', '/auth/me', undefined, { token }), 'me');
  let org = (me.orgs || []).find((o) => (o.org?.name || o.name) === c.name);
  let s;
  if (!org) {
    const made = await must(call('POST', '/auth/setup-company', { companyName: c.name, state: c.state }, { token }), `make ${c.name}`);
    s = { token, orgId: made.company.orgId, branchId: made.branch.id };
    console.log('  company made');
  } else {
    s = { token, orgId: org.orgId };
    s.branchId = org.branchId || org.branches?.[0]?.id || org.branches?.[0]?.branchId || me.activeBranchId;
    if (!s.branchId) { const br = await call('GET', `/orgs/${s.orgId}/branches`, undefined, s); const list = Array.isArray(br.body) ? br.body : br.body.branches || br.body.items || []; s.branchId = list[0]?.id; }
    console.log('  company already there');
  }
  owner.orgId = s.orgId;
  /* Admins must have an authenticator before the company lets them change anything. */
  await ensure2fa(owner, s);
  save();
  s.token = token = await login(owner);

  await call('PUT', `/orgs/${s.orgId}/features`, { features: { people: true, attendance: true, peopleHiring: true, peoplePerformance: true, peopleEngage: true, peopleBenefits: true } }, s);
  const base = `/orgs/${s.orgId}/people`;
  const have = await call('GET', `${base}/employees`, undefined, s);
  const existing = have.body.employees || have.body.items || [];
  if (existing.length === 0) {
    const depts = {}, desigs = {}, ids = [];
    for (const [, , d, j] of c.people) {
      depts[d] ||= (await must(call('POST', `${base}/structure/departments`, { name: d }, s), 'department')).item.id;
      desigs[j] ||= (await must(call('POST', `${base}/structure/job-positions`, { name: j, departmentId: depts[d] }, s), 'job position')).item.id;
    }
    for (const [i, [f, l, d, j, mgr]] of c.people.entries()) {
      const e = await must(call('POST', `${base}/employees`, { firstName: f, lastName: l, code: `${c.prefix}-${String(i + 1).padStart(3, '0')}`, departmentId: depts[d], jobPositionId: desigs[j], reportingManagerId: mgr === undefined ? undefined : ids[mgr], dateOfJoining: '2025-04-01' }, s), `employee ${f}`);
      ids.push(e.employee.id);
    }
    console.log(`  ${ids.length} employees added`);
  } else console.log(`  ${existing.length} employees already there`);

  const roles = (await must(call('GET', `/orgs/${s.orgId}/roles`, undefined, s), 'roles')).roles || [];
  for (const [tag, re, fullName] of USERS) {
    const label = `${c.key}-${tag}`;
    if (byLabel[label]) continue;
    const role = roles.find((r) => re.test(r.name));
    if (!role) { console.log(`  no role like ${re} (have: ${roles.map((r) => r.name).join(', ')}); ${tag} skipped`); continue; }
    const acc = { label, role: tag, company: c.name, email: mail(label), password: pw() };
    const u = await call('POST', '/users', { email: acc.email, fullName, password: acc.password, orgIds: [s.orgId], branchIdsByOrg: { [s.orgId]: [s.branchId] } }, s);
    if (!u.ok) { console.log(`  ${tag}: not made (${u.status} ${u.body.error || ''})`); continue; }
    await call('POST', `/orgs/${s.orgId}/users/${u.body.user.id}/roles`, { roleId: role.id, branchId: null }, s);
    byLabel[label] = acc;
    try { const t = await login(acc); await ensure2fa(acc, { token: t, orgId: s.orgId, branchId: s.branchId }); } catch (e) { console.log(`  ${tag}: ${e.message}`); }
    save();
    console.log(`  ${tag} (${role.name}) made`);
  }
}

if (!byLabel['ops-staff']) {
  console.log('\nOps staff login: add one in ops.clor.in > Staff (only an Ops admin can).');
  const e = (await rl.question('Its email (Enter to skip): ')).trim();
  if (e) {
    const p = (await rl.question('Its password: ')).trim();
    const k = (await rl.question('Its authenticator key, if 2FA is on (Enter to skip): ')).trim();
    byLabel['ops-staff'] = { label: 'ops-staff', role: 'staff', site: 'ops', company: COMPANIES[0].name, email: e, password: p, ...(k ? { totpSecret: k } : {}) };
  }
}
save();
rl.close();
console.log(`\nDone. ${Object.keys(byLabel).length} logins saved in e2e/live/.env.live. Now run: npm run qa:live`);
