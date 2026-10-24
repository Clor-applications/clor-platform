import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/*
 * A-32 (Batch 5): a reminder sent by someone who may not make a new link goes
 * without one — and now says so, instead of the link silently vanishing from
 * the message. A link to a cancelled invoice says the seller cancelled it.
 */

const apiFetch = vi.fn();
vi.mock('@platform/http', () => ({
  apiFetch: (...args) => apiFetch(...args),
  authHeaders: () => ({}),
}));

const { setPlatformContext } = await import('@platform/context');
const { reminderLink } = await import('../../api/share');
const { default: SharedInvoice } = await import('./SharedInvoice');

/* Built when the mock is called, so no rejected promise is left lying around. */
const failing = (status, code, message = 'x') => () => Promise.reject(Object.assign(new Error(message), { status, code }));

beforeEach(() => {
  apiFetch.mockReset();
  setPlatformContext({ orgId: 'org_1' });
});

describe('the link a reminder carries', () => {
  it('is the invoice’s address when there is one', async () => {
    apiFetch.mockResolvedValue({ token: 'tok_abc' });
    const r = await reminderLink('inv_1');
    expect(r.url).toBe(`${window.location.origin}/?share=tok_abc`);
    expect(r.note).toBe('');
  });

  it('is left out, with a reason, when the person may not make one', async () => {
    apiFetch.mockImplementation(failing(403, 'SHARE_LINK_NEEDS_EDIT'));
    const r = await reminderLink('inv_1');
    expect(r.url).toBe('');
    expect(r.note).toMatch(/only someone who can edit invoices/);
  });

  it('is left out, with a reason, when it could not be made', async () => {
    apiFetch.mockImplementation(failing(500, null));
    expect((await reminderLink('inv_1')).note).toMatch(/could not be made/);
  });

  it('is not asked for an invoice that is not on the server yet', async () => {
    expect(await reminderLink('')).toEqual({ url: '', note: '' });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('the page a customer opens', () => {
  it('says the seller cancelled the invoice', async () => {
    apiFetch.mockImplementation(failing(410, 'INVOICE_CANCELLED', 'This invoice was cancelled by Acme Traders.'));
    render(<SharedInvoice token="tok_abc" />);
    await waitFor(() => expect(screen.getByText('This invoice was cancelled by Acme Traders.')).toBeTruthy());
  });

  it('a withdrawn link is still the plain "no longer available"', async () => {
    apiFetch.mockImplementation(failing(404, null, 'This link is no longer available'));
    render(<SharedInvoice token="tok_abc" />);
    await waitFor(() => expect(screen.getByText('This link is no longer available')).toBeTruthy());
  });

  it('asks not to be indexed or passed on as a referrer', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    render(<SharedInvoice token="tok_abc" />);
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(/noindex/);
  });
});
