import React from 'react';
import ClorMark from './ClorMark.jsx';

/**
 * The CLOR logo: ribbon-arc C-mark + "LOR" text — the icon IS the "C".
 * Together they read "CLOR". O is orange, L/R are slate.
 * variant: 'horizontal' (default) | 'mark' (icon only) | 'wordmark' (LOR text only) | 'stacked'
 */

const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const SLATE  = 'rgb(var(--logo-mark-slate,  15 23 42))';
const FONT   = "'Inter Variable', 'Inter', ui-sans-serif, sans-serif";
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };

function Lor({ h, color, className, title, style: extraStyle }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const co = color || ORANGE;
  const sl = color || SLATE;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: h,
        lineHeight: 1,
        letterSpacing: '0.02em',
        userSelect: 'none',
        flexShrink: 0,
        ...extraStyle,
      }}
      {...a11y}
    >
      <span style={{ color: sl }}>L</span>
      <span style={{ color: co }}>O</span>
      <span style={{ color: sl }}>R</span>
    </span>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;

  if (variant === 'mark')     return <ClorMark size={h} color={color} className={className} title={title} />;
  if (variant === 'wordmark') return <Lor h={h} color={color} className={className} title={title} />;

  if (variant === 'stacked') {
    return (
      <span
        role="img"
        aria-label={title || undefined}
        aria-hidden={title ? undefined : 'true'}
        className={className}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(h / 4), verticalAlign: 'middle', flexShrink: 0 }}
      >
        <ClorMark size={Math.round(h * 1.4)} color={color} title="" />
        <Lor h={h} color={color} title="" />
      </span>
    );
  }

  /* horizontal (default): [C-mark] LOR — icon acts as the "C", zero gap = one word */
  return (
    <span
      role="img"
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 0, verticalAlign: 'middle', flexShrink: 0 }}
    >
      <ClorMark size={Math.round(h * 0.8)} color={color} title="" />
      <Lor h={h} color={color} title="" style={{ marginLeft: -Math.round(h * 0.09) }} />
    </span>
  );
}
