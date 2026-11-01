/**
 * Text made safe to put inside HTML we write by hand: a public page, a mail
 * body. All five characters that can end text or an attribute are escaped.
 * (Tally XML has its own escaper in services/payroll/tally.ts.)
 */
const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]!);
