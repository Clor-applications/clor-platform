import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { gstinStateCode, isValidGstinChecksum, isValidGstinFormat } from '../../utils/gstin.js';
import { CLOR_STATE_CODE, type GstStanding } from './engine.js';

/**
 * CLOR's GST standing as a seller, kept as the platform setting `billing.gst`:
 * `{ registered: boolean, gstin: string | null }`.
 *
 * Until CLOR has a GSTIN nothing is charged: no row, a row saying
 * registered false, or a row saying registered true without a valid GSTIN
 * all read as not registered. CLOR's state for CGST + SGST against IGST comes
 * from the GSTIN itself, so the two cannot disagree.
 */
export const GST_SETTING_KEY = 'billing.gst';

export type GstSetting = GstStanding & { gstin: string | null };

export function readGstSetting(value: unknown): GstSetting {
  const v = (value && typeof value === 'object' ? value : {}) as {
    registered?: unknown;
    gstin?: unknown;
  };
  const gstin = typeof v.gstin === 'string' ? v.gstin.trim().toUpperCase() : '';
  const valid = Boolean(gstin) && isValidGstinFormat(gstin) && isValidGstinChecksum(gstin);
  if (v.registered !== true || !valid)
    return {
      registered: false,
      gstin: valid ? gstin : null,
      sellerStateCode: CLOR_STATE_CODE,
    };
  return { registered: true, gstin, sellerStateCode: gstinStateCode(gstin) };
}

export async function gstSetting(): Promise<GstSetting> {
  const row = await outsideTenant('pricing: CLOR’s GST standing', () =>
    platformPrisma.platformSetting.findUnique({
      where: { key: GST_SETTING_KEY },
    }),
  );
  return readGstSetting(row?.value);
}
