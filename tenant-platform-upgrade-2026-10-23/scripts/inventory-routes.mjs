/**
 * Route manifest and CI gate (A-49, GAP-008).
 *
 *   node tenant-platform-upgrade-2026-10-23/scripts/inventory-routes.mjs           writes evidence/route-inventory.csv
 *   node tenant-platform-upgrade-2026-10-23/scripts/inventory-routes.mjs --check   CI: exits 1 on any violation, writes nothing
 *
 * For every route the server declares: who may call it (principal), how they
 * prove it (auth), whether the company comes from the membership (tenant),
 * which permission is checked, which subscription/app check applies
 * (entitlement), whether maker-checker applies, and whether the change reaches
 * the audit trail (recordAudit, a direct auditLog.create, the sign-in event
 * log recordAuthEvent, or the
 * auditMutations middleware for Payroll, Attendance and People).
 *
 * The first version guessed with regular expressions. Its mount regex ran
 * across lines, so publicApi came out under /api/portal/punch and SSO under
 * /api; it saw only literal `requirePermission(...)`, never the VIEW/EDIT
 * aliases, the `can()` helpers, `authorize()` in a handler or the *RouteOk
 * guards — so "HUMAN_TENANT" said nothing about whether a permission was
 * checked. This version uses the TypeScript compiler: every identifier is
 * resolved to its declaration (aliases and imports included), registration
 * helpers (`transition(...)`, `register(kind)`, `handle(path, fn)`,
 * `[...].forEach(register)`) are expanded at their call sites with their
 * arguments bound, and router mounts come from the `app.use(...)` argument
 * lists in app.ts, in order. Router-level `.use(...)` applies only to routes
 * registered after it, as in Express.
 *
 * The gate fails when:
 *   - a route that changes something (POST, PUT, PATCH, DELETE, ALL) has no
 *     permission check and no entitlement check, and is not on the allow-list;
 *   - a public, employee-token or machine-token route is not on the allow-list
 *     (each needs a one-line reason);
 *   - an allow-list entry names a route that does not exist, or a known gap
 *     that is now guarded (so the list only ever shrinks).
 *
 * Static analysis over-approximates: a check reached through a helper is
 * credited to the route even if the helper takes it only on some branch. The
 * allow-list reasons and FIX_CHECKLIST findings carry the human judgement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const DEFAULT_SERVER = path.join(repoRoot, 'server');
const DEFAULT_ALLOWLIST = path.resolve(here, '..', 'route-allowlist.json');
const DEFAULT_OUT = path.resolve(here, '..', 'evidence', 'route-inventory.csv');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'ALL']);
const OPEN_PRINCIPALS = new Set(['public', 'employee-token', 'machine-token']);

/*
 * Routers whose callers are not CLOR users. `gatedByUse`: the credential is
 * checked by the router's own `.use(...)`, so a route registered before it is
 * public (the API docs, the connector download). Otherwise the credential is
 * in the request itself (a token in the path, a reader's serial).
 */
const TOKEN_MOUNTS = {
  '/v1': { principal: 'machine-token', auth: 'API key (publicApi authenticate)', gatedByUse: true },
  '/scim/v2': { principal: 'machine-token', auth: 'SCIM bearer token', gatedByUse: true },
  '/agent/v1': { principal: 'machine-token', auth: 'connector token', gatedByUse: true },
  '/api/portal': { principal: 'employee-token', auth: 'portal session token (portal authenticate)', gatedByUse: true },
  '/iclock': { principal: 'machine-token', auth: 'reader serial (claimed device)', gatedByUse: false },
  '/ingest': { principal: 'machine-token', auth: 'ingest token in path', gatedByUse: false },
  '/matrix': { principal: 'machine-token', auth: 'device token in path', gatedByUse: false },
  '/hikvision': { principal: 'machine-token', auth: 'device token in path', gatedByUse: false },
};

/*
 * The checks the manifest recognises, by declaring file (relative to src/)
 * and name. Anything else a route calls is followed into its body.
 */
const KNOWN = {
  'middleware/auth.ts#requireAuth': { kind: 'auth' },
  'middleware/tenantContext.ts#requireTenantContext': { kind: 'tenant' },
  'middleware/operator.ts#requireOperator': { kind: 'operator' },
  /* The same, for the two routes that set up the authenticator requireOperator insists on. */
  'middleware/operator.ts#requireOperatorToEnrol': { kind: 'operator' },
  'middleware/operator.ts#isOperator': { kind: 'operator' },
  'middleware/rbac.ts#requirePermission': { kind: 'permission' },
  'middleware/rbac.ts#authorize': { kind: 'permission', argOffset: 1 },
  /* Any one of several permissions: requireAnyPermission([m, a, s], ...), authorizeAny(req, [[m, a, s], ...]). */
  'middleware/rbac.ts#requireAnyPermission': { kind: 'permissionAny' },
  'middleware/rbac.ts#authorizeAny': { kind: 'permissionAny', argOffset: 1 },
  /* A role check rather than a permission: closing a company is for its administrators (A-21). */
  'services/companyClosure.ts#mayClose': { kind: 'permission', label: () => 'role:company ADMIN (mayClose)' },
  /* Workspace W-1: an account-level role (OWNER / ADMIN / BILLING_ADMIN), not a company permission. */
  'services/accountMembership.ts#requireAccountRole': { kind: 'permission', label: () => 'account role (requireAccountRole)' },
  'services/stepUp.ts#stepUpRefusal': { kind: 'stepUp' },
  'services/stepUp.ts#requirePayrollStepUp': { kind: 'stepUp' },
  'middleware/requireApp.ts#requireApp': { kind: 'entitlement', label: (a) => `requireApp(${a[0]})` },
  'services/principalAllowed.ts#appLive': { kind: 'entitlement', label: (a) => `appLive(${a[2]})` },
  'services/principalAllowed.ts#anyAppLive': { kind: 'entitlement', label: () => 'anyAppLive' },
  'services/principalAllowed.ts#closing': { kind: 'entitlement', label: () => 'closure check' },
  'services/subscriptions.ts#isAppEntitled': { kind: 'entitlement', label: (a) => `isAppEntitled(${a[1]})` },
  'services/payroll/guards.ts#payrollRouteOk': { kind: 'entitlement', label: () => 'payrollRouteOk' },
  'services/people/guards.ts#peopleRouteOk': { kind: 'entitlement', label: () => 'peopleRouteOk' },
  'services/people/guards.ts#hrOrAttendanceRouteOk': { kind: 'entitlement', label: () => 'hrOrAttendanceRouteOk' },
  'services/attendance/guards.ts#attendanceRouteOk': { kind: 'entitlement', label: () => 'attendanceRouteOk' },
  'services/makerChecker.ts#ownWorkRefusal': { kind: 'makerChecker' },
  'services/makerChecker.ts#ownRecordRefusal': { kind: 'makerChecker' },
  'services/makerChecker.ts#anotherApproverExists': { kind: 'makerChecker' },
  'services/auditTrail.ts#recordAudit': { kind: 'audit', label: () => 'recordAudit' },
  'services/auth.ts#recordAuthEvent': { kind: 'audit', label: () => 'recordAuthEvent' },
  'middleware/auditMutations.ts#auditMutations': { kind: 'auditMutations' },
  /* The outside-systems API grants scopes to a key instead of roles to a person. */
  'routes/publicApi.ts#scope': { kind: 'permission', label: (a) => `api-scope:${a[0]}` },
};

/* Mirrors middleware/auditMutations.ts: the writes it records on its own. */
const AUDIT_MUTATIONS_PATH = /^\/api\/orgs\/[^/]+\/(payroll|attendance|people)(\/.*)?$/;
const AUDIT_MUTATIONS_SKIP = [/\/payroll\/runs\/[^/]+\/validate$/, /\/attendance\/devices\/test-etimeoffice$/];

function loadTypescript(serverDir) {
  for (const base of [serverDir, DEFAULT_SERVER, repoRoot]) {
    try {
      return createRequire(path.join(base, 'package.json'))('typescript');
    } catch {
      /* next */
    }
  }
  throw new Error('typescript is not installed (npm ci in server/)');
}

function listTs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...listTs(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const empty = () => ({ auth: false, tenant: false, operator: false, stepUp: false, permissions: new Set(), entitlements: new Set(), makerChecker: false, audit: new Set(), auditMutations: false });
function merge(into, from) {
  into.auth ||= from.auth;
  into.tenant ||= from.tenant;
  into.operator ||= from.operator;
  into.stepUp ||= from.stepUp;
  into.makerChecker ||= from.makerChecker;
  into.auditMutations ||= from.auditMutations;
  for (const k of ['permissions', 'entitlements', 'audit']) for (const v of from[k]) into[k].add(v);
  return into;
}

export function buildManifest({ serverDir = DEFAULT_SERVER, allowlist = DEFAULT_ALLOWLIST } = {}) {
  const ts = loadTypescript(serverDir);
  const srcDir = path.join(serverDir, 'src');
  const appFile = path.join(srcDir, 'app.ts');
  const files = listTs(srcDir);
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const isProject = (sf) => sf && !sf.isDeclarationFile && path.resolve(sf.fileName).startsWith(srcDir + path.sep);
  const srcRel = (sf) => path.relative(srcDir, sf.fileName).split(path.sep).join('/');
  const where = (node) => {
    const sf = node.getSourceFile();
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    return `${path.relative(path.dirname(serverDir), sf.fileName).split(path.sep).join('/')}:${line}`;
  };

  const rbacText = fs.existsSync(path.join(srcDir, 'middleware', 'rbac.ts')) ? fs.readFileSync(path.join(srcDir, 'middleware', 'rbac.ts'), 'utf8') : '';
  const ceilingMatch = /ACCOUNTING_MODULES\s*=\s*new Set\(\[([^\]]*)\]/.exec(rbacText);
  const ACCOUNTING_MODULES = new Set(ceilingMatch ? [...ceilingMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []);

  const unwrap = (e) => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))) e = e.expression;
    return e;
  };

  /** The declaration an identifier names, through imports and aliases. */
  function declOf(id) {
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym);
      } catch {
        return null;
      }
    }
    return sym.valueDeclaration ?? sym.declarations?.[0] ?? null;
  }
  const declName = (d) => (d && d.name && ts.isIdentifier(d.name) ? d.name.text : null);
  const knownOf = (d) => {
    if (!d) return null;
    const sf = d.getSourceFile();
    if (!isProject(sf)) return null;
    return KNOWN[`${srcRel(sf)}#${declName(d)}`] ?? null;
  };
  const functionOf = (d) => {
    if (!d) return null;
    if (ts.isFunctionDeclaration(d) && d.body) return d;
    if (ts.isVariableDeclaration(d) && d.initializer) {
      const init = unwrap(d.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
    }
    return null;
  };

  /*
   * Values. An environment binds a parameter (or loop variable) declaration
   * to what was passed: { expr, env } or { value } (a forEach element).
   * evalAll returns every value an expression can have — strings and object
   * literals — so `direction === 'RECEIPT' ? RECEIPT : PAYMENT` yields both.
   */
  const propOf = (obj, key) => obj.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key);
  function evalAll(expr, env, depth = 0) {
    expr = unwrap(expr);
    if (!expr || depth > 10) return [];
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
    if (ts.isObjectLiteralExpression(expr)) return [expr];
    if (ts.isConditionalExpression(expr)) return [...evalAll(expr.whenTrue, env, depth + 1), ...evalAll(expr.whenFalse, env, depth + 1)];
    if (ts.isTemplateExpression(expr)) {
      let out = expr.head.text;
      for (const span of expr.templateSpans) {
        const v = evalStr(span.expression, env, depth + 1);
        out += (typeof v === 'string' ? v : `{${span.expression.getText()}}`) + span.literal.text;
      }
      return [out];
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = evalStr(expr.left, env, depth + 1);
      const r = evalStr(expr.right, env, depth + 1);
      return typeof l === 'string' && typeof r === 'string' ? [l + r] : [];
    }
    if (ts.isIdentifier(expr)) {
      const d = declOf(expr);
      if (!d) return [];
      if (env.has(d)) {
        const b = env.get(d);
        return 'value' in b ? [b.value] : evalAll(b.expr, b.env, depth + 1);
      }
      if (ts.isVariableDeclaration(d) && d.initializer) return evalAll(d.initializer, env, depth + 1);
      /* const { employees: EMPLOYEES } = PEOPLE_RESOURCE */
      if (ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && ts.isVariableDeclaration(d.parent.parent) && d.parent.parent.initializer) {
        const key = (d.propertyName ?? d.name).getText();
        return evalAll(d.parent.parent.initializer, env, depth + 1)
          .filter((o) => typeof o !== 'string')
          .flatMap((o) => {
            const prop = propOf(o, key);
            return prop && ts.isPropertyAssignment(prop) ? evalAll(prop.initializer, env, depth + 1) : [];
          });
      }
      return [];
    }
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      const keys = ts.isPropertyAccessExpression(expr) ? [expr.name.text] : evalAll(expr.argumentExpression, env, depth + 1).filter((k) => typeof k === 'string');
      const out = [];
      for (const obj of evalAll(expr.expression, env, depth + 1)) {
        if (typeof obj === 'string') continue;
        for (const key of keys) {
          const prop = propOf(obj, key);
          if (prop && ts.isPropertyAssignment(prop)) out.push(...evalAll(prop.initializer, env, depth + 1));
        }
      }
      /* PermissionAction.VIEW and the like: the member is the value. */
      if (!out.length && ts.isPropertyAccessExpression(expr) && /^[A-Z_]+$/.test(expr.name.text)) out.push(expr.name.text);
      return out;
    }
    /* permsFor(direction): an arrow with an expression body, its parameters bound. */
    if (ts.isCallExpression(expr) && ts.isIdentifier(unwrap(expr.expression))) {
      const fn = functionOf(declOf(unwrap(expr.expression)));
      if (fn && !ts.isBlock(fn.body)) {
        const inner = new Map(env);
        fn.parameters.forEach((p, i) => expr.arguments[i] && inner.set(p, { expr: expr.arguments[i], env }));
        return evalAll(fn.body, inner, depth + 1);
      }
    }
    return [];
  }
  const uniq = (xs) => [...new Set(xs)];
  function evalStr(expr, env, depth = 0) {
    const v = uniq(evalAll(expr, env, depth).filter((x) => typeof x === 'string'));
    return v.length === 1 ? v[0] : null;
  }
  function evalList(expr, env) {
    expr = unwrap(expr);
    if (expr && ts.isArrayLiteralExpression(expr)) return expr.elements.map((e) => evalStr(e, env));
    if (expr && ts.isIdentifier(expr)) {
      const d = declOf(expr);
      if (d && ts.isVariableDeclaration(d) && d.initializer) return evalList(d.initializer, env);
    }
    return null;
  }
  /** true / false when a condition is decided by bound strings alone, else undefined. */
  function evalCond(expr, env) {
    expr = unwrap(expr);
    if (!expr) return undefined;
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
      const v = evalCond(expr.operand, env);
      return v === undefined ? undefined : !v;
    }
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        const [l, r] = [evalCond(expr.left, env), evalCond(expr.right, env)];
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) return l === false || r === false ? false : l === true && r === true ? true : undefined;
        return l === true || r === true ? true : l === false && r === false ? false : undefined;
      }
      const eq = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(op);
      const ne = [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op);
      if (eq || ne) {
        const [l, r] = [evalStr(expr.left, env), evalStr(expr.right, env)];
        if (l === null || r === null) return undefined;
        return eq ? l === r : l !== r;
      }
    }
    return undefined;
  }
  /** Every string an argument can be ('?' when unknown). */
  const strsOf = (expr, env) => {
    if (!expr) return [''];
    const v = uniq(evalAll(expr, env).filter((x) => typeof x === 'string'));
    return v.length ? v : ['?'];
  };

  /*
   * Facts: what a middleware or handler checks, following every function it
   * calls or references in this project (bodies analysed once per binding).
   */
  const memo = new Map();
  function factsOf(node, env, stack, crossDepth) {
    const facts = empty();
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isIdentifier(callee)) {
          const d = declOf(callee);
          const known = knownOf(d);
          if (known) {
            record(facts, known, n.arguments, env);
            n.arguments.forEach(visit);
            return;
          }
          if (d && env.has(d)) {
            const b = env.get(d);
            if (b.expr) merge(facts, factsOf(b.expr, b.env, stack, crossDepth));
          }
          const fn = functionOf(d);
          if (fn) {
            const inner = new Map(env);
            fn.parameters.forEach((p, i) => {
              if (n.arguments[i]) inner.set(p, { expr: n.arguments[i], env });
            });
            merge(facts, bodyFacts(fn, d, inner, stack, crossDepth));
          }
        } else {
          /* A handler that writes its own audit row: platformPrisma.auditLog.create(...). */
          if (ts.isPropertyAccessExpression(callee) && /\bauditLog\.create(Many)?$/.test(callee.getText())) facts.audit.add('auditLog.create');
          visit(callee);
        }
        n.arguments.forEach(visit);
        return;
      }
      if (ts.isIfStatement(n)) {
        /* if (to === 'APPROVED') with `to` bound: only the branch that runs. */
        const c = evalCond(n.expression, env);
        visit(n.expression);
        if (c !== false) visit(n.thenStatement);
        if (c !== true && n.elseStatement) visit(n.elseStatement);
        return;
      }
      if (ts.isIdentifier(n)) {
        const parent = n.parent;
        if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) return;
        if (parent && (ts.isPropertyAssignment(parent) && parent.name === n)) return;
        const d = declOf(n);
        if (!d) return;
        const known = knownOf(d);
        if (known) {
          /* Referenced, not called: middleware passed by name. */
          record(facts, known, [], env);
          return;
        }
        if (env.has(d)) {
          const b = env.get(d);
          if (b.expr) merge(facts, factsOf(b.expr, b.env, stack, crossDepth));
          return;
        }
        const fn = functionOf(d);
        if (fn) return merge(facts, bodyFacts(fn, d, env, stack, crossDepth));
        if (ts.isVariableDeclaration(d) && d.initializer && ts.isCallExpression(unwrap(d.initializer)) && isProject(d.getSourceFile())) {
          /* const VIEW = requirePermission(...), const handler = withErrors(...) */
          if (stack.has(d)) return;
          stack.add(d);
          merge(facts, factsOf(d.initializer, env, stack, crossDepth));
          stack.delete(d);
        }
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return facts;
  }

  function bodyFacts(fn, d, env, stack, crossDepth) {
    if (!isProject(fn.getSourceFile()) || stack.has(fn)) return empty();
    const cross = fn.getSourceFile() !== currentFile;
    if (cross && crossDepth >= 3) return empty();
    /*
     * Memoised per function and per the values it can see: its own arguments
     * and those of the functions it sits inside (register(kind) → cfg). A
     * string argument is its value; anything else is the node passed.
     */
    const sf = fn.getSourceFile();
    const sig = [];
    for (const [decl, b] of env) {
      const owner = decl.parent;
      if (!owner || owner.getSourceFile() !== sf || fn.pos < owner.pos || fn.end > owner.end) continue;
      const v = 'value' in b ? b.value : evalStr(b.expr, b.env);
      sig.push(`${decl.pos}=${typeof v === 'string' ? `s:${v}` : `n:${b.expr ? `${b.expr.getSourceFile().fileName}@${b.expr.pos}` : '?'}`}`);
    }
    const key = `${sf.fileName}@${fn.pos}|${sig.sort().join(',')}`;
    if (memo.has(key)) return memo.get(key);
    stack.add(fn);
    const facts = factsOf(fn.body, env, stack, crossDepth + (cross ? 1 : 0));
    stack.delete(fn);
    memo.set(key, facts);
    return facts;
  }

  function record(facts, known, args, env) {
    const alts = [...args].map((x) => strsOf(x, env));
    const a = alts.map((v) => v.join('|'));
    switch (known.kind) {
      case 'auth':
        facts.auth = true;
        break;
      case 'tenant':
        facts.tenant = true;
        break;
      case 'operator':
        facts.operator = true;
        facts.permissions.add('operator');
        break;
      case 'permission': {
        if (known.label) facts.permissions.add(known.label(a));
        else if (!args.length) facts.permissions.add('?::?::?');
        else {
          const o = known.argOffset ?? 0;
          /* perms.module with perms.resource: one pair per object perms can be, not every mix. */
          const [m, sb] = [unwrap(args[o]), args[o + 2] && unwrap(args[o + 2])];
          let pairs = (alts[o] ?? ['?']).flatMap((mod) => (alts[o + 2] ?? ['']).map((sub) => [mod, sub]));
          if (m && sb && ts.isPropertyAccessExpression(m) && ts.isPropertyAccessExpression(sb) && m.expression.getText() === sb.expression.getText()) {
            const objs = evalAll(m.expression, env).filter((x) => typeof x !== 'string');
            const one = (obj, name) => {
              const prop = propOf(obj, name);
              const v = prop && ts.isPropertyAssignment(prop) ? evalStr(prop.initializer, env) : null;
              return v ?? '?';
            };
            if (objs.length) pairs = objs.map((obj) => [one(obj, m.name.text), one(obj, sb.name.text)]);
          }
          for (const [mod, sub] of pairs)
            for (const action of alts[o + 1] ?? ['?']) {
              facts.permissions.add(`${mod}::${sub}::${action}`);
              if (ACCOUNTING_MODULES.has(mod)) facts.entitlements.add('rbac ceiling (accounting)');
            }
        }
        break;
      }
      case 'permissionAny': {
        const tuples = known.argOffset ? (args[known.argOffset] && ts.isArrayLiteralExpression(unwrap(args[known.argOffset])) ? unwrap(args[known.argOffset]).elements : []) : [...args];
        if (!tuples.length) facts.permissions.add('?::?::?');
        for (const t of tuples) {
          const x = unwrap(t);
          if (!ts.isArrayLiteralExpression(x)) {
            facts.permissions.add('?::?::?');
            continue;
          }
          const [mod, action, sub] = [0, 1, 2].map((i) => (x.elements[i] ? strsOf(x.elements[i], env).join('|') : ''));
          facts.permissions.add(`${mod}::${sub}::${action}`);
          if (ACCOUNTING_MODULES.has(mod)) facts.entitlements.add('rbac ceiling (accounting)');
        }
        break;
      }
      case 'stepUp':
        facts.stepUp = true;
        break;
      case 'entitlement':
        facts.entitlements.add(known.label(a));
        break;
      case 'makerChecker':
        facts.makerChecker = true;
        break;
      case 'audit':
        facts.audit.add(known.label(a));
        break;
      case 'auditMutations':
        facts.auditMutations = true;
        break;
    }
  }

  /* ---- app.ts: mounts, in order ---- */
  const appSf = program.getSourceFile(appFile);
  if (!appSf) throw new Error(`no app.ts under ${srcDir}`);
  let currentFile = appSf;
  const isRouterDecl = (d) => {
    if (!d || !ts.isVariableDeclaration(d) || !d.initializer) return false;
    const init = unwrap(d.initializer);
    return ts.isCallExpression(init) && /(^|\.)Router$/.test(init.expression.getText());
  };
  const mounts = new Map(); // router declaration -> { mount, seq, at }; other app.use arguments go to appLayers
  const appLayers = [];
  const appRoutes = [];
  let seq = 0;
  const visitApp = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'use' && n.expression.expression.getText() === 'app') {
      const args = [...n.arguments];
      const mount = args.length && ts.isStringLiteral(args[0]) ? args.shift().text : null;
      for (const arg of args) {
        const inner = ts.isSpreadElement(arg) ? arg.expression : arg;
        const d = ts.isIdentifier(inner) ? declOf(inner) : null;
        if (isRouterDecl(d)) mounts.set(d, { mount: mount ?? '/', seq: seq++, at: where(n) });
        else appLayers.push({ expr: inner, mount, seq: seq++ });
      }
    }
    /* A route on the app itself (the billing webhook, before the JSON parser; /health). */
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && METHODS.has(n.expression.name.text) && n.expression.expression.getText() === 'app' && n.arguments.length > 1) {
      const [first, ...handlers] = n.arguments;
      const p = evalStr(first, new Map());
      if (p) appRoutes.push({ method: n.expression.name.text.toUpperCase(), path: p, handlers, seq: seq++, at: where(n) });
    }
    ts.forEachChild(n, visitApp);
  };
  visitApp(appSf);

  /* ---- route files: registrations, executed in order ---- */
  const routes = [];
  const unmounted = [];
  for (const sf of program.getSourceFiles()) {
    if (!isProject(sf) || !srcRel(sf).startsWith('routes/')) continue;
    currentFile = sf;
    const routers = new Map(); // decl -> { uses: [], routes: [] }
    const routerOf = (expr) => {
      const d = ts.isIdentifier(expr) ? declOf(expr) : null;
      if (!d || d.getSourceFile() !== sf || !isRouterDecl(d)) return null;
      if (!routers.has(d)) routers.set(d, { decl: d, uses: [], routes: [] });
      return routers.get(d);
    };
    let order = 0;
    const execExpr = (expr, env, site, depth) => {
      expr = unwrap(expr);
      if (!expr || !ts.isCallExpression(expr) || depth > 4) return;
      const callee = unwrap(expr.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const r = routerOf(unwrap(callee.expression));
        if (r && method === 'use') {
          const args = [...expr.arguments];
          const prefix = args.length && evalStr(args[0], env) !== null ? evalStr(args.shift(), env) : null;
          r.uses.push({ order: order++, prefix, args, env });
          return;
        }
        if (r && METHODS.has(method)) {
          const [first, ...handlers] = expr.arguments;
          const list = evalList(first, env);
          const paths = list ?? [evalStr(first, env) ?? `{${first.getText()}}`];
          r.routes.push({ order: order++, method: method.toUpperCase(), paths: paths.map((p) => p ?? '{?}'), handlers, env, at: where(site ?? expr), registeredAt: site ? where(expr).split(':').pop() : null });
          return;
        }
        if (method === 'forEach' && expr.arguments.length) {
          const items = evalList(callee.expression, env);
          const fnExpr = unwrap(expr.arguments[0]);
          const fn = ts.isIdentifier(fnExpr) ? functionOf(declOf(fnExpr)) : ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr) ? fnExpr : null;
          if (items && fn) for (const value of items) runFunction(fn, [{ value }], env, site, depth + 1);
        }
        return;
      }
      if (ts.isIdentifier(callee)) {
        const fn = functionOf(declOf(callee));
        if (fn && fn.getSourceFile() === sf) runFunction(fn, expr.arguments.map((a) => ({ expr: a, env })), env, site ?? expr, depth + 1);
      }
    };
    const runFunction = (fn, bindings, env, site, depth) => {
      const inner = new Map(env);
      fn.parameters.forEach((p, i) => bindings[i] && inner.set(p, bindings[i]));
      if (ts.isBlock(fn.body)) execStatements(fn.body.statements, inner, site, depth);
      else execExpr(fn.body, inner, site, depth);
    };
    const execStatements = (stmts, env, site, depth) => {
      for (const st of stmts) {
        if (ts.isExpressionStatement(st)) execExpr(st.expression, env, site, depth);
        else if (ts.isForOfStatement(st)) {
          const items = evalList(st.expression, env);
          const decl = ts.isVariableDeclarationList(st.initializer) ? st.initializer.declarations[0] : null;
          if (items && decl && ts.isIdentifier(decl.name)) {
            for (const value of items) {
              /* The loop variable is a declaration, not a parameter: bind it the same way. */
              const inner = new Map(env);
              inner.set(decl, { value });
              execStatements(ts.isBlock(st.statement) ? st.statement.statements : [st.statement], inner, site, depth);
            }
          }
        } else if (ts.isIfStatement(st)) {
          execStatements(ts.isBlock(st.thenStatement) ? st.thenStatement.statements : [st.thenStatement], env, site, depth);
          if (st.elseStatement) execStatements(ts.isBlock(st.elseStatement) ? st.elseStatement.statements : [st.elseStatement], env, site, depth);
        } else if (ts.isBlock(st)) execStatements(st.statements, env, site, depth);
      }
    };
    execStatements(sf.statements, new Map(), null, 0);

    for (const r of routers.values()) {
      const m = mounts.get(r.decl);
      if (!m) {
        if (r.routes.length) unmounted.push(`${declName(r.decl)} (${where(r.decl)})`);
        continue;
      }
      const tokenMount = TOKEN_MOUNTS[m.mount];
      const isAuthenticatingUse = (u) =>
        u.args.some((a) => {
          const x = unwrap(ts.isSpreadElement(a) ? a.expression : a);
          if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return true;
          const d = ts.isIdentifier(x) ? declOf(x) : null;
          return !!(d && d.getSourceFile() === sf && functionOf(d));
        });
      for (const route of r.routes) {
        for (const p of route.paths) {
          const full = m.mount === '/' ? p : `${m.mount.replace(/\/$/, '')}${p === '/' ? '' : p.startsWith('/') ? p : `/${p}`}` || '/';
          const uses = r.uses.filter((u) => u.order < route.order && (!u.prefix || p.startsWith(u.prefix)));
          emit({ ...route, full, layerSeq: m.seq, uses, tokenMount, gated: uses.some(isAuthenticatingUse) });
        }
      }
    }
  }
  currentFile = appSf;
  for (const route of appRoutes) emit({ ...route, full: route.path, env: new Map(), layerSeq: route.seq, uses: [], tokenMount: null, gated: false });

  function emit({ method, full, at, registeredAt, handlers, env, layerSeq, uses, tokenMount, gated }) {
    const mw = empty();
    for (const layer of appLayers.filter((l) => l.seq < layerSeq && (!l.mount || full.startsWith(l.mount)))) merge(mw, factsOf(layer.expr, new Map(), new Set(), 0));
    for (const u of uses) for (const a of u.args) merge(mw, factsOf(a, u.env, new Set(), 0));
    const chain = [...handlers];
    const handler = chain.pop();
    for (const a of chain) merge(mw, factsOf(a, env, new Set(), 0));
    const inHandler = handler ? factsOf(handler, env, new Set(), 0) : empty();
    const all = merge(merge(empty(), mw), inHandler);

    let principal;
    let auth;
    let tenant = all.tenant ? 'requireTenantContext' : 'none';
    if (all.operator && all.auth) [principal, auth] = ['platform-operator', 'session (requireAuth) + requireOperator'];
    else if (all.auth) [principal, auth] = [all.tenant ? 'human-tenant' : 'human-global', 'session (requireAuth)'];
    else if (tokenMount && (!tokenMount.gatedByUse || gated)) {
      [principal, auth] = [tokenMount.principal, tokenMount.auth];
      tenant = 'from the credential';
    } else [principal, auth] = ['public', /:token\b/.test(full) ? 'link token in path' : 'none'];

    const audit = [...all.audit];
    if (all.auditMutations && MUTATING.has(method) && AUDIT_MUTATIONS_PATH.test(full) && !AUDIT_MUTATIONS_SKIP.some((re) => re.test(full))) audit.push('auditMutations');
    const permissions = [...all.permissions];
    const notes = [];
    if (registeredAt) notes.push(`registered by the helper at line ${registeredAt}`);
    if (permissions.length && ![...mw.permissions].length) notes.push('permission checked in the handler');
    if (permissions.some((x) => x.includes('?'))) notes.push('part of the permission is chosen at run time');
    if (all.stepUp) notes.push('step-up (fresh second factor)');
    routes.push({
      method,
      path: full,
      location: at,
      principal,
      auth,
      tenant,
      permission: permissions.length ? permissions.sort().join(' | ') : 'none',
      entitlement: all.entitlements.size ? [...all.entitlements].sort().join(' | ') : 'none',
      makerChecker: all.makerChecker ? 'yes' : 'no',
      audit: audit.length ? audit.join(' | ') : 'none',
      reviewed: notes.join('; '),
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.location.localeCompare(b.location));

  /* ---- the gate ---- */
  const list = fs.existsSync(allowlist) ? JSON.parse(fs.readFileSync(allowlist, 'utf8')).routes ?? [] : [];
  const keyOf = (r) => `${r.method} ${r.path}`;
  const listed = new Map(list.map((e) => [keyOf(e), e]));
  const violations = [];
  const knownGaps = [];
  const unguarded = (r) => MUTATING.has(r.method) && r.permission === 'none' && r.entitlement === 'none';
  for (const r of routes) {
    const entry = listed.get(keyOf(r));
    if (entry) {
      r.reviewed = [entry.finding ? `${entry.finding}:` : '', entry.reason, r.reviewed && `(${r.reviewed})`].filter(Boolean).join(' ');
      if (!String(entry.reason || '').trim()) violations.push({ method: r.method, path: r.path, problem: 'allow-list entry has no reason' });
      if (entry.finding && unguarded(r)) knownGaps.push(r);
      else if (entry.finding && !OPEN_PRINCIPALS.has(r.principal)) violations.push({ method: r.method, path: r.path, problem: `stale allow-list entry: ${entry.finding} is now guarded — remove it` });
      continue;
    }
    if (OPEN_PRINCIPALS.has(r.principal)) violations.push({ method: r.method, path: r.path, location: r.location, problem: `${r.principal} route is not on the allow-list (give it a one-line reason)` });
    else if (unguarded(r)) violations.push({ method: r.method, path: r.path, location: r.location, problem: 'mutating route with no permission and no entitlement guard' });
  }
  const present = new Set(routes.map(keyOf));
  for (const e of list) if (!present.has(keyOf(e))) violations.push({ method: e.method, path: e.path, problem: 'stale allow-list entry: no such route' });

  return { routes, violations, knownGaps, unmounted };
}

const COLUMNS = ['method', 'path', 'location', 'principal', 'auth', 'tenant', 'permission', 'entitlement', 'makerChecker', 'audit', 'reviewed'];
const HEADER = ['method', 'path', 'file:line', 'principal', 'auth', 'tenant', 'permission', 'entitlement', 'makerChecker', 'audit', 'reviewed'];

export function toCsv(routes) {
  const quote = (v) => `"${String(v).replaceAll('"', '""')}"`;
  return `${[HEADER, ...routes.map((r) => COLUMNS.map((c) => r[c]))].map((row) => row.map(quote).join(',')).join('\n')}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? path.resolve(argv[i + 1]) : dflt;
  };
  const check = argv.includes('--check');
  const out = opt('--out', DEFAULT_OUT);
  const { routes, violations, knownGaps, unmounted } = buildManifest({ serverDir: opt('--server', DEFAULT_SERVER), allowlist: opt('--allowlist', DEFAULT_ALLOWLIST) });
  const count = (key) => routes.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {});
  if (!check) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, toCsv(routes));
  }
  const mutating = routes.filter((r) => MUTATING.has(r.method));
  console.log(
    JSON.stringify(
      {
        output: check ? '(check only)' : path.relative(repoRoot, out),
        routes: routes.length,
        principals: count('principal'),
        mutating: mutating.length,
        mutatingWithPermission: mutating.filter((r) => r.permission !== 'none').length,
        mutatingWithEntitlementOnly: mutating.filter((r) => r.permission === 'none' && r.entitlement !== 'none').length,
        knownGaps: knownGaps.map((r) => `${r.method} ${r.path} (${r.location})`),
        unmountedRouters: unmounted,
        violations: violations.length,
      },
      null,
      2,
    ),
  );
  for (const v of violations) console.error(`VIOLATION ${v.method} ${v.path}${v.location ? ` (${v.location})` : ''}: ${v.problem}`);
  if (check && violations.length) {
    console.error(`\nRoute manifest gate failed: ${violations.length} violation(s). Guard the route, or add it to tenant-platform-upgrade-2026-10-23/route-allowlist.json with a reason.`);
    process.exit(1);
  }
}
