import React from 'react';

/*
 * A hand-drawn person (Open Peeps by Pablo Stanley, CC0 1.0), slate line on
 * white. Decorative: the words beside it say who it stands for, so alt is
 * empty. 240 x 324 is each drawing's own size; CSS sets the shown height.
 */
export default function Person({ who, className = '' }) {
  return <img className={`person ${className}`.trim()} src={`/illustrations/people/person-${who}.svg`} width={240} height={324} alt="" loading="lazy" decoding="async" />;
}
