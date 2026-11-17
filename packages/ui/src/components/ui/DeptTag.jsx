import React from 'react';

/*
 * A department in a list, as a coloured tag (owner's pick, round 11, 17 Nov 2026). The colour comes from the
 * department's own name, one of the eight category colours, so the same department is the same colour on every
 * screen. The name is always written out: the colour only helps the eye group rows. Not used in Books.
 */
const catOf = (name) => {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
};

export default function DeptTag({ name }) {
  if (!name) return null;
  return <span className="ui-dept-tag" style={{ '--tag': `var(--cat-${catOf(name)})` }}>{name}</span>;
}
