/*
 * Hover only on a real pointer (UI polish, 21 Nov 2026).
 *
 * On a phone, `:hover` sticks to whatever was tapped last, so a tapped row or button kept
 * its hover colour and read as selected. Tailwind's `hover:` utilities are fixed by
 * `future.hoverOnlyWhenSupported` in tailwind.config.js; this does the same for the plain
 * CSS files. Each rule whose selector has `:hover` moves into `@media (hover: hover)`.
 * A selector list that mixes hover and non-hover parts (`.a:hover, .a:focus-visible`) is
 * split, so the focus half keeps working on touch. Books keeps its own CSS untouched.
 */
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

const SKIP =/[\\/]apps[\\/]accounting[\\/]/;

const hoverOnlyOnPointer = () => ({
  postcssPlugin: 'clor-hover-on-pointer',
  Once(root, { AtRule }) {
    if (SKIP.test(root.source?.input?.file || '')) return;
    root.walkRules((rule) => {
      if (!rule.selector.includes(':hover')) return;
      for (let p = rule.parent; p; p = p.parent) {
        if (p.type === 'atrule' && (/hover\s*:\s*hover/.test(p.params) || /keyframes$/.test(p.name))) return;
      }
      const hover = rule.selectors.filter((s) => s.includes(':hover'));
      const rest = rule.selectors.filter((s) => !s.includes(':hover'));
      const moved = rest.length ? rule.clone({ selectors: hover }) : rule;
      const media = new AtRule({ name: 'media', params: '(hover: hover)' });
      if (rest.length) {
        rule.selectors = rest;
        rule.after(media);
      } else {
        rule.replaceWith(media);
      }
      media.append(moved);
    });
  },
});
hoverOnlyOnPointer.postcss = true;

export default {
  plugins: [tailwindcss(), hoverOnlyOnPointer(), autoprefixer()],
};
