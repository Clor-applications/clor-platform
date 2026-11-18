/*
 * Server picks batch 2 (payroll lines). Plain helpers shared by Payroll and the employee app:
 * - count × rate on a payslip line: canteen meals (round 24), pieces made (round 27), night shifts (round 21).
 * - a salary changed inside the month, split by days on the payslip (round 54).
 * - a note for next month's payroll (round 32) and an ask to skip a loan instalment (round 54) read their words from here.
 */

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Units offered when typing what was counted. */
export const COUNT_UNITS = ['meal', 'piece', 'night', 'day', 'hour', 'trip', 'visit'];

/** "meal" → "meals" for any count but one. */
export function plural(unit, count) {
  const u = String(unit || '').trim();
  if (!u) return '';
  if (Number(count) === 1) return u;
  if (/(s|x|ch|sh)$/i.test(u)) return `${u}es`;
  if (/[^aeiou]y$/i.test(u)) return `${u.slice(0, -1)}ies`;
  return `${u}s`;
}

/** "22 meals × ₹30", or "" when the line is a plain amount. */
export function countWords(line) {
  if (!line || line.quantity == null || line.rate == null) return '';
  const q = Number(line.quantity);
  const count = Number.isInteger(q) ? String(q) : q.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const unit = plural(line.unit, q);
  return `${count}${unit ? ` ${unit}` : ''} × ${rupees(line.rate)}`;
}

/** Count × rate to the paisa, as the server works it out. */
export function countAmount(quantity, rate) {
  const q = Number(quantity);
  const r = Number(rate);
  if (!(q > 0) || !(r > 0)) return 0;
  return Math.round(q * r * 100) / 100;
}

const dayWords = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/**
 * The salary changed inside the month: one line per salary, "10 days from 1 Apr at ₹50,000 a month".
 * Empty when one salary covered the month.
 */
export function splitLines(split) {
  if (!Array.isArray(split) || split.length < 2) return [];
  return split.map((p) => `${p.days} ${p.days === 1 ? 'day' : 'days'} from ${dayWords(p.from)} at ${rupees(p.monthly)} a month`);
}

export const SPLIT_TITLE = 'Salary changed this month';
export const SPLIT_NOTE = 'Each day is paid at the salary in force that day.';

export const NEXT_NOTE_LABEL = 'Note for next month';
export const NEXT_NOTE_HINT = 'Shown at the top of next month’s payroll for the same group.';

/** "From March's payroll (PR-0003): …" */
export function earlierNoteTitle(note) {
  if (!note) return '';
  return `From ${note.period ? `${note.period}’s` : 'last month’s'} payroll${note.runNumber ? ` (${note.runNumber})` : ''}`;
}

export const SKIP_ASK_HINT = 'HR decides. If they agree, this month is skipped and the loan runs a month longer.';
