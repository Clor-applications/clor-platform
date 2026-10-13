/**
 * The rules behind the ledger master.
 *
 * The form is one form whose shape follows the group; these are the decisions
 * it makes that are not layout — what a name may be, what an identifier must
 * look like, which side an opening balance falls on, and when a ledger has
 * gone too far to be re-filed. They live here rather than inside the component
 * so each one can be stated once and tested on its own.
 */

/** Four letters, a zero, then six of either. The zero is the part people miss. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Five letters, four digits, a check letter. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * State code, the holder's PAN, entity number, Z, checksum. The PAN sits
 * inside the GSTIN, which is why the form can fill PAN in from it.
 */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const upper = (v) => String(v ?? '').trim().toUpperCase();

export const isValidIfsc = (v) => IFSC_RE.test(upper(v));
export const isValidPan = (v) => PAN_RE.test(upper(v));
export const isValidGstin = (v) => GSTIN_RE.test(upper(v));

/**
 * Which side a fresh opening balance sits on.
 *
 * An asset or an expense carries a debit balance, a liability, income or the
 * owner's capital a credit one. Defaulting everything to Dr meant a bank
 * overdraft and every creditor ledger opened on the wrong side and had to be
 * corrected by hand — and the correction is silent when it is missed, because
 * the number still looks right until the trial balance is read.
 */
export const openingTypeForNature = (accountClass) => {
  const c = String(accountClass || '').trim().toLowerCase();
  if (c === 'liability' || c === 'income' || c === 'revenue' || c === 'equity' || c === 'capital') return 'Cr';
  return 'Dr';
};

/**
 * A group that only exists to hold other groups cannot hold a ledger.
 *
 * "Duties & Taxes" is where TDS Payable and the GST ledgers hang; a ledger
 * filed directly on it belongs to no tax at all. The flag is opt-out so a
 * chart that has never heard of it keeps working.
 */
export const groupAllowsLedger = (group) => {
  if (!group) return false;
  if (group.allowLedger === false) return false;
  return String(group.name || '').trim().toLowerCase() !== 'primary';
};

/** Case- and space-insensitive: "HDFC  Bank" is the ledger "hdfc bank" again. */
const nameKey = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const isDuplicateLedgerName = ({ ledgers, companyId, name, ignoreId = null }) => {
  const key = nameKey(name);
  if (!key) return false;
  return (Array.isArray(ledgers) ? ledgers : []).some(
    (l) =>
      String(l?.companyId) === String(companyId) &&
      String(l?.id) !== String(ignoreId ?? '') &&
      nameKey(l?.name) === key
  );
};

/**
 * Has anything been posted to this ledger?
 *
 * Re-filing a ledger under another group moves every figure it holds onto a
 * different statement — a balance that was a liability becomes an expense —
 * and the entries that produced it say nothing about the move. So the group is
 * fixed from the first entry onwards; the name is not, because a rename
 * changes no total.
 */
export const ledgerHasPostings = ({ journalEntries, companyId, ledgerId }) => {
  const id = String(ledgerId || '').trim();
  if (!id) return false;
  return (Array.isArray(journalEntries) ? journalEntries : [])
    .filter((j) => String(j?.companyId) === String(companyId))
    .some((j) => (Array.isArray(j?.lines) ? j.lines : []).some((l) => String(l?.accountId || '').trim() === id));
};

/**
 * Everything the form refuses, in the order a person meets it.
 *
 * Returns the first complaint as `{ field, message }`, or null when the ledger
 * is fit to save. Order matters: a missing name is reported before a malformed
 * IFSC on a tab that is not open.
 */
export const validateLedger = ({
  values,
  group,
  ledgers,
  companyId,
  isEdit = false,
  ledgerId = null,
  needsBank = false,
  needsTds = false,
}) => {
  const name = String(values?.name || '').trim();
  if (!name) return { field: 'name', message: 'Ledger name is required.' };

  if (!group) return { field: 'groupId', message: 'Select the group this ledger belongs to.' };
  if (!groupAllowsLedger(group)) {
    return { field: 'groupId', message: `"${String(group.name || '').trim()}" holds groups, not ledgers. Pick one of the groups under it.` };
  }

  if (isDuplicateLedgerName({ ledgers, companyId, name, ignoreId: isEdit ? ledgerId : null })) {
    return { field: 'name', message: `A ledger called "${name}" already exists.` };
  }

  if (needsBank) {
    if (!String(values?.bankName || '').trim()) return { field: 'bankName', message: 'Bank name is required for a bank ledger.' };
    if (!String(values?.bankAccountNumber || '').trim()) return { field: 'bankAccountNumber', message: 'Account number is required for a bank ledger.' };
    const ifsc = upper(values?.bankIfsc);
    if (!ifsc) return { field: 'bankIfsc', message: 'IFSC code is required for a bank ledger.' };
    if (!isValidIfsc(ifsc)) return { field: 'bankIfsc', message: 'That IFSC is not valid — four letters, a zero, then six characters (HDFC0001234).' };
  }

  const pan = upper(values?.pan);
  if (pan && !isValidPan(pan)) return { field: 'pan', message: 'That PAN is not valid — five letters, four digits, one letter (AABCU9603R).' };

  const gstin = upper(values?.gstin);
  if (gstin && !isValidGstin(gstin)) return { field: 'gstin', message: 'That GSTIN is not valid — 15 characters, and the PAN sits inside it.' };

  if (needsTds && !String(values?.tdsSection || '').trim()) {
    return { field: 'tdsSection', message: 'A TDS ledger must say which section it accumulates.' };
  }

  return null;
};

/**
 * What the TDS tab shows about the chosen section.
 *
 * All of it is read from the section master, and none of it is stored on the
 * ledger: one rate, in one place, so a rule that changes later changes for
 * everyone and cannot disagree with itself.
 */
export const tdsSectionSummary = (section) => {
  if (!section) return null;

  const parts = [];
  if (section.single) parts.push(`₹${Number(section.single).toLocaleString('en-IN')} per payment`);
  if (section.monthly) parts.push(`₹${Number(section.monthly).toLocaleString('en-IN')} a month`);
  if (section.annual) parts.push(`₹${Number(section.annual).toLocaleString('en-IN')} a year`);

  const rate =
    section.rateIndividual && section.rateIndividual !== section.rate
      ? `${section.rate}% — ${section.rateIndividual}% for an individual or HUF`
      : `${section.rate}%`;

  return {
    rate,
    threshold: parts.length ? parts.join(', ') : 'No threshold — deducted from the first rupee',
    applicability: section.wholeOnceCrossed
      ? 'Once the threshold is crossed the whole aggregate is deducted, earlier payments included.'
      : 'Only the amount above the threshold is deducted.',
    version: section.newAct ? `Section ${section.code} (from 1 April 2026: ${section.newAct})` : `Section ${section.code}`,
  };
};

/** Payable or receivable, taken from the group rather than typed. */
export const tdsLedgerNature = (group) => {
  const name = String(group?.name || '').toLowerCase();
  if (/receivable|asset|advance/.test(name)) return 'Receivable';
  return 'Payable';
};

export default validateLedger;
