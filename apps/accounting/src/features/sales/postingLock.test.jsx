import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Whether a document is still in the books — the question the invoice form asks
 * before it offers its financial controls.
 *
 * The naive query is wrong in a way that matters: a reversal copies the
 * original's source document, so after a cancellation the only POSTED entry
 * for an invoice is the contra that undid it. Asking "is there a POSTED entry?"
 * answers yes for an invoice whose effect has already been withdrawn, and would
 * lock a cancelled invoice's form for a posting that no longer exists.
 */

const apiFetch = vi.fn();
vi.mock('@platform/http', () => ({
  apiFetch: (...args) => apiFetch(...args),
  authHeaders: () => ({}),
}));

const { getDocumentPostings } = await import('@ui/api/ledger');
const { usePostingLock } = await import('./usePostingLock');

const entry = (id, status, reversedById = null) => ({ id, entryNo: id, status, reversedById });

beforeEach(() => {
  apiFetch.mockReset();
  localStorage.setItem('activeOrgId', 'org-1');
});

describe('what counts as still in the books', () => {
  it('is a posted entry nothing has reversed', async () => {
    apiFetch.mockResolvedValue({ entries: [entry('a', 'POSTED')] });
    await expect(getDocumentPostings('INVOICE', 'inv-1')).resolves.toHaveLength(1);
  });

  it('is not the contra left behind by a cancellation', async () => {
    /* The shape a cancelled invoice actually has: the original marked REVERSED
       and pointing at the contra, and the contra itself POSTED. */
    apiFetch.mockResolvedValue({
      entries: [entry('contra', 'POSTED'), entry('original', 'REVERSED', 'contra')],
    });
    await expect(getDocumentPostings('INVOICE', 'inv-1')).resolves.toEqual([]);
  });

  it('asks about one document, not the whole ledger', async () => {
    apiFetch.mockResolvedValue({ entries: [] });
    await getDocumentPostings('INVOICE', 'inv-42');
    const url = String(apiFetch.mock.calls[0][0]);
    expect(url).toContain('docType=INVOICE');
    expect(url).toContain('docId=inv-42');
  });

  it('does not ask at all for a document that has never been saved', async () => {
    await expect(getDocumentPostings('INVOICE', '')).resolves.toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('the form’s lock', () => {
  it('closes the financial controls when the document is in the books', async () => {
    apiFetch.mockResolvedValue({ entries: [entry('a', 'POSTED')] });
    const { result } = renderHook(() => usePostingLock('INVOICE', 'inv-1'));
    await waitFor(() => expect(result.current.state).toBe('locked'));
    expect(result.current.locked).toBe(true);
  });

  it('leaves them open for a document that is not', async () => {
    apiFetch.mockResolvedValue({ entries: [] });
    const { result } = renderHook(() => usePostingLock('INVOICE', 'inv-1'));
    await waitFor(() => expect(result.current.state).toBe('open'));
    expect(result.current.locked).toBe(false);
  });

  it('fails open when the ledger will not answer', async () => {
    /* A salesperson without ledger permission gets a 403, and an offline
       browser gets nothing. Neither is evidence the invoice is unposted, and
       locking on it would take editing away from a draft over a dropped
       request. The server is still the authority either way. */
    apiFetch.mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => usePostingLock('INVOICE', 'inv-1'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(result.current.locked).toBe(false);
  });

  it('never answers for the previous document after switching', async () => {
    apiFetch.mockResolvedValue({ entries: [entry('a', 'POSTED')] });
    const { result, rerender } = renderHook(({ id }) => usePostingLock('INVOICE', id), {
      initialProps: { id: 'inv-1' },
    });
    await waitFor(() => expect(result.current.locked).toBe(true));

    apiFetch.mockResolvedValue({ entries: [] });
    rerender({ id: 'inv-2' });
    /* Not the old verdict while the new one is in flight. */
    expect(result.current.locked).toBe(false);
    await waitFor(() => expect(result.current.state).toBe('open'));
  });

  it('asks nothing for an invoice being raised for the first time', () => {
    const { result } = renderHook(() => usePostingLock('INVOICE', ''));
    expect(result.current).toEqual({ locked: false, state: 'open' });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
