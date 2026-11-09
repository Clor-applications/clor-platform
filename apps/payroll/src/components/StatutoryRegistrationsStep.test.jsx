import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { PtRegistrationFields, RegistrationNotice, StatutoryRegistrationsStep } from './StatutoryRegistrationsStep';
import { getStatutoryRegistrations, saveStatutoryRegistrations } from '../api/payrollSetup';
import { requestOpenScreen } from '@platform/context';

vi.mock('../api/payrollSetup', () => ({ getStatutoryRegistrations: vi.fn(), saveStatutoryRegistrations: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@platform/context', () => ({ requestOpenScreen: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const levyStates = [
  { state: 'KARNATAKA', label: 'Karnataka' },
  { state: 'MAHARASHTRA', label: 'Maharashtra' },
  { state: 'TAMIL NADU', label: 'Tamil Nadu' },
];

const fresh = () => ({
  pf: { applies: false, code: '', contributeOnFullWage: false, wageCeiling: 15000 },
  esi: { applies: false, code: '', eligibilityThreshold: 21000 },
  pt: { applies: false, registrations: [{ state: 'KARNATAKA', label: 'Karnataka', registrationNumber: '', people: 3 }], levyStates },
  tds: { applies: false, tan: '', deductorType: null, responsibleName: '', responsibleDesignation: '' },
  deductorTypes: [
    { code: 'COMPANY', label: 'Company' },
    { code: 'FIRM', label: 'Partnership firm or LLP' },
  ],
  answeredAt: null,
  missing: [],
  done: false,
  hasSchemes: false,
});

it('asks for each registration, says where the number is found, and saves them all to one place', async () => {
  vi.mocked(getStatutoryRegistrations).mockResolvedValue(fresh());
  vi.mocked(saveStatutoryRegistrations).mockResolvedValue({ ...fresh(), answeredAt: '2026-11-10T09:00:00.000Z', missing: [], done: true });
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(<StatutoryRegistrationsStep onSaved={onSaved} />);

  expect(await screen.findByRole('heading', { name: 'Statutory registrations' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Not entered yet.');
  await user.click(screen.getByRole('button', { name: 'Enter them' }));

  /* Where each number comes from, in plain words. */
  expect(screen.getByText(/EPFO employer portal/)).toBeInTheDocument();
  expect(screen.getByText(/ESIC employer portal/)).toBeInTheDocument();
  expect(screen.getByText(/state's professional tax portal/)).toBeInTheDocument();
  expect(screen.getByText(/TAN allotment letter/)).toBeInTheDocument();
  /* The ceilings, in rupees, and that the ESI one is the law's. */
  expect(screen.getByText(/PF wages up to ₹15,000 a month/)).toBeInTheDocument();
  expect(screen.getByText(/up to ₹21,000 a month; that limit is set by law/)).toBeInTheDocument();
  /* Skipping is allowed and says where to come back to. */
  expect(screen.getByText('You can add this later in Settings › Statutory › Compliance.')).toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: /PF applies to this company/ }));
  await user.type(screen.getByRole('textbox', { name: 'PF establishment code' }), 'kn/bng/0012345/000');
  await user.click(screen.getByRole('radio', { name: /The full PF wage/ }));
  await user.click(screen.getByRole('checkbox', { name: /Professional tax applies/ }));
  await user.type(screen.getByRole('textbox', { name: /Karnataka/ }), 'ptr-ka-1');
  await user.click(screen.getByRole('checkbox', { name: /Tax is deducted from salaries here/ }));
  await user.type(screen.getByRole('textbox', { name: 'TAN' }), 'blra12345b');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Kind of deductor' }), 'COMPANY');
  await user.type(screen.getByRole('combobox', { name: 'Person responsible for deducting tax' }), 'Ritika Chawla');
  await user.type(screen.getByRole('combobox', { name: 'Their designation' }), 'Director');

  await user.click(screen.getByRole('button', { name: 'Save registrations' }));
  await waitFor(() =>
    expect(saveStatutoryRegistrations).toHaveBeenCalledWith({
      pf: { applies: true, code: 'KN/BNG/0012345/000', contributeOnFullWage: true },
      esi: { applies: false, code: null },
      pt: { applies: true, registrations: [{ state: 'KARNATAKA', registrationNumber: 'PTR-KA-1' }] },
      tds: { applies: true, tan: 'BLRA12345B', deductorType: 'COMPANY', responsibleName: 'Ritika Chawla', responsibleDesignation: 'Director' },
    })
  );
  expect(onSaved).toHaveBeenCalled();
});

it('says what shape a number should be before anything is sent, and will not save until it is', async () => {
  vi.mocked(getStatutoryRegistrations).mockResolvedValue(fresh());
  const user = userEvent.setup();
  render(<StatutoryRegistrationsStep startOpen />);

  const tan = await screen.findByRole('textbox', { name: 'TAN' });
  await user.type(tan, 'BLR12345B');
  expect(screen.getByText('Four letters, five numbers and a letter, such as BLRA12345B.')).toBeInTheDocument();
  expect(tan).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Save registrations' })).toBeDisabled();

  await user.type(screen.getByRole('textbox', { name: 'ESI employer code' }), '1234');
  expect(screen.getByText('Seventeen digits.')).toBeInTheDocument();

  await user.clear(tan);
  await user.type(tan, 'BLRA12345B');
  await user.clear(screen.getByRole('textbox', { name: 'ESI employer code' }));
  expect(screen.getByRole('button', { name: 'Save registrations' })).toBeEnabled();
  expect(saveStatutoryRegistrations).not.toHaveBeenCalled();
});

it('can be skipped, and then says where to come back to', async () => {
  vi.mocked(getStatutoryRegistrations).mockResolvedValue(fresh());
  const user = userEvent.setup();
  render(<StatutoryRegistrationsStep startOpen />);
  await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
  expect(screen.getByRole('status')).toHaveTextContent('Skipped. You can add this later in Settings › Statutory › Compliance.');
  expect(screen.queryByRole('textbox', { name: 'TAN' })).toBeNull();
  expect(saveStatutoryRegistrations).not.toHaveBeenCalled();
});

it('shows what is still missing once answered', async () => {
  vi.mocked(getStatutoryRegistrations).mockResolvedValue({
    ...fresh(),
    pf: { applies: true, code: '', contributeOnFullWage: false, wageCeiling: 15000 },
    answeredAt: '2026-11-10T09:00:00.000Z',
    missing: [{ scheme: 'PF', short: 'PF establishment code', message: 'PF ECR cannot be filed until the PF establishment code is added.' }],
  });
  render(<StatutoryRegistrationsStep />);
  expect(await screen.findByRole('status')).toHaveTextContent('Still to add: PF establishment code.');
  expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
});

it('says so when the registrations cannot be read', async () => {
  vi.mocked(getStatutoryRegistrations).mockRejectedValue(new Error('No access'));
  render(<StatutoryRegistrationsStep />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No access');
});

it('lists professional tax by state, adds a state, and removes only one nobody works in', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const rows = [{ state: 'KARNATAKA', label: 'Karnataka', registrationNumber: '', people: 3 }];
  render(<PtRegistrationFields value={rows} onChange={onChange} onCommit={onCommit} levyStates={levyStates} />);

  expect(screen.getByText('3 people in payroll there')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Remove Karnataka' })).toBeNull();

  const pick = screen.getByRole('combobox', { name: 'Another state' });
  expect(within(pick).queryByRole('option', { name: 'Karnataka' })).toBeNull();
  await user.selectOptions(pick, 'MAHARASHTRA');
  await user.click(screen.getByRole('button', { name: 'Add state' }));
  const next = [...rows, { state: 'MAHARASHTRA', label: 'Maharashtra', registrationNumber: '', people: 0 }];
  expect(onChange).toHaveBeenCalledWith(next);
  expect(onCommit).toHaveBeenCalledWith(next);
});

it('on the pay run, names each return that cannot be filed yet and opens the step', async () => {
  const user = userEvent.setup();
  const gaps = [
    { scheme: 'PF', short: 'PF establishment code', message: 'PF ECR cannot be filed until the PF establishment code is added.' },
    { scheme: 'PT', state: 'KARNATAKA', short: 'Karnataka professional tax registration', message: 'Professional tax for Karnataka cannot be filed until its registration number is added.' },
  ];
  const { rerender, container } = render(<RegistrationNotice gaps={gaps} />);
  expect(screen.getByText('PF ECR cannot be filed until the PF establishment code is added.')).toBeInTheDocument();
  expect(screen.getByText(/Professional tax for Karnataka/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add it in Setup' }));
  expect(requestOpenScreen).toHaveBeenCalledWith('setup', { step: 'registrations' });

  rerender(<RegistrationNotice gaps={[]} />);
  expect(container).toBeEmptyDOMElement();
});
