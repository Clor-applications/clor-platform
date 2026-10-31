/* A label in any script gets its own code: Hindi or Tamil answers have no A to Z to make one from, and two of them must not both read OTHER. */
const hashOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.codePointAt(0)) >>> 0, 7).toString(36).toUpperCase();

/** The stored code of an answer's label; a label already saved keeps its code. */
export const codeOf = (label, before = []) => before.find((o) => o.label === label)?.code || label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || `ANS_${hashOf(label)}`;
