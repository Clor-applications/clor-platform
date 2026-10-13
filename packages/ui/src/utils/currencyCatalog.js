const FALLBACK_CODES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XOF','XPF','YER','ZAR','ZMW','ZWL'
];

const codes = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('currency')
  : FALLBACK_CODES;
const names = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'currency' })
  : null;

const symbolFor = (code) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((part) => part.type === 'currency')?.value || code;
  } catch {
    return code;
  }
};

export const CURRENCY_CATALOG = codes.map((code) => ({
  code,
  name: names?.of(code) || code,
  symbol: symbolFor(code),
  value: code,
  label: `${code} - ${names?.of(code) || code}`,
  searchText: `${code} ${names?.of(code) || code}`,
}));

export const currencyMeta = (code) => CURRENCY_CATALOG.find((entry) => entry.code === String(code || '').toUpperCase()) || null;
