/**
 * Staging: company isolation, roles and security checks against the real
 * stack (Cloudflare Worker -> Cloud Run -> Postgres with RLS).
 *
 *   STAGING_PASSWORD=... node test/staging/isolation-security.cjs
 *
 * Creates two accounts (A with two companies, B with one), a limited member
 * in A, and records in B, then tries to reach B from A every way there is.
 * Staging only. Prints one line per check and a JSON summary; exit 1 on any
 * failure.
 */
/* One address family: a dual-stack machine otherwise alternates IPv4 / IPv6, two clients to a rate limiter. */
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
} catch { /* undici not installed: limiter results may show two buckets */ }

const API = process.env.API_URL || 'https://api.staging.clor.in/api';
const APP = process.env.APP_URL || 'https://app.staging.clor.in';
const PASSWORD = process.env.STAGING_PASSWORD;
/* 'off' when staging runs with DISABLE_RATE_LIMIT=true (lockout and roles), 'on' for the limiter checks alone. */
const LIMITER = process.env.LIMITER || 'off';
if (!PASSWORD) throw new Error('STAGING_PASSWORD not set');
if (!/staging/.test(API)) throw new Error('This suite creates accounts: staging only.');

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const results = [];
const check = (area, name, pass, detail = '') => {
  results.push({ area, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(method, path, { token, org, branch, body, headers = {}, raw = false } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (org) h['x-org-id'] = org;
  if (branch) h['x-branch-id'] = branch;
  const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return raw ? { status: r.status, headers: r.headers, text, json } : { status: r.status, json, text };
}

async function owner(label) {
  const email = `iso.${label}.${tag()}@example.com`;
  const s = await call('POST', '/auth/signup', { body: { email, password: PASSWORD, name: `Owner ${label}` } });
  if (s.status !== 200) throw new Error(`signup ${label}: ${s.status} ${s.text.slice(0, 200)}`);
  const token = s.json.token;
  const c = await call('POST', '/auth/setup-company', { token, body: { companyName: `Iso ${label} ${tag()}`, state: 'Karnataka' } });
  if (c.status !== 200) throw new Error(`setup ${label}: ${c.status} ${c.text.slice(0, 200)}`);
  return { email, token, org: c.json.company.orgId, branch: c.json.branch.id };
}

const ok2xx = (r) => r.status >= 200 && r.status < 300;
const denied = (r) => [401, 403, 404].includes(r.status);
/** Nothing of B's in the body: no id, no name. */
const leaks = (r, ...needles) => needles.filter(Boolean).some((n) => (r.text || '').includes(n));

async function limiterOnly() {
  /* rateLimit.ts: 10 per email and 30 per address (an office shares one) per 15 minutes; sign-up 5 and 15 per hour. */
  const one = `rl.one.${tag()}@example.com`;
  const perEmail = [];
  for (let i = 0; i < 11; i++) perEmail.push((await call('POST', '/auth/login', { body: { emailOrUsername: one, password: 'wrong-password-1' } })).status);
  check('limits', 'sign-in limited per email (429 by the 11th try on one address)', perEmail.slice(10).includes(429), perEmail.join(','));
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await call('POST', '/auth/login', { body: { emailOrUsername: `rl.${tag()}@example.com`, password: 'wrong-password-1' } })).status);
  check('limits', 'sign-in limited per address across many emails (429 by the 31st)', statuses.includes(429), `${statuses.filter((x) => x === 429).length} of 31 refused`);
  const spoof = await call('POST', '/auth/login', { headers: { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 250)}` }, body: { emailOrUsername: `rl.${tag()}@example.com`, password: 'wrong-password-1' } });
  check('limits', 'forged X-Forwarded-For does not get round the limit', spoof.status === 429, `${spoof.status}`);
  const signups = [];
  for (let i = 0; i < 16; i++) signups.push((await call('POST', '/auth/signup', { body: { email: `rl.${tag()}@example.com`, password: PASSWORD, name: 'Limit' } })).status);
  check('limits', 'sign-up limited per address (429 by the 16th in an hour)', signups.includes(429), `${signups.filter((x) => x === 429).length} of 16 refused`);
  const failed = results.filter((x) => !x.pass);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((f) => `[${f.area}] ${f.name} — ${f.detail}`) }));
  process.exitCode = failed.length ? 1 : 0;
}

(async () => {
  if (LIMITER === 'on') return limiterOnly();
  const started = Date.now();
  /* ---------------------------------------------------------- setup */
  const A = await owner('a');
  const B = await owner('b');
  const a2 = await call('POST', '/auth/setup-company', { token: A.token, body: { companyName: `Iso a-second ${tag()}`, state: 'Kerala' } });
  const A2 = { ...A, org: a2.json?.company?.orgId, branch: a2.json?.branch?.id };
  check('setup', 'two accounts, A with two companies', ok2xx(a2) && !!A2.org, `A=${A.org} A2=${A2.org} B=${B.org}`);

  const bItemName = `B-secret-item-${tag()}`;
  const bItem = await call('POST', `/orgs/${B.org}/items`, { ...B, body: { name: bItemName, salePrice: 100 } });
  check('setup', "B has an item of its own", ok2xx(bItem), `${bItem.status}`);
  const bItemId = bItem.json?.item?.id || bItem.json?.id;

  /* ------------------------------------------- company isolation (A -> B) */
  let r = await call('GET', `/orgs/${B.org}/items`, { token: A.token, org: B.org, branch: B.branch });
  check('isolation', "A cannot list B's items naming B's company", denied(r) && !leaks(r, bItemName), `${r.status}`);

  r = await call('GET', `/orgs/${B.org}/items`, { token: A.token, org: A.org, branch: A.branch });
  check('isolation', "A cannot list B's items with B in the path and A in the headers", denied(r) && !leaks(r, bItemName), `${r.status}`);

  r = await call('GET', `/orgs/${A.org}/items`, { token: A.token, org: B.org, branch: B.branch });
  check('isolation', "A cannot read through A's path with B's headers", denied(r) && !leaks(r, bItemName), `${r.status}`);

  r = await call('GET', `/orgs/${A.org}/items`, { ...A });
  check('isolation', "A's own list does not contain B's item", ok2xx(r) && !leaks(r, bItemName, bItemId), `${r.status}`);

  if (bItemId) {
    r = await call('PATCH', `/orgs/${A.org}/items/${bItemId}`, { ...A, body: { name: 'pwned' } });
    check('isolation', "A cannot edit B's item by its id through A's company", denied(r), `${r.status}`);
    r = await call('DELETE', `/orgs/${A.org}/items/${bItemId}`, { ...A });
    check('isolation', "A cannot delete B's item by its id through A's company", denied(r), `${r.status}`);
    const still = await call('GET', `/orgs/${B.org}/items`, { ...B });
    check('isolation', "B's item is untouched", ok2xx(still) && leaks(still, bItemName) && !leaks(still, 'pwned'), `${still.status}`);
  }

  r = await call('GET', `/orgs/${B.org}/users`, { token: A.token, org: B.org, branch: B.branch });
  check('isolation', "A cannot list B's users", denied(r) && !leaks(r, B.email), `${r.status}`);

  r = await call('GET', `/orgs/${B.org}/export`, { token: A.token, org: B.org, branch: B.branch });
  check('isolation', "A cannot export B's company", denied(r), `${r.status}`);

  r = await call('GET', `/orgs/${A2.org}/items`, { token: A.token, org: A2.org, branch: A2.branch });
  check('isolation', 'A opens its own second company', ok2xx(r), `${r.status}`);

  r = await call('GET', `/orgs/${A2.org}/items`, { token: B.token, org: A2.org, branch: A2.branch });
  check('isolation', "B cannot reach A's second company", denied(r), `${r.status}`);

  /* ------------------------------------------------- roles (member in A) */
  const roleRes = await call('POST', `/orgs/${A.org}/roles`, { ...A, body: { name: `Viewer ${tag()}`, roleType: 'CUSTOM', permissions: ['MASTERS::Items::VIEW'] } });
  const memberEmail = `iso.member.${tag()}@example.com`;
  const userRes = await call('POST', '/users', { ...A, body: { email: memberEmail, fullName: 'Limited Member', password: PASSWORD, orgIds: [A.org], branchIdsByOrg: { [A.org]: [A.branch] } } });
  const grant = await call('POST', `/orgs/${A.org}/users/${userRes.json?.user?.id}/roles`, { ...A, body: { roleId: roleRes.json?.role?.id, branchId: null } });
  const login = await call('POST', '/auth/login', { body: { emailOrUsername: memberEmail, password: PASSWORD } });
  const M = { token: login.json?.token, org: A.org, branch: A.branch };
  check('roles', 'a member with only "view items" exists', [roleRes, userRes, grant, login].every(ok2xx) && !!M.token, [roleRes, userRes, grant, login].map((x) => x.status).join('/'));

  r = await call('GET', `/orgs/${A.org}/items`, { ...M });
  check('roles', 'member can view items', ok2xx(r), `${r.status}`);
  r = await call('POST', `/orgs/${A.org}/items`, { ...M, body: { name: 'member-made' } });
  check('roles', 'member cannot create an item', r.status === 403, `${r.status}`);
  r = await call('GET', `/orgs/${A.org}/invoices`, { ...M });
  check('roles', 'member cannot list invoices', r.status === 403, `${r.status}`);
  r = await call('POST', '/users', { ...M, body: { email: `iso.x.${tag()}@example.com`, fullName: 'X', password: PASSWORD, orgIds: [A.org] } });
  check('roles', 'member cannot add users', r.status === 403, `${r.status}`);
  r = await call('POST', `/orgs/${A.org}/roles`, { ...M, body: { name: `Escalate ${tag()}`, roleType: 'CUSTOM', permissions: ['SETTINGS::Users::CREATE'] } });
  check('roles', 'member cannot create a role (no self-escalation)', r.status === 403, `${r.status}`);
  r = await call('GET', '/account/members', { ...M });
  check('roles', 'member cannot read account members', denied(r), `${r.status}`);
  r = await call('GET', `/orgs/${A2.org}/items`, { token: M.token, org: A2.org, branch: A2.branch });
  check('roles', "member of company 1 cannot open A's company 2", denied(r), `${r.status}`);

  /* ----------------------------------------------------- operators */
  for (const p of ['/ops/me', '/ops/accounts', '/ops/audit', '/ops/operators']) {
    r = await call('GET', p, { token: A.token });
    check('operators', `customer refused at ${p}`, r.status === 403, `${r.status}`);
  }
  r = await call('POST', '/ops/two-factor/setup', { token: A.token });
  check('operators', 'customer refused at /ops/two-factor/setup', r.status === 403, `${r.status}`);

  /* ------------------------------------------------------ sign-in */
  r = await call('GET', `/orgs/${A.org}/items`, { org: A.org, branch: A.branch });
  check('auth', 'no token: refused', r.status === 401, `${r.status}`);
  const [h, p] = A.token.split('.');
  r = await call('GET', `/orgs/${A.org}/items`, { token: `${h}.${p}.AAAA`, org: A.org, branch: A.branch });
  check('auth', 'bad signature: refused', r.status === 401, `${r.status}`);
  const noneTok = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
  r = await call('GET', `/orgs/${A.org}/items`, { token: noneTok, org: A.org, branch: A.branch });
  check('auth', 'alg=none token: refused', r.status === 401, `${r.status}`);
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const swapped = `${h}.${Buffer.from(JSON.stringify({ ...claims, accountId: 'x', userId: 'x' })).toString('base64url')}.${A.token.split('.')[2]}`;
  r = await call('GET', `/orgs/${A.org}/items`, { token: swapped, org: A.org, branch: A.branch });
  check('auth', 'edited claims, old signature: refused', r.status === 401, `${r.status}`);

  /* Before the lockout test below, whose wrong passwords trip the per-address sign-in limit. */
  const loginRaw = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: APP }, body: JSON.stringify({ emailOrUsername: B.email, password: PASSWORD }) });
  const cookie = loginRaw.headers.get('set-cookie') || '';
  check('cookies', 'refresh cookie is HttpOnly', /httponly/i.test(cookie), cookie ? cookie.split(';').slice(1).join(';').trim() : `no cookie (login ${loginRaw.status})`);
  check('cookies', 'refresh cookie is Secure', /secure/i.test(cookie));
  check('cookies', 'refresh cookie has SameSite', /samesite/i.test(cookie));

  {
    /* Account lockout, with the per-address limiter off so a 429 can only be the account's own lock. */
    const victim = await owner('lock');
    let last;
    for (let i = 0; i < 12; i++) last = await call('POST', '/auth/login', { body: { emailOrUsername: victim.email, password: 'wrong-password-1' } });
    const right = await call('POST', '/auth/login', { body: { emailOrUsername: victim.email, password: PASSWORD } });
    check('auth', 'repeated wrong passwords lock the account (right password refused while locked)', right.status === 429 && /failed attempts/i.test(right.json?.error || ''), `right ${right.status} ${right.json?.error || ''}`);
    /* The same twelve wrong tries on an address that has no account: does the answer differ? */
    const ghost = `nobody.${tag()}@example.com`;
    let ghostLast;
    for (let i = 0; i < 12; i++) ghostLast = await call('POST', '/auth/login', { body: { emailOrUsername: ghost, password: 'wrong-password-1' } });
    check('auth', 'no account enumeration: locked real address and unknown address answer alike', ghostLast.status === last.status, `real ${last.status} vs unknown ${ghostLast.status}`);
  }


  r = await call('GET', `/orgs/${A.org}/items`, { ...A });
  const out = await call('POST', '/auth/logout', { token: A.token });
  check('auth', 'logout accepted', ok2xx(out) || out.status === 204, `${out.status}`);

  /* -------------------------------------------- injection & leaks */
  const xss = `<img src=x onerror="window.__pwned=1">${tag()}`;
  r = await call('POST', `/orgs/${B.org}/items`, { ...B, body: { name: xss } });
  check('injection', 'script-like item name is stored as text (no 500)', ok2xx(r) || r.status === 400, `${r.status}`);
  for (const q of ["' OR 1=1 --", '"; DROP TABLE "Item"; --', '%00', '../../../../etc/passwd', '${7*7}']) {
    r = await call('GET', `/orgs/${B.org}/items?q=${encodeURIComponent(q)}&search=${encodeURIComponent(q)}`, { ...B });
    check('injection', `search ${JSON.stringify(q)}: no server error`, r.status < 500, `${r.status}`);
  }
  r = await call('GET', `/orgs/${B.org}/items/${encodeURIComponent('../../users')}`, { ...B });
  check('injection', 'path traversal in an id: not served', r.status !== 200 || !leaks(r, B.email), `${r.status}`);
  r = await call('POST', `/orgs/${B.org}/items`, { ...B, body: '{"name":' });
  check('leaks', 'malformed body: no stack trace in the reply', !/at .*\.(js|ts):\d+|node_modules|prisma/i.test(r.text), `${r.status}`);
  r = await call('GET', '/definitely-not-a-route');
  /* 401 is fine too: sign-in is checked before routing, which says nothing about what exists. */
  check('leaks', 'unknown route: refused, no stack', [401, 404].includes(r.status) && !/node_modules|\.ts:\d+/.test(r.text), `${r.status}`);

  /* ------------------------------------------------ headers & CORS */
  const evil = await fetch(`${API}/auth/login`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  check('cors', 'foreign origin not allowed', evil.headers.get('access-control-allow-origin') !== 'https://evil.example' && evil.headers.get('access-control-allow-origin') !== '*', `${evil.headers.get('access-control-allow-origin')}`);
  const good = await fetch(`${API}/auth/login`, { method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'POST' } });
  check('cors', 'own app origin allowed', good.headers.get('access-control-allow-origin') === APP, `${good.headers.get('access-control-allow-origin')}`);

  const appRes = await fetch(`${APP}/`);
  const hdr = (n) => appRes.headers.get(n);
  check('headers', 'app: Content-Security-Policy present', !!(hdr('content-security-policy') || hdr('content-security-policy-report-only')));
  check('headers', 'app: Content-Security-Policy ENFORCED (not report-only)', !!hdr('content-security-policy'), hdr('content-security-policy') ? '' : 'report-only: violations are logged, not blocked');
  check('headers', 'app: Strict-Transport-Security', !!hdr('strict-transport-security'));
  check('headers', 'app: clickjacking blocked (X-Frame-Options / enforced frame-ancestors)', /frame-ancestors/.test(hdr('content-security-policy') || '') || !!hdr('x-frame-options'));
  check('headers', 'app: X-Content-Type-Options nosniff', /nosniff/i.test(hdr('x-content-type-options') || ''));
  const apiRes = await fetch(`${API}/auth/me`);
  check('headers', 'api: X-Content-Type-Options nosniff', /nosniff/i.test(apiRes.headers.get('x-content-type-options') || ''));
  check('headers', 'api: does not advertise its framework', !apiRes.headers.get('x-powered-by'), `${apiRes.headers.get('x-powered-by') || ''}`);

  /* ------------------------------------------------- guessing */
  const guesses = await Promise.all(['1000000000', '4831920657', '9999999999'].map((c) => call('POST', '/portal/login', { body: { company: c, employeeCode: 'E1', password: 'x-y-z-123' } })));
  check('guessing', 'portal: unknown company codes all give one answer', new Set(guesses.map((g) => `${g.status}:${g.json?.error}`)).size === 1, guesses.map((g) => g.status).join('/'));

  const failed = results.filter((x) => !x.pass);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((f) => `[${f.area}] ${f.name} — ${f.detail}`), seconds: Math.round((Date.now() - started) / 1000) }));
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => {
  console.log(JSON.stringify({ crashed: String(e.message || e).slice(0, 300), results }));
  process.exitCode = 1;
});
