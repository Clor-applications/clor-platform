import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The logo itself (the locked C-mark of 6 Nov 2026 and "LOR") is checked in
 * people-red-brand.test.js. This keeps what the neon brand asks of the static
 * icons: one orange family, nothing left of the red brand, one tab icon.
 */
const read = (f) => readFileSync(f, 'utf8');

describe('the CLOR icons', () => {
  it('every favicon and app icon is Blaze orange, with nothing of the red brand left', () => {
    const files = ['public/icon.svg'];
    for (const app of ['people', 'accounting', 'payroll', 'attendance']) files.push(`public/icons/${app}.svg`, `public/icons/${app}-maskable.svg`);
    for (const f of files) {
      const svg = read(f);
      expect(svg, f).toContain('#FF5400');
      for (const old of ['#C8102E', '#5C0A16', '#F5A623']) expect(svg, f).not.toContain(old);
    }
  });

  it('every app shows the same favicon in its browser tab', () => {
    expect(read('index.html')).not.toMatch(/icons\/people\.svg/);
  });
});
