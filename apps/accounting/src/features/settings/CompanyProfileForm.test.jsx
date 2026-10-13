import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CompanyProfileForm from './CompanyProfileForm';

const form = {
  logo: '',
  companyName: 'CLOR', legalName: 'CLOR Technologies Private Limited', incorporationDate: '',
  baseCurrency: 'INR', numberFormat: '12,34,567.89', dateFormat: 'DD-MM-YYYY',
  financialYearStart: '', booksBeginDate: '', regAddress1: '', regAddress2: '', regCountry: 'India',
  regStateCode: '', regCity: '', regPincode: '', phone: '', officialEmail: '', website: '', cin: '', pan: '', gstin: '',
};

describe('CompanyProfileForm', () => {
  it('shows only the requested profile fields in a two-column form', () => {
    const { container } = render(<CompanyProfileForm form={form} updateForm={() => {}} countryOptions={['India']} currencyOptions={['INR']} states={[["29", "Karnataka"]]} />);
    for (const label of ['Company Name', 'Legal Name', 'Address Line 1', 'Address Line 2', 'Country', 'State', 'City', 'PIN', 'Date of Incorporation', 'Mobile', 'Email', 'Website', 'Currency', 'CIN', 'PAN', 'GSTIN', 'Number Format', 'Date Format', 'Financial Year Begins From', 'Books Begin From']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Industry/)).toBeNull();
    expect(screen.queryByLabelText(/Entity Type/)).toBeNull();
    expect(container.querySelectorAll('.company-profile-grid')).toHaveLength(3);
  });

  it('sends field changes back to the profile state', () => {
    const updateForm = vi.fn();
    render(<CompanyProfileForm form={form} updateForm={updateForm} countryOptions={['India']} currencyOptions={['INR']} states={[["29", "Karnataka"]]} />);
    fireEvent.change(screen.getByLabelText('CIN'), { target: { value: 'u123' } });
    expect(updateForm).toHaveBeenCalledWith({ cin: 'U123' });
  });

  it('converts an uploaded logo into persistent company data', async () => {
    const updateForm = vi.fn();
    render(<CompanyProfileForm form={form} updateForm={updateForm} countryOptions={['India']} currencyOptions={['INR']} states={[["29", "Karnataka"]]} />);
    const logo = new File(['company-logo'], 'company-logo.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Upload company logo'), { target: { files: [logo] } });

    await waitFor(() => expect(updateForm).toHaveBeenCalledWith({
      logo: expect.stringMatching(/^data:image\/png;base64,/),
    }));
  });
});
