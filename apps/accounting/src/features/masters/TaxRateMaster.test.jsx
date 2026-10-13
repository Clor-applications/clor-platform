import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TcsRatesMaster, TdsRatesMaster } from './TaxRateMaster';

const company = { id: 1, name: 'Neev', profile: { taxCompliances: { tds: { enabled: true }, tcs: { enabled: true } } } };

describe('tax rate masters', () => {
  it('saves a TDS override and applies it to matching mapped ledgers', () => {
    const sourceDb = {
      companies: [company],
      chartOfAccounts: [{ id: 9, companyId: 1, tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR', tdsRate: 2 }],
    };
    const setDb = vi.fn((updater) => updater(sourceDb));
    render(<TdsRatesMaster db={sourceDb} setDb={setDb} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit Contractor/i }));
    fireEvent.change(screen.getByLabelText(/Contractor.*company rate/i), { target: { value: '3.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = setDb.mock.results[0].value;
    expect(saved.companies[0].profile.taxCompliances.tds.rateOverrides.CONTRACTOR_SUB_CONTRACTOR.rate).toBe(3.5);
    expect(saved.chartOfAccounts[0].tdsRate).toBe(3.5);
    expect(saved.chartOfAccounts[0].tdsRateIndividual).toBe(1);
  });

  it('saves the TCS rate and threshold into the existing calculation config', () => {
    const setDb = vi.fn((updater) => updater({ companies: [company], tdsConfigs: [] }));
    render(<TcsRatesMaster db={{ companies: [company], tdsConfigs: [] }} setDb={setDb} currentCompany={company} />);
    fireEvent.change(screen.getByLabelText('TCS rate'), { target: { value: '0.2' } });
    fireEvent.change(screen.getByLabelText('TCS threshold'), { target: { value: '6000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = setDb.mock.results[0].value;
    expect(saved.tdsConfigs[0]).toMatchObject({ companyId: 1, rate: 0.2, threshold: 6000000 });
  });
});
