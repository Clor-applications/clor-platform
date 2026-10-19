/**
 * What CLOR may honestly say about a reader. Support is claimed per driver and,
 * once tested, per model and firmware — never by brand logo alone.
 *
 *   CERTIFIED              a model + firmware passed CLOR's test list, recorded below
 *   COMPATIBLE             works in use on some models; the exact models are not recorded yet
 *   INTEGRATION_AVAILABLE  a driver exists from the vendor's documents; no hardware tested
 *   UNDER_INVESTIGATION    a customer has it; its protocol is being found out
 *   UNSUPPORTED            no way in without hardware or an SDK licence CLOR does not have
 *
 * The test list is the biometric compatibility research's T-01 … T-14. A model
 * becomes CERTIFIED only by adding an entry to CERTIFIED with the date, the
 * firmware and the evidence — the in-app checklist (readerChecklist) gathers
 * most of that evidence from a live reader.
 */
export type Support = 'CERTIFIED' | 'COMPATIBLE' | 'INTEGRATION_AVAILABLE' | 'UNDER_INVESTIGATION' | 'UNSUPPORTED';

export const SUPPORT_LABEL: Record<Support, string> = {
  CERTIFIED: 'Certified',
  COMPATIBLE: 'Compatible',
  INTEGRATION_AVAILABLE: 'Integration available',
  UNDER_INVESTIGATION: 'Under investigation',
  UNSUPPORTED: 'Unsupported',
};

export const TESTS: Array<{ id: string; label: string }> = [
  { id: 'T-01', label: 'Exact model and firmware recorded' },
  { id: 'T-02', label: 'Only this company’s reader is accepted' },
  { id: 'T-03', label: 'A live punch arrives' },
  { id: 'T-04', label: 'Past punches can be fetched again' },
  { id: 'T-05', label: 'A resent punch is not counted twice' },
  { id: 'T-06', label: 'Punches made while offline arrive later' },
  { id: 'T-07', label: 'The reader’s clock error is measured' },
  { id: 'T-08', label: 'Time zone is set' },
  { id: 'T-09', label: 'A night shift lands on the right day' },
  { id: 'T-10', label: 'IDs map per site' },
  { id: 'T-11', label: 'Punches without in/out are paired' },
  { id: 'T-12', label: 'Reader health is watched' },
  { id: 'T-13', label: 'Every change is in the audit trail' },
  { id: 'T-14', label: 'No vendor SDK licence needed' },
];

/** What each driver is, honestly. */
export const DRIVER_SUPPORT: Record<string, { support: Support; note: string }> = {
  ADMS: { support: 'COMPATIBLE', note: 'In use with ZKTeco and eSSL readers that have a "Cloud server / ADMS" setting. Exact models and firmware are recorded as they are certified.' },
  ETIMEOFFICE: { support: 'COMPATIBLE', note: 'eSSL’s e-Time Office cloud, in use.' },
  HTTP_PUSH: { support: 'INTEGRATION_AVAILABLE', note: 'Any reader or software that can post to a URL; you map the fields.' },
  HTTP_PULL: { support: 'INTEGRATION_AVAILABLE', note: 'Any software with a JSON API; you map the fields.' },
  FILE: { support: 'INTEGRATION_AVAILABLE', note: 'A CSV export from any reader or attendance software.' },
  API: { support: 'INTEGRATION_AVAILABLE', note: 'Punches sent with an API key.' },
  HIKVISION: { support: 'INTEGRATION_AVAILABLE', note: 'Built from Hikvision’s ISAPI guide; not yet tested on a terminal.' },
  HIKVISION_PUSH: { support: 'INTEGRATION_AVAILABLE', note: 'Built from Hikvision’s ISAPI guide; not yet tested on a terminal.' },
  DAHUA: { support: 'INTEGRATION_AVAILABLE', note: 'Built from Dahua’s HTTP interface; not yet tested on a controller.' },
  BIOSTAR: { support: 'INTEGRATION_AVAILABLE', note: 'Suprema BioStar 2 server API; not yet tested. BioStar X and Air are different APIs.' },
  ANVIZ_CLOUD: { support: 'INTEGRATION_AVAILABLE', note: 'Anviz CrossChex Cloud API; not yet tested.' },
  MATRIX_COSEC: { support: 'INTEGRATION_AVAILABLE', note: 'Matrix COSEC controller push; not yet tested.' },
};

/** Brands and kinds of device asked about, and what CLOR can say. */
export const CATALOGUE: Array<{ name: string; support: Support; route: string; note: string }> = [
  { name: 'ZKTeco (cloud / ADMS setting)', support: 'COMPATIBLE', route: 'Push reader (ADMS)', note: 'Models without a cloud setting talk only on the office network: not supported yet.' },
  { name: 'eSSL (ADMS models, e-Time Office)', support: 'COMPATIBLE', route: 'Push reader (ADMS) or e-Time Office', note: '' },
  { name: 'Hikvision access terminals', support: 'INTEGRATION_AVAILABLE', route: 'Hikvision (pull or push)', note: '' },
  { name: 'Suprema BioStar 2', support: 'INTEGRATION_AVAILABLE', route: 'BioStar 2 server', note: '' },
  { name: 'Dahua access controllers', support: 'INTEGRATION_AVAILABLE', route: 'Dahua', note: '' },
  { name: 'Anviz CrossChex Cloud', support: 'INTEGRATION_AVAILABLE', route: 'Anviz CrossChex Cloud', note: '' },
  { name: 'Matrix COSEC', support: 'INTEGRATION_AVAILABLE', route: 'Matrix COSEC push', note: '' },
  { name: 'Realtime, Biomax, Identix, BioEnable and other rebrands', support: 'UNDER_INVESTIGATION', route: 'Try Push reader (ADMS) if it has a cloud server setting; else File import', note: 'The brand does not tell the protocol; it is checked per model.' },
  { name: 'Bio-Park B100 / B200', support: 'UNDER_INVESTIGATION', route: 'Any HTTP push (to capture what it sends), else File import', note: 'First customer pilot.' },
  { name: 'Mantra, Startek, SecuGen USB scanners', support: 'UNSUPPORTED', route: '—', note: 'USB fingerprint scanners for Aadhaar-style capture are not attendance terminals.' },
  { name: 'Virdi, FingerTec BioBridge, IDEMIA, Nitgen', support: 'UNSUPPORTED', route: 'File import meanwhile', note: 'Need a Windows vendor SDK and its licence.' },
  { name: 'Wiegand / OSDP readers on their own', support: 'UNSUPPORTED', route: 'Through their controller', note: 'They keep no punch history of their own.' },
];

/** Model + firmware combinations that passed every test, with the evidence. Empty until the first is certified. */
export const CERTIFIED: Array<{ vendor: string; model: RegExp; firmware?: RegExp; date: string; tests: string[]; evidence: string }> = [];

export function supportOf(vendor: string | null | undefined, model?: string | null, firmware?: string | null) {
  const v = String(vendor || 'ADMS');
  const hit = CERTIFIED.find((c) => c.vendor === v && model && c.model.test(model) && (!c.firmware || (firmware && c.firmware.test(firmware))));
  if (hit) return { support: 'CERTIFIED' as Support, label: SUPPORT_LABEL.CERTIFIED, note: `Certified ${hit.date} on this model and firmware.` };
  const d = DRIVER_SUPPORT[v] || { support: 'INTEGRATION_AVAILABLE' as Support, note: '' };
  return { support: d.support, label: SUPPORT_LABEL[d.support], note: d.note };
}
