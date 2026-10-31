import http from 'node:http';
import https from 'node:https';

/**
 * Disable HTTP keep-alive for the whole suite.
 *
 * Node 19+ turns keep-alive on for the global agent. supertest starts a fresh
 * server on an ephemeral port for every request, and when the OS reuses one of
 * those ports within the agent's 5-second keep-alive window, superagent hands
 * the new request a cached socket belonging to the previous, now-closed server.
 * The result is an intermittent "socket hang up" or "Parse Error: Expected
 * HTTP/" that has nothing to do with the test that hits it.
 *
 * With keep-alive off every request opens a fresh socket, which is the right
 * trade for a test suite: correctness over connection reuse.
 */
http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });

/*
 * TEST_TODAY runs the suite as if it were another moment, to prove no test is
 * tied to the day it was written (main went red on 1 Nov 2026 for exactly
 * that): TEST_TODAY=2026-12-31T23:30:00+05:30 npx vitest run ...
 * The clock is moved, not stopped: it keeps running from that moment, and a
 * test's own vi.useFakeTimers() still works on top of it. PostgreSQL's own
 * now() is not moved, so a column it defaults stays on the real clock.
 */
if (process.env.TEST_TODAY) shiftClock(process.env.TEST_TODAY);

function shiftClock(when: string) {
  const RealDate = Date;
  const at = new RealDate(when).getTime();
  if (Number.isNaN(at)) throw new Error(`TEST_TODAY is not a date: ${when}`);
  const offset = at - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length) super(...(args as []));
      else super(RealDate.now() + offset);
    }
    static now() { return RealDate.now() + offset; }
    static [Symbol.hasInstance](x: unknown) { return x instanceof RealDate; }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}
