/**
 * Text made safe to put inside HTML we write by hand: a print window, a
 * mail body, a sheet a browser opens. All five characters that can end text
 * or an attribute are escaped. (XML for Tally has its own escaper in
 * tallyXml.js.)
 */
const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
