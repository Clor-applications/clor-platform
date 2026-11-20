import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listAudit: vi.fn(), listAuditFacets: vi.fn() }));
vi.mock('@platform/admin/audit', () => ({ listAudit: (f) => api.listAudit(f), listAuditFacets: () => api.listAuditFacets() }));
vi.mock('@platform/context', () => ({ hasApp: () => true, requestOpenScreen: vi.fn() }));
vi.mock('@ui/components/ListToolbar', () => ({ exportRows: vi.fn() }));

import AuditTrail from './AuditTrail';

const entry = (id, message) => ({ id, at: new Date().toISOString(), action: 'UPDATE', entity: 'INVOICE', message, by: { name: 'Asha' } });

beforeEach(() => {
  api.listAuditFacets.mockReset().mockResolvedValue({ entities: [], actions: [] });
  api.listAudit.mockReset().mockResolvedValue({ entries: [entry('a1', 'Invoice INV-7 edited')] });
});

/* Audit 21 Nov 2026: every key asked the server, and a slow early reply could replace a later one. */
describe('Audit trail search', () => {
  it('asks once, 250ms after the last key, and drops a stale reply', async () => {
    render(<AuditTrail />);
    await screen.findByText('Invoice INV-7 edited');
    let slow;
    api.listAudit.mockImplementationOnce(() => new Promise((r) => { slow = r; }));
    api.listAudit.mockResolvedValueOnce({ entries: [entry('a3', 'Invoice INV-9 edited')] });
    const box = screen.getByPlaceholderText('Search by record or what happened');
    fireEvent.change(box, { target: { value: 'I' } });
    fireEvent.change(box, { target: { value: 'IN' } });
    await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'IN' })));
    expect(api.listAudit.mock.calls.filter(([f]) => f.q === 'I')).toHaveLength(0);
    fireEvent.change(box, { target: { value: 'INV-9' } });
    await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'INV-9' })));
    expect(await screen.findByText('Invoice INV-9 edited')).toBeInTheDocument();
    slow({ entries: [entry('a2', 'Stale reply')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Stale reply')).toBeNull();
  });

  it('a failed load offers a retry instead of "Nothing matches"', async () => {
    api.listAudit.mockRejectedValueOnce(new Error('down'));
    render(<AuditTrail />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText('Nothing matches these filters.')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('Invoice INV-7 edited')).toBeInTheDocument();
  });
});
