import { useCallback, useEffect, useState } from 'react';

/**
 * Text size: Small, Medium or Large (owner's round 19 pick), chosen in the
 * name menu. A personal preference like row density, kept in this browser.
 * Written to `data-text-size` on <html>; picks.css scales the root font
 * there, so every rem-sized thing grows with it. Books ignores it.
 */
export const TEXT_SIZES = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

const readStored = () => {
  try {
    const v = localStorage.getItem('uiTextSize');
    return v === 'small' || v === 'large' ? v : 'medium';
  } catch {
    return 'medium';
  }
};

const apply = (next) => {
  if (next === 'medium') document.documentElement.removeAttribute('data-text-size');
  else document.documentElement.setAttribute('data-text-size', next);
  try {
    localStorage.setItem('uiTextSize', next);
  } catch {
    /* ignore */
  }
  return next;
};

export const useTextSize = () => {
  const [size, setSize] = useState(readStored);
  useEffect(() => {
    apply(size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = useCallback((next) => {
    setSize(apply(next === 'small' || next === 'large' ? next : 'medium'));
  }, []);
  return { size, set };
};

export default useTextSize;
