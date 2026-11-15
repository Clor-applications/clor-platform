import { createElement } from 'react';

import { FLUENT_EMOJI } from './fluentEmoji.data';

/**
 * One Fluent Emoji (flat) as an icon component with Lucide's call shape: `size`, `className`,
 * `style` and `aria-*` pass through; stroke props are dropped because an emoji has no stroke.
 * The SVG body is local (no runtime fetch), from fluentEmoji.data.js.
 */
export function emoji(name) {
  const body = FLUENT_EMOJI[name];
  if (!body) throw new Error(`Fluent Emoji "${name}" is not in fluentEmoji.data.js; run node scripts/build-emoji-icons.mjs`);
  function Emoji({ size = 16, className, style, strokeWidth: _s, absoluteStrokeWidth: _a, color: _c, ...rest }) {
    return createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 32 32',
      width: size,
      height: size,
      focusable: 'false',
      className: className ? `ui-emoji ${className}` : 'ui-emoji',
      style,
      'data-emoji': name,
      ...rest,
      dangerouslySetInnerHTML: { __html: body },
    });
  }
  Emoji.displayName = `Emoji(${name})`;
  return Emoji;
}
