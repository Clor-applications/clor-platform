/**
 * The fields a partial update actually sent.
 *
 * Zod 4 fills a field's `.default()` even inside `.partial()`, so
 * `schema.partial().parse({ name })` comes back with every defaulted field
 * set (a role's permissions emptied, its type reset). Zod 3 left them out.
 * An update must change only what was sent: keep the parsed value of each
 * key present in the raw body, drop the rest.
 */
export function sentOnly<T extends Record<string, unknown>>(parsed: T, raw: unknown): T {
  const sent = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(parsed)) if (Object.prototype.hasOwnProperty.call(sent, key)) out[key] = parsed[key];
  return out as T;
}
