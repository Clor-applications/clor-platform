/**
 * Countries for an address, without a third-party data package.
 *
 * The country list used to come from `country-state-city`, which is GPL-3.0:
 * shipping it in the web bundle and the Android apps could oblige CLOR to
 * publish its own source. The ISO 3166-1 codes are facts, and the browser
 * already knows every country's English name (Intl.DisplayNames), so neither
 * needs a licence. Indian states come from the GST state list the form already
 * has; other countries' states and every city are typed.
 */
const ISO_3166_1 = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

let cached = null;

/** Every country as `{ isoCode, name }`, by English name. */
export function allCountries() {
  if (cached) return cached;
  let names = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    /* A runtime without Intl.DisplayNames still gets India, which is what most addresses are. */
  }
  cached = names
    ? ISO_3166_1.map((isoCode) => ({ isoCode, name: names.of(isoCode) || isoCode })).sort((a, b) => a.name.localeCompare(b.name))
    : [{ isoCode: 'IN', name: 'India' }];
  return cached;
}
