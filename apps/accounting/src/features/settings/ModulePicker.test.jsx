import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getEntitlement = vi.fn();
const getFeatureCatalog = vi.fn();
const setFeaturesApi = vi.fn();
vi.mock('@ui/api/features', () => ({
  getEntitlement: (...a) => getEntitlement(...a),
  getFeatureCatalog: (...a) => getFeatureCatalog(...a),
  setFeatures: (...a) => setFeaturesApi(...a),
}));

import ModulePicker from './ModulePicker';

/**
 * The module picker asks "what do you use?" at the level a business owner can
 * answer. The forty individual switches are right for someone tuning a working
 * system and wrong for someone who signed up ten seconds ago — nobody knows
 * whether they want `batchSerial`, and everybody knows whether they hold stock.
 */

const packs = [
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Stock, warehouses, transfers.',
    features: ['warehouses', 'stockTransfers'],
    entitled: true,
    fullyEntitled: true,
    upgradeHint: null,
  },
  {
    key: 'compliance',
    label: 'GST & Compliance',
    description: 'e-invoicing and returns.',
    features: ['einvoice', 'gstr'],
    entitled: false,
    fullyEntitled: false,
    upgradeHint: 'Available on the Growth plan',
  },
];

const catalogWith = (values) => ({
  features: Object.entries(values).map(([key, enabled]) => ({ key, enabled })),
});

beforeEach(() => {
  getEntitlement.mockReset().mockResolvedValue({ packs });
  getFeatureCatalog
    .mockReset()
    .mockResolvedValue(catalogWith({ warehouses: false, stockTransfers: false, einvoice: false, gstr: false }));
  setFeaturesApi.mockReset().mockResolvedValue({});
});

describe('the module picker', () => {
  it('offers packs as checkboxes, not the forty switches underneath them', async () => {
    render(<ModulePicker />);
    expect(await screen.findByRole('checkbox', { name: /Inventory/ })).toBeInTheDocument();
    expect(screen.queryByText('warehouses')).toBeNull();
  });

  /* Turning a pack on completes the set beneath it in one action. */
  it('switches on every feature in the pack', async () => {
    const user = userEvent.setup();
    render(<ModulePicker />);
    await user.click(await screen.findByRole('checkbox', { name: /Inventory/ }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(setFeaturesApi).toHaveBeenCalledTimes(1));
    const sent = setFeaturesApi.mock.calls[0][0];
    expect(sent.warehouses).toBe(true);
    expect(sent.stockTransfers).toBe(true);
    // Nothing outside the pack was touched.
    expect(sent.einvoice).toBe(false);
  });

  /*
   * A pack the plan does not carry is shown locked with the plan that does.
   * Hiding it reads as a product that cannot do the thing, which is untrue and
   * a lost sale; showing it as ordinary and failing on save is worse.
   */
  it('shows an unentitled pack, locked, naming the plan that carries it', async () => {
    render(<ModulePicker />);
    const locked = await screen.findByRole('checkbox', { name: /GST & Compliance/ });
    expect(locked).toBeDisabled();
    expect(screen.getByText('Available on the Growth plan')).toBeInTheDocument();
  });

  it('will not send an unentitled feature even if the control is reached', async () => {
    const user = userEvent.setup();
    render(<ModulePicker />);
    await user.click(await screen.findByRole('checkbox', { name: /GST & Compliance/ }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(setFeaturesApi).toHaveBeenCalled());
    expect(setFeaturesApi.mock.calls[0][0].einvoice).toBe(false);
  });

  /* A pack reads as on only when everything under it is on. */
  it('shows a half-configured pack as off rather than as chosen', async () => {
    getFeatureCatalog.mockResolvedValue(
      catalogWith({ warehouses: true, stockTransfers: false, einvoice: false, gstr: false })
    );
    render(<ModulePicker />);
    expect(await screen.findByRole('checkbox', { name: /Inventory/ })).not.toBeChecked();
  });

  it('tells the wizard when it is done, so onboarding can advance', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    render(<ModulePicker onDone={done} submitLabel="Continue" />);
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });
});
