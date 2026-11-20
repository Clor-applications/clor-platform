/**
 * The one source of a shift's colour, for every screen that draws a shift: the
 * colour picked on the shift, or else its place among the company's shifts from
 * the chart series tokens (--dept-1..8).
 *
 * A shift is drawn as ink on a soft tint of its colour, never white words on the
 * raw colour: a user can pick a light colour, and white on it cannot be read.
 */
export const shiftHue = (shift, index = 0) => (shift?.color ? shift.color : `rgb(var(--dept-${(Math.max(0, index) % 8) + 1}))`);

export const shiftChip = (hue) => ({
  backgroundColor: `color-mix(in srgb, ${hue} 16%, rgb(var(--surface)))`,
  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} 45%, transparent)`,
  color: 'rgb(var(--fg))',
});

/** A map of shift id to its colour, for a list of shifts. */
export const shiftHues = (shifts = []) => new Map(shifts.map((s, i) => [s.id, shiftHue(s, i)]));
