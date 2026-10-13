import { useRef } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFitToViewport } from './useFitToViewport';

/* jsdom has no ResizeObserver; the hook uses one to catch the chrome above a
   table growing. Nothing here tests that path, so a stub is enough. */
class StubResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || StubResizeObserver;

/**
 * The rows scroll; the page does not.
 *
 * jsdom has no layout, so the geometry is stubbed and what is under test is the
 * arithmetic: what height the region is given, and — the part that was wrong
 * twice — what happens to the height when the page still does not fit.
 */

const Harness = ({ dep = 0, fillViewport = false }) => {
  const ref = useRef(null);
  useFitToViewport(dep);
  return (
    <main id="main-content" ref={ref}>
      <div className="ui-card">
        <div className="ui-table-scroll" data-fill-viewport={fillViewport ? '' : undefined} data-testid="scroller" />
        <div className="pagination" />
      </div>
    </main>
  );
};

/** Places the page: a scroller starting at `top`, a card ending `below` past it. */
const layout = ({ top, below, overflow }) => {
  const root = document.getElementById('main-content');
  const scroller = document.querySelector('.ui-table-scroll');
  const card = document.querySelector('.ui-card');

  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 100, height: 100 });
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 100 + below, height: 100 + below });
  Object.defineProperty(root, 'scrollHeight', { value: 900 + overflow, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: 900, configurable: true });
  return scroller;
};

const varOf = (el) => el.style.getPropertyValue('--table-scroll-h');

/* The hook measures on an animation frame, so the assertion has to wait for
   one — two, since it schedules a second pass for the fonts landing. */
const frame = async (fn) => {
  await act(async () => {
    fn();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
};

afterEach(() => vi.restoreAllMocks());

describe('the region gets what the window has left', () => {
  it('takes the window, less everything above and the card below it', async () => {
    window.innerHeight = 900;
    render(<Harness />);
    const scroller = layout({ top: 300, below: 40, overflow: 0 });
    await frame(() => window.dispatchEvent(new Event('resize')));
    /* 900 − 300 above − 40 under it − 2, with no page padding in jsdom. */
    expect(varOf(scroller)).toBe('558px');
  });

  it('gives back whatever the page still overflows by', async () => {
    window.innerHeight = 900;
    render(<Harness />);
    /*
     * The measurement above cannot see a tip *under* the card, so the page was
     * left scrolling by exactly the height of it. The remainder is read off the
     * page and taken back.
     */
    const scroller = layout({ top: 300, below: 40, overflow: 74 });
    await frame(() => window.dispatchEvent(new Event('resize')));
    /* 100 measured − 74 still overflowing = 26, under the floor, so 160. */
    expect(varOf(scroller)).toBe('160px');
  });

  it('never shrinks a table below something worth reading', async () => {
    window.innerHeight = 300;
    render(<Harness />);
    const scroller = layout({ top: 280, below: 40, overflow: 0 });
    await frame(() => window.dispatchEvent(new Event('resize')));
    expect(varOf(scroller)).toBe('160px');
  });

  it('keeps a full-page report scrollbar at the viewport bottom', async () => {
    window.innerHeight = 900;
    render(<Harness fillViewport />);
    const scroller = layout({ top: 300, below: 0, overflow: 140 });
    await frame(() => window.dispatchEvent(new Event('resize')));
    expect(varOf(scroller)).toBe('598px');
  });
});
