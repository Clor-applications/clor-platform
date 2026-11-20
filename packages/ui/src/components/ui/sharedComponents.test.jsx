import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApproveActions } from './ApproveActions';
import { FilterSelect } from './FilterSelect';
import { FormPart } from './FormPart';
import { PageHeader } from './Primitives';

/* Shared parts from the 20 Nov 2026 design audit: G1 tick and cross, G3 form part, G6 count line, G7 filter chip. */

describe('ApproveActions', () => {
  it('names what is being decided and keeps the click off the row', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onRow = vi.fn();
    render(<div onClick={onRow}><ApproveActions what="leave for Rohan Deshpande" onApprove={onApprove} onReject={onReject} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Approve leave for Rohan Deshpande' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject leave for Rohan Deshpande' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('holds both buttons while the decision is being saved', () => {
    render(<ApproveActions what="this claim" busy onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByRole('button', { name: 'Approve this claim' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject this claim' })).toBeDisabled();
  });

  it('shows only the buttons it has a handler for', () => {
    render(<ApproveActions what="this punch" onApprove={() => {}} />);
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
  });
});

describe('FormPart', () => {
  it('is a heading over a rule, not a card', () => {
    const { container } = render(<FormPart id="bank" title="Bank account" description="Where salary goes"><input aria-label="IFSC" /></FormPart>);
    expect(screen.getByRole('region', { name: 'Bank account' })).toBeTruthy();
    expect(container.querySelector('.ui-card')).toBeNull();
    expect(container.querySelector('.ui-form-part-head h3').textContent).toBe('Bank account');
  });
});

describe('PageHeader count line', () => {
  it('leaves zero clauses out', () => {
    render(<PageHeader title="Employees" counts={[{ label: 'people', value: 142 }, { label: 'joining Monday', value: 0 }, { label: 'need documents', value: 2 }]} />);
    const line = screen.getByLabelText('Figures');
    expect(line.textContent).toBe('142 people · 2 need documents');
  });

  it('takes a ready sentence too', () => {
    render(<PageHeader title="Pay runs" counts="3 runs this year" />);
    expect(screen.getByText('3 runs this year').className).toContain('ui-count-line');
  });
});

describe('FilterSelect', () => {
  const few = [['', 'All'], ['active', 'Active'], ['invited', 'Invited']];
  const many = [['', 'All'], ...['Pune', 'Mumbai', 'Delhi', 'Chennai', 'Kolkata', 'Jaipur', 'Surat', 'Nagpur'].map((c) => [c.toLowerCase(), c])];

  it('shows its label and the chosen option, and marks a chosen filter', () => {
    const { rerender } = render(<FilterSelect label="Status" value="" options={few} onChange={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Status: All' });
    expect(chip.hasAttribute('data-set')).toBe(false);
    rerender(<FilterSelect label="Status" value="invited" options={few} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Status: Invited' }).hasAttribute('data-set')).toBe(true);
  });

  it('gives a long list a search box that narrows it', async () => {
    const onChange = vi.fn();
    render(<FilterSelect label="Branch" value="" options={many} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch: All' }));
    const box = await screen.findByRole('searchbox', { name: 'Find branch' });
    fireEvent.change(box, { target: { value: 'pun' } });
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['Pune']);
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy();
  });

  it('keeps a short list without a box', async () => {
    render(<FilterSelect label="Status" value="" options={few} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Status: All' }));
    await screen.findAllByRole('menuitemradio');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
