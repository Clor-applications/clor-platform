/**
 * What a party is worth to the business right now.
 *
 * A customer master listed a `balance` field that nothing maintained, so the
 * column read ₹0.00 for everybody while the invoice list showed lakhs
 * outstanding against the same names. The figure a list of customers is opened
 * for is what they owe, so it is computed from the documents rather than
 * stored: total minus what has been paid, cancelled and draft documents left
 * out, and the part of it that is past its due date counted separately.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isLive = (doc) => {
  const st = String(doc?.status || '').trim().toLowerCase();
  return st !== 'cancelled' && st !== 'draft';
};

/**
 * Outstanding per party id, from a set of documents.
 *
 * `idKey` is `customerId` on sales documents and `vendorId` on purchase ones —
 * the arithmetic either side of the business is identical, and writing it twice
 * is how the two screens end up disagreeing about what "overdue" means.
 */
export const outstandingByParty = ({ docs = [], idKey = 'customerId', companyId, todayIso }) => {
  const today = String(todayIso || new Date().toISOString().slice(0, 10));
  const byId = new Map();
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (companyId !== undefined && doc?.companyId !== companyId) continue;
    if (!isLive(doc)) continue;
    const id = String(doc?.[idKey] || '').trim();
    if (!id) continue;
    const due = Math.max(0, num(doc.total) - num(doc.paidAmount));
    if (due <= 0.0001) continue;
    const row = byId.get(id) || { outstanding: 0, overdue: 0, documents: 0 };
    row.outstanding += due;
    row.documents += 1;
    const dueDate = String(doc?.dueDate || '').slice(0, 10);
    if (dueDate && dueDate < today) row.overdue += due;
    byId.set(id, row);
  }
  return byId;
};

/** The same for one party, with zeroes rather than undefined. */
export const standingOf = (byId, partyId) =>
  byId.get(String(partyId)) || { outstanding: 0, overdue: 0, documents: 0 };

/**
 * Whether a party is registered under GST.
 *
 * Two fields say it and they can disagree: `gstRegistration` is what somebody
 * chose in the form, `gstin` is the number itself. A party with a GSTIN typed
 * in is registered whatever the dropdown says — the number is the evidence.
 */
export const isGstRegistered = (party) => {
  if (String(party?.gstin || '').trim()) return true;
  // Matched as whole words, not as a substring: "Unregistered" contains
  // "registered", and a loose test called every unregistered party registered.
  return /^(regular|composition|sez|sez with payment|deemed export|registered)$/i.test(
    String(party?.gstRegistration || '').trim()
  );
};
