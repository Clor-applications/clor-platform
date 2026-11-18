import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BalanceAfter, InlineDocument, LONG_WAIT_DAYS, isWaitingTooLong, stepChipText, waitedWholeDays } from './round47';

/* Round 47 picks (18 Nov 2026): approvals. */

describe('the step a request is at', () => {
  it('says only the current step in a few words', () => {
    expect(stepChipText({ current: 2, of: 2, waitingFor: ['HR'] })).toBe('With HR');
    expect(stepChipText({ current: 1, yours: true, waitingFor: ['Rahul'] })).toBe('Yours to decide');
    expect(stepChipText({ current: null })).toBe('Decided');
    expect(stepChipText({ current: 1, waitingFor: [] })).toBe('With someone else');
    expect(stepChipText(null)).toBe('');
  });
});

describe('waiting too long', () => {
  const now = new Date('2026-11-18T10:00:00Z').getTime();
  const ago = (d) => new Date(now - d * 86_400_000).toISOString();
  it('counts whole days and flags only more than three', () => {
    expect(LONG_WAIT_DAYS).toBe(3);
    expect(waitedWholeDays(ago(4.2), now)).toBe(4);
    expect(isWaitingTooLong(ago(3), now)).toBe(false);
    expect(isWaitingTooLong(ago(4), now)).toBe(true);
    expect(isWaitingTooLong(null, now)).toBe(false);
  });
});

describe('balance after', () => {
  it('leads with what is left after this request', () => {
    const { container } = render(<p><BalanceAfter withIt={4} without={6} /></p>);
    expect(container.textContent).toBe('Leaves 4 days after this · 6 days without this request');
  });
  it('marks a balance below zero', () => {
    render(<p><BalanceAfter withIt={-1} without={1} /></p>);
    expect(screen.getByText('-1 day')).toHaveClass('ui-text-neg');
  });
});

describe('the attached proof, inside the request', () => {
  it('shows a picture as a picture and closes', () => {
    const onClose = vi.fn();
    render(<InlineDocument dataUrl="data:image/png;base64,AAAA" title="Medical note" onClose={onClose} />);
    expect(screen.getByRole('img', { name: 'Medical note' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
  it('shows a PDF in a frame, anything else as a download', () => {
    const { container, rerender } = render(<InlineDocument dataUrl="data:application/pdf;base64,AAAA" title="Note.pdf" />);
    expect(container.querySelector('iframe[title="Note.pdf"]')).not.toBeNull();
    rerender(<InlineDocument dataUrl="data:application/zip;base64,AAAA" title="Note.zip" />);
    expect(screen.getByRole('link', { name: 'Download it' })).toHaveAttribute('download', 'Note.zip');
  });
});
