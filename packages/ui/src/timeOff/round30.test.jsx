import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CallButtons, { phoneLinks } from '../components/ui/CallButtons';
import YearOnYearLine, { shiftYear } from './YearOnYearLine';

describe('round 30: call a colleague', () => {
  it('gives Call and WhatsApp for an Indian mobile', () => {
    expect(phoneLinks('98450 67890')).toEqual({ tel: 'tel:+919845067890', wa: 'https://wa.me/919845067890' });
    expect(phoneLinks('+91 98450 67890')).toEqual({ tel: 'tel:+919845067890', wa: 'https://wa.me/919845067890' });
  });

  it('keeps Call but no WhatsApp for a landline, and nothing for an empty number', () => {
    expect(phoneLinks('080-2345 6789')).toEqual({ tel: 'tel:08023456789', wa: null });
    expect(phoneLinks('')).toBeNull();
    expect(phoneLinks(null)).toBeNull();
  });

  it('renders both buttons named for the person', () => {
    render(<CallButtons phone="9845067890" name="Arun" />);
    expect(screen.getByText('+91 98450 67890')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Call Arun' }).getAttribute('href')).toBe('tel:+919845067890');
    expect(screen.getByRole('link', { name: 'WhatsApp Arun' }).getAttribute('href')).toBe('https://wa.me/919845067890');
  });
});

describe('round 30: this year against last year', () => {
  it('moves a day back one year, Feb 29 to Feb 28', () => {
    expect(shiftYear('2026-11-18')).toBe('2025-11-18');
    expect(shiftYear('2028-02-29')).toBe('2027-02-28');
  });

  it('draws both lines and says the change on a year before', () => {
    const { container } = render(
      <YearOnYearLine label="Headcount" rows={[
        { key: '2026-10', label: 'Oct', now: 180, before: 170 },
        { key: '2026-11', label: 'Nov', now: 190, before: 172 },
      ]} />
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Headcount: this period ends at 190, a year before at 172');
    expect(screen.getByText('+18 on a year before')).toBeTruthy();
  });

  it('draws nothing without rows', () => {
    const { container } = render(<YearOnYearLine label="Headcount" rows={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
