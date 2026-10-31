/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchWideTables } from '../packages/shell/wideTables';

/* jsdom has no ResizeObserver: a stand-in that records what is watched. */
class FakeRO {
  static last = null;
  constructor() { this.els = new Set(); FakeRO.last = this; }
  observe(el) { this.els.add(el); }
  unobserve(el) { this.els.delete(el); }
  disconnect() { this.els.clear(); }
}

describe('wide table watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver = FakeRO;
    document.body.innerHTML = '<main id="main-content"><div class="ui-table-scroll"><table></table></div></main>';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.ResizeObserver;
    document.documentElement.removeAttribute('data-palette');
    document.body.innerHTML = '';
  });

  it('does nothing outside the People look', () => {
    const stop = watchWideTables(document.body);
    expect(FakeRO.last.els.size).toBe(0);
    stop();
  });

  it('lets go of lists that left the page', async () => {
    document.documentElement.setAttribute('data-palette', 'sky');
    const stop = watchWideTables(document.body);
    expect(FakeRO.last.els.size).toBe(2);
    document.querySelector('#main-content').innerHTML = '<p>Another screen</p>';
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    expect(FakeRO.last.els.size).toBe(0);
    stop();
  });
});

describe('wide content that is not a table (#80: the Candidates board at 390px)', () => {
  const size = (el, scroll, client) => {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scroll });
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => client });
  };
  beforeEach(() => {
    globalThis.ResizeObserver = FakeRO;
    document.documentElement.setAttribute('data-palette', 'sky');
  });
  afterEach(() => {
    delete globalThis.ResizeObserver;
    document.documentElement.removeAttribute('data-palette');
    document.body.innerHTML = '';
  });

  it('marks a box wide when its board of stage columns runs past it, so it scrolls instead of clipping', () => {
    document.body.innerHTML = '<main id="main-content"><div class="ui-table-scroll"><div class="grid"></div></div></main>';
    const box = document.querySelector('.ui-table-scroll');
    size(box, 1344, 358);
    size(box.firstElementChild, 1344, 358);
    const stop = watchWideTables(document.body);
    expect(box.hasAttribute('data-wide')).toBe(true);
    expect(FakeRO.last.els.has(box.firstElementChild)).toBe(true);
    stop();
  });

  it('leaves a board that fits unmarked', () => {
    document.body.innerHTML = '<main id="main-content"><div class="ui-table-scroll"><div class="grid"></div></div></main>';
    const box = document.querySelector('.ui-table-scroll');
    size(box, 900, 900);
    size(box.firstElementChild, 900, 900);
    const stop = watchWideTables(document.body);
    expect(box.hasAttribute('data-wide')).toBe(false);
    stop();
  });
});
