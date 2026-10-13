import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

const q = (search) => (search ? `?search=${encodeURIComponent(search)}` : '');

export const listCustomers = (search) => apiFetch(`${base()}/customers${q(search)}`, opts);
export const createCustomer = (party) =>
  apiFetch(`${base()}/customers`, { method: 'POST', body: party, ...opts });
export const updateCustomer = (partyId, party) =>
  apiFetch(`${base()}/customers/${encodeURIComponent(partyId)}`, { method: 'PATCH', body: party, ...opts });

export const listVendors = (search) => apiFetch(`${base()}/vendors${q(search)}`, opts);
export const createVendor = (party) => apiFetch(`${base()}/vendors`, { method: 'POST', body: party, ...opts });

export const listItems = (search) => apiFetch(`${base()}/items${q(search)}`, opts);
export const createItem = (item) => apiFetch(`${base()}/items`, { method: 'POST', body: item, ...opts });

export const nextNumber = (docType, date) =>
  apiFetch(`${base()}/number-series/next/${encodeURIComponent(docType)}${date ? `?date=${date}` : ''}`, opts);

/**
 * What a GSTIN says about itself, plus whatever a configured portal adds.
 *
 * The number is self-describing: the first two digits are the state code and
 * characters 3–12 are the PAN. The server returns those without calling
 * anywhere, so the button is useful even where no portal is configured.
 */
export const lookupGstin = (gstin, token = '') =>
  apiFetch(`/gstin/${encodeURIComponent(String(gstin || '').trim().toUpperCase())}`, {
    skipBranchHeader: true,
    skipWarehouseHeader: true,
    /*
     * The token is passed explicitly during signup. At the company step the
     * account exists and its session is valid, but nothing has been written to
     * localStorage yet — that happens once the company is created — so the
     * default header would have been absent and the lookup would have answered
     * 401 at exactly the moment it is most useful.
     */
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });

/**
 * The whole customer master, in the shape the server takes.
 *
 * Built in one place because there were two callers sending two different
 * subsets: the picker sent six fields and the Customers screen sent nothing at
 * all — it wrote to the browser and stopped. So contacts, extra addresses,
 * group, currency, MSME and the rest reached the database from neither, and the
 * customer code the server allots was never asked for.
 */
export const toServerCustomer = (c) => ({
  name: String(c?.displayName || c?.name || '').trim() || 'Customer',
  code: String(c?.code || '').trim() || undefined,
  gstin: c?.gstin || undefined,
  gstRegistrationType:
    c?.gstRegistration === 'Registered' ? 'REGULAR' : c?.gstRegistration === 'Composition' ? 'COMPOSITION' : 'UNREGISTERED',
  pan: c?.pan || undefined,
  email: c?.email || undefined,
  phone: c?.mobile || c?.phone || undefined,
  contactPerson: c?.contactPerson || undefined,
  paymentTermName: c?.paymentTermName || undefined,
  partyGroup: c?.groupName || undefined,
  currency: c?.currency || undefined,
  priceListId: c?.priceListId || undefined,
  msmeNumber: c?.msmeNumber || undefined,
  statutoryOther: c?.statutoryOther || undefined,
  notes: c?.notes || undefined,
  openingBalance: Number(c?.openingBalance || 0),
  openingBalanceType: String(c?.openingBalanceType || 'Dr').toUpperCase() === 'CR' ? 'CR' : 'DR',
  paymentTermDays:
    c?.paymentTermDays === undefined || c?.paymentTermDays === null ? undefined : Number(c.paymentTermDays),
  creditLimit: c?.creditLimit === undefined || c?.creditLimit === null ? undefined : Number(c.creditLimit),
  isActive: c?.isActive !== false,

  billingLine1: c?.billingAddress?.line1 || undefined,
  billingLine2: c?.billingAddress?.line2 || undefined,
  billingCity: c?.billingAddress?.city || undefined,
  billingDistrict: c?.billingAddress?.district || undefined,
  billingState: c?.billingAddress?.state || undefined,
  billingPincode: c?.billingAddress?.pincode || undefined,
  billingCountry: c?.billingAddress?.country || undefined,

  shippingSameAsBilling: c?.shippingSameAsBilling !== false,
  shippingLine1: c?.shippingAddress?.line1 || undefined,
  shippingLine2: c?.shippingAddress?.line2 || undefined,
  shippingCity: c?.shippingAddress?.city || undefined,
  shippingDistrict: c?.shippingAddress?.district || undefined,
  shippingState: c?.shippingAddress?.state || undefined,
  shippingPincode: c?.shippingAddress?.pincode || undefined,
  shippingCountry: c?.shippingAddress?.country || undefined,

  extraAddresses: (Array.isArray(c?.shipToAddresses) ? c.shipToAddresses : [])
    .filter((a) => String(a?.label || '').trim())
    .map((a) => ({
      label: String(a.label).trim(),
      line1: a.line1 || undefined,
      line2: a.line2 || undefined,
      city: a.city || undefined,
      district: a.district || undefined,
      state: a.state || undefined,
      pincode: a.pincode || undefined,
      country: a.country || undefined,
    })),
  contacts: (Array.isArray(c?.contacts) ? c.contacts : [])
    .filter((p) => String(p?.name || '').trim())
    .map((p) => ({
      name: String(p.name).trim(),
      position: p.position || undefined,
      email: p.email || undefined,
      mobile: p.mobile || undefined,
      isPrimary: Boolean(p.isPrimary),
    })),
});

/*
 * Three collections that used to live only in the browser.
 *
 * A delivery challan is a document under Rule 55, a fixed asset is on the
 * balance sheet, and a salesman is the axis of a report — so each of them, held
 * in one machine's localStorage, made the same company show different records
 * on different machines.
 */
export const listDeliveryChallans = () => apiFetch(`${base()}/delivery-challans`, opts);
export const createDeliveryChallan = (doc) =>
  apiFetch(`${base()}/delivery-challans`, { method: 'POST', body: doc, ...opts });
export const updateDeliveryChallan = (id, patch) =>
  apiFetch(`${base()}/delivery-challans/${id}`, { method: 'PATCH', body: patch, ...opts });

export const listSalesmen = () => apiFetch(`${base()}/salesmen`, opts);
export const createSalesman = (s) => apiFetch(`${base()}/salesmen`, { method: 'POST', body: s, ...opts });
export const updateSalesman = (id, patch) =>
  apiFetch(`${base()}/salesmen/${id}`, { method: 'PATCH', body: patch, ...opts });
export const deactivateSalesman = (id) => apiFetch(`${base()}/salesmen/${id}`, { method: 'DELETE', ...opts });

export const listFixedAssets = () => apiFetch(`${base()}/fixed-assets`, opts);
export const createFixedAsset = (a) => apiFetch(`${base()}/fixed-assets`, { method: 'POST', body: a, ...opts });
export const updateFixedAsset = (id, patch) =>
  apiFetch(`${base()}/fixed-assets/${id}`, { method: 'PATCH', body: patch, ...opts });

/**
 * The six reference lists — units, item categories, price lists, discount
 * rules, cost centres, account groups — through one endpoint.
 *
 * `data` is whatever the kind carries and the browser owns its shape; the
 * server stores it verbatim. Names are unique per kind, so a duplicate comes
 * back as a 409 with a sentence rather than a silent second row.
 */
export const MASTER_KIND = {
  uoms: 'UOM',
  itemCategories: 'ITEM_CATEGORY',
  priceLists: 'PRICE_LIST',
  discountRules: 'DISCOUNT_RULE',
  costCenters: 'COST_CENTER',
  accountGroups: 'ACCOUNT_GROUP',
  gstRates: 'GST_RATE',
};

/** The db collection each server kind belongs to — MASTER_KIND, reversed. */
export const COLLECTION_FOR_KIND = Object.fromEntries(
  Object.entries(MASTER_KIND).map(([collection, kind]) => [kind, collection])
);

export const listOrgMasters = (kinds = []) => {
  const q = kinds.length ? `?kind=${encodeURIComponent(kinds.join(','))}` : '';
  return apiFetch(`${base()}/masters${q}`, opts);
};
export const createOrgMaster = (kind, name, data = {}) =>
  apiFetch(`${base()}/masters`, { method: 'POST', body: { kind, name, data }, ...opts });
export const updateOrgMaster = (id, patch) =>
  apiFetch(`${base()}/masters/${id}`, { method: 'PATCH', body: patch, ...opts });
export const deleteOrgMaster = (id) => apiFetch(`${base()}/masters/${id}`, { method: 'DELETE', ...opts });
