export const getCustomerDisplayName = (customer) => {
  if (!customer) return '';
  return customer.displayName || customer.name || '';
};

export const getVendorDisplayName = (vendor) => {
  if (!vendor) return '';
  return vendor.displayName || vendor.name || '';
};

/**
 * Who to write to at a party.
 *
 * Both masters ask for one contact to be marked primary, and until the flag
 * existed the first row typed was the one every reminder went to — so adding an
 * accounts clerk above the person you actually deal with quietly redirected the
 * correspondence. A party with no flag keeps the old behaviour: the first
 * contact that has a name.
 */
export const primaryContactOf = (party) => {
  const rows = (Array.isArray(party?.contacts) ? party.contacts : []).filter((c) => String(c?.name || '').trim());
  if (!rows.length) return null;
  return rows.find((c) => c?.isPrimary) || rows[0];
};

/**
 * The address a message actually goes to.
 *
 * The party's own field wins where it is filled — it is the one somebody typed
 * on the master itself — and the primary contact answers for it where it is
 * not, which is the common case for a company whose "email" is a person.
 */
export const partyEmail = (party) => {
  const own = String(party?.email || '').trim();
  if (own) return own;
  return String(primaryContactOf(party)?.email || '').trim();
};

export const partyMobile = (party) => {
  const own = String(party?.mobile || party?.phone || '').trim();
  if (own) return own;
  return String(primaryContactOf(party)?.mobile || '').trim();
};
