import { describe, expect, it, beforeEach } from 'vitest';

import { resolveTokenColor } from './useChartTheme';

beforeEach(() => {
  document.documentElement.style.setProperty('--ov-blue', '37 99 235');
  document.documentElement.style.setProperty('--brand', '249 115 22');
});

/*
 * A colour ECharts can actually paint.
 *
 * The overview pages hand the donut palette entries like `rgb(var(--ov-blue))`.
 * That is a real colour in CSS and nothing at all as an SVG `fill` attribute,
 * which ECharts writes it into — so the ring rendered invisible under its own
 * centre label on every module overview, and the legend beside it kept working,
 * which is what made it look like a layout problem rather than a colour one.
 */
describe('resolving a token colour for a chart', () => {
  it('turns a CSS variable into the colour it stands for', () => {
    expect(resolveTokenColor('rgb(var(--ov-blue))')).toBe('rgb(37,99,235)');
    expect(resolveTokenColor('var(--brand)')).toBe('rgb(249,115,22)');
  });

  it('leaves a real colour alone', () => {
    expect(resolveTokenColor('#FF8800')).toBe('#FF8800');
    expect(resolveTokenColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });

  it('falls back when the token is not defined, rather than painting nothing', () => {
    expect(resolveTokenColor('rgb(var(--not-a-token))', '#123456')).toBe('#123456');
    expect(resolveTokenColor('', '#123456')).toBe('#123456');
    expect(resolveTokenColor(null, '#123456')).toBe('#123456');
  });
});
