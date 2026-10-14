import { useEffect, useState } from 'react';
import { DOCUMENTS } from './documents';

/**
 * The legal document named by the address, if any: `#/legal/<doc>`.
 *
 * In the address so a page can be linked from an email, a footer or a
 * printed invoice, and reached whether or not somebody is signed in.
 */
const docFrom = (hash) => {
  const m = /^#\/legal\/([a-z]+)/.exec(String(hash || ''));
  return m && DOCUMENTS[m[1]] ? m[1] : null;
};

export function useLegalRoute() {
  const [doc, setDoc] = useState(() => (typeof window === 'undefined' ? null : docFrom(window.location.hash)));
  useEffect(() => {
    const onHash = () => setDoc(docFrom(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return doc;
}

export const legalHref = (doc) => `#/legal/${doc}`;
