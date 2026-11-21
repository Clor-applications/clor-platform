import { orgId as platformOrgId } from '@platform/context';

/**
 * One rounding rule, in one place.
 *
 * There were five definitions of `round2` in the browser alone and nine more
 * on the server, in two versions that disagree: `Math.round(n * 100) / 100`
 * makes ₹1.005 into ₹1.00, and the variant with `Number.EPSILON` makes it
 * ₹1.01. Which one an amount met depended on which file computed it — so a
 * figure could be rounded two ways between a form and its ledger entry, and
 * the two could differ by a paisa. A ledger out by a paisa is not a rounding
 * difference; it is an entry that does not balance.
 *
 * The rule is the one a person with a pen uses: half away from zero, at the
 * paisa. `Math.round` cannot express it — it rounds a half toward positive
 * infinity, so −0.5 becomes −0 — and it cannot see through binary
 * representation, where 1.005 * 100 is 100.49999999999999.
 *
 * It is the same rule, written the same way, as server/src/utils/money.ts.
 * Two languages, one arithmetic.
 */

/** Below this, a difference is binary representation rather than money. */
const BINARY_SLOP = 1e-9;

/** Rupees to whole paise, where addition is exact. */
export const toPaise = (rupees) => {
  const x = Number(rupees);
  if (!Number.isFinite(x)) return 0;
  const scaled = x * 100;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + BINARY_SLOP);
};

/** Paise back to rupees, for a field, a total or the API. */
export const fromPaise = (paise) => {
  const p = Number(paise);
  if (!Number.isFinite(p)) return 0;
  return Math.trunc(p) / 100;
};

/** A rupee amount, rounded to the paisa. The only rounding in the app. */
export const round2 = (n) => fromPaise(toPaise(n));

/**
 * A total that does not drift.
 *
 * 0.1 + 0.2 is 0.30000000000000004, and a hundred invoice lines can land a few
 * paise from where they belong. Summed as integers, they cannot.
 */
export const sumMoney = (values) => {
  let paise = 0;
  for (const v of values || []) paise += toPaise(v);
  return fromPaise(paise);
};

/** Exact equality at the paisa, which `===` on floats is not. */
export const moneyEquals = (a, b) => toPaise(a) === toPaise(b);

/**
 * Split an amount by weights so the parts add back to the whole.
 *
 * Rounding each share on its own loses or invents a paisa — ₹10 three ways is
 * ₹3.33 three times, which is ₹9.99. The remainder goes out a paisa at a time,
 * largest fractional part first, so a GST split always foots.
 */
export const allocate = (total, weights) => {
  const totalPaise = toPaise(total);
  const w = (weights || []).map((x) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const weightSum = w.reduce((t, n) => t + n, 0);
  if (!weightSum || !totalPaise) return w.map(() => 0);

  const exact = w.map((n) => (totalPaise * n) / weightSum);
  const out = exact.map((n) => Math.floor(n));
  let remainder = totalPaise - out.reduce((t, n) => t + n, 0);

  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out.map(fromPaise);
};

/*
 * How this company shows money and dates (currency, digit grouping, decimal
 * places, date order). Kept per company in the browser so a formatter with no
 * company object in reach still shows the company's own format.
 */
const activeSettingsKey = () => {
  if (typeof localStorage === 'undefined') return '';
  const orgId = String(platformOrgId() || '').trim();
  return orgId ? `companyDisplaySettings:${orgId}` : '';
};

let cachedDisplayKey = '';
let cachedDisplayRaw = '';
let cachedDisplayValue = {};

export const rememberCompanyDisplaySettings = (company) => {
  const key = activeSettingsKey();
  if (!key || !company) return;
  const settings = company?.profile?.companySettings || {};
  localStorage.setItem(key, JSON.stringify({
    baseCurrency: settings.baseCurrency || company.currency || 'INR',
    numberFormat: settings.numberFormat || '12,34,567.89',
    dateFormat: settings.dateFormat || 'DD-MM-YYYY',
    decimalPlaces: settings.decimalPlaces ?? 2,
  }));
};

export const getCompanyDisplaySettings = (company) => {
  if (company) return company?.profile?.companySettings || company || {};
  try {
    const key = activeSettingsKey();
    if (!key) return {};
    const raw = localStorage.getItem(key) || '{}';
    if (key !== cachedDisplayKey || raw !== cachedDisplayRaw) {
      cachedDisplayKey = key;
      cachedDisplayRaw = raw;
      cachedDisplayValue = JSON.parse(raw);
    }
    return cachedDisplayValue;
  } catch { return {}; }
};

export const getCurrencyCode = (company) => String(
  getCompanyDisplaySettings(company).baseCurrency || company?.currency || company?.baseCurrency || 'INR'
).toUpperCase();

export const getDecimalPlaces = (company) => {
  const value = Number(getCompanyDisplaySettings(company).decimalPlaces ?? 2);
  return Number.isInteger(value) && value >= 0 && value <= 4 ? value : 2;
};

export const getNumberLocale = (company) => ({
  '12,34,567.89': 'en-IN',
  '1,234,567.89': 'en-US',
  '1.234.567,89': 'de-DE',
})[getCompanyDisplaySettings(company).numberFormat] || 'en-IN';

export const formatMoney = (amount, company) => {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const currency = getCurrencyCode(company);

  try {
    return new Intl.NumberFormat(getNumberLocale(company), {
      style: 'currency',
      currency,
      minimumFractionDigits: getDecimalPlaces(company),
      maximumFractionDigits: getDecimalPlaces(company),
    }).format(safe);
  } catch {
    return `${currency} ${safe.toFixed(getDecimalPlaces(company))}`;
  }
};

/**
 * Compact money for KPI figures: ₹13.3L, ₹1.34Cr.
 *
 * A dashboard number is read at a glance, and eleven digits at 42px is a
 * number nobody reads — it is a number they measure. Indian units (lakh,
 * crore) rather than M/B, because that is how the figure gets said out loud
 * by the people using this. The exact amount stays available in the tables and
 * in the tooltip, so precision is never lost, only deferred.
 */
export const formatMoneyCompact = (amount, company) => {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);

  const symbol = (() => {
    try {
      return (
        new Intl.NumberFormat(getNumberLocale(company), { style: 'currency', currency: getCurrencyCode(company) })
          .formatToParts(0)
          .find((p) => p.type === 'currency')?.value || '₹'
      );
    } catch {
      return '₹';
    }
  })();

  // Trim a trailing ".0" so 13.0L reads as 13L.
  const trim = (n, dp) => String(Number(n.toFixed(dp))).replace(/\.0$/, '');

  if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7, 2)}Cr`;
  if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5, 2)}L`;
  if (abs >= 1000) return `${sign}${symbol}${trim(abs / 1000, 1)}K`;
  return `${sign}${symbol}${trim(abs, 0)}`;
};

/**
 * Indian numbering, because "One Lakh Twenty One Thousand" is what a customer
 * here reads back to check the figure — "One Hundred Twenty One Thousand" is
 * the same number written for somebody else.
 */
const WORD_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const WORD_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const wordsUnder100 = (n) => (n < 20 ? WORD_ONES[n] : `${WORD_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${WORD_ONES[n % 10]}` : ''}`);
const wordsUnder1000 = (n) =>
  `${n > 99 ? `${WORD_ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${wordsUnder100(n % 100)}`;

export const amountInWordsInr = (value, company) => {
  const total = Number(value);
  if (!Number.isFinite(total)) return '';
  const negative = total < 0;
  const currency = getCurrencyCode(company);
  const places = getDecimalPlaces(company);
  const scale = 10 ** places;
  const minorTotal = Math.round(Math.abs(total) * scale);
  let majorAmount = Math.floor(minorTotal / scale);
  const minorAmount = minorTotal % scale;

  const parts = [];
  const groups = currency === 'INR'
    ? [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]
    : [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand']];
  groups.forEach(([size, name]) => {
    if (majorAmount >= size) {
      parts.push(`${wordsUnder1000(Math.floor(majorAmount / size))} ${name}`);
      majorAmount %= size;
    }
  });
  if (majorAmount) parts.push(wordsUnder1000(majorAmount));

  const body = parts.join(' ').replace(/\s+/g, ' ').trim() || 'Zero';
  const majorUnit = { INR: 'Rupees', USD: 'Dollars', EUR: 'Euros', GBP: 'Pounds', AED: 'Dirhams' }[currency] || currency;
  const minorUnit = { INR: 'Paise', USD: 'Cents', EUR: 'Cents', GBP: 'Pence', AED: 'Fils' }[currency] || 'minor units';
  const minorText = minorAmount
    ? places <= 2 ? ` and ${wordsUnder100(minorAmount)} ${minorUnit}` : ` and ${minorAmount}/${scale} ${minorUnit}`
    : '';
  return `${negative ? 'Minus ' : ''}${majorUnit} ${body}${minorText} Only`;
};

/*
 * Rupees for reading: ₹ and Indian grouping (₹1,23,456.5). Twenty screens
 * each wrote their own; these are the two the screens agreed on. A blank or
 * non-number amount shows as ₹0.
 */
/** Two decimals, or none when whole: ₹1,23,456.50 and ₹1,23,456 (never ₹1,23,456.5, audit 17 Nov 2026). */
/* An amount in a sentence or a field: ₹ in front, Indian grouping, always two decimals (DESIGN.md money rule). */
export const rupees = (n) => {
  const v = Number(n || 0);
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
/*
 * An amount in a table cell (DESIGN.md money rule; design audit S8/G5):
 * ₹ in front, Indian grouping, two decimals, a true minus (\u2212, not -), and
 * "—" when it is zero or missing. A balance that should read ₹0.00 passes
 * `{ zero: true }`. Pair it with the tabular, right-aligned cell classes.
 * In a sentence use `rupees`, which shows a zero as ₹0.00.
 */
export const moneyCell = (n, { zero = false } = {}) => {
  const v = Number(n);
  if (!Number.isFinite(v) || (Math.abs(v) < 0.005 && !zero)) return '—';
  const text = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v <= -0.005 ? '\u2212' : ''}₹${text}`;
};

/** To the rupee: ₹1,23,457 */
export const wholeRupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
