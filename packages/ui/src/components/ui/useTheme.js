import { useCallback, useEffect, useState } from 'react';

/**
 * Theme state for the app shell.
 *
 * Kept in its own module (not Primitives.jsx) so that file exports only
 * components and Fast Refresh keeps working.
 *
 * The DOM write happens in `applyTheme`, not only in an effect: `data-theme`
 * is global state shared by every consumer, so writing it from an effect makes
 * the result depend on mount/render ordering.
 */
const readStoredTheme = () => {
  try {
    const saved = localStorage.getItem('uiTheme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (next) => {
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('uiTheme', next);
  } catch {
    /* ignore */
  }
  return next;
};

export const useTheme = () => {
  const [theme, setTheme] = useState(readStoredTheme);

  // Sync once on mount so the attribute matches the resolved preference.
  useEffect(() => {
    applyTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, []);

  return { theme, toggle };
};
