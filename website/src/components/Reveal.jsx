import React, { useEffect, useRef } from 'react';

/*
 * A figure rises into place as it scrolls into view. The prerendered page
 * shows everything at rest; only in the browser, and only when the reader has
 * not asked for reduced motion, is a figure first set a little low and faded,
 * then let go when it comes within reach. Transform and opacity only.
 */
export function Reveal({ children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const rect = el.getBoundingClientRect();
    /* Already on screen at load: stay as rendered, nothing to reveal. */
    if (rect.top < window.innerHeight && rect.bottom > 0) return undefined;
    el.classList.add('reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal-wrap ${className}`.trim()}>
      {children}
    </div>
  );
}
