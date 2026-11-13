import React from 'react';
import ClorMark from './ClorMark.jsx';
import { LETTERS, SYMBOL_ARC_D, SYMBOL_BRACKET_D, WORD_BOX, HORIZONTAL, STACKED } from './logoPaths.js';

/**
 * The CLOR logo (14 Nov 2026), drawn from the CLOR SVG pack: the open CL frame
 * followed by CLOR in the pack's own letters. The frame's bracket and the O's
 * lower-left quarter carry the blaze orange; everything else is the ink.
 *
 * variant: 'horizontal' (default, the frame and the name side by side)
 *        | 'stacked'    (the frame centred over the name)
 *        | 'wordmark'   (the name alone, for places too tight for the frame)
 *        | 'mark'       (the frame alone)
 *
 * `size` is the cap height of CLOR, so the name is drawn the same size in
 * every variant and the box around it grows instead.
 */

const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const INK = 'rgb(var(--logo-mark-slate, 32 35 41))';
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
const CAP = 100;

function Word({ ink, accent }) {
  return LETTERS.map((l) => (
    <g key={l.x} transform={`translate(${l.x} 0)`}>
      {l.accent ? <path d={l.accent} fill={accent} /> : null}
      <path d={l.ink} fill={ink} fillRule={l.evenOdd ? 'evenodd' : undefined} />
      {l.extra ? <path d={l.extra} fill={ink} /> : null}
    </g>
  ));
}

function Symbol({ ink, accent }) {
  return (
    <>
      <path d={SYMBOL_ARC_D} fill={ink} />
      <path d={SYMBOL_BRACKET_D} fill={accent} />
    </>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;
  if (variant === 'mark') return <ClorMark size={h} color={color} className={className} title={title} />;

  const ink = color || INK;
  const accent = color || ORANGE;
  const layout = variant === 'stacked' ? STACKED : variant === 'wordmark' ? null : HORIZONTAL;
  const box = layout ? layout.box : WORD_BOX;
  const height = Math.round((h * box.h) / CAP);
  const width = Math.round((height * box.w) / box.h);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      {layout ? (
        <>
          <g transform={`translate(${layout.symbol.x} ${layout.symbol.y}) scale(${layout.symbol.scale})`}>
            <Symbol ink={ink} accent={accent} />
          </g>
          <g transform={`translate(${layout.word.x} ${layout.word.y})`}>
            <Word ink={ink} accent={accent} />
          </g>
        </>
      ) : (
        <Word ink={ink} accent={accent} />
      )}
    </svg>
  );
}
