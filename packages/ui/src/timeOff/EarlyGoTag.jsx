import React from 'react';

/**
 * Round 40, earlygo A: leaving before the shift ends gets its own tag on the
 * day, drawn like the late mark beside it. The server already works out
 * `earlyOutMinutes` for every day; until now it only showed as a bare "120m"
 * in a column most screens hide.
 */
export function earlyGoText(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return '';
  if (m < 60) return `Left ${m} min early`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `Left ${h}h ${rest}m early` : `Left ${h}h early`;
}

export default function EarlyGoTag({ minutes, block = false }) {
  const text = earlyGoText(minutes);
  if (!text) return null;
  const tag = <span className="ui-late-tag ui-early-tag">{text}</span>;
  return block ? <span className="block">{tag}</span> : tag;
}
