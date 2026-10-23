import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which company the current request is working for, told to the database.
 *
 * The row-level security policies (the `_rls` migrations) compare each row's
 * `orgId` with the connection setting `clor.org_id`. Until now nothing set it,
 * so the policies allowed everything and a query was only as safe as its own
 * `where`. This sets it — once, centrally — for every query a request makes
 * after its company is known (requireTenantContext, the employee portal, a
 * reader or connector once its company is resolved). A forgotten orgId filter
 * then returns that company's rows only, not another's.
 *
 * How, without changing a single route:
 *
 *  - The company lives in an AsyncLocalStorage for the life of the request.
 *  - Each Prisma client is wrapped. A plain query runs as a two-statement batch
 *    — `set_config('clor.org_id', org, true)` then the query — so the setting
 *    is SET LOCAL to that one transaction and cannot leak to the next request
 *    that borrows the pooled connection.
 *  - `$transaction(async (tx) => …)` sets it once at the start of that
 *    transaction; every query on `tx` runs inside it, as before.
 *  - `$transaction([…])` gets the setting as its first statement.
 *  - Raw queries (`$queryRaw`, `$executeRaw` and the unsafe forms) likewise.
 *
 * With no company in scope (sign-in, a background job, a platform admin) the
 * client behaves exactly as it did. `outsideTenant(reason, fn)` is the one way
 * for a request to read across companies on purpose (an account's company list,
 * a group's consolidated report); every use names why.
 */

export const TENANT_SETTING = 'clor.org_id';

/*
 * A request's queries are also capped in time. Without a cap, a query still
 * running after Cloud Run gave up on the request (60 s) kept one of the four
 * main connections busy until it finished. Set with the company, transaction-
 * local, so migrations and background jobs (which run outside a request) are
 * not affected. REQUEST_STATEMENT_TIMEOUT_MS overrides; 0 turns it off.
 */
export const requestStatementTimeout = (): string => {
  const ms = Number(process.env.REQUEST_STATEMENT_TIMEOUT_MS ?? 30_000);
  return String(Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : 30_000);
};

/*
 * `inTx`: the clients whose batch transaction is being assembled. The
 * queries in the batch go straight through — the setting is the batch's
 * first statement. It was one flag for every client, and set for
 * interactive transactions too (A-37), so inside a payroll transaction a
 * query through the people or platform client — or the payroll client
 * itself outside `tx` — skipped the setting and ran with no company.
 */
type Scope = { orgId: string; inTx?: ReadonlySet<object> };
const store = new AsyncLocalStorage<Scope>();

/*
 * Prisma queries are lazy — they run when awaited, not when called. A callback
 * that returns the query itself (`() => prisma.x.findMany()`) would otherwise
 * run it after the scope has ended, in whatever scope the caller is in. So a
 * returned promise is awaited here, inside the scope.
 */
const within = <T>(scope: Scope, fn: () => T): T =>
  store.run(scope, () => {
    const r = fn() as unknown as { then?: unknown };
    return (r && typeof r.then === 'function' ? (async () => await (r as unknown as Promise<unknown>))() : r) as T;
  });

/** Run `fn` with the database told this company. */
export function runInTenant<T>(orgId: string, fn: () => T): T {
  const id = String(orgId || '').trim();
  return id ? within({ orgId: id }, fn) : fn();
}

/**
 * Put the rest of this request in a company's scope (A-30).
 *
 * For routes that learn their company from a token rather than a signed-in
 * person — directory sync, readers, push sources, share and pay links. The
 * token is looked up first, with no company (it is how the company is
 * found); once it names one, everything the request does after this call
 * runs as that company, so row-level security is a backstop there too.
 * `runInTenant` needs the rest of the handler as a callback; these handlers
 * find their company halfway through, so this enters it in place.
 */
export function enterTenant(orgId: string) {
  const id = String(orgId || '').trim();
  if (id) store.enterWith({ orgId: id });
}

/** The company in scope, or '' when none. */
export const currentOrg = (): string => store.getStore()?.orgId || '';

/** The company this client's next query must set: none inside its own transaction, where it is already set. */
const orgFor = (client: object): string => {
  const s = store.getStore();
  return s && !s.inTx?.has(client) ? s.orgId : '';
};

/**
 * Read across companies from inside a request, on purpose. The setting is
 * cleared for `fn`, which is what the policies allow today when no company is
 * named. Named so a reviewer can find every crossing.
 */
export function outsideTenant<T>(reason: string, fn: () => T): T {
  if (!String(reason || '').trim()) throw new Error('Crossing the tenant boundary needs a reason, for whoever reads this next.');
  return within({ orgId: '' }, fn);
}

/* While this client's batch is assembled its queries go straight through into it, and only its. */
const asInTx = <T>(client: object, fn: () => T): T => {
  const s = store.getStore();
  return store.run({ orgId: s?.orgId || '', inTx: new Set([...(s?.inTx || []), client]) }, fn);
};

const RAW = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);

/**
 * Wrap a Prisma client so the request's company reaches the database. The
 * returned object has the client's own type; callers do not change.
 */
export function tenantScoped<C extends object>(base: C): C {
  const client = base as any;
  const setting = (orgId: string) =>
    client.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${orgId}, true), set_config('statement_timeout', ${requestStatementTimeout()}, true)`;

  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
          const org = orgFor(client);
          if (!org) return query(args);
          const [, result] = await client.$transaction([setting(org), query(args)]);
          return result;
        },
      },
    },
  });

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return (arg: any, options?: unknown) => {
          const org = orgFor(client);
          if (typeof arg === 'function') {
            /*
             * Interactive: one connection for the whole callback, the setting
             * made first. `tx` is the unwrapped client, so its queries come
             * nowhere near this wrapper. Anything else the callback runs —
             * through this client or the other three — goes out on its own
             * connection and is scoped as usual (A-37: it used to be marked
             * "in a transaction" and sent with no company at all).
             */
            return client.$transaction(async (tx: any) => {
              if (org) await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${org}, true), set_config('statement_timeout', ${requestStatementTimeout()}, true)`;
              return arg(tx);
            }, options);
          }
          if (!org) return client.$transaction(arg, options);
          /* Batch: the setting is the first statement of the same transaction. */
          return asInTx(client, () => client.$transaction([setting(org), ...arg], options)).then((rows: unknown[]) => rows.slice(1));
        };
      }
      if (typeof prop === 'string' && RAW.has(prop)) {
        return (...args: unknown[]) => {
          const org = orgFor(client);
          if (!org) return client[prop](...args);
          return client.$transaction([setting(org), client[prop](...args)]).then((rows: unknown[]) => rows[1]);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as C;
}
