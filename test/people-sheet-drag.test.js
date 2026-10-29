import { afterEach, describe, expect, it, vi } from 'vitest';
import { project, rubberband, spring } from '@ui/components/ui/useSheetDrag';

/* A phone sheet dragged down (Apple's projection, rubber band and spring, owner 28 Oct 2026). */
describe('dragging a phone sheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('projects where a flick would come to rest, as scrolling slows down', () => {
    expect(project(0)).toBe(0);
    /* 1000 px/s carries about half a metre of screen at Apple's 0.998. */
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
  });

  it('gives less and less past the edge, never more than the pull', () => {
    const small = rubberband(-20, 600);
    const big = rubberband(-200, 600);
    expect(small).toBeLessThan(0);
    expect(Math.abs(small)).toBeLessThan(20);
    expect(Math.abs(big)).toBeLessThan(200);
    expect(Math.abs(big) / 200).toBeLessThan(Math.abs(small) / 20);
  });

  it('springs to its target from where it is, can be stopped, and does not overshoot when critically damped', () => {
    let now = 0;
    const frames = [];
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const seen = [];
    let done = false;
    spring({ from: 0, to: 300, velocity: 1500, damping: 1, response: 0.3, onUpdate: (x) => seen.push(x), onDone: () => { done = true; } });
    for (let i = 0; i < 120 && !done; i += 1) { now += 16; frames.shift()?.(now); }
    expect(done).toBe(true);
    expect(seen.at(-1)).toBe(300);
    expect(Math.max(...seen)).toBeLessThanOrEqual(300.5);
    /* Stopped mid-flight, it stays where it is. */
    now = 0; frames.length = 0;
    const s = spring({ from: 0, to: 300, onUpdate: () => {} });
    for (let i = 0; i < 3; i += 1) { now += 16; frames.shift()?.(now); }
    const at = s.value;
    s.stop();
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(300);
  });
});
