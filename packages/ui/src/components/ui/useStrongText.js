import { useCallback, useEffect, useState } from 'react';

/**
 * Round 50 pick "highcontrast" A: "Stronger text" in the name menu makes the
 * greys darker and the hairlines thicker, for anyone who finds grey text
 * faint. A personal preference like text size, kept in this browser. Written
 * to `data-contrast="strong"` on <html>; picks.css darkens the colours there.
 * Books ignores it.
 */
const KEY = 'uiStrongText';

const readStored = () => {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};

export const applyStrongText = (on) => {
  if (on) document.documentElement.setAttribute('data-contrast', 'strong');
  else document.documentElement.removeAttribute('data-contrast');
  try {
    if (on) localStorage.setItem(KEY, 'on');
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return on;
};

export const useStrongText = () => {
  const [on, setOn] = useState(readStored);
  useEffect(() => {
    applyStrongText(on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = useCallback(() => setOn((was) => applyStrongText(!was)), []);
  return { on, toggle };
};

export default useStrongText;
