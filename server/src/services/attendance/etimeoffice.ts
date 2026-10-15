/**
 * eSSL e-Time Office — the vendor's cloud, which eSSL readers sync to. CLOR
 * pulls punches from its API on a timer, the way Horilla's biometric module
 * does (biometric/etimeoffice.py; reference only, no code copied):
 *
 *   GET {base}/DownloadPunchData?Empcode=ALL&FromDate=dd/mm/yyyy_HH:MM&ToDate=dd/mm/yyyy_HH:MM
 *   Authorization: Basic …
 *   → { Error: false, Msg: "Success", PunchData: [{ Empcode, Name, PunchDate: "dd/mm/yyyy HH:mm:ss", … }] }
 *
 * The Basic credentials: Horilla sends "username:password". eSSL's own guides
 * describe "corporateId:username:password:true"; with a Corporate ID set, that
 * form is used. "Test connection" shows which one an account accepts.
 *
 * Times are the reader's wall clock, IST, as with ADMS.
 */

export const ETO_DEFAULT_URL = 'https://api.etimeoffice.com/api/';

export type EtoCredentials = { apiUrl?: string | null; corporateId?: string | null; username: string; password: string };

export const etoAuthHeader = (c: EtoCredentials) => {
  const raw = c.corporateId ? `${c.corporateId}:${c.username}:${c.password}:true` : `${c.username}:${c.password}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
};

/** An instant as e-Time Office wants it: IST wall clock, "dd/mm/yyyy_HH:MM". */
export const etoDate = (at: Date) => {
  const ist = new Date(at.getTime() + 330 * 60_000).toISOString();
  return `${ist.slice(8, 10)}/${ist.slice(5, 7)}/${ist.slice(0, 4)}_${ist.slice(11, 16)}`;
};

/** "14/10/2026 09:05:12" → "2026-10-14 09:05:12" (the ADMS local-time shape). */
export const etoPunchTime = (s: unknown) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6] || '00'}` : null;
};

export type EtoResult = { ok: boolean; message: string; punches: Array<{ pin: string; localTime: string; name: string | null }> };

export async function etoFetchPunches(c: EtoCredentials, from: Date, to: Date, fetchImpl: typeof fetch = fetch): Promise<EtoResult> {
  const base = String(c.apiUrl || ETO_DEFAULT_URL).replace(/\/+$/, '') + '/';
  const url = `${base}DownloadPunchData?Empcode=ALL&FromDate=${encodeURIComponent(etoDate(from))}&ToDate=${encodeURIComponent(etoDate(to))}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: etoAuthHeader(c), Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  } catch (e: any) {
    return { ok: false, message: `Could not reach e-Time Office: ${e?.message || e}`, punches: [] };
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: `e-Time Office answered ${res.status} without data.`, punches: [] };
  }
  if (!res.ok || body?.Error === true || (body?.Msg && body.Msg !== 'Success')) {
    return { ok: false, message: String(body?.Msg || body?.Message || `e-Time Office answered ${res.status}.`).slice(0, 300), punches: [] };
  }
  const punches = (Array.isArray(body?.PunchData) ? body.PunchData : [])
    .map((p: any) => ({ pin: String(p?.Empcode ?? '').trim(), localTime: etoPunchTime(p?.PunchDate), name: p?.Name ? String(p.Name) : null }))
    .filter((p: any) => p.pin && p.localTime);
  return { ok: true, message: 'Success', punches };
}
