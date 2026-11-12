// usage: node shots.mjs <outdir> <prefix> screen1 screen2 ... ; env W,H for viewport
import { chromium } from '@playwright/test';
const [outDir, prefix, ...screens] = process.argv.slice(2);
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const base = 'http://localhost:5194/o/7742737419/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
await page.goto(`${base}?app=people`);
await page.fill('input[type=text], input[type=email]', 'people.dev@clor.test');
await page.fill('input[type=password]', 'People-Dev-2026!');
await page.click('button[type=submit]');
await page.waitForURL(/app=people/, { timeout: 15000 });
await page.waitForTimeout(1500);
for (const s of screens) {
  const [key, extra = ''] = s.split('@');
  await page.goto(`${base}?app=people&open=${key}${extra}`);
  await page.waitForTimeout(2200);
  const file = `${outDir}/${prefix}${key.replace(/[^\w-]/g, '_')}${W < 600 ? '-phone' : ''}.png`;
  await page.screenshot({ path: file, fullPage: !!process.env.FULL });
  console.log(file);
}
if (errors.length) console.log('ERRORS\n' + [...new Set(errors)].join('\n'));
await browser.close();
