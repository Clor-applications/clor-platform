/*
 * Before the build: fetch the price list published in the operator console,
 * so /pricing is prerendered with real prices (search engines, link previews,
 * slow phones). Written to src/data/pricing.live.json, which is not committed.
 *
 * Never fails the build. Nothing published: the page is built with Request a
 * demo instead of prices. The API not answering: the same, and the page asks
 * the API again in the browser, so prices show as soon as it answers.
 *
 * Where: VITE_API_URL (a local run), else the API beside VITE_APP_URL, else
 * api.clor.in — the same rule as src/site.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src', 'data', 'pricing.live.json');

/* The same .env files Vite reads, so a staging build asks the staging API. */
const env = { ...process.env };
for (const f of ['.env', '.env.production', '.env.local', '.env.production.local']) {
  const file = path.join(root, f);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}
const appUrl = env.VITE_APP_URL || 'https://app.clor.in';
const api = env.VITE_API_URL || `${appUrl.replace('//app.', '//api.')}/api`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
try {
  const r = await fetch(`${api}/public/pricing`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (r.status === 404) {
    fs.writeFileSync(out, JSON.stringify({ none: true }));
    console.log('Pricing: nothing is published; /pricing shows Request a demo.');
  } else if (r.ok) {
    const body = await r.json();
    fs.writeFileSync(out, JSON.stringify(body));
    console.log(`Pricing: version ${body.version}, ${body.plans?.length ?? 0} plans, from ${api}`);
  } else {
    console.warn(`Pricing: ${api} answered ${r.status}; /pricing is built without prices and asks again in the browser.`);
  }
} catch (e) {
  console.warn(`Pricing: ${api} did not answer (${e?.message || e}); /pricing is built without prices and asks again in the browser.`);
}
