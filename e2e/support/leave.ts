import { expect, type Locator } from '@playwright/test';

import { todayIST } from './dates';

/** The employee app's balance cards are this year's; leave that falls next year (late December runs) moves next year's. */
export const inThisYear = (isoDate: string) => isoDate.slice(0, 4) === String(todayIST().getFullYear());

/** "Casual leave 10 left of 12 · 2 waiting" → { left: 10, of: 12, waiting: 2 }. */
export async function readBalance(line: Locator) {
  const text = (await line.textContent()) || '';
  const m = text.match(/([\d.]+)\s*left of ([\d.]+)(?:\s*·\s*([\d.]+) waiting)?/);
  expect(m, `a balance line, got "${text}"`).not.toBeNull();
  return { left: Number(m![1]), of: Number(m![2]), waiting: Number(m![3] || 0), text };
}

/**
 * Waits until the balance line shows these numbers (the parts given), the way
 * a person reads it again until it changes, rather than reading it once.
 */
export async function expectBalance(line: Locator, want: { left?: number; waiting?: number }, message?: string) {
  await expect
    .poll(
      async () => {
        const m = ((await line.textContent()) || '').match(/([\d.]+)\s*left of ([\d.]+)(?:\s*·\s*([\d.]+) waiting)?/);
        if (!m) return null;
        const got = { left: Number(m[1]), waiting: Number(m[3] || 0) };
        return Object.fromEntries(Object.keys(want).map((k) => [k, got[k as 'left' | 'waiting']]));
      },
      { message },
    )
    .toEqual(want);
}

/** "2 Nov 2026 – 3 Nov 2026", the way the web app writes a range. */
export const range = (fmt: (d: string) => string, from: string, to = from) => `${fmt(from)} – ${fmt(to)}`;
