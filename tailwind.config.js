/** @type {import('tailwindcss').Config} */
export default {
  /* hover: styles only on a real pointer. On a phone a tapped row or button kept its
     hover look until the next tap, which read as a stuck selection (UI polish, 21 Nov 2026). */
  future: { hoverOnlyWhenSupported: true },
  content: [
    './index.html',
    './main.jsx',
    './packages/**/*.{js,ts,jsx,tsx}',
    './apps/**/*.{js,ts,jsx,tsx}',
    './console/web/**/*.{js,jsx}',
  ],
  // Component classes in @layer components are purged when the class name never
  // appears literally in the scanned source. These variants are composed at
  // runtime (`ui-pill-${tone}`), so they must be kept explicitly.
  safelist: [
    'ui-pill-pos',
    'ui-pill-neg',
    'ui-pill-warn',
    'ui-pill-info',
    'ui-pill-outline',
    'ui-not-allowed',
    'ui-pill-neutral',
    'ui-amount-pos',
    'ui-amount-neg',
    'ui-btn-primary',
    'ui-btn-secondary',
    'ui-btn-ghost',
    'ui-btn-danger',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
