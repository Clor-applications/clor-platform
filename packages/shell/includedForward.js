import { appFromHost, hostForApp } from './appHosts';
import { frontDoorForward } from './orgUrl';
import { landingFor } from './registry';

/**
 * Where an address that names an app this company has inside another should
 * go instead, or null to stay.
 *
 * attendance.clor.in opened by a company on People has nothing of its own to
 * show: the same screens are People's Time menu. So the visit goes on to
 * people.clor.in, on the matching screen (People's home when there is none),
 * keeping the company in the path and the screen's own state. The same for a
 * link through the front door that names the app (`?app=attendance&open=…`,
 * a welcome or summary email).
 *
 * Null when the address names no such app, or where apps have no addresses of
 * their own (localhost, a preview, the phone app): there the shell opens the
 * other app in place.
 */
export function includedForward({ protocol = 'https:', hostname = '', pathname = '/', search = '', hash = '' } = {}, subscriptions = [], { code = '', all = false } = {}) {
  const q = new URLSearchParams(search || '');
  const fromHost = appFromHost(hostname);
  const asked = fromHost || q.get('app');
  if (!asked) return null;
  const to = landingFor({ app: asked, screen: q.get('open') || '' }, subscriptions, { all });
  if (!to.moved) return null;
  const host = hostForApp(to.app, hostname);
  if (!host || host === hostname) return null;
  /* The other address says which app it is; ?app= would name the one left behind. */
  q.delete('app');
  if (to.screen) q.set('open', to.screen);
  else q.delete('open');
  const s = q.toString();
  return frontDoorForward({ protocol, host, pathname, search: s ? `?${s}` : '', hash, code });
}
