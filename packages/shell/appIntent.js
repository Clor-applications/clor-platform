/**
 * The app a visitor came for. clor.in's product pages send "Start with
 * Payroll" to /signup?app=payroll; the choice is kept for this tab so it
 * survives sign-up, a verification round trip and company setup, which then
 * switches that app on and opens into it.
 */
const KEY = 'clor.appIntent';
const KNOWN = new Set(['accounting', 'payroll', 'people', 'attendance']);

/**
 * Read ?app= from the address (once, on load) and remember it for this tab.
 * Only on the way in (sign-up, sign-in): inside a company (/o/<code>/) ?app=
 * names the app open in place, and remembering it there sent every later
 * visit to the Workspace on the front door straight back to that app, which
 * sent it back to the Workspace, round and round.
 */
export function captureAppIntent(
  search = typeof window !== 'undefined' ? window.location.search : '',
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
) {
  if (/^\/o\//.test(String(pathname || ''))) return null;
  try {
    const asked = new URLSearchParams(search).get('app');
    if (asked && KNOWN.has(asked)) sessionStorage.setItem(KEY, asked);
    return asked && KNOWN.has(asked) ? asked : null;
  } catch {
    return null;
  }
}

/** The app this tab came for, if any. */
export function appIntent() {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && KNOWN.has(v) ? v : null;
  } catch {
    return null;
  }
}

/** Forget it once the company is made: from then on the person chooses for themselves. */
export function clearAppIntent() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * The app to open once a company is set up with `picked` apps: the one they
 * came for if they picked it, the only one if there is one, else Accounting
 * (where the day starts for companies with several), else the first. Attendance
 * on a company that also picked People opens People, which includes it.
 */
export function landingAfterSetup(picked, intended = appIntent()) {
  const list = (Array.isArray(picked) ? picked : []).filter((a) => KNOWN.has(a));
  if (!list.length) return null;
  let to;
  if (intended && list.includes(intended)) to = intended;
  else if (list.length === 1) to = list[0];
  else to = list.includes('accounting') ? 'accounting' : list[0];
  return to === 'attendance' && list.includes('people') ? 'people' : to;
}
