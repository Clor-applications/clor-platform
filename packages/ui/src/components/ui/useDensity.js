import { useCallback, useEffect, useState } from 'react';

/**
 * Row density.
 *
 * The engine has been in index.css for a while — `--row-pad-y`, flipped by
 * `data-density="compact"` on the root — with nothing anywhere in the product
 * to turn it. Compact puts roughly nine more rows in the same window, which on
 * a list of eighty-eight invoices is the difference between one screen and two.
 *
 * Written to the DOM in `apply`, not only in an effect, for the same reason
 * the theme is: the attribute is global state shared by every table on the
 * page, so setting it from an effect makes the result depend on render order.
 *
 * This is a personal preference, not an organisational setting. It belongs to
 * the person, travels with them, and lives in their own menu rather than in
 * Settings where the company's tax profile lives.
 */
const readStored = () => {
  try {
    return localStorage.getItem('uiDensity') === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
};

const apply = (next) => {
  // Comfortable is the default the stylesheet already assumes, so it is
  // expressed by the absence of the attribute rather than by a second value.
  if (next === 'compact') document.documentElement.setAttribute('data-density', 'compact');
  else document.documentElement.removeAttribute('data-density');
  try {
    localStorage.setItem('uiDensity', next);
  } catch {
    /* ignore */
  }
  return next;
};

export const useDensity = () => {
  const [density, setDensity] = useState(readStored);

  useEffect(() => {
    apply(density);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = useCallback((next) => {
    setDensity(apply(next === 'compact' ? 'compact' : 'comfortable'));
  }, []);

  const toggle = useCallback(() => {
    setDensity((prev) => apply(prev === 'compact' ? 'comfortable' : 'compact'));
  }, []);

  return { density, set, toggle };
};

export default useDensity;
