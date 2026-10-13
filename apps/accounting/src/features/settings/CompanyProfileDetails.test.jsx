import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import CompanyProfileDetails from './CompanyProfileDetails';

/*
 * Company Profile was a form that was always open, while Branches and
 * Warehouses — the two screens beside it under Organisation — showed the record
 * and opened a form only when asked. This is the read view that closes that
 * gap, so what it must do is *state what is stored*, including the parts that
 * are not.
 */

const form = {
  companyName: 'Sunrise Traders',
  legalName: 'Sunrise Traders Pvt Ltd',
  tradeName: '',
  entityType: 'Pvt Ltd',
  industries: ['Retail', 'Services'],
  incorporationDate: '2019-04-01',
  financialYearStart: '2026-04-01',
  booksBeginDate: '2026-04-01',
  baseCurrency: 'INR',
  country: 'India',
  timeZone: 'Asia/Kolkata',
  officialEmail: 'hello@sunrise.example',
  phone: '9876543210',
  website: '',
  regAddress1: '12 MG Road',
  regAddress2: '',
  regCity: 'Bengaluru',
  regStateCode: '29', // the GST code is what is stored
  regPincode: '560001',
  regCountry: 'India',
  cin: 'U12345KA2019PTC123456',
  pan: 'AABCU9603R',
  gstin: '29AABCU9603R1ZJ',
  numberFormat: '12,34,567.89',
  dateFormat: 'DD-MM-YYYY',
};

describe('the company shown as a record', () => {
  it('states the values that are stored', () => {
    render(<CompanyProfileDetails form={form} company={{ gstin: '29AABCU9603R1ZJ' }} />);
    expect(screen.getByText('Sunrise Traders Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('Sunrise Traders')).toBeInTheDocument();
    expect(screen.getByText('29AABCU9603R1ZJ')).toBeInTheDocument();
    expect(screen.getByText('12 MG Road')).toBeInTheDocument();
    expect(screen.getByText('Karnataka')).toBeInTheDocument();
    expect(screen.getByText('12,34,567.89')).toBeInTheDocument();
  });

  /*
   * The stored value is the GST state code. The form hides that behind a
   * <select> of names, so printing the stored value put a bare "29" where the
   * user had picked Karnataka.
   */
  it('names the state rather than printing its GST code', () => {
    render(<CompanyProfileDetails form={form} company={{}} />);
    const state = screen.getByText('State').parentElement;
    expect(state.textContent).toContain('Karnataka');
    expect(state.textContent).not.toContain('29');
  });

  /*
   * A field with nothing in it still gets a row. Dropping empty fields turns
   * "you never filled this in" into "this field does not exist", which is the
   * question a details view exists to answer.
   */
  it('shows an empty field as empty rather than hiding it', () => {
    render(<CompanyProfileDetails form={{ ...form, gstin: '' }} company={{}} />);
    const address2 = screen.getByText('Address Line 2').parentElement;
    expect(address2.textContent).toBe('Address Line 2');
    const website = screen.getByText('Website').parentElement;
    expect(website.textContent).toBe('Website');
    // No GSTIN on this company either.
    const gstin = screen.getByText('GSTIN').parentElement;
    expect(gstin.textContent).toBe('GSTIN');
  });

  it('uses the shared two-column profile grid', () => {
    const { container } = render(<CompanyProfileDetails form={form} company={{}} />);
    expect(container.querySelectorAll('.company-profile-grid')).toHaveLength(3);
  });
});
