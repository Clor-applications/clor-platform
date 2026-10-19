import { confirmDialog, notify } from '@ui/components/ui/notify';
import { checkSchedule } from '../api/attendance';

const range = (from, to) => (to ? `${from} to ${to}` : `from ${from}`);

/**
 * Ask the server what a schedule change would do before saving it, and let
 * the person decide when it clashes with or replaces something. Returns true
 * to go ahead. If the check itself fails the save is not blocked — the server
 * still validates the save — but the person is told.
 */
export async function confirmScheduleChange(body) {
  let r;
  try {
    r = await checkSchedule(body);
  } catch (e) {
    notify.error(`Could not check for clashes (${String(e?.message || e)}); saving anyway.`);
    return true;
  }
  const people = r?.people || [];
  if (!people.length) return true;
  const lines = [];
  for (const p of people.slice(0, 8)) {
    for (const f of p.findings.slice(0, 3)) {
      const who = p.name || 'This department';
      if (f.level === 'CONFLICT') lines.push(`${who}: clashes with ${f.shift} ${range(f.from, f.to)}; only one can apply.`);
      else if (f.level === 'REPLACES') lines.push(`${who}: replaces ${f.shift} ${range(f.from, f.to)}.`);
      else lines.push(`${who}: a temporary ${f.shift} still applies ${range(f.from, f.to)}.`);
    }
  }
  if (people.length > 8) lines.push(`…and ${people.length - 8} more.`);
  const night = r.shift?.crossesMidnight ? ` ${r.shift.name} ends the next morning; its day belongs to the date it starts.` : '';
  return confirmDialog({
    title: r.conflicts ? `${r.conflicts} clash${r.conflicts === 1 ? '' : 'es'} with existing schedules` : 'This changes existing schedules',
    message: `${lines.join(' ')}${night}`,
    confirmLabel: r.conflicts ? 'Save anyway' : 'Save',
    tone: r.conflicts ? 'danger' : 'default',
  });
}
