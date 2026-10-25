import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One request's whole life on a screen (People design spec v1 §8):
 *  - first load: `loading` (draw a skeleton the shape of the page);
 *  - later loads keep `data` and set `refreshing` (background refresh);
 *  - past `slowAfter` ms, `slow` is set (keep showing what is there, offer Cancel);
 *  - a failure keeps the last good `data` and sets `error` (an apiFetch error:
 *    `network` for no connection, `status` for a server answer);
 *  - `cancel()` drops the answer of the request in flight; a newer request
 *    always wins over an older one that arrives late.
 * `load(signal)` must return a promise; `deps` re-run it.
 */
export default function useRequest(load, deps, { slowAfter = 4000, enabled = true } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: Boolean(enabled), refreshing: false, slow: false });
  const seq = useRef(0);
  const run = useCallback(() => {
    if (!enabled) return undefined;
    const mine = ++seq.current;
    setState((s) => ({ ...s, error: null, loading: s.data === undefined, refreshing: s.data !== undefined, slow: false }));
    const slowTimer = setTimeout(() => { if (seq.current === mine) setState((s) => ({ ...s, slow: true })); }, slowAfter);
    Promise.resolve()
      .then(() => load())
      .then((data) => { if (seq.current === mine) setState({ data, error: null, loading: false, refreshing: false, slow: false }); })
      .catch((error) => { if (seq.current === mine) setState((s) => ({ ...s, error, loading: false, refreshing: false, slow: false })); })
      .finally(() => clearTimeout(slowTimer));
    return () => clearTimeout(slowTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  useEffect(() => run(), [run]);
  const cancel = useCallback(() => {
    seq.current += 1;
    setState((s) => ({ ...s, loading: false, refreshing: false, slow: false }));
  }, []);
  /* Change what is shown without a round trip (a saved edit coming back). */
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: run, cancel, setData };
}

/** The browser's own guess at connectivity. Only a hint (spec §8): a failed request is the real signal. */
export function useOnlineHint() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
