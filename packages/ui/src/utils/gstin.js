/**
 * PAN and GSTIN, checked for shape. The same patterns as the server's
 * `server/src/utils/gstin.ts` (which also checks the GSTIN's check digit).
 * Ledger, party, picker and TDS forms each kept a copy; this is the one.
 */

/** Five letters, four digits, a check letter. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * State code, the holder's PAN, entity number, Z, checksum. The PAN sits
 * inside the GSTIN, which is why a form can fill PAN in from it.
 */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const upper = (v) => String(v ?? '').trim().toUpperCase();

export const isValidPan = (v) => PAN_RE.test(upper(v));
export const isValidGstin = (v) => GSTIN_RE.test(upper(v));
