import { useEffect } from 'react';

/**
 * The app is light-only: one standard light theme across the platform and
 * every app, matching clor.in.
 *
 * A browser that chose dark earlier (the old toggle stored `uiTheme`) or asks
 * for dark at the system level still gets light; `data-theme="light"` is also
 * set in index.html so nothing renders dark before the script runs. The dark
 * token block in index.css is unused while this holds.
 */
const applyLight = () => {
  document.documentElement.setAttribute('data-theme', 'light');
  try {
    localStorage.removeItem('uiTheme');
  } catch {
    /* ignore */
  }
};

export const useTheme = () => {
  useEffect(applyLight, []);
  return { theme: 'light', toggle: applyLight };
};
