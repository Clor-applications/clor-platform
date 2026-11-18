/**
 * Round 28 picks, the parts that are plain rules (DESIGN.md, Round 28).
 *
 * - "haptic" B: two short buzzes for a punch in, one for a punch out, so the
 *   person feels which one was saved without looking at the screen.
 * - "otlimit" B: approving overtime that runs past the company's cap asks
 *   first, at the moment of approving, in plain words.
 * - "deldept" B: a department that still has people cannot be deleted; the
 *   menu says why and offers the people in it.
 */

/** The buzz for a saved punch: two for in, one for out. */
export const PUNCH_BUZZ = { IN: [70, 90, 70], OUT: [70] };

/** Buzz the phone for a saved punch, where the browser can. Never throws. */
export function buzzForPunch(kind, nav = typeof navigator !== 'undefined' ? navigator : null) {
  const pattern = PUNCH_BUZZ[kind];
  if (!pattern || !nav || typeof nav.vibrate !== 'function') return false;
  try {
    return nav.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}

/** The question asked before approving overtime past the cap, or null when it is within the cap. */
export function overCapQuestion(r) {
  if (!r || !r.overCapMinutes || !r.overCap) return null;
  const who = r.employeeName || 'This person';
  return {
    title: `Approve past the limit?`,
    message: `Approving this takes ${who} past the company’s overtime limit: ${r.overCap}.`,
    confirmLabel: 'Approve anyway',
  };
}

/** What the Delete item says for an organisation item that still has people in it. */
export function blockedDelete(name, count, singular = 'department') {
  const n = Number(count) || 0;
  const people = `${n} ${n === 1 ? 'person is' : 'people are'}`;
  return {
    title: `${name} cannot be deleted yet`,
    message: `${people} in ${name}. Move them to another ${singular} first, or retire it to keep it in the history.`,
    confirmLabel: n === 1 ? 'See the 1 person' : `See the ${n} people`,
  };
}
