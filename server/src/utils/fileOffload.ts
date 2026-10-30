import { randomUUID } from 'node:crypto';
import { fileStore, keyFor, prefixOf, type FileKind } from '../services/fileStore.js';

/**
 * R2 plan, S3: the three people models that hold files keep their bytes in
 * object storage when a store is configured, without any caller knowing.
 *
 *  - create / update / upsert with non-empty bytes: the bytes go to the store
 *    under `org/<orgId>/<kind>/<id>`; the row keeps the key and empty bytes.
 *    A create that already carries a key (a restore) keeps that object.
 *    Not supported: a NEW file created inside a batch `$transaction([...])`
 *    (putting the object needs a wait the batch cannot take) — nothing does today.
 *  - reads that return the bytes field: a row with a key and empty bytes has
 *    them filled from the store.
 *  - deletes are untouched: the recycle bin may still restore the row (its
 *    snapshot keeps the key), so objects are removed by the nightly
 *    cross-store check once nothing needs them, and at company closure.
 *
 * With no store (FILE_STORE unset or `db`) every call goes straight through,
 * so behaviour is exactly as before. A call with nothing to do also goes
 * straight through, returning Prisma's own promise, so batch transactions
 * (the recycle bin's) keep working.
 */

type Spec = { kind: FileKind; bytes: string; key: string };
const SPECS: Record<string, Spec> = {
  employeeDocument: { kind: 'employee-documents', bytes: 'data', key: 'storageKey' },
  punchPhoto: { kind: 'punch-photos', bytes: 'data', key: 'storageKey' },
  complianceTask: { kind: 'compliance-evidence', bytes: 'evidenceData', key: 'evidenceKey' },
  /* An obligation's proof files (Compliance): filed with the calendar's evidence they replace. */
  obligationProof: { kind: 'compliance-evidence', bytes: 'data', key: 'storageKey' },
  /* A bill photo or PDF on an expense claim (People money). */
  expenseBill: { kind: 'expense-bills', bytes: 'data', key: 'storageKey' },
};
export const OFFLOADED_MODELS = Object.keys(SPECS);

const hasBytes = (v: unknown) => (Buffer.isBuffer(v) || v instanceof Uint8Array) && (v as Uint8Array).length > 0;
const READS = new Set(['findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany']);

/** A model delegate whose file bytes live in the store. */
function wrapDelegate(delegate: any, spec: Spec) {
  return new Proxy(delegate, {
    get(target, op) {
      const original = Reflect.get(target, op);
      if (typeof original !== 'function') return original;
      const call = original.bind(target);
      const store = fileStore();
      if (!store) return call;

      if (op === 'create') {
        return (args: any) => {
          const data = args?.data;
          if (!data || !hasBytes(data[spec.bytes])) return call(args);
          /*
           * A row coming back with its key (the recycle bin restoring it) already
           * has its object: keep the key, drop the copy of the bytes. Done without
           * waiting, so Prisma's own promise goes back — the bin restores in a
           * batch transaction, which takes nothing else.
           */
          if (data[spec.key]) {
            if (!String(data[spec.key]).startsWith(prefixOf(data.orgId))) throw new Error('File key outside the row\'s company.');
            return call({ ...args, data: { ...data, [spec.bytes]: Buffer.alloc(0) } });
          }
          return (async () => {
            const id = data.id || randomUUID();
            const key = keyFor(data.orgId, spec.kind, id);
            await store.put(data.orgId, key, Buffer.from(data[spec.bytes]), data.mime || data.evidenceMime);
            return call({ ...args, data: { ...data, id, [spec.bytes]: Buffer.alloc(0), [spec.key]: key } });
          })();
        };
      }

      if (op === 'update' || op === 'upsert') {
        return (args: any) => {
          const data = op === 'update' ? args?.data : args?.update;
          const createData = op === 'upsert' ? args?.create : null;
          const offloadUpdate = data && hasBytes(data[spec.bytes]);
          const offloadCreate = createData && hasBytes(createData[spec.bytes]);
          const clearing = data && spec.bytes in data && data[spec.bytes] === null;
          if (!offloadUpdate && !offloadCreate && !clearing) return call(args);
          return (async () => {
            const next = { ...args };
            const row = await target.findUnique({ where: args.where, select: { id: true, orgId: true } });
            if (row && offloadUpdate) {
              const key = keyFor(row.orgId, spec.kind, row.id);
              await store.put(row.orgId, key, Buffer.from(data[spec.bytes]), data.mime || data.evidenceMime);
              next[op === 'update' ? 'data' : 'update'] = { ...data, [spec.bytes]: Buffer.alloc(0), [spec.key]: key };
            }
            if (clearing) next[op === 'update' ? 'data' : 'update'] = { ...data, [spec.key]: null };
            if (!row && offloadCreate) {
              const id = createData.id || randomUUID();
              const key = keyFor(createData.orgId, spec.kind, id);
              await store.put(createData.orgId, key, Buffer.from(createData[spec.bytes]), createData.mime || createData.evidenceMime);
              next.create = { ...createData, id, [spec.bytes]: Buffer.alloc(0), [spec.key]: key };
            }
            return call(next);
          })();
        };
      }

      if (READS.has(op as string)) {
        return (args: any = {}) => {
          const sel = args.select;
          /* Only when the bytes are asked for; add what is needed to fill them, and take it out again. */
          if (sel && !sel[spec.bytes]) return call(args);
          const added = sel ? [spec.key, 'orgId'].filter((f) => !sel[f]) : [];
          const query = sel && added.length ? { ...args, select: { ...sel, ...Object.fromEntries(added.map((f) => [f, true])) } } : args;
          return (async () => {
            const result = await call(query);
            const rows = Array.isArray(result) ? result : result ? [result] : [];
            await Promise.all(
              rows.map(async (r: any) => {
                if (r[spec.key] && r[spec.bytes] && r[spec.bytes].length === 0) {
                  r[spec.bytes] = (await store.get(r.orgId, r[spec.key])) ?? Buffer.alloc(0);
                }
                for (const f of added) delete r[f];
              })
            );
            return result;
          })();
        };
      }
      return call;
    },
  });
}

/** A people client (or transaction) whose file-holding models offload their bytes. */
export function withFileOffload<T extends object>(db: T): T {
  if (!fileStore()) return db;
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      const spec = typeof prop === 'string' ? SPECS[prop] : undefined;
      if (spec && value) return wrapDelegate(value, spec);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
