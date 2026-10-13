import React from 'react';

/**
 * Line drawings for empty, filtered, blocked and finished states.
 *
 * One motif, drawn five ways: a ruled page. Every illustration is the same
 * sheet at the same proportions with the same stroke weight and corner radius,
 * so they read as one family rather than as five icons that happened to be
 * commissioned together. What changes is what is happening to the page.
 *
 * Drawn rather than downloaded for two reasons. Stock illustration is the
 * fastest way to look like every other SaaS, and none of it knows what a ledger
 * is. And these inherit `currentColor`, so they theme with the product instead
 * of needing a light and a dark copy.
 *
 * Sized by the caller. Nothing here sets a width, so the same file serves a
 * 72px table empty state and a 140px first-run screen.
 */

const STROKE = 1.5;

/** The sheet every illustration is drawn on. */
function Sheet({ children, rules = 3 }) {
  return (
    <>
      <rect x="16" y="10" width="56" height="70" rx="5" />
      {Array.from({ length: rules }, (_, i) => (
        <line key={i} x1="26" y1={30 + i * 12} x2={i === rules - 1 ? 50 : 62} y2={30 + i * 12} opacity=".55" />
      ))}
      {children}
    </>
  );
}

function Frame({ children, label }) {
  return (
    <svg
      /* Cropped to the art rather than sitting in a generous box: at 104px the
         sheet was rendering about 58px and reading as a small icon with space
         around it rather than as a drawing. */
      viewBox="11 5 74 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {children}
    </svg>
  );
}

/** Nothing recorded yet — the page is blank and a line is being ruled onto it. */
export function ArtBlank() {
  return (
    <Frame label="">
      <Sheet rules={0} />
      <line x1="26" y1="30" x2="62" y2="30" opacity=".3" />
      <line x1="26" y1="42" x2="62" y2="42" opacity=".3" />
      <line x1="26" y1="54" x2="62" y2="54" opacity=".3" />
      {/* the one entry that has been made */}
      <line x1="26" y1="30" x2="45" y2="30" strokeWidth={2.5} />
      <circle cx="49" cy="30" r="1.8" fill="currentColor" stroke="none" />
    </Frame>
  );
}

/** Records exist, the filters are hiding them — the page is behind a lens. */
export function ArtFiltered() {
  return (
    <Frame label="">
      <g opacity=".45">
        <Sheet rules={3} />
      </g>
      <circle cx="58" cy="52" r="17" />
      <line x1="70" y1="64" x2="80" y2="74" strokeWidth={2.5} />
      <line x1="51" y1="48" x2="65" y2="48" opacity=".7" />
      <line x1="51" y1="56" x2="60" y2="56" opacity=".7" />
    </Frame>
  );
}

/** Switched off — the page is there and ruled through. */
export function ArtDisabled() {
  return (
    <Frame label="">
      <g opacity=".4">
        <Sheet rules={3} />
      </g>
      <circle cx="62" cy="60" r="15" />
      <line x1="52" y1="70" x2="72" y2="50" />
    </Frame>
  );
}

/** Everything settled — the page is complete and ticked. */
export function ArtDone() {
  return (
    <Frame label="">
      <Sheet rules={3} />
      <circle cx="64" cy="62" r="15" />
      <path d="M57 62.5 61.5 67 71.5 57" strokeWidth={2.2} />
    </Frame>
  );
}

/** Something failed — the sheet is torn across. */
export function ArtBroken() {
  return (
    <Frame label="">
      <path d="M16 15a5 5 0 0 1 5-5h46a5 5 0 0 1 5 5v22" />
      <path d="M72 55v20a5 5 0 0 1-5 5H21a5 5 0 0 1-5-5V52" />
      {/* the tear */}
      <path d="M16 44 26 40 34 46 44 39 53 46 62 40 72 46" strokeDasharray="0.1 4" />
      <line x1="26" y1="30" x2="62" y2="30" opacity=".55" />
      <line x1="26" y1="66" x2="50" y2="66" opacity=".55" />
    </Frame>
  );
}

const ART = {
  new: ArtBlank,
  filtered: ArtFiltered,
  disabled: ArtDisabled,
  done: ArtDone,
  error: ArtBroken,
};

/**
 * The one entry point callers use.
 *
 * `kind` matches the vocabulary EmptyState already speaks, so nothing at a call
 * site has to change to gain an illustration.
 */
export default function Illustration({ kind = 'new', size = 108, className = '' }) {
  const Art = ART[kind] || ART.new;
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ width: size, height: Math.round((size * 80) / 74), display: 'block', color: 'rgb(var(--brand))' }}
    >
      <Art />
    </span>
  );
}
