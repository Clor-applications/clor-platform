/*
 * The price list on clor.in comes from the operator console and nowhere else
 * (server: routes/pricing.ts, GET /api/public/pricing). The build fetches it
 * (scripts/fetch-pricing.mjs) so /pricing is prerendered with it; the page
 * asks again in the browser, so a publish shows without a rebuild. Nothing
 * published, or nothing reachable at build time: no prices, and the page
 * offers Request a demo instead.
 */
const built = import.meta.glob('./data/pricing.live.json', { eager: true, import: 'default' });
const first = Object.values(built)[0];
/** What the build saw: a price list, or null. */
export const BUILT_PRICING = first && !first.none && Array.isArray(first.plans) ? first : null;

/** Whether the book's own note says the prices are not final yet. */
export const provisional = (p) => /sample|mock|not final|draft/i.test(String(p?.note || ''));

/** ₹1,23,456.50 the Indian way; whole rupees drop the paise. */
const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const RUPEES_PAISE = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export function inr(paise) {
  const abs = Math.abs(Number(paise) || 0);
  return (abs % 100 ? RUPEES_PAISE : RUPEES).format(abs / 100);
}

export const UNIT = { COMPANY: ['company', 'companies'], USER: ['user', 'users'], EMPLOYEE: ['employee', 'employees'] };
