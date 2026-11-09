import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { deriveStateCodeFromInput, gstinStateCode, isValidGstinChecksum, isValidGstinFormat } from '../../utils/gstin.js';
import { DEFAULT_GST_RATE, type GstStanding } from './engine.js';

/**
 * CLOR's GST standing as a seller: the platform setting `billing.gst`, set in
 * the operator console (Settings, Tax).
 *
 *   { registered, gstin, legalName, stateCode, sac, ratePercent }
 *
 * Until CLOR is registered nothing is charged. A stored row that says
 * registered but whose GSTIN does not check out reads as not registered, so a
 * bad row can never put a wrong tax line on a quote. CLOR's state for CGST +
 * SGST against IGST is the GSTIN's own.
 */
export const GST_SETTING_KEY = 'billing.gst';
export const GST_RATES = [0, 5, 12, 18, 28];

export type TaxSetting = GstStanding & {
  gstin: string | null;
  legalName: string | null;
  stateCode: string | null;
  sac: string | null;
  ratePercent: number;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const validGstin = (g: string | null): g is string => Boolean(g) && isValidGstinFormat(g as string) && isValidGstinChecksum(g as string);

export function readTaxSetting(value: unknown): TaxSetting {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const gstin = str(v.gstin)?.toUpperCase() ?? null;
  const rate = GST_RATES.includes(Number(v.ratePercent)) ? Number(v.ratePercent) : DEFAULT_GST_RATE;
  const base = { gstin, legalName: str(v.legalName), stateCode: str(v.stateCode), sac: str(v.sac), ratePercent: rate };
  if (v.registered !== true || !validGstin(gstin)) return { ...base, registered: false, sellerStateCode: base.stateCode };
  return { ...base, registered: true, sellerStateCode: gstinStateCode(gstin) };
}

export async function taxSetting(): Promise<TaxSetting> {
  const row = await outsideTenant('pricing: CLOR’s GST standing', () => platformPrisma.platformSetting.findUnique({ where: { key: GST_SETTING_KEY } }));
  return readTaxSetting(row?.value);
}

export type TaxInput = { registered: boolean; gstin?: string | null; legalName?: string | null; state?: string | null; sac?: string | null; ratePercent?: number | null };

/** Check what an operator typed: the value to store, or the problems in plain words. */
export function checkTaxInput(input: TaxInput): { value: Record<string, unknown>; problems: string[] } {
  const problems: string[] = [];
  const gstin = str(input.gstin)?.toUpperCase() ?? null;
  const legalName = str(input.legalName);
  const stateCode = input.state ? deriveStateCodeFromInput(input.state) || null : null;
  const sac = str(input.sac);
  const ratePercent = input.ratePercent == null ? DEFAULT_GST_RATE : Number(input.ratePercent);
  if (input.state && !stateCode) problems.push('Choose a state from the list.');
  if (gstin && !validGstin(gstin)) problems.push('That GSTIN is not right: check the 15 characters.');
  if (sac && !/^\d{4,8}$/.test(sac)) problems.push('A SAC code is 4 to 8 digits, like 998314.');
  if (!GST_RATES.includes(ratePercent)) problems.push('The rate is one of 0, 5, 12, 18 or 28 percent.');
  if (legalName && legalName.length > 160) problems.push('Keep the legal name under 160 characters.');
  if (input.registered) {
    if (!gstin) problems.push('Enter CLOR’s GSTIN to charge GST.');
    if (!legalName) problems.push('Enter the legal name on the GST registration.');
    if (!sac) problems.push('Enter the SAC code for CLOR’s services.');
    if (validGstin(gstin) && stateCode && gstinStateCode(gstin) !== stateCode) problems.push('The state does not match the GSTIN: its first two digits are the state code.');
  }
  return { value: { registered: Boolean(input.registered), gstin, legalName, stateCode: stateCode || (validGstin(gstin) ? gstinStateCode(gstin) : null), sac, ratePercent }, problems };
}
