// @vitest-environment node
/*
 * clor.in's router decisions (website/src/history.js): Back and Forward put the
 * reader where they were, a "#section" link stays on its section, and a
 * half-filled form asks before an in-site link leaves it.
 */
import { describe, expect, it, vi } from 'vitest';
import { addLeaveGuard, hasUnsaved, mayLeave, scrollOnPop } from '../website/src/history.js';

describe('scrollOnPop', () => {
  it('restores the scroll an entry remembered', () => {
    expect(scrollOnPop('/pricing', '/', { scrollY: 1240 })).toBe(1240);
    expect(scrollOnPop('/', '/', { scrollY: 0 })).toBe(0);
  });

  it('leaves the scroll alone when only the hash changed on the same page', () => {
    expect(scrollOnPop('/', '/', null)).toBeNull();
    expect(scrollOnPop('/products/books', '/products/books', {})).toBeNull();
  });

  it('opens another page with nothing remembered at its top', () => {
    expect(scrollOnPop('/', '/pricing', null)).toBe(0);
  });
});

describe('leave guards', () => {
  it('lets a move go ahead when nothing is unsaved, without asking', () => {
    const ask = vi.fn();
    const off = addLeaveGuard({ dirty: () => false, message: () => 'x' });
    expect(hasUnsaved()).toBe(false);
    expect(mayLeave(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    off();
  });

  it('asks with the page’s own words while a form is dirty, and follows the answer', () => {
    let dirty = true;
    const off = addLeaveGuard({ dirty: () => dirty, message: () => 'Your demo request is not sent yet.' });
    expect(hasUnsaved()).toBe(true);
    const no = vi.fn(() => false);
    expect(mayLeave(no)).toBe(false);
    expect(no).toHaveBeenCalledWith('Your demo request is not sent yet.');
    expect(mayLeave(() => true)).toBe(true);
    dirty = false;
    expect(mayLeave(no)).toBe(true);
    off();
  });

  it('stops asking once the page has gone', () => {
    const off = addLeaveGuard({ dirty: () => true, message: () => '' });
    off();
    expect(hasUnsaved()).toBe(false);
    expect(mayLeave(() => false)).toBe(true);
  });
});
