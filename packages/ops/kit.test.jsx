import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Err, ErrorSummary, Loading, ReasonDrawer } from './kit';

describe('the console kit', () => {
  it('keeps a confirm open while its request runs: Cancel, Escape and × wait', async () => {
    let finish;
    const onConfirm = vi.fn(() => new Promise((r) => { finish = r; }));
    const onClose = vi.fn();
    render(<ReasonDrawer open title="Suspend Acme?" what="Acme’s 12 users are signed out." confirmLabel="Suspend" onClose={onClose} onConfirm={onConfirm} />);
    const why = screen.getByLabelText('Why');
    expect(why).toHaveAccessibleDescription('Reason required (3+ characters)');
    fireEvent.change(why, { target: { value: 'Unpaid for three months' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Suspend' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.keyDown(why, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 250));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled());
  });

  it('marks a too-short reason on the field', () => {
    render(<ReasonDrawer open title="Resume Acme?" confirmLabel="Resume" onClose={() => {}} onConfirm={() => {}} />);
    const why = screen.getByLabelText('Why');
    fireEvent.change(why, { target: { value: 'no' } });
    fireEvent.blur(why);
    expect(why).toHaveAttribute('aria-invalid', 'true');
  });

  it('gives a failed load a Try again, and says Loading as a status', () => {
    const retry = vi.fn();
    const { rerender } = render(<Err onRetry={retry}>The list did not load.</Err>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    rerender(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('puts every form problem in one summary that takes the focus', () => {
    render(<ErrorSummary errors={{ name: 'Give the plan a name.', price: 'A price is a number of rupees.' }} />);
    const box = screen.getByRole('alert');
    expect(box).toHaveFocus();
    expect(box).toHaveTextContent('Give the plan a name.');
    expect(box).toHaveTextContent('A price is a number of rupees.');
  });
});
