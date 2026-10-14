import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../api/purchaseDocs', () => ({ hasApiSession: vi.fn(() => true) }));
vi.mock('../api/stockLedger', () => ({ getStockOnHand: vi.fn() }));

import { hasApiSession } from '../api/purchaseDocs';
import { getStockOnHand } from '../api/stockLedger';
import { useServerOnHand } from './useServerOnHand';

describe('the server count on a sales form', () => {
  beforeEach(() => {
    vi.mocked(getStockOnHand).mockReset();
    vi.mocked(hasApiSession).mockReturnValue(true);
  });

  it('asks once for the distinct items on the form, in the chosen warehouse', async () => {
    vi.mocked(getStockOnHand).mockResolvedValue({ onHand: [{ itemId: 'itm-mango', qty: 8 }] });
    const { result } = renderHook(() => useServerOnHand(['itm-mango', '', 'itm-mango', 'itm-apple'], 'wh-1'));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(getStockOnHand).toHaveBeenCalledWith({ warehouseId: 'wh-1', itemIds: ['itm-apple', 'itm-mango'] });
    expect(result.current.get('itm-mango')).toBe(8);
    expect(result.current.get('itm-apple')).toBeUndefined(); // none on hand
  });

  it('stays null offline, so the form keeps its own count', async () => {
    vi.mocked(getStockOnHand).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useServerOnHand(['itm-mango'], ''));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });

  it('asks nothing without a session or without items', () => {
    vi.mocked(hasApiSession).mockReturnValue(false);
    renderHook(() => useServerOnHand(['itm-mango'], ''));
    vi.mocked(hasApiSession).mockReturnValue(true);
    renderHook(() => useServerOnHand([], ''));
    expect(getStockOnHand).not.toHaveBeenCalled();
  });
});
