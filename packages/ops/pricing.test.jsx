import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  one: vi.fn(),
  sample: vi.fn(),
  preview: vi.fn(),
  make: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  archive: vi.fn(),
  rollBack: vi.fn(),
  tax: vi.fn(),
  saveTax: vi.fn(),
}));
vi.mock('./api', () => ({
  opsPricing: () => api.list(),
  opsPriceBook: (id) => api.one(id),
  opsSamplePlans: () => api.sample(),
  opsPricePreview: (b) => api.preview(b),
  opsNewPriceBook: (b) => api.make(b),
  opsSavePriceBook: (id, b) => api.save(id, b),
  opsPublishPriceBook: (id) => api.publish(id),
  opsArchivePriceBook: (id) => api.archive(id),
  opsRollBackPriceBook: (id) => api.rollBack(id),
  opsTax: () => api.tax(),
  opsSaveTax: (b) => api.saveTax(b),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Pricing } from './Pricing';
import { Settings } from './Settings';
import { inr, rupeesText, toPaise } from './money';

const apps = [
  { code: 'accounting', name: 'Books', available: true },
  { code: 'payroll', name: 'Payroll', available: true },
  { code: 'projects', name: 'Projects', available: false },
];
const tax = { registered: false, gstin: null, legalName: null, stateCode: null, sac: null, ratePercent: 18, note: 'No GST is charged: CLOR is not registered for GST yet. The price shown is what you pay.' };
const starter = {
  code: 'books-starter', name: 'Books Starter', description: null, apps: ['accounting'], unit: 'USER', includedUnits: 1, trialDays: 30, periods: ['MONTHLY', 'YEARLY'], yearlyDiscountPct: null,
  displayOrder: 10, showOnWebsite: true, highlight: false, gstApplies: true,
  prices: [{ period: 'MONTHLY', basePrice: 30000, extraUnitPrice: 30000 }, { period: 'YEARLY', basePrice: 300000, extraUnitPrice: 300000 }],
};
const draft = { id: 'b2', version: 2, status: 'DRAFT', note: 'Sample prices — not final', plans: [starter] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.preview.mockResolvedValue({ problems: [], cards: [], hidden: [], quote: null, gst: { note: tax.note } });
});

describe('money in the console', () => {
  it('reads rupees as paise without floats, and writes them back', () => {
    expect(toPaise('1,250.5')).toBe(125050);
    expect(toPaise('₹ 499')).toBe(49900);
    expect(toPaise('0.07')).toBe(7);
    expect(toPaise('12.345')).toBeNull();
    expect(toPaise('-5')).toBeNull();
    expect(rupeesText(125050)).toBe('1250.50');
    expect(rupeesText(30000)).toBe('300');
    expect(inr(12345650)).toBe('₹1,23,456.50');
  });
});

describe('Pricing in the operator console', () => {
  it('lists the versions and says when nothing is on clor.in', async () => {
    api.list.mockResolvedValue({ books: [{ id: 'b1', version: 1, status: 'ARCHIVED', planCount: 8, note: 'Sample', publishedAt: '2026-11-09T05:00:00Z' }], tax, apps });
    render(<Pricing role="BILLING" />);
    expect(await screen.findByText('Nothing published: clor.in shows Request a demo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Version 1' })).toBeInTheDocument();
    expect(screen.getByText(/No GST is charged/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New price book' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make the draft' }));
    await waitFor(() => expect(api.make).toHaveBeenCalledWith({ empty: true }));
  });

  it('edits a plan in rupees, saves paise, and publishes only once saved', async () => {
    api.list.mockResolvedValue({ books: [draft], tax, apps });
    api.one.mockResolvedValue({ book: draft });
    api.save.mockResolvedValue({ book: draft });
    api.publish.mockResolvedValue({ book: { ...draft, status: 'PUBLISHED' } });
    render(<Pricing role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the draft' }));
    expect(await screen.findByText('Version 2, draft')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Plans in the order/ });
    expect(within(table).getByText('₹300')).toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: 'Books Starter' }));
    const monthly = await screen.findByLabelText('Monthly price, ₹');
    fireEvent.change(monthly, { target: { value: '349.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Changes not saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const [, body] = api.save.mock.calls[0];
    expect(body.plans[0].prices).toEqual([{ period: 'MONTHLY', basePrice: 34950, extraUnitPrice: 30000 }, { period: 'YEARLY', basePrice: 300000, extraUnitPrice: 300000 }]);
  });

  it('turns a yearly price into a discount on twelve months', async () => {
    api.list.mockResolvedValue({ books: [draft], tax, apps });
    api.one.mockResolvedValue({ book: draft });
    api.save.mockResolvedValue({ book: draft });
    render(<Pricing role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Books Starter' }));
    fireEvent.click(await screen.findByLabelText(/Twelve months of the monthly price/));
    fireEvent.change(screen.getByLabelText('Yearly discount, percent'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    /* ₹300 × 12 less 20% = ₹2,880, worked out as the engine does. */
    expect(screen.getByText('₹2,880')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][1].plans[0]).toMatchObject({ yearlyDiscountPct: 20, prices: [{ period: 'MONTHLY', basePrice: 30000, extraUnitPrice: 30000 }] });
  });

  it('loads the sample prices into an empty draft and publishes after a confirm', async () => {
    const empty = { ...draft, note: null, plans: [] };
    api.list.mockResolvedValue({ books: [empty], tax, apps });
    api.one.mockResolvedValueOnce({ book: empty }).mockResolvedValue({ book: draft });
    api.sample.mockResolvedValue({ plans: [starter], note: 'Sample prices — not final' });
    api.save.mockResolvedValue({ book: draft });
    api.publish.mockResolvedValue({ book: { ...draft, status: 'PUBLISHED' } });
    render(<Pricing role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load sample prices' }));
    expect(await screen.findByRole('button', { name: 'Books Starter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Its plans and prices go on clor.in/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' }).at(-1));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('b2'));
  });

  it('shows a support operator the prices without the buttons that change them', async () => {
    api.list.mockResolvedValue({ books: [], tax, apps });
    render(<Pricing role="SUPPORT" />);
    expect(await screen.findByText(/No price book yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New price book' })).toBeNull();
  });
});

describe('Settings, Tax', () => {
  it('fills the state from the GSTIN and saves the registration', async () => {
    api.tax.mockResolvedValue({ tax, rates: [0, 5, 12, 18, 28] });
    api.saveTax.mockResolvedValue({ tax: { ...tax, registered: true } });
    render(<Settings role="BILLING" />);
    fireEvent.click(await screen.findByLabelText(/CLOR is GST registered/));
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29aabcu9603r1zj' } });
    expect(screen.getByLabelText('State')).toHaveValue('29');
    fireEvent.change(screen.getByLabelText('Legal name'), { target: { value: 'Clor Applications Pvt Ltd' } });
    fireEvent.change(screen.getByLabelText('SAC code'), { target: { value: '998314' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveTax).toHaveBeenCalledWith({ registered: true, gstin: '29AABCU9603R1ZJ', legalName: 'Clor Applications Pvt Ltd', state: '29', sac: '998314', ratePercent: 18 }));
  });
});
