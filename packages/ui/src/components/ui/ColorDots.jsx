import React from 'react';

/**
 * A label colour chosen from a row of dots (owner's round 12 pick). A fixed
 * set keeps calendars and rosters readable side by side. Each dot is a radio
 * named by its colour, so a screen reader hears "Magenta, selected". A colour
 * saved before this set existed still shows, as an extra dot at the end.
 */
export const LABEL_COLOURS = [
  ['#A21CAF', 'Magenta'],
  ['#006A9E', 'Blue'],
  ['#0F766E', 'Teal'],
  ['#16845B', 'Green'],
  ['#A85A00', 'Amber'],
  ['#C2410C', 'Orange'],
  ['#B42318', 'Red'],
  ['#6D28D9', 'Violet'],
  ['#475569', 'Slate'],
];

export default function ColorDots({ value, onChange, label = 'Colour', name = 'label-colour' }) {
  const v = String(value || '').toUpperCase();
  const known = LABEL_COLOURS.some(([c]) => c === v);
  const list = known || !v ? LABEL_COLOURS : [...LABEL_COLOURS, [v, 'Current colour']];
  return (
    <fieldset className="ui-color-dots">
      <legend className="ui-label">{label}</legend>
      <div className="ui-color-dots-row">
        {list.map(([c, n]) => (
          <label key={c} className="ui-color-dot" style={{ '--dot': c }} title={n}>
            <input type="radio" name={name} value={c} checked={v === c} onChange={() => onChange(c)} aria-label={n} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
