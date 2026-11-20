import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Workspace → Company → Company profile: round 64 "companyprofile" A, one page in four flat sections. */
const api = vi.hoisted(() => ({ apiFetch: vi.fn(), me: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => api.apiFetch(...a) }));
vi.mock('@platform/auth', () => ({ me: () => api.me() }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', requestOpenScreen: vi.fn(), requestOpenHelp: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: (...a) => api.success(...a), error: (...a) => api.error(...a) } }));

const { default: CompanyProfile } = await import('./CompanyProfile');

const COMPANY = {
  name: 'Kaveri Traders', code: 'KAVE', legalName: 'Kaveri Traders Private Limited', pan: 'AABCK1234D', tan: '', cin: '',
  industry: '', addressLine: '12 MG Road', city: 'Bengaluru', pincode: '560001', phone: '', email: '', website: '',
  epfCode: '', esicCode: '', ptRegistration: '', lwfRegistration: '', state: 'Karnataka', gstin: '',
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.apiFetch.mockImplementation((_url, o = {}) => Promise.resolve({ company: o.method === 'PUT' ? { ...COMPANY, ...o.body } : COMPANY }));
  api.me.mockResolvedValue({ orgs: [{ orgId: 'org1', org: { profile: { companySettings: { logo: 'data:image/png;base64,BBBB' } } } }] });
});

describe('Company profile', () => {
  it('is one page grouped as Identity, Address, Tax numbers and Logo, saying where each is used', async () => {
    render(<CompanyProfile />);
    expect(await screen.findByDisplayValue('Kaveri Traders Private Limited')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Identity', 'Address', 'Tax numbers', 'Logo']);
    const address = screen.getByRole('region', { name: 'Address' });
    expect(within(address).getByText('Karnataka')).toBeInTheDocument();
    expect(within(address).getByText('Used on: e-invoices')).toBeInTheDocument();
    const tax = screen.getByRole('region', { name: 'Tax numbers' });
    expect(within(tax).getByText('Not registered')).toBeInTheDocument();
    expect(within(tax).getByText('Used on: Form 16 and Form 24Q')).toBeInTheDocument();
    expect(within(tax).getByText('1 of 6 filled in')).toBeInTheDocument();
    const logo = screen.getByRole('region', { name: 'Logo' });
    expect(await within(logo).findByRole('img', { name: 'Kaveri Traders logo' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Save changes/ })).toHaveLength(1);
  });

  it('keeps the page when the logo cannot be read, and saves the typed fields', async () => {
    api.me.mockRejectedValue(new Error('offline'));
    render(<CompanyProfile />);
    const save = await screen.findByRole('button', { name: /Save changes/ });
    expect(save).toBeDisabled();
    expect(await screen.findByText('No logo yet')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /EPF establishment code/ }), { target: { value: 'KNBNG0012345000' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.success).toHaveBeenCalledWith('Company profile saved.'));
    const [, opts] = api.apiFetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(opts.body.epfCode).toBe('KNBNG0012345000');
    expect(Object.keys(opts.body)).not.toContain('name');
  });

  it('a failed read offers a retry', async () => {
    api.apiFetch.mockRejectedValueOnce(new Error('down'));
    render(<CompanyProfile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByDisplayValue('Kaveri Traders Private Limited')).toBeInTheDocument();
  });
});

