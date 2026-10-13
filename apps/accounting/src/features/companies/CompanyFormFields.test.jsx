import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const lookupGstin = vi.fn();
vi.mock('@ui/api/masters', () => ({ lookupGstin: (...a) => lookupGstin(...a) }));
const notify = { success: vi.fn(), error: vi.fn() };
vi.mock('@ui/components/ui/notify', () => ({
  notify: { success: (...a) => notify.success(...a), error: (...a) => notify.error(...a) },
}));

import CompanyFormFields, { emptyCompanyForm, INDUSTRIES } from './CompanyFormFields';

/**
 * The company form at signup.
 *
 * A business used to arrive in its own books with a name and a state, so every
 * other thing an invoice needs had to be gone back for. Two of the gaps this
 * covers were reported after it shipped: three industries is a guess rather
 * than a list, and the GSTIN had no fetch beside it even though the customer
 * form has had one all along.
 */

const Host = ({ token = 'tok_1' }) => {
  const [form, setForm] = useState(emptyCompanyForm);
  return <CompanyFormFields form={form} setForm={setForm} authToken={token} />;
};

beforeEach(() => {
  lookupGstin.mockReset();
  notify.success.mockReset();
  notify.error.mockReset();
});

describe('industry', () => {
  it('offers a list somebody can actually find themselves in', () => {
    render(<Host />);
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(15);
    // The three it started with, and the ones that had nowhere to go.
    for (const name of ['Retail', 'Manufacturing', 'Transport & Logistics', 'Information Technology', 'Healthcare & Pharma']) {
      expect(screen.getByRole('checkbox', { name })).toBeInTheDocument();
    }
  });

  it('takes more than one', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('checkbox', { name: 'Retail' }));
    await user.click(screen.getByRole('checkbox', { name: 'E-commerce' }));
    expect(screen.getByRole('checkbox', { name: 'Retail' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'E-commerce' })).toBeChecked();
  });
});

describe('fetch from GSTN', () => {
  it('fills the state from the number', async () => {
    lookupGstin.mockResolvedValue({ state: 'Karnataka', pan: 'AABCU9603R', source: 'derived' });
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AABCU9603R1ZJ');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTN/i }));

    expect(await screen.findByDisplayValue('Karnataka')).toBeInTheDocument();
  });

  /*
   * The session exists at this point but nothing is in localStorage yet — that
   * happens once the company is created — so the token has to travel with the
   * call or the lookup answers 401 exactly when it is most useful.
   */
  it('carries the signup token, which is not in storage yet', async () => {
    lookupGstin.mockResolvedValue({ state: 'Karnataka' });
    const user = userEvent.setup();
    render(<Host token="signup_tok" />);

    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AABCU9603R1ZJ');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTN/i }));

    expect(lookupGstin).toHaveBeenCalledWith('29AABCU9603R1ZJ', 'signup_tok');
  });

  it('refuses a number that is not 15 characters, without calling out', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AAB');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTN/i }));
    expect(lookupGstin).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
  });

  /* Somebody who typed their address should not lose it to a lookup. */
  it('does not overwrite what has already been typed', async () => {
    lookupGstin.mockResolvedValue({ state: 'Karnataka', legalName: 'From Portal', address: { city: 'Portal City' } });
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByPlaceholderText('Knockbell Logistics Pvt Ltd'), 'My Own Name');
    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AABCU9603R1ZJ');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTN/i }));

    expect(await screen.findByDisplayValue('My Own Name')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('From Portal')).toBeNull();
  });
});
