import { useCallback, useRef } from 'react';

/**
 * Pointer-tracked 3D tilt.
 *
 * The element rotates a few degrees toward the cursor and springs back on
 * leave; children given a translateZ ride above the surface, so the card
 * reads as a physical object rather than a flat rectangle with a shadow.
 *
 * Deliberate constraints:
 * - CSS transforms only — no WebGL, no dependency, nothing on the bundle.
 * - Hover-capable pointers only: on touch there is no hover, and a tilt that
 *   jumps on tap reads as breakage.
 * - prefers-reduced-motion disables it entirely.
 * - Max angle stays small (default 5°): furniture may lean, not somersault.
 */
export function useTilt({ maxDeg = 5, scale = 1.015 } = {}) {
  const ref = useRef(null);

  const settled = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);

  const onPointerMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el || settled()) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5; // -0.5 … 0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg) scale(${scale})`;
    },
    [maxDeg, scale]
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}
