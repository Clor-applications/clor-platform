/**
 * Turns an English line of the employee app into another language, from a
 * language file (hi.js and the like):
 *
 *  1. the line exactly ("Cancel leave");
 *  2. a line with values ("Apply for {}" matches "Apply for Casual leave"; the
 *     value is itself looked up, so "Casual leave" turns too when it is known);
 *  3. a line made only of date, time and count words, digits and the terms that
 *     stay in English ("18 Nov 2026", "3 days", "Tue"), word by word.
 *
 * Anything else is left as it is (a name, a code, text people typed), and the
 * caller gets null, so it knows nothing turned.
 */

/** Terms that stay in English in every language: what payslips, forms and the law call them. */
export const KEEP_ENGLISH = [
  'PF', 'EPF', 'EPS', 'EPFO', 'ESI', 'ESIC', 'UAN', 'PAN', 'IFSC', 'TDS', 'GST', 'GSTIN', 'HRA', 'LOP', 'CTC', 'ECR',
  'OT', 'HR', 'IT', 'CLOR', 'PDF', 'MB', 'KB', 'AM', 'PM', 'am', 'pm', 'OTP', 'SIM', 'GPS', 'ID', 'WhatsApp', 'Word', '80C',
  'YYYY', 'MM', 'DD',
];
const KEEP = new Set(KEEP_ENGLISH);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** "{1}", "{2}" put the values where the language wants them; plain "{}" takes them in order. */
const fill = (target, values) => {
  let i = 0;
  return target.replace(/\{(\d*)\}/g, (_, n) => (n ? values[Number(n) - 1] : values[i++]) ?? '');
};

export function makeTranslator(pack) {
  if (!pack) return () => null;
  const exact = new Map();
  /* "present" inside a sentence is the same word as the label "Present". */
  const lower = new Map();
  const patterns = [];
  for (const [from, to] of Object.entries(pack.words || {})) {
    if (!from.includes('{}')) {
      exact.set(squash(from), to);
      if (!lower.has(squash(from).toLowerCase())) lower.set(squash(from).toLowerCase(), to);
      continue;
    }
    const parts = from.split('{}');
    const literal = parts.join('');
    /* A pattern needs words of its own, or it would match anything. */
    if (!/[A-Za-z]{2}/.test(literal)) continue;
    const anchor = parts.reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), '');
    /*
     * Holes side by side ("{}{}": a month and ", 2026") cannot be told apart, so
     * they share one capture: the first hole gets it, the others stay empty.
     */
    let source = escape(parts[0]);
    const groups = [];
    for (let i = 1; i < parts.length; i += 1) {
      if (i > 1 && parts[i - 1] === '') groups[groups.length - 1].push(i - 1);
      else {
        groups.push([i - 1]);
        source += '(.*?)';
      }
      source += escape(parts[i]);
    }
    const re = new RegExp(`^${source}$`, 's');
    /* The same with the first hole taking as much as it can: "Why is {} {}?" on "Why is Tue, 18 Nov present?". */
    const greedy = groups.length > 1 ? new RegExp(`^${source.replace('(.*?)', '(.*)')}$`, 's') : null;
    patterns.push({ re, greedy, to, anchor, groups, holes: parts.length - 1, weight: literal.length, words: (literal.match(/[A-Za-z]{2,}/g) || []).length });
  }
  /* The most specific pattern first: "Left {}h {}m early" before "{} early". */
  patterns.sort((a, b) => b.weight - a.weight);
  const tokens = pack.tokens || {};

  const byTokens = (text) => {
    if (!/[A-Za-z]/.test(text)) return null;
    let changed = false;
    const out = text
      .replace(/(\d)(h|m)\b/g, (_, d, u) => { changed = true; return `${d} ${tokens[u] || u}`; })
      .replace(/[A-Za-z]+/g, (w) => {
        if (tokens[w] && !KEEP.has(w)) {
          changed = true;
          return tokens[w];
        }
        return w;
      });
    if (!changed) return null;
    const leftover = out.match(/[A-Za-z][A-Za-z0-9]*/g) || [];
    return leftover.every((w) => KEEP.has(w)) ? out : null;
  };

  /** The values a pattern's match puts in its holes, or null when the match is a wrong one. */
  const fit = (p, m, depth) => {
    if (!m) return null;
    const values = new Array(p.holes).fill('');
    let misses = 0;
    for (let g = 0; g < p.groups.length; g += 1) {
      const v = m[g + 1];
      const turned = translate(v, depth + 1);
      /*
       * A value is a name, a date or a number; a whole English sentence in a hole
       * means a wrong match. A pattern of one word ("{} days") takes only numbers
       * and words it knows; a longer one also takes a short name.
       */
      const english = (v.match(/[A-Za-z]{2,}/g) || []).filter((w) => !KEEP.has(w)).length;
      if (turned == null && english > (p.words < 2 ? 0 : 3)) return null;
      if (turned == null && english) misses += 1;
      values[p.groups[g][0]] = turned ?? v;
    }
    return { values, misses };
  };

  const translate = (raw, depth = 0) => {
    if (raw == null) return null;
    const text = squash(String(raw));
    if (!text || !/[A-Za-z]/.test(text)) return null;
    const hit = exact.get(text) ?? lower.get(text.toLowerCase());
    if (hit != null) return hit;
    if (depth < 3) {
      for (const p of patterns) {
        if (p.anchor && !text.includes(p.anchor)) continue;
        let best = null;
        for (const re of p.greedy ? [p.re, p.greedy] : [p.re]) {
          const tried = fit(p, re.exec(text), depth);
          if (tried && (!best || tried.misses < best.misses)) best = tried;
          if (best && best.misses === 0) break;
        }
        if (best) return fill(p.to, best.values);
      }
    }
    const tokened = byTokens(text);
    if (tokened != null || depth > 0) return tokened;
    return bySegments(text);
  };

  /*
   * A line put together from pieces ("Fri: not yet", "unpaid · half days allowed",
   * "Saturday, 28 November, weekly off"): each piece on its own. Pieces that do
   * not turn (a name) stay as they are, as long as one piece did.
   */
  const bySegments = (text) => {
    const pieces = text.split(/(\s·\s|:\s|,\s|\s–\s|\s—\s|;\s)/);
    if (pieces.length < 3) return null;
    let turned = 0;
    const out = pieces.map((piece, i) => {
      if (i % 2 === 1) return piece;
      const one = translate(piece, 1);
      if (one != null) turned += 1;
      return one ?? piece;
    });
    return turned ? out.join('') : null;
  };

  /** Keeps the spaces around a piece of text: React splits "Hello {name}" into "Hello " and the name. */
  const translateKeepingSpace = (raw) => {
    const s = String(raw);
    const lead = s.match(/^\s*/)[0];
    const trail = s.slice(lead.length).match(/\s*$/)[0];
    const out = translate(s);
    return out == null ? null : `${lead}${out}${trail}`;
  };

  /** A server error by its code, then by its words. */
  const error = (message, code) => (code && pack.errors?.[code]) || translate(message) || null;

  return Object.assign(translate, { keepingSpace: translateKeepingSpace, error });
}
