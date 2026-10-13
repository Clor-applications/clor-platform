import React from 'react';

/**
 * Hand-drawn illustration for the sign-in brand panel.
 *
 * Inline SVG, no image asset: it inherits the panel's colours, weighs nothing,
 * and ships in the same chunk as the screen it decorates. The scene is the
 * product's own story — an invoice posting into a ledger, the balance ticking
 * green — drawn in the panel's white line-work with the brand orange reserved
 * for the two moments that matter (the total, the balanced check).
 *
 * Motion: the floating chips breathe on a 7–9s cycle via the shared ui-float
 * classes; transform-box keeps each group rotating/translating about itself.
 * Purely decorative, so the whole thing is hidden from assistive tech and the
 * global reduced-motion block freezes it.
 */
const floatStyle = { transformBox: 'fill-box', transformOrigin: 'center' };

export default function AuthIllustration({ className = '' }) {
  return (
    <svg
      viewBox="0 0 420 300"
      fill="none"
      aria-hidden="true"
      className={className}
      role="presentation"
    >
      {/* Ledger baseline the invoice sits on. */}
      <line x1="24" y1="262" x2="396" y2="262" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="1 7" strokeLinecap="round" />

      {/* The invoice document. */}
      <g>
        <rect x="96" y="38" width="184" height="224" rx="14" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
        {/* header */}
        <rect x="118" y="62" width="76" height="9" rx="4.5" fill="rgba(255,255,255,0.35)" />
        <rect x="118" y="80" width="46" height="6" rx="3" fill="rgba(255,255,255,0.18)" />
        <circle cx="248" cy="72" r="13" fill="rgb(var(--brand) / 0.22)" stroke="rgb(var(--brand) / 0.65)" strokeWidth="1.5" />
        <text x="248" y="77" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">₹</text>
        {/* line items */}
        {[108, 130, 152, 174].map((y) => (
          <g key={y}>
            <rect x="118" y={y} width="88" height="6" rx="3" fill="rgba(255,255,255,0.16)" />
            <rect x="222" y={y} width="36" height="6" rx="3" fill="rgba(255,255,255,0.28)" />
          </g>
        ))}
        <line x1="118" y1="196" x2="258" y2="196" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        {/* total row — the one line in brand colour */}
        <rect x="118" y="210" width="52" height="8" rx="4" fill="rgba(255,255,255,0.3)" />
        <rect x="204" y="206" width="54" height="16" rx="8" fill="rgb(var(--brand) / 0.9)" />
        <rect x="214" y="212" width="34" height="4" rx="2" fill="rgba(255,255,255,0.85)" />
      </g>

      {/* Floating chip: debits = credits, balanced. */}
      <g className="ui-float" style={floatStyle}>
        <rect x="278" y="118" width="118" height="44" rx="12" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
        <circle cx="302" cy="140" r="11" fill="rgb(var(--pos) / 0.25)" stroke="rgb(var(--pos))" strokeWidth="1.5" />
        <path d="m297 140 3.5 3.5 7-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="322" y="130" width="58" height="6" rx="3" fill="rgba(255,255,255,0.4)" />
        <rect x="322" y="143" width="40" height="5" rx="2.5" fill="rgba(255,255,255,0.2)" />
      </g>

      {/* Floating chip: the trend, drawn ascending. */}
      <g className="ui-float-late" style={floatStyle}>
        <rect x="18" y="86" width="66" height="60" rx="12" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
        <rect x="32" y="122" width="8" height="14" rx="2" fill="rgba(255,255,255,0.3)" />
        <rect x="46" y="112" width="8" height="24" rx="2" fill="rgba(255,255,255,0.45)" />
        <rect x="60" y="102" width="8" height="34" rx="2" fill="rgb(var(--brand) / 0.9)" />
      </g>

      {/* Floating coin. */}
      <g className="ui-float" style={{ ...floatStyle, animationDelay: '0.9s' }}>
        <circle cx="336" cy="224" r="20" fill="rgb(var(--brand) / 0.16)" stroke="rgb(var(--brand) / 0.6)" strokeWidth="1.5" />
        <circle cx="336" cy="224" r="14" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
        <text x="336" y="230" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">₹</text>
      </g>

      {/* Posting arc: document into ledger line. */}
      <path d="M280 236c26 10 44 18 56 26" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
    </svg>
  );
}
