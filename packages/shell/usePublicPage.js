import { createElement, useEffect, useState } from 'react';

import { APPS } from './registry';

/**
 * A page an app offers to people who are not CLOR users — Attendance's
 * employee portal at #/portal — named by the address, like the legal pages.
 * Apps declare them in their manifest (`publicPages`); the shell only routes.
 */
const PAGES = Object.fromEntries(APPS.flatMap((a) => Object.entries(a.publicPages || {})));

const pageFrom = (hash) => {
  const m = /^#\/([a-z-]+)(?:[/?]|$)/.exec(String(hash || ''));
  return m && PAGES[m[1]] ? m[1] : null;
};

/** The public page the address names, if any. */
export function usePublicPage() {
  const [page, setPage] = useState(() => (typeof window === 'undefined' ? null : pageFrom(window.location.hash)));
  useEffect(() => {
    const onHash = () => setPage(pageFrom(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return page;
}

export const renderPublicPage = (page) => createElement(PAGES[page]);
