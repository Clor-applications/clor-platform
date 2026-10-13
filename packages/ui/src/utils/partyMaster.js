/**
 * The rules behind the party master — customers and vendors alike.
 *
 * Both specifications describe one form twice and list the differences at the
 * end: the noun, which side an opening balance sits, sales price list against
 * purchase. So the decisions that are not layout live here once, and neither
 * form can quietly grow a different answer to the same question.
 */

import { isPriceListInForce } from './pricing';

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const upper = (v) => String(v ?? '').trim().toUpperCase();
const text = (v) => String(v ?? '').trim();

export const isValidPan = (v) => PAN_RE.test(upper(v));
export const isValidGstin = (v) => GSTIN_RE.test(upper(v));

/**
 * What a GSTN lookup is allowed to change.
 *
 * "Do not silently overwrite manually entered information." The vendor form
 * did exactly that: a name typed before the number was fetched was replaced by
 * the legal name on the portal, and so was every address line under it. Somebody
 * who had corrected a trade name to what they actually call the supplier lost
 * the correction to a button they pressed for the PAN.
 *
 * So a fetch fills blanks. Where a field already holds something and the portal
 * disagrees, the typed value stays and the difference is reported — the person
 * decides, not the network. The one exception is the state, which is not
 * fetched at all: it is the first two digits of the GSTIN, so it is a fact
 * about the number rather than an opinion about the party, and a mismatch is
 * refused at save time anyway.
 */
export const mergeGstinFetch = ({ prev = {}, data = {} }) => {
  const kept = [];
  const fill = (current, incoming, label) => {
    const now = text(current);
    const next = text(incoming);
    if (!next) return now;
    if (!now) return next;
    if (now.toLowerCase() !== next.toLowerCase()) kept.push(label);
    return now;
  };

  const address = data.address || {};
  const prevAddress = prev.billingAddress || {};

  const next = {
    ...prev,
    gstin: upper(data.gstin || prev.gstin),
    pan: upper(fill(prev.pan, data.pan, 'PAN')),
    displayName: fill(prev.displayName, data.legalName || data.tradeName, 'name'),
    legalName: text(prev.legalName) || text(data.legalName),
    tradeName: text(prev.tradeName) || text(data.tradeName),
    gstStatus: text(data.status) || text(prev.gstStatus),
    gstTaxpayerType: text(data.taxpayerType) || text(prev.gstTaxpayerType),
    gstRegistrationDate: text(data.registrationDate) || text(prev.gstRegistrationDate),
    billingAddress: {
      ...prevAddress,
      line1: fill(prevAddress.line1, address.line1, 'address'),
      line2: fill(prevAddress.line2, address.line2, 'address line 2'),
      city: fill(prevAddress.city, address.city, 'city'),
      district: fill(prevAddress.district, address.district, 'district'),
      pincode: fill(prevAddress.pincode, address.pincode, 'pincode'),
      /* Encoded in the number itself, so it is not somebody's typing to keep. */
      state: text(data.state) || text(prevAddress.state),
      country: text(prevAddress.country) || 'India',
    },
  };

  return { next, kept: [...new Set(kept)] };
};

/**
 * The price lists a party may point at.
 *
 * The field was free text with "Standard" as a placeholder, and the rate
 * engine looks a list up by id — so whatever was typed there resolved to
 * nothing and the party was quietly on default rates. A list that has been
 * retired, or whose validity window has passed, is not offered either: the
 * master should not point at a list that cannot price anything.
 */
export const activePriceListOptions = ({ db, companyId, onDate = '' }) => {
  const lists = Array.isArray(db?.priceLists) ? db.priceLists : [];
  return lists
    .filter((p) => String(p?.companyId) === String(companyId))
    .filter((p) => isPriceListInForce(p, onDate))
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    .map((p) => ({ value: String(p.id), label: String(p.name || '').trim() || `List ${p.id}` }));
};

/**
 * Everything the party master refuses, in the order a person meets it.
 *
 * Returns the first complaint as `{ field, tab, message }` so the form can open
 * the tab the bad field is on, or null when the party is fit to save. GSTIN and
 * state checks stay with the caller: they are entangled with the registration
 * type and with deriving state from the number, and that logic is already
 * tested where it lives.
 */
export const validateParty = ({ values, noun = 'Party', priceListOptions = [] }) => {
  if (!text(values?.displayName)) {
    return { field: 'displayName', tab: '', message: `${noun} name is required.` };
  }

  if (!text(values?.groupId)) {
    return { field: 'groupId', tab: '', message: `${noun} group is required.` };
  }

  const opening = values?.openingBalance;
  if (text(opening) !== '' && !Number.isFinite(Number(opening))) {
    return { field: 'openingBalance', tab: '', message: 'Opening balance must be a number.' };
  }

  const limit = values?.creditLimit;
  if (text(limit) !== '') {
    const n = Number(limit);
    if (!Number.isFinite(n)) return { field: 'creditLimit', tab: 'credit', message: 'Credit limit must be a number.' };
    if (n < 0) return { field: 'creditLimit', tab: 'credit', message: 'Credit limit cannot be negative.' };
  }

  const days = values?.paymentTermDays;
  if (text(days) !== '') {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0) {
      return { field: 'paymentTermDays', tab: 'credit', message: 'Credit period must be a number of days.' };
    }
  }

  const priceListId = text(values?.priceListId);
  if (priceListId && !priceListOptions.some((o) => String(o.value) === priceListId)) {
    return {
      field: 'priceListId',
      tab: 'credit',
      message: 'That price list is not in force. Pick one that is, or leave it empty.',
    };
  }

  const pan = upper(values?.pan);
  if (pan && !isValidPan(pan)) {
    return { field: 'pan', tab: 'statutory', message: 'That PAN is not valid — five letters, four digits, one letter (AABCU9603R).' };
  }

  return null;
};

export default validateParty;
