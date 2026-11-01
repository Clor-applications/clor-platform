/**
 * A query string from an object: `?a=1&b=x`, or '' when nothing is set.
 * Undefined, null and empty values are left out, so a filter that is not
 * chosen is not sent. Several API clients each kept their own copy.
 */
export const queryString = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
