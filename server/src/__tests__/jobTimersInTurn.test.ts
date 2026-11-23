import { describe, it, expect, vi, afterEach } from 'vitest';
import { inTurn, takingTurns, jobTimersInTurn } from '../services/jobRegistry.js';

/* In-process job timers take turns, so ticks that came due together do not all
   grab the database at once (services/jobRegistry.ts, 23 Nov 2026). */

const later = () => {
  let done!: () => void;
  const p = new Promise<void>((r) => (done = r));
  return { p, done };
};
const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => vi.useRealTimers());

describe('inTurn', () => {
  it('runs one at a time by default and the next when one ends', async () => {
    const a = later();
    const order: string[] = [];
    const first = inTurn(async () => { order.push('a start'); await a.p; order.push('a end'); });
    const second = inTurn(() => { order.push('b'); });
    await flush();
    expect(order).toEqual(['a start']);
    a.done();
    await Promise.all([first, second]);
    expect(order).toEqual(['a start', 'a end', 'b']);
  });

  it('allows more at once when asked', async () => {
    const a = later();
    const ran: string[] = [];
    const one = inTurn(async () => { ran.push('a'); await a.p; }, 2);
    const two = inTurn(() => { ran.push('b'); }, 2);
    await two;
    expect(ran).toEqual(['a', 'b']);
    a.done();
    await one;
  });

  it('passes a failure on and still frees the turn', async () => {
    await expect(inTurn(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(inTurn(() => 7)).resolves.toBe(7);
  });
});

describe('takingTurns', () => {
  it('does not queue a callback twice while it is still running', async () => {
    const a = later();
    let runs = 0;
    const cb = takingTurns(async () => { runs += 1; await a.p; });
    cb(); cb(); cb();
    await flush();
    expect(runs).toBe(1);
    a.done();
    await flush(); await flush();
    cb();
    await flush();
    expect(runs).toBe(2);
  });

  it('logs a failure instead of leaving it unhandled', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    takingTurns(() => { throw new Error('tick broke'); }, 'demo')();
    await flush(); await flush();
    expect(err.mock.calls.some((c) => String(c[0]).includes('demo') && String(c[1]).includes('tick broke'))).toBe(true);
    err.mockRestore();
  });
});

describe('jobTimersInTurn', () => {
  it('makes timers set up inside it take turns, and restores the real timers after', async () => {
    const realInterval = globalThis.setInterval;
    const realTimeout = globalThis.setTimeout;
    const a = later();
    const order: string[] = [];
    const handles: Array<ReturnType<typeof setTimeout>> = [];
    jobTimersInTurn(() => {
      handles.push(setTimeout(async () => { order.push('slow start'); await a.p; order.push('slow end'); }, 1));
      handles.push(setTimeout(() => { order.push('quick'); }, 1));
    });
    expect(globalThis.setInterval).toBe(realInterval);
    expect(globalThis.setTimeout).toBe(realTimeout);
    await new Promise((r) => realTimeout(r, 20));
    expect(order).toEqual(['slow start']);
    a.done();
    await new Promise((r) => realTimeout(r, 5));
    expect(order).toEqual(['slow start', 'slow end', 'quick']);
    handles.forEach((h) => clearTimeout(h));
  });

  it('restores the real timers even when a start call throws', () => {
    const realTimeout = globalThis.setTimeout;
    expect(() => jobTimersInTurn(() => { throw new Error('start failed'); })).toThrow('start failed');
    expect(globalThis.setTimeout).toBe(realTimeout);
  });
});
