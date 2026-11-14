import React from 'react';

/**
 * A Fluent colour icon (`*Color` from @fluentui/react-icons) as a drop-in for the platform's icon props:
 * the same `size` prop as Lucide/Phosphor, mapped to Fluent's font-size sizing. R&D shell (14 Nov 2026):
 * rail, panel and section icons are Fluent colour; controls stay on the Fluent line set (lineIcons.js).
 */
export function colorIcon(Icon, name = Icon.displayName || 'Icon', defaultSize = 20) {
  // eslint-disable-next-line no-unused-vars -- Lucide's strokeWidth and Phosphor's weight are dropped
  const Color = ({ size = defaultSize, strokeWidth, weight, className = '', style, ...rest }) => (
    <Icon fontSize={size} className={`ui-color-icon ${className}`.trim()} style={{ width: size, height: size, flex: 'none', ...style }} {...rest} />
  );
  Color.displayName = `Color(${name})`;
  return Color;
}

/** A whole map at once: `{ home: HomeColor }` becomes `{ home: colorIcon(HomeColor, 'home') }`. */
export const colorSet = (icons, defaultSize) => Object.fromEntries(Object.entries(icons).map(([key, Icon]) => [key, colorIcon(Icon, key, defaultSize)]));
