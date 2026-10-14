/**
 * A request URL fit for an access log.
 *
 * `morgan('tiny')` wrote every URL as it came, so the log kept live invoice
 * share tokens (anyone holding one can read that invoice), GSTINs being
 * looked up, and whatever people typed into search boxes. The path shape and
 * the status are what an operator needs; those values are not.
 */
const SECRET_PATHS: Array<[RegExp, string]> = [
  [/(\/public\/invoice\/)[^/?#]+/i, '$1[token]'],
  [/(\/gstin\/)[^/?#]+/i, '$1[gstin]'],
];

const QUIET_PARAMS = new Set(['token', 'share', 'search', 'q', 'email', 'gstin', 'pan', 'phone']);

export function safeUrl(url: string): string {
  let out = String(url || '');
  for (const [re, to] of SECRET_PATHS) out = out.replace(re, to);
  const q = out.indexOf('?');
  if (q === -1) return out;
  const params = new URLSearchParams(out.slice(q + 1));
  for (const key of [...params.keys()]) if (QUIET_PARAMS.has(key.toLowerCase())) params.set(key, '[redacted]');
  const rest = params.toString().replace(/%5Bredacted%5D/g, '[redacted]');
  return `${out.slice(0, q)}${rest ? `?${rest}` : ''}`;
}
