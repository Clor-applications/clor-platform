import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { isValidGstinChecksum, isValidGstinFormat, gstinStateCode } from '../utils/gstin.js';

/**
 * GSTIN lookup — "fetch from the GST portal".
 *
 * The portal's own taxpayer search sits behind a captcha, so a real lookup goes
 * through a GST Suvidha Provider. Point GSTIN_LOOKUP_URL at yours ({gstin} is
 * substituted, or appended) and, if it needs one, set GSTIN_LOOKUP_KEY and
 * GSTIN_LOOKUP_KEY_HEADER.
 *
 * Without a provider configured this still answers, with the facts the GSTIN
 * itself encodes — state and PAN — and says so in `source`, so the form can
 * fill what it honestly knows instead of inventing a name and an address.
 */

const STATE_BY_CODE: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory',
};

/** Whatever shape the provider answers with, the form wants these fields. */
const pick = (row: any, keys: string[]): string => {
  for (const k of keys) {
    const parts = k.split('.');
    let cur: any = row;
    for (const p of parts) cur = cur?.[p];
    const v = String(cur ?? '').trim();
    if (v) return v;
  }
  return '';
};

const mapProviderResponse = (raw: any) => {
  const row = raw?.data ?? raw?.result ?? raw ?? {};
  const addr =
    row?.pradr?.addr ?? row?.principalAddress?.address ?? row?.address ?? row?.primaryAddress ?? {};

  const line = [
    pick(addr, ['bno', 'buildingNumber', 'doorNumber']),
    pick(addr, ['bnm', 'buildingName']),
    pick(addr, ['flno', 'floorNumber']),
    pick(addr, ['st', 'street']),
    pick(addr, ['loc', 'location', 'locality']),
  ]
    .filter(Boolean)
    .join(', ');

  const line1 = line || pick(addr, ['adr', 'fullAddress']);
  const city = pick(addr, ['city', 'dst', 'district']);
  const district = pick(addr, ['dst', 'district']);
  const state = pick(addr, ['stcd', 'state', 'stateName']);
  const pincode = pick(addr, ['pncd', 'pincode', 'zip']);

  return {
    legalName: pick(row, ['lgnm', 'legalName', 'legal_name', 'name']),
    tradeName: pick(row, ['tradeNam', 'tradeName', 'trade_name']),
    status: pick(row, ['sts', 'status', 'gstinStatus']),
    taxpayerType: pick(row, ['dty', 'taxpayerType', 'dealerType']),
    registrationDate: pick(row, ['rgdt', 'registrationDate', 'regDate']),
    constitution: pick(row, ['ctb', 'constitutionOfBusiness', 'businessConstitution']),

    /*
     * The address, nested, and the same flat fields kept beside it.
     *
     * Three forms read this and two of them read a nested `address` that was
     * never returned, so the portal fill silently did nothing on the company
     * and customer forms while working on vendors. Nested is the shape they now
     * agree on; the flat keys stay so nothing that already reads them breaks.
     */
    address: { line1, line2: '', city, district, state, pincode },
    addressLine: line1,
    city,
    district,
    state,
    pincode,
  };
};

/*
 * A short cache in front of the provider.
 *
 * These lookups are usually billed per call, and a person correcting a typo in
 * a form will press the button three times in a minute. A GSTIN's registered
 * details do not change on that timescale.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

const cached = (gstin: string) => {
  const hit = cache.get(gstin);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(gstin);
    return null;
  }
  return hit.body;
};

export const gstinRouter = Router();

gstinRouter.get('/gstin/:gstin', requireAuth, async (req, res) => {
  const gstin = String(req.params.gstin || '').trim().toUpperCase();

  if (!isValidGstinFormat(gstin)) {
    return res.status(400).json({ error: 'That is not a valid GSTIN — it should be 15 characters.' });
  }
  if (!isValidGstinChecksum(gstin)) {
    return res.status(400).json({ error: 'That GSTIN fails its own check digit — please re-read it.' });
  }

  const stateCode = gstinStateCode(gstin);
  const derived = {
    gstin,
    pan: gstin.slice(2, 12),
    state: STATE_BY_CODE[stateCode] || '',
    stateCode,
  };

  const fromCache = cached(gstin);
  if (fromCache) return res.json(fromCache);

  const url = String(process.env.GSTIN_LOOKUP_URL || '').trim();
  if (!url) {
    return res.json({
      ...derived,
      source: 'derived',
      note: 'Portal lookup is not configured, so only what the GSTIN itself encodes was filled.',
    });
  }

  const endpoint = url.includes('{gstin}') ? url.replace('{gstin}', gstin) : `${url.replace(/\/$/, '')}/${gstin}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = String(process.env.GSTIN_LOOKUP_KEY || '').trim();
  if (key) headers[String(process.env.GSTIN_LOOKUP_KEY_HEADER || 'Authorization')] = key;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const upstream = await fetch(endpoint, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res.status(502).json({
        ...derived,
        source: 'derived',
        error: `The GST lookup service answered ${upstream.status}.`,
      });
    }

    const raw = await upstream.json();
    const mapped = mapProviderResponse(raw);
    const body = {
      ...derived,
      ...mapped,
      /*
       * The state the NUMBER encodes wins over the one the provider reports.
       * They should agree; where they do not, the first two digits are the
       * fact and everything downstream — CGST/SGST against IGST — is decided
       * by them.
       */
      state: derived.state || mapped.state,
      source: 'portal',
    };
    cache.set(gstin, { at: Date.now(), body });
    return res.json(body);
  } catch (err: any) {
    const aborted = String(err?.name || '') === 'AbortError';
    return res.status(502).json({
      ...derived,
      source: 'derived',
      error: aborted ? 'The GST lookup service timed out.' : 'The GST lookup service could not be reached.',
    });
  }
});
