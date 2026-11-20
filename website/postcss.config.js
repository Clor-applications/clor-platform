/*
 * Hover only on a real pointer (UI polish, 21 Nov 2026).
 *
 * On a phone, `:hover` sticks to whatever was tapped last, so a tapped card, tab or
 * menu item kept its hover colour and read as selected. Each rule whose selector has
 * `:hover` moves into `@media (hover: hover)`. A selector list that mixes hover and
 * non-hover parts (`.a:hover, .a[aria-expanded='true']`) is split, so the other half
 * keeps working on touch. The same rule the app's own build applies (../postcss.config.js);
 * the site keeps its own copy so its build never picks up the app's Tailwind.
 */
const hoverOnlyOnPointer = () => ({
  postcssPlugin: 'clor-hover-on-pointer',
  Once(root, { AtRule }) {
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
  plugins: [hoverOnlyOnPointer()],
};
