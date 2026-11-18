import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OfferAnswerBy, answerByText, daysUntil } from './round36';

describe('round 36: offer answer date', () => {
  it('counts whole days to the answer date', () => {
    expect(daysUntil('2026-11-25', '2026-11-18')).toBe(7);
    expect(daysUntil('2026-11-18', '2026-11-18')).toBe(0);
    expect(daysUntil('2026-11-17', '2026-11-18')).toBe(-1);
    expect(daysUntil(null, '2026-11-18')).toBeNull();
  });

  it('only a sent offer waits for an answer', () => {
    expect(answerByText({ status: 'ACCEPTED', acceptBy: '2026-11-25' }, '2026-11-18')).toBeNull();
    expect(answerByText({ status: 'SENT' }, '2026-11-18')).toBeNull();
    expect(answerByText({ status: 'SENT', acceptBy: '2026-11-25' }, '2026-11-18').text).toMatch(/^Answer by .* · 7 days left$/);
    expect(answerByText({ status: 'SENT', acceptBy: '2026-11-19' }, '2026-11-18').text).toMatch(/1 day left$/);
    expect(answerByText({ status: 'SENT', acceptBy: '2026-11-18' }, '2026-11-18').text).toMatch(/^Answer by today/);
    expect(answerByText({ status: 'SENT', acceptBy: '2026-11-16' }, '2026-11-18')).toMatchObject({ late: true });
  });

  it('shows the chip for a sent offer and nothing otherwise', () => {
    const { rerender } = render(<OfferAnswerBy offer={{ status: 'SENT', acceptBy: '2026-11-21' }} today="2026-11-18" />);
    expect(screen.getByText(/3 days left/)).toHaveClass('ui-pill-warn');
    rerender(<OfferAnswerBy offer={{ status: 'DECLINED', acceptBy: '2026-11-21' }} today="2026-11-18" />);
    expect(screen.queryByText(/left/)).toBeNull();
  });
});
