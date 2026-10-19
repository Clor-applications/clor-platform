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

type Scope = { orgId: string; inTx?: boolean };
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

/** The company in scope, or '' when none. */
export const currentOrg = (): string => {
  const s = store.getStore();
  return s && !s.inTx ? s.orgId : '';
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

/* Inside our own transaction wrapper the setting is already made; queries go straight through. */
const asInTx = <T>(fn: () => T): T => store.run({ orgId: store.getStore()?.orgId || '', inTx: true }, fn);

const RAW = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);

/**
 * Wrap a Prisma client so the request's company reaches the database. The
 * returned object has the client's own type; callers do not change.
 */
export function tenantScoped<C extends object>(base: C): C {
  const client = base as any;
  const setting = (orgId: string) => client.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${orgId}, true)`;

  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
          const org = currentOrg();
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
          const org = currentOrg();
          if (typeof arg === 'function') {
            /* Interactive: one connection for the whole callback, the setting made first. */
            return client.$transaction(async (tx: any) => {
              if (org) await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${org}, true)`;
              return asInTx(() => arg(tx));
            }, options);
          }
          if (!org) return client.$transaction(arg, options);
          /* Batch: the setting is the first statement of the same transaction. */
          return asInTx(() => client.$transaction([setting(org), ...arg], options)).then((rows: unknown[]) => rows.slice(1));
        };
      }
      if (typeof prop === 'string' && RAW.has(prop)) {
        return (...args: unknown[]) => {
          const org = currentOrg();
          if (!org) return client[prop](...args);
          return client.$transaction([setting(org), client[prop](...args)]).then((rows: unknown[]) => rows[1]);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as C;
}
