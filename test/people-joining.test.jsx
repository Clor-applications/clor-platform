import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Joining (HR-VIEW gaps 2, 3, 5): the joiner's PAN, PF, ESI and bank are
 * masked until opened for approval; employee app access is sent to many at
 * once, with codes handed over only for those with no e-mail; an offer
 * carries the CTC with typed lines, or a salary structure when Payroll is on.
 */
const wf = vi.hoisted(() => ({
  sendAppAccess: vi.fn(),
  offerSetup: vi.fn(),
  previewOffer: vi.fn(),
  createOffer: vi.fn(),
}));
const personnel = vi.hoisted(() => ({
  joiningStatutory: vi.fn(),
  approveJoiningStatutory: vi.fn(),
  rejectJoiningStatutory: vi.fn(),
}));
vi.mock('../apps/people/src/workforce/api', async (orig) => ({ ...(await orig()), ...wf }));
vi.mock('../packages/ui/src/personnel/api', async (orig) => ({ ...(await orig()), ...personnel }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import AppAccessSend from '../apps/people/src/workforce/AppAccessSend';
import OfferDrawer from '../apps/people/src/workforce/OfferDrawer';
import JoiningStatutory from '../packages/ui/src/personnel/JoiningStatutory';
import { notify } from '@ui/components/ui/notify';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Send employee app access', () => {
  it('sends for everyone picked; shows codes only for those handed over, with WhatsApp, and says who was skipped', async () => {
    wf.sendAppAccess.mockResolvedValue({
      company: { name: 'Acme', code: 'ACME' }, portalUrl: 'https://app.example/#/portal', expiresAt: '2026-11-02T10:00:00.000Z',
      sent: [
        { employeeId: 'e1', name: 'Mail Person', employeeCode: 'A-1', channel: 'EMAIL', sentTo: 'mail@example.com' },
        { employeeId: 'e2', name: 'Phone Person', employeeCode: 'A-2', channel: 'PRINT', phoneEnding: '2345', activationCode: 'ABCD-EFGH', whatsappUrl: 'https://wa.me/919845012345?text=hello', link: 'x' },
      ],
      skipped: [{ employeeId: 'e3', name: 'No Contact', reason: 'No e-mail or phone on file.' }],
    });
    const user = userEvent.setup();
    render(<AppAccessSend people={[{ id: 'e1', name: 'Mail Person' }, { id: 'e2', name: 'Phone Person' }, { id: 'e3', name: 'No Contact' }]} onClose={() => {}} />);
    expect(screen.getByText('Employee app access for 3 people')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send access' }));
    expect(wf.sendAppAccess).toHaveBeenCalledWith(['e1', 'e2', 'e3']);
    const mailed = await screen.findByRole('region', { name: 'Sent by e-mail' });
    expect(mailed).toHaveTextContent('mail@example.com');
    expect(mailed).not.toHaveTextContent('ABCD');
    const handed = screen.getByRole('region', { name: 'To hand over' });
    expect(within(handed).getByLabelText('Activation code for Phone Person')).toHaveTextContent('ABCD-EFGH');
    expect(within(handed).getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919845012345?text=hello');
    expect(screen.getByRole('region', { name: 'Not sent' })).toHaveTextContent('No e-mail or phone on file.');
    expect(screen.getByRole('button', { name: 'Print codes' })).toBeInTheDocument();
  });
});

describe('Send an offer', () => {
  const employee = { id: 'e9', name: 'Neha Rao', personalEmail: 'neha@example.com', designation: 'Designer', dateOfJoining: '2026-12-01' };

  it('without Payroll, sends the CTC and the typed monthly lines', async () => {
    wf.offerSetup.mockResolvedValue({ payrollOn: false, structures: [] });
    wf.createOffer.mockResolvedValue({ offer: { id: 'o1', email: 'neha@example.com' } });
    const onSent = vi.fn();
    const user = userEvent.setup();
    render(<OfferDrawer employee={employee} onClose={() => {}} onSent={onSent} />);
    await screen.findByText(/Payroll is not on/);
    expect(screen.getByLabelText('E-mail *')).toHaveValue('neha@example.com');
    await user.type(screen.getByLabelText('Annual CTC (₹) *'), '600000');
    await user.type(screen.getByLabelText('Line 1 a month'), '25000');
    await user.type(screen.getByLabelText('Line 2 a month'), '12500');
    await user.type(screen.getByLabelText('Signed by *'), 'Asha Rao, Director');
    await user.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(wf.createOffer).toHaveBeenCalled());
    expect(wf.createOffer.mock.calls[0][0]).toMatchObject({
      employeeId: 'e9', email: 'neha@example.com', designation: 'Designer', joiningDate: '2026-12-01', annualCtc: 600000, signatory: 'Asha Rao, Director',
      lines: [{ label: 'Basic', monthly: 25000 }, { label: 'House rent allowance', monthly: 12500 }],
    });
    expect(wf.createOffer.mock.calls[0][0]).not.toHaveProperty('structureId');
    expect(onSent).toHaveBeenCalled();
  });

  it('with Payroll on, offers on the first salary structure and shows the annexure it works out', async () => {
    wf.offerSetup.mockResolvedValue({ payrollOn: true, structures: [{ id: 's1', name: 'Staff' }] });
    wf.previewOffer.mockResolvedValue({ annexure: ['', 'ANNEXURE: PAY OFFERED', '  Basic: Rs 25,000'] });
    wf.createOffer.mockResolvedValue({ offer: { id: 'o2', email: 'meera@example.com' } });
    const user = userEvent.setup();
    render(<OfferDrawer candidate={{ id: 'c1', title: 'Meera K', details: { email: 'meera@example.com' } }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Monthly lines')).not.toBeInTheDocument());
    await user.type(screen.getByLabelText('Position *'), 'Accountant');
    await user.type(screen.getByLabelText('Annual CTC (₹) *'), '600000');
    await user.click(screen.getByRole('button', { name: 'Show the pay annexure' }));
    expect(await screen.findByLabelText('Pay annexure')).toHaveTextContent('Basic: Rs 25,000');
    expect(wf.previewOffer).toHaveBeenCalledWith({ annualCtc: 600000, structureId: 's1' });
    await user.type(screen.getByLabelText('Signed by *'), 'Owner');
    await user.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(wf.createOffer).toHaveBeenCalled());
    expect(wf.createOffer.mock.calls[0][0]).toMatchObject({ candidateId: 'c1', email: 'meera@example.com', structureId: 's1', annualCtc: 600000 });
  });
});

describe('PAN, PF, ESI and bank from the joiner', () => {
  const invite = {
    id: 'i1',
    statutory: { id: 's1', status: 'SENT', masked: true, values: { pan: 'AB*******F', uan: '********0400', bankAccountNumber: '********9012', bankIfsc: 'HDFC0001234', nominees: [{ name: 'Lata Kumar', relation: 'MOTHER', sharePercent: 100 }] } },
  };

  it('is masked until opened; opened, it can be corrected and approved for payroll', async () => {
    personnel.joiningStatutory.mockResolvedValue({ ...invite.statutory, masked: false, values: { pan: 'ABCDE1234F', uan: '100200300400', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', nominees: invite.statutory.values.nominees } });
    personnel.approveJoiningStatutory.mockResolvedValue({ payroll: 'SENT', statutory: { ...invite.statutory, status: 'APPLIED', bankOutcome: 'PENDING' } });
    const user = userEvent.setup();
    render(<JoiningStatutory invite={invite} canView canApprove />);
    expect(screen.getByText('AB*******F')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'PF nominees' })).toHaveTextContent('Lata Kumar');
    expect(screen.queryByText('ABCDE1234F')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show in full to check' }));
    expect(personnel.joiningStatutory).toHaveBeenCalledWith('i1');
    const pan = await screen.findByLabelText('PAN');
    expect(pan).toHaveValue('ABCDE1234F');
    expect(screen.getByRole('button', { name: 'Not accepted' })).toBeDisabled();
    await user.clear(pan);
    await user.type(pan, 'PQRST6789Z');
    await user.click(screen.getByRole('button', { name: 'Approve for payroll' }));
    expect(personnel.approveJoiningStatutory).toHaveBeenCalledWith('i1', { pan: 'PQRST6789Z' });
    expect(await screen.findByText('Approved and on the Payroll record')).toBeInTheDocument();
    expect(screen.getByText(/waits for approval in Payroll/)).toBeInTheDocument();
    expect(notify.success).toHaveBeenCalled();
  });

  it('without the Statutory Details grant there is nothing to open', () => {
    render(<JoiningStatutory invite={invite} canView={false} canApprove={false} />);
    expect(screen.queryByRole('button', { name: 'Show in full to check' })).not.toBeInTheDocument();
    expect(screen.getByText('Sent, not checked')).toBeInTheDocument();
  });
});
