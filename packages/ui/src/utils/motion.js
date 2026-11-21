/**
 * Scrolling asked for from script. The CSS reduced-motion rule cannot reach a
 * `scrollTo({ behavior: 'smooth' })`, so the call has to ask itself.
 */
export const prefersLessMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

/** `behavior` for scrollTo / scrollIntoView: smooth, unless the person asked for less motion. */
export const smoothOrInstant = () => (prefersLessMotion() ? 'auto' : 'smooth');
