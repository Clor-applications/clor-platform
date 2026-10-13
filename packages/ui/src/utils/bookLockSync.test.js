/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const locked = vi.fn();
const errors = vi.fn();
let signedIn = true;

vi.mock('../api/ledger', () => ({ lockFiscalYear: (...a) => locked(...a) }));
vi.mock('../api/purchaseDocs', () => ({ hasApiSession: () => signedIn }));
vi.mock('../components/ui/notify', () => ({ notify: { error: (...a) => errors(...a), success: vi.fn() } }));

import { fyNameFor, setBookLockOnServer } from './bookLockSync';

beforeEach(() => {
  locked.mockReset().mockResolvedValue({});
  errors.mockReset();
  signedIn = true;
});

describe('naming the fiscal year', () => {
  it('names it the way the server does, on both sides of April', () => {
    // A lock written against a year nobody posts into stops nothing.
    expect(fyNameFor('2027-03-31')).toBe('2026-27');
    expect(fyNameFor('2026-04-01')).toBe('2026-27');
    expect(fyNameFor('2026-03-31')).toBe('2025-26');
    expect(fyNameFor('2099-12-01')).toBe('2099-00');
  });
});

describe('closing the books on the server', () => {
  it('closes the year the date falls in', async () => {
    expect(await setBookLockOnServer({ fyDate: '2027-03-31', lockedThrough: '2027-03-31' })).toEqual({ ok: true });
    expect(locked).toHaveBeenCalledWith('2026-27', '2027-03-31');
  });

  it('still names a year when reopening', async () => {
    // The route locks a named year, so an unlock that passes no name reopens
    // nothing and the books stay shut with the screen saying otherwise.
    expect(await setBookLockOnServer({ fyDate: '2027-03-31', lockedThrough: null })).toEqual({ ok: true });
    expect(locked).toHaveBeenCalledWith('2026-27', null);
  });

  it('reports a refusal so the screen does not show a year as closed', async () => {
    locked.mockRejectedValue(new Error('forbidden'));

    expect(await setBookLockOnServer({ fyDate: '2027-03-31', lockedThrough: '2027-03-31' })).toEqual({ ok: false });
    expect(String(errors.mock.calls[0][0])).toMatch(/not closed on the server.*forbidden/);
  });

  it('lets a signed-out user close the books in their own copy', async () => {
    signedIn = false;
    expect(await setBookLockOnServer({ fyDate: '2027-03-31', lockedThrough: '2027-03-31' })).toEqual({ ok: true, local: true });
    expect(locked).not.toHaveBeenCalled();
  });
});
