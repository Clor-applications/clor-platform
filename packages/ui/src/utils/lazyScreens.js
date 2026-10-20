import { lazy } from 'react';

/**
 * An app's screens, fetched together the first time any of them is shown
 * (WX-03).
 *
 * Every app used to ship in one 2.9 MB file, so the phone punch portal and a
 * Payroll-only company downloaded all of Accounting. Now a manifest names its
 * screens through this: `load` is one dynamic import of the app's screen list,
 * so the app becomes one file of its own, fetched once and then shared by
 * every screen in it — moving between screens never waits on the network.
 */
export function lazyScreens(load) {
  let pending = null;
  const once = () => {
    if (!pending) {
      pending = load().catch((e) => {
        pending = null; // a failed fetch (offline, a new deploy) may be retried
        throw e;
      });
    }
    return pending;
  };
  return (name) =>
    lazy(() =>
      once().then((m) => {
        if (!m[name]) throw new Error(`Screen "${name}" is missing from the app's screen list`);
        return { default: m[name] };
      })
    );
}
