/**
 * Before and after values for the edit log (Rule 3(1); platform audit, 11 Nov 2026).
 *
 * A snapshot is a plain object of what a person would call the record's fields: a role's name, type and the
 * permissions it grants; an employee's master data; a company's sign-in policy. `diffSnapshots` compares two of
 * them and answers `{ field: { from, to } }` for each field that changed, or null when nothing did. Nested
 * settings are compared by path ("lateMarks.graceMinutes"); lists as a whole.
 *
 * Masked, never written: secrets, passwords, tokens, hashes, Aadhaar, PAN, bank account numbers, and the reason
 * typed for leaving (the same names auditMutations.ts hides in a request). A masked field that changed is still
 * listed, as "[hidden]" on both sides, so the log says that it changed without saying what to.
 */

/** Field names whose values are never written to the log. */
export const HIDDEN_FIELDS = /password|secret|token|hash|bankaccountnumber|accountnumber|^pan$|pannumber|aadhaar|passportnumber|photo|selfie|template|tmp$|activationcode|apikey|signature|^code$|otp|^leavingreason$|^endreason$|totp|recovery|clientsecret|privatekey|certificate/i;
/** Bookkeeping, not anything a person changed. */
const IGNORED = /^(id|accountId|orgId|createdAt|updatedAt|createdByUserId|updatedByUserId|version)$/;

export type Snapshot = Record<string, unknown>;
/* `any`: JSON values, as the audit table stores them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Changes = Record<string, { from: any; to: any }>;

const MAX_FIELDS = 80;
const MAX_TEXT = 300;
const MAX_DEPTH = 3;

/** A value as the log keeps it: dates as ISO text, long text cut, long lists cut. */
function plain(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'string') return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 50).map(plain);
  if (v && typeof v === 'object') {
    /* Prisma Decimal and the like: their own text. */
    if (typeof (v as any).toJSON === 'function' && !(v as any).constructor?.name?.startsWith('Object')) return plain((v as any).toJSON());
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, HIDDEN_FIELDS.test(k) && x != null ? '[hidden]' : plain(x)]));
  }
  return v;
}

/** `{ a: { b: 1 } }` → `{ "a.b": 1 }`, three levels deep; arrays and deeper objects stay whole. */
function flatten(o: Snapshot | null | undefined, prefix = '', depth = 0, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    if (!prefix && IGNORED.test(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && depth < MAX_DEPTH - 1 && (v as any).constructor === Object) {
      flatten(v as Snapshot, key, depth + 1, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
const hidden = (path: string) => path.split('.').some((p) => HIDDEN_FIELDS.test(p));

/**
 * What changed between two snapshots. `before` null: the record was made (every field from null); `after` null:
 * it was removed (every field to null). Both null, or nothing different: null.
 */
export function diffSnapshots(before: Snapshot | null | undefined, after: Snapshot | null | undefined): Changes | null {
  if (!before && !after) return null;
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const changes: Changes = {};
  let n = 0;
  for (const k of keys) {
    const from = before ? a[k] ?? null : null;
    const to = after ? b[k] ?? null : null;
    if (same(from, to)) continue;
    if (++n > MAX_FIELDS) {
      changes['…'] = { from: null, to: `${keys.length - MAX_FIELDS} more fields` };
      break;
    }
    changes[k] = hidden(k) ? { from: from == null ? null : '[hidden]', to: to == null ? null : '[hidden]' } : { from: plain(from), to: plain(to) };
  }
  return n ? changes : null;
}

/** A row read for a snapshot, without the fields that are never anybody's change. */
export function rowSnapshot(row: Record<string, unknown> | null | undefined, drop: string[] = []): Snapshot | null {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).filter(([k]) => !drop.includes(k)));
}
