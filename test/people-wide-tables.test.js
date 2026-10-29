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
