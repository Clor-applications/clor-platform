/* global process */
import '@testing-library/jest-dom/vitest';

/*
 * jsdom implements no layout, so these two are simply absent. Both are called
 * for their visual effect only — keeping a highlighted row on screen, and
 * pointing a panel at its anchor — so a no-op is the honest stand-in rather
 * than something that would make a test pass for the wrong reason.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/*
 * TEST_TODAY runs the suite as if it were another moment, to prove no test is
 * tied to the day it was written (main went red on 1 Nov 2026 for exactly
 * that): TEST_TODAY=2026-12-31T23:30:00+05:30 npm run test:web
 * The clock is moved, not stopped: it keeps running from that moment, and a
 * test's own vi.useFakeTimers() still works on top of it.
 */
if (process.env.TEST_TODAY) shiftClock(process.env.TEST_TODAY);

function shiftClock(when) {
  const RealDate = Date;
  const at = new RealDate(when).getTime();
  if (Number.isNaN(at)) throw new Error(`TEST_TODAY is not a date: ${when}`);
  const offset = at - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(RealDate.now() + offset);
    }
    static now() { return RealDate.now() + offset; }
    static [Symbol.hasInstance](x) { return x instanceof RealDate; }
  }
  globalThis.Date = ShiftedDate;
}
