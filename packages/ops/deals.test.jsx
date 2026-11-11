import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  opsOffers: vi.fn(),
  opsOfferSave: vi.fn(),
  opsOfferStep: vi.fn(),
  opsCustomPlans: vi.fn(),
  opsCustomPlanSave: vi.fn(),
  opsCustomPlanArchive: vi.fn(),
  opsAccounts: vi.fn(),
  opsDealOptions: vi.fn(),
  opsDealQuote: vi.fn(),
  opsSetDeal: vi.fn(),
  opsSubscriptions: vi.fn(),
}));
vi.mock('./api', () => Object.fromEntries(Object.keys(api).map((k) => [k, (...a) => api[k](...a)])));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Offers } from './Offers';
import { CustomPlans } from './CustomPlans';
import { DealDrawer, Subscriptions } from './Deals';

const why = () => screen.getByLabelText('Why');
const last = (name) => {
  const b = screen.getAllByRole('button', { name });
  return b[b.length - 1];
};

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('operator console: offers', () => {
  it('makes an offer: code in capitals, rupees sent as paise', async () => {
    api.opsOffers.mockResolvedValue({ offers: [], counts: {}, plans: [{ code: 'books-growth', name: 'Books Growth' }] });
    api.opsOfferSave.mockResolvedValue({ offer: { code: 'FLAT500' } });
    render(<Offers role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'New offer' }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'flat500' } });
    expect(screen.getByLabelText('Code')).toHaveValue('FLAT500');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Five hundred off' } });
    fireEvent.click(screen.getByRole('radio', { name: 'An amount' }));
    fireEvent.change(screen.getByLabelText('Rupees off each period'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Books Growth' }));
    fireEvent.change(screen.getByLabelText('Lasts how many billing periods'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make offer' }));
    await waitFor(() =>
      expect(api.opsOfferSave).toHaveBeenCalledWith(null, expect.objectContaining({ code: 'FLAT500', kind: 'AMOUNT', value: 50000, planCodes: ['books-growth'], durationPeriods: 3, maxRedemptions: null })),
    );
  });

  it('an offer customers have taken keeps its price; only the name, last day and limit change', async () => {
    const o = { id: 'o1', code: 'DIWALI25', name: 'Diwali', kind: 'PERCENT', value: 25, planCodes: [], periods: [], durationPeriods: 3, startsAt: '2026-11-01T00:00:00Z', endsAt: null, maxRedemptions: 10, redemptions: 4, status: 'active' };
    api.opsOffers.mockResolvedValue({ offers: [o], counts: {}, plans: [] });
    api.opsOfferSave.mockResolvedValue({ offer: o });
    render(<Offers role="BILLING" />);
    const row = within(await screen.findByRole('list', { name: 'Offers' })).getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('25% off for the first 3 billing periods, on every plan.');
    expect(row).toHaveTextContent('4 of 10 taken');
    fireEvent.click(within(row).getByRole('button', { name: 'Change DIWALI25' }));
    expect(screen.getByText(/4 customers have taken this offer/)).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Diwali 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.opsOfferSave).toHaveBeenCalledWith('o1', { name: 'Diwali 2026', description: null, endsOn: null, maxRedemptions: 10 }));
  });

  it('read-only staff see offers but cannot make or change them', async () => {
    api.opsOffers.mockResolvedValue({ offers: [], counts: {}, plans: [] });
    render(<Offers role="READ_ONLY" />);
    expect(await screen.findByText(/No offers in force/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New offer' })).toBeNull();
  });
});

describe('operator console: custom plans', () => {
  it('makes a plan with monthly prices in rupees, sent as paise', async () => {
    api.opsCustomPlans.mockResolvedValue({ plans: [], apps: [{ code: 'people', name: 'People' }, { code: 'payroll', name: 'Payroll' }] });
    api.opsCustomPlanSave.mockResolvedValue({ plan: { name: 'Meridian special' } });
    render(<CustomPlans role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'New custom plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meridian special' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'People' }));
    fireEvent.change(screen.getByLabelText('Included in the price'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Monthly price, ₹'), { target: { value: '2,500' } });
    fireEvent.change(screen.getByLabelText('Each user more a month, ₹'), { target: { value: '80.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make plan' }));
    await waitFor(() =>
      expect(api.opsCustomPlanSave).toHaveBeenCalledWith(null, expect.objectContaining({ accountId: null, apps: ['people'], unit: 'USER', includedUnits: 25, monthlyPrice: 250000, monthlyExtra: 8050, yearlyPrice: null })),
    );
  });
});

describe('operator console: a subscription deal', () => {
  const plans = [
    { source: 'book', ref: 'books-growth', name: 'Books Growth', apps: ['accounting'], appNames: ['Books'], unit: 'USER', includedUnits: 1, monthly: { basePrice: 60000, extraUnitPrice: 60000 }, yearly: null, forThisCustomer: false },
    { source: 'custom', ref: 'cp1', name: 'Meridian special', apps: ['people'], appNames: ['People'], unit: 'EMPLOYEE', includedUnits: 25, monthly: { basePrice: 250000, extraUnitPrice: 8000 }, yearly: { basePrice: 2500000, extraUnitPrice: 80000 }, forThisCustomer: true },
  ];
  const deal = { plan: { name: 'Meridian special' }, period: 'MONTHLY', quantity: 30, listAmount: 290000, discount: 29000, periodAmount: 261000, tax: { charged: false, amount: 0 }, total: 261000, offer: { code: 'TEN', words: '10% off for 3 months' } };

  it('starts on the plan made for them, prices it live with the offer, and sets it with a reason', async () => {
    api.opsDealOptions.mockResolvedValue({ plans, offers: [{ code: 'TEN', words: '10% off for 3 billing periods', planCodes: [], periods: [] }, { code: 'GROWTHONLY', words: '5% off', planCodes: ['books-growth'], periods: [] }], current: null });
    api.opsDealQuote.mockResolvedValue({ deal });
    api.opsSetDeal.mockResolvedValue({ invoiceId: 'inv1' });
    const onDone = vi.fn();
    render(<DealDrawer open account={{ id: 'acc', name: 'Meridian' }} onClose={() => {}} onDone={onDone} />);
    expect(await screen.findByRole('combobox', { name: 'Plan' })).toHaveValue('custom:cp1');
    /* An offer for another plan is not offered. */
    expect(screen.queryByRole('option', { name: /GROWTHONLY/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('How many employees'), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Offer' }), { target: { value: 'TEN' } });
    await waitFor(() => expect(api.opsDealQuote).toHaveBeenLastCalledWith('acc', { source: 'custom', ref: 'cp1', period: 'MONTHLY', quantity: 30, offerCode: 'TEN' }));
    expect(screen.getByText('−₹290 (10% off for 3 months)')).toBeInTheDocument();
    expect(screen.getAllByText('₹2,610 a month').length).toBeGreaterThan(0);
    fireEvent.change(why(), { target: { value: 'Signed the order form' } });
    fireEvent.click(last('Set subscription'));
    await waitFor(() =>
      expect(api.opsSetDeal).toHaveBeenCalledWith('acc', expect.objectContaining({ source: 'custom', ref: 'cp1', quantity: 30, offerCode: 'TEN', status: 'active', draftInvoice: true, reason: 'Signed the order form' })),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('says a big discount needs a second person, and sends it for approval', async () => {
    api.opsDealOptions.mockResolvedValue({ plans, offers: [{ code: 'TEN', words: '40% off', planCodes: [], periods: [] }], current: null });
    api.opsDealQuote.mockResolvedValue({ deal, needsApproval: true, limit: 20 });
    api.opsSetDeal.mockResolvedValue({ needsApproval: true, approval: { id: 'ap1', status: 'PENDING' } });
    const onDone = vi.fn();
    render(<DealDrawer open account={{ id: 'acc', name: 'Meridian' }} onClose={() => {}} onDone={onDone} />);
    expect(await screen.findByText(/takes more than 20% off the list price, so a second person must approve it/)).toBeInTheDocument();
    fireEvent.change(why(), { target: { value: 'Matching a rival quote' } });
    fireEvent.click(last('Ask for approval'));
    await waitFor(() => expect(api.opsSetDeal).toHaveBeenCalledWith('acc', expect.objectContaining({ reason: 'Matching a rival quote' })));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('operator console: subscriptions', () => {
  it('lists what each customer pays and the monthly total', async () => {
    api.opsSubscriptions.mockResolvedValue({
      monthly: 361000,
      subscriptions: [{ accountId: 'a', name: 'Meridian', status: 'active', apps: ['people'], planName: 'Meridian special', unit: 'EMPLOYEE', quantity: 30, interval: 'month', amount: 261000, listAmount: 290000, offerCode: 'TEN', offerEndsAt: '2027-02-15T00:00:00Z', renewsAt: '2026-12-15T00:00:00Z' }],
    });
    const open = vi.fn();
    render(<Subscriptions openCustomer={open} />);
    expect(await screen.findByText('₹3,610 a month from active customers')).toBeInTheDocument();
    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveTextContent('₹2,610 / mo');
    expect(row).toHaveTextContent('30 employees');
    fireEvent.click(within(row).getByRole('button', { name: 'Meridian' }));
    expect(open).toHaveBeenCalledWith('a');
  });
});
