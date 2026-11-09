import React from 'react';

/**
 * A Phosphor icon in the platform's two-tone set (owner, 29 Oct 2026, option C of six; every app but Accounting
 * since 9 Nov 2026: "use same icons which is used in people everywhere except books"). The line and a light fill
 * in the text colour; `.ui-glyph` lets a palette recolour either (people.css). Drop-in for a Lucide icon: the same
 * `size` prop, and Lucide's `strokeWidth` taken off so it never reaches the svg.
 *
 * Menus, rails and the app's own tile use it from the manifest; content icons a screen draws reach it through
 * colorSwap (`useContentIcon`); buttons and actions use the Fluent line set (lineIcons.js).
 */
export function duo(Icon, name = Icon.displayName || 'Icon', defaultSize = 16) {
  // eslint-disable-next-line no-unused-vars -- Lucide's strokeWidth is taken off so it is not passed to the svg
  const Duo = ({ size = defaultSize, strokeWidth, weight = 'duotone', className = '', ...rest }) => (
    <Icon size={size} weight={weight} className={`ui-glyph ${className}`.trim()} {...rest} />
  );
  Duo.displayName = `Duo(${name})`;
  return Duo;
}

/** A whole map of Phosphor icons at once: `{ home: House }` becomes `{ home: duo(House, 'home') }`. */
export const duoSet = (icons, defaultSize) => Object.fromEntries(Object.entries(icons).map(([key, Icon]) => [key, duo(Icon, key, defaultSize)]));
