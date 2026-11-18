import { useEffect } from 'react';

import { startDomTranslation } from './dom';
import { makeTranslator } from './translate';

/**
 * The employee app's languages (round 67). English is the code itself; every
 * other language is one file beside this one, loaded only when chosen. To add
 * Tamil: write ta.js like hi.js (`node scripts/i18n-strings.mjs --missing ta`
 * lists every line it needs), add it to PACKS and LANGUAGES, and allow 'ta' in
 * the server's PORTAL_LANGUAGES (routes/portal.ts).
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
];
const PACKS = {
  hi: () => import('./hi.js'),
};
export const isLanguage = (code) => LANGUAGES.some((l) => l.code === code);

export async function loadPack(code) {
  const load = PACKS[code];
  return load ? (await load()).default : null;
}

/* Remembered in this browser too, so the sign-in page opens in it before the server is asked. */
const KEY = 'clor.portal.lang';
export const savedLanguage = () => {
  try {
    const v = localStorage.getItem(KEY);
    return isLanguage(v) ? v : 'en';
  } catch {
    return 'en';
  }
};
export const rememberLanguage = (code) => {
  try {
    if (code && code !== 'en') localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: this page only */
  }
};

/* The language showing now, for the few words made outside the page (a server error by its code). */
let current = null;
export const currentTranslator = () => current;
/** A server error in the language showing: by its code when the language has one, else as it came. */
export const errorWords = (message, code) => (current && code ? current.error(message, code) || message : message);

/**
 * Shows the whole page in `code` while the calling screen is mounted: text,
 * placeholders, labels for screen readers, toasts and dialogs (they open
 * outside the screen, so the page body is watched), the tab title and <html lang>.
 */
export function usePageLanguage(code) {
  useEffect(() => {
    if (!code || code === 'en') return undefined;
    let stop = () => {};
    let gone = false;
    loadPack(code).then((pack) => {
      if (gone || !pack) return;
      const t = makeTranslator(pack);
      current = t;
      const html = document.documentElement;
      const lang = html.getAttribute('lang');
      html.setAttribute('lang', code);
      const stopText = startDomTranslation(document.body, t);
      /* The tab title is outside the body. */
      const englishTitle = document.title;
      const ownTitle = t(englishTitle) || englishTitle;
      document.title = ownTitle;
      stop = () => {
        stopText();
        if (lang) html.setAttribute('lang', lang);
        else html.removeAttribute('lang');
        if (document.title === ownTitle) document.title = englishTitle;
        if (current === t) current = null;
      };
    }).catch(() => {
      /* The language file did not load (offline on first use): the page stays in English. */
    });
    return () => {
      gone = true;
      stop();
    };
  }, [code]);
}
