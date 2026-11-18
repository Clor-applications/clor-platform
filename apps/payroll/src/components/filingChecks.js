/**
 * The check list before a statutory download (round 26 ECR and round 44 ESIC
 * picks): "82 ready · 2 without UAN", from the server's `checklist`.
 */

const KIND_WORDS = {
  NO_UAN: 'without a UAN',
  BAD_UAN: 'with a UAN that is not 12 digits',
  NO_IP: 'without an ESI IP number',
  BAD_IP: 'with an IP number that is not 10 digits',
};

/** "82 ready · 2 without a UAN", or "Nobody ready" when the file would be empty. */
export function checklistLine(checklist) {
  if (!checklist) return '';
  const ready = Number(checklist.ready) || 0;
  const parts = [ready ? `${ready} ready` : 'Nobody ready'];
  for (const [kind, n] of Object.entries(checklist.byKind || {})) {
    const words = KIND_WORDS[kind];
    if (words && n > 0) parts.push(`${n} ${words}`);
  }
  return parts.join(' · ');
}

/** The ESIC monthly contribution template's columns, in its order. */
export const ESIC_COLUMNS = [
  'IP Number (10 Digits)',
  'IP Name ( Only alphabets and space )',
  'No of Days for which wages paid/payable during the month',
  'Total Monthly Wages',
  'Reason Code for Zero workings days(numeric only; provide 0 for all other reasons- Click on the link for reference)',
  'Last Working Day ( Format DD/MM/YYYY  or DD-MM-YYYY)',
];

/** One row of the ESIC template: the reason only when nobody was paid for a day or the person left. */
export const esicRow = (r) => [
  String(r.ipNumber || ''),
  String(r.name || '').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim(),
  Number(r.days) || 0,
  Math.round(Number(r.wages) || 0),
  Number(r.days) > 0 && !r.lastWorkingDay ? 0 : Number(r.reason) || 0,
  String(r.lastWorkingDay || ''),
];

/** The rupees still to deposit for a month, or what was over-deposited. */
export const leftWords = (left) => (left > 0 ? 'to deposit' : left < 0 ? 'more than deducted' : '');
