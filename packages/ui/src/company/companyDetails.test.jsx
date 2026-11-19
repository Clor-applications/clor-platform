import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Round 64 "companyprofile" A (owner, 19 Nov 2026): the company details page is one page grouped as
 * Identity, Address, Tax numbers and Logo, and each field says where it is used. People → Settings →
 * Company details draws it; Workspace → Company profile draws the same model (apps/admin).
 */
const api = vi.hoisted(() => ({ apiFetch: vi.fn(), me: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => api.apiFetch(...a) }));
vi.mock('@platform/auth', () => ({ me: () => api.me() }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', requestOpenHelp: vi.fn() }));
vi.mock('../components/ui/notify', () => ({ notify: { success: (...a) => api.success(...a), error: (...a) => api.error(...a) } }));

const { default: CompanyDetails } = await import('./CompanyDetails');
const { EDITABLE, SECTIONS, bodyOf, filled, isDirty, logoFromMe, usedOn } = await import('./companyFields');

const COMPANY = {
  name: 'Kaveri Traders', code: 'KAVE', legalName: 'Kaveri Traders Private Limited', pan: 'AABCK1234D', tan: '', cin: 'U12345KA2020PTC123456',
  industry: 'Retail', addressLine: '12 MG Road', city: 'Bengaluru', pincode: '560001', phone: '', email: '', website: '',
  epfCode: '', esicCode: '', ptRegistration: '', lwfRegistration: '', state: 'Karnataka', gstin: '29AABCK1234D1Z5',
};
const ME = { orgs: [{ orgId: 'org2', org: { profile: {} } }, { orgId: 'org1', org: { profile: { companySettings: { logo: 'data:image/png;base64,AAAA' } } } }] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.apiFetch.mockImplementation((_url, o = {}) => Promise.resolve({ company: o.method === 'PUT' ? { ...COMPANY, ...o.body } : COMPANY }));
  api.me.mockResolvedValue(ME);
});

describe('the company details model', () => {
  it('groups the page as Identity, Address and Tax numbers, with every stored field kept', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Identity', 'Address', 'Tax numbers']);
    expect([...EDITABLE].sort()).toEqual(['addressLine', 'cin', 'city', 'email', 'epfCode', 'esicCode', 'industry', 'legalName', 'lwfRegistration', 'pan', 'phone', 'pincode', 'ptRegistration', 'tan', 'website']);
  });

  it('sends only the typed fields, never what Accounting owns', () => {
    const body = bodyOf(COMPANY);
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('gstin');
    expect(body).not.toHaveProperty('state');
    expect(body).not.toHaveProperty('code');
    expect(body.legalName).toBe('Kaveri Traders Private Limited');
  });

  it('counts and compares the typed fields only', () => {
    expect(filled(COMPANY, SECTIONS[0])).toBe(3);
    expect(isDirty(COMPANY, COMPANY)).toBe(false);
    expect(isDirty({ ...COMPANY, gstin: 'x' }, COMPANY)).toBe(false);
    expect(isDirty({ ...COMPANY, tan: 'BLRC12345D' }, COMPANY)).toBe(true);
  });

  it('reads the logo of this company from /auth/me', () => {
    expect(logoFromMe(ME, 'org1')).toBe('data:image/png;base64,AAAA');
    expect(logoFromMe(ME, 'org2')).toBe('');
    expect(logoFromMe(null, 'org1')).toBe('');
  });

  it('says "Used on" only where a use is known', () => {
    expect(usedOn('')).toBe('');
    expect(usedOn('Form 16')).toBe('Used on: Form 16');
    const used = Object.fromEntries(SECTIONS.flatMap((s) => s.fields).map(([k, , o = {}]) => [k, o.used || '']));
    expect(used.legalName).toMatch(/Form 16/);
    expect(used.pan).toMatch(/Form 16/);
    expect(used.epfCode).toBe('');
    expect(used.tan).toBe('');
  });
});

describe('People → Company details', () => {
  it('draws four sections with where each field is used, the logo and one Save', async () => {
    render(<CompanyDetails />);
    expect(await screen.findByDisplayValue('Kaveri Traders Private Limited')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Identity', 'Address', 'Tax numbers', 'Logo']);
    const identity = screen.getByRole('region', { name: 'Identity' });
    expect(within(identity).getByText('Kaveri Traders')).toBeInTheDocument();
    expect(within(identity).getByText('Used on: Form 16, Form 24Q and e-invoices')).toBeInTheDocument();
    const tax = screen.getByRole('region', { name: /Tax numbers/ });
    expect(within(tax).getByText('29AABCK1234D1Z5')).toBeInTheDocument();
    expect(within(tax).queryByRole('textbox', { name: /GSTIN/ })).toBeNull();
    const logo = screen.getByRole('region', { name: 'Logo' });
    expect(await within(logo).findByRole('img', { name: 'Kaveri Traders logo' })).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(within(logo).getByText('Used on: invoices and payment receipts')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(1);
  });

  it('saves the typed fields once something changed', async () => {
    render(<CompanyDetails />);
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /^TAN/ }), { target: { value: 'BLRC12345D' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.success).toHaveBeenCalledWith('Company details saved.'));
    const [, opts] = api.apiFetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(opts.body.tan).toBe('BLRC12345D');
    expect(opts.body).not.toHaveProperty('gstin');
  });

  it('says so when there is no logo', async () => {
    api.me.mockResolvedValue({ orgs: [] });
    render(<CompanyDetails />);
    expect(await screen.findByText('No logo yet')).toBeInTheDocument();
  });
});
