import React from 'react';

/*
 * A browser too old to run CLOR well (owner's pick, round 27: a full page
 * naming the browsers that work, rather than broken screens).
 *
 * The build targets browsers from late 2022 on. Each check below is a feature
 * those browsers have and the code leans on; a browser missing any of them is
 * older than that line. A browser so old it cannot even read the code never
 * reaches this page, which is no worse than before.
 */
export function browserIsTooOld(win = typeof window === 'undefined' ? undefined : window) {
  if (!win) return false;
  try {
    if (typeof win.structuredClone !== 'function') return true;
    if (typeof Array.prototype.findLast !== 'function') return true;
    if (typeof Array.prototype.at !== 'function') return true;
    if (typeof Object.hasOwn !== 'function') return true;
    return false;
  } catch {
    return false;
  }
}

export const SUPPORTED_BROWSERS = [
  { name: 'Google Chrome', from: 'Version 107 or newer', href: 'https://www.google.com/chrome/' },
  { name: 'Microsoft Edge', from: 'Version 107 or newer', href: 'https://www.microsoft.com/edge' },
  { name: 'Mozilla Firefox', from: 'Version 104 or newer', href: 'https://www.mozilla.org/firefox/' },
  { name: 'Safari', from: 'Version 16 or newer, on a Mac, iPhone or iPad', href: 'https://support.apple.com/en-in/102665' },
];

export function OldBrowserPage() {
  return (
    <main className="ui-old-browser">
      <h1 className="ui-old-browser-h">This browser is too old for CLOR</h1>
      <p>Open CLOR in one of these browsers. Each is free, and your data stays as it is.</p>
      <ul className="ui-old-browser-list">
        {SUPPORTED_BROWSERS.map((b) => (
          <li key={b.name}>
            <a className="ui-link" href={b.href} target="_blank" rel="noreferrer">{b.name}</a>
            <span className="ui-caption">{b.from}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
