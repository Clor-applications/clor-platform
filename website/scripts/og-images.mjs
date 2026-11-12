/*
 * Each product page's sharing picture (platform audit, 11 Nov 2026: every page
 * shared the one site picture). 1200 by 630, in the site's own style: the
 * CLOR logo, the product's name with its colour bar, its one line, and its
 * address. Run by hand after a product's name or line changes, and commit the
 * PNGs: node scripts/og-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PRODUCTS } from '../src/site.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'brand');
const logo = `data:image/png;base64,${fs.readFileSync(path.join(out, 'clor-logo-2026-11.png')).toString('base64')}`;
const FONT = 'node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2';
const fontFile = process.argv[2] || [path.join(root, FONT), path.join(root, '..', FONT)].find((f) => fs.existsSync(f));
const font = fontFile ? `@font-face { font-family: 'Jakarta'; src: url(data:font/woff2;base64,${fs.readFileSync(fontFile).toString('base64')}) format('woff2'); font-weight: 200 800; }` : '';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const page = (p) => `<!doctype html><html><head><style>
${font}
html,body{margin:0;width:1200px;height:630px;background:#fff;font-family:'Jakarta',system-ui,sans-serif;color:#0F172A}
.wrap{padding:150px 80px 0 80px}
img{height:72px;display:block}
.name{display:flex;align-items:center;gap:20px;margin-top:64px}
.bar{width:12px;height:72px;border-radius:6px;background:${p.accent}}
h1{font-size:76px;font-weight:800;letter-spacing:-0.02em;margin:0;line-height:1}
p{font-size:38px;font-weight:600;line-height:1.3;margin:28px 0 0;max-width:1020px}
.url{font-size:28px;font-weight:500;color:#475569;margin-top:36px}
</style></head><body><div class="wrap">
<img src="${logo}" alt="">
<div class="name"><span class="bar"></span><h1>${esc(p.name)}${p.status === 'soon' ? '<span style="font-weight:600;color:#475569;font-size:44px"> · coming soon</span>' : ''}</h1></div>
<p>${esc(p.line)}</p>
<div class="url">clor.in/products/${p.slug}</div>
</div></body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const p of PRODUCTS) {
  await tab.setContent(page(p), { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: path.join(out, `og-${p.slug}.png`) });
  console.log(`og-${p.slug}.png`);
}
await browser.close();
