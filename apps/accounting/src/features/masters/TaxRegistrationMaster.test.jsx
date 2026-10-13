import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TaxRegistrationMaster from './TaxRegistrationMaster';

describe('TaxRegistrationMaster', () => {
  it('keeps GST to its three fields and supports another registration', () => {
    const company = { id: 1, gstRegistration: 'Registered', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };
    const setDb = vi.fn((updater) => updater({ companies: [company] }));
    render(<TaxRegistrationMaster kind="GST" db={{ companies: [company] }} setDb={setDb} currentCompany={company} />);

    expect(screen.getByLabelText('Primary GST registration type')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary GST GSTIN')).toHaveValue('29ABCDE1234F1Z5');
    expect(screen.getByLabelText('Primary GST state')).toHaveValue('Karnataka');
    fireEvent.click(screen.getByRole('button', { name: 'Add other GST' }));
    fireEvent.change(screen.getByLabelText('Other GST 1 GSTIN'), { target: { value: '27ABCDE1234F1Z5' } });
    fireEvent.change(screen.getByLabelText('Other GST 1 state'), { target: { value: 'Maharashtra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const saved = setDb.mock.results[0].value.companies[0];
    expect(saved.profile.taxCompliances.gst.registrations[0]).toMatchObject({ number: '27ABCDE1234F1Z5', state: 'Maharashtra' });
  });

  it('disables GSTIN when unregistered and derives state from a GSTIN', () => {
    const company = { id: 1, gstRegistration: 'Registered', gstin: '', state: '' };
    render(<TaxRegistrationMaster kind="GST" db={{ companies: [company] }} setDb={() => {}} currentCompany={company} />);
    const gstin = screen.getByLabelText('Primary GST GSTIN');
    fireEvent.change(gstin, { target: { value: '27ABCDE1234F1Z5' } });
    expect(screen.getByLabelText('Primary GST state')).toHaveValue('Maharashtra');
    fireEvent.change(screen.getByLabelText('Primary GST registration type'), { target: { value: 'Unregistered' } });
    expect(gstin).toBeDisabled();
    expect(gstin).toHaveValue('');
  });
});
