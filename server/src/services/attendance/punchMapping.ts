import { z } from 'zod';

/**
 * Reading punches from what another system sends, whatever shape it is in.
 *
 * A mapping says where each field is — a JSON path for HTTP pushes and pull
 * APIs, a column name for files — how to read the time, and which values mean
 * in and out. The result is the one shape ingestPunches takes: employee code,
 * local time in India ("YYYY-MM-DD HH:mm:ss"), direction and verify mode.
 *
 * Times: an ISO time with an offset (…Z, …+05:30) is converted; one without
 * an offset is read in the source's zone (the reader's timezone setting), so
 * a reader in Dubai sending "09:00" is 10:30 here.
 */

export const mappingSchema = z.object({
  /** Where the list of punches is ("data.events"); empty when the body is the list, or one punch. */
  records: z.string().trim().max(120).optional().default(''),
  employeeCode: z.string().trim().min(1, 'Say which field has the employee code.').max(120),
  /** One field with date and time, or `date` + `time` separately. */
  timestamp: z.string().trim().max(120).optional().default(''),
  date: z.string().trim().max(120).optional().default(''),
  time: z.string().trim().max(120).optional().default(''),
  /** auto | epoch | epoch_ms | DMY (31-12-2026 / 31/12/2026) | MDY. */
  timeFormat: z.enum(['auto', 'epoch', 'epoch_ms', 'DMY', 'MDY']).default('auto'),
  direction: z.string().trim().max(120).optional().default(''),
  /** Values meaning in and out, compared without case ("in, 0, checkin"). */
  inValues: z.array(z.string().trim().max(40)).max(20).default(['in', '0', 'checkin', 'check-in', 'entry']),
  outValues: z.array(z.string().trim().max(40)).max(20).default(['out', '1', 'checkout', 'check-out', 'exit']),
  verifyMode: z.string().trim().max(120).optional().default(''),
  /** Only records where this field equals one of these values count (e.g. event type "access granted"). */
  filterField: z.string().trim().max(120).optional().default(''),
  filterValues: z.array(z.string().trim().max(80)).max(20).default([]),
});
export type Mapping = z.infer<typeof mappingSchema>;

export type NormalPunch = { code: string; localTime: string; direction: 'in' | 'out' | null; verify: number };

const VERIFY: Record<string, number> = { password: 0, pin: 0, finger: 1, fingerprint: 1, card: 4, rfid: 4, face: 15, palm: 25 };
const pad = (n: number) => String(n).padStart(2, '0');

/** `a.b[2].c` into a value; plain keys with dots also work when nested lookups miss. */
export function pick(obj: unknown, path: string): unknown {
  if (!path) return obj;
  if (obj && typeof obj === 'object' && path in (obj as Record<string, unknown>)) return (obj as Record<string, unknown>)[path];
  let cur: any = obj;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Minutes the zone is ahead of UTC at that moment (Intl, no library). */
function offsetMinutes(zone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at)
    .reduce<Record<string, string>>((m, p) => ((m[p.type] = p.value), m), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** An instant as India local time, the form punches are stored in. */
const istLocal = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

/** Wall-clock parts in `zone` to the instant they name. */
function fromZone(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = offsetMinutes(zone, new Date(guess));
  return new Date(guess - off * 60_000);
}

/** A time as another system wrote it, to India local time; null when it cannot be read. */
export function readTime(raw: unknown, format: Mapping['timeFormat'], zone: string): string | null {
  if (raw == null || raw === '') return null;
  if (format === 'epoch' || format === 'epoch_ms' || (format === 'auto' && typeof raw === 'number')) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const ms = format === 'epoch_ms' || (format === 'auto' && n > 1e11) ? n : n * 1000;
    return istLocal(new Date(ms));
  }
  const text = String(raw).trim();
  /* ISO with an offset or Z: an exact instant. */
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const at = new Date(text.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(at.getTime()) ? null : istLocal(at);
  }
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  let parts: number[] | null = m ? [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)] : null;
  if (!parts) {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
    if (m) {
      let h = +m[4];
      if (m[7]) h = (h % 12) + (m[7].toLowerCase() === 'pm' ? 12 : 0);
      parts = format === 'MDY' ? [+m[3], +m[1], +m[2], h, +m[5], +(m[6] || 0)] : [+m[3], +m[2], +m[1], h, +m[5], +(m[6] || 0)];
    }
  }
  if (!parts) return null;
  const [y, mo, d, h, mi, s] = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const at = fromZone(y, mo, d, h, mi, s, zone);
  return Number.isNaN(at.getTime()) ? null : istLocal(at);
}

/** The records in a body, by the mapping's `records` path. */
export function recordsOf(body: unknown, mapping: Pick<Mapping, 'records'>): unknown[] {
  const at = pick(body, mapping.records || '');
  if (Array.isArray(at)) return at;
  if (at && typeof at === 'object') {
    /* A body that is one punch, or {punches|data|events|records: [...]} when no path was given. */
    if (!mapping.records) for (const k of ['punches', 'data', 'events', 'records', 'logs', 'AccessControllerEvent']) if (Array.isArray((at as any)[k])) return (at as any)[k];
    return [at];
  }
  return [];
}

/** One record through a mapping. */
export function normalise(record: unknown, mapping: Mapping, zone: string): { punch: NormalPunch } | { error: string } {
  if (mapping.filterField && mapping.filterValues.length) {
    const v = String(pick(record, mapping.filterField) ?? '').trim().toLowerCase();
    if (!mapping.filterValues.some((f) => f.toLowerCase() === v)) return { error: 'skipped' };
  }
  const code = String(pick(record, mapping.employeeCode) ?? '').trim().slice(0, 40);
  if (!code) return { error: `No employee code at "${mapping.employeeCode}".` };
  const raw = mapping.timestamp ? pick(record, mapping.timestamp) : `${pick(record, mapping.date) ?? ''} ${pick(record, mapping.time) ?? ''}`.trim();
  const localTime = readTime(raw, mapping.timeFormat, zone);
  if (!localTime) return { error: `Time "${String(raw ?? '').slice(0, 40)}" could not be read.` };
  let direction: NormalPunch['direction'] = null;
  if (mapping.direction) {
    const v = String(pick(record, mapping.direction) ?? '').trim().toLowerCase();
    if (mapping.inValues.some((x) => x.toLowerCase() === v)) direction = 'in';
    else if (mapping.outValues.some((x) => x.toLowerCase() === v)) direction = 'out';
  }
  const vm = mapping.verifyMode ? pick(record, mapping.verifyMode) : null;
  const verify = typeof vm === 'number' ? vm : VERIFY[String(vm ?? '').trim().toLowerCase()] ?? 0;
  return { punch: { code, localTime, direction, verify } };
}

/** A whole body (or file rows) to ADMS-style lines for ingestPunches, with reasons for what was refused. */
export function toAttlog(records: unknown[], mapping: Mapping, zone: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  let skipped = 0;
  const sample: NormalPunch[] = [];
  records.forEach((r, i) => {
    const out = normalise(r, mapping, zone);
    if ('error' in out) {
      if (out.error === 'skipped') skipped += 1;
      else if (errors.length < 50) errors.push(`Record ${i + 1}: ${out.error}`);
      return;
    }
    const p = out.punch;
    if (sample.length < 5) sample.push(p);
    lines.push(`${p.code}\t${p.localTime}\t${p.direction === 'in' ? '0' : p.direction === 'out' ? '1' : '255'}\t${p.verify}`);
  });
  return { lines, errors, skipped, sample };
}

