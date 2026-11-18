import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OldBrowserPage, browserIsTooOld } from './OldBrowser';
import { repeatPunchIds } from '../../../../../apps/attendance/src/components/repeatPunches';
import DraftStrip, { isDraftSlip } from '../../../../../apps/payroll/src/components/DraftStrip';

describe('round 27: two punches a minute apart', () => {
  it('marks the second punch within 60 seconds, per person', () => {
    const ids = repeatPunchIds([
      { id: 'a', employeeId: 'e1', localTime: '2026-11-18 09:01:00' },
      { id: 'b', employeeId: 'e1', localTime: '2026-11-18 09:02:00' },
      { id: 'c', employeeId: 'e1', localTime: '2026-11-18 18:00:00' },
      { id: 'd', employeeId: 'e2', localTime: '2026-11-18 09:01:30' },
      { id: 'e', pin: '77', localTime: '2026-11-18 09:00:00' },
      { id: 'f', pin: '77', localTime: '2026-11-18 09:00:40' },
    ]);
    expect([...ids].sort()).toEqual(['b', 'f']);
  });

  it('keeps punches more than a minute apart', () => {
    expect(repeatPunchIds([
      { id: 'a', employeeId: 'e1', localTime: '2026-11-18 09:01:00' },
      { id: 'b', employeeId: 'e1', localTime: '2026-11-18 09:02:01' },
    ]).size).toBe(0);
  });
});

describe('round 27: draft payslip strip', () => {
  it('shows while the slip or run is not approved', () => {
    expect(isDraftSlip({ status: 'CALCULATED' })).toBe(true);
    expect(isDraftSlip({ status: 'APPROVED', run: { status: 'REVIEW' } })).toBe(true);
    expect(isDraftSlip({ status: 'APPROVED', run: { status: 'APPROVED' } })).toBe(false);
    expect(isDraftSlip({ status: 'PAID' })).toBe(false);
    render(<DraftStrip slip={{ status: 'DRAFT' }} />);
    expect(screen.getByRole('note').textContent).toMatch(/not approved yet/);
  });

  it('draws nothing once approved', () => {
    const { container } = render(<DraftStrip slip={{ status: 'LOCKED' }} />);
    expect(container.textContent).toBe('');
  });
});

describe('round 27: old browser', () => {
  it('passes a browser with the features the build needs', () => {
    expect(browserIsTooOld({ structuredClone: () => {} })).toBe(false);
  });

  it('fails a browser without structuredClone', () => {
    expect(browserIsTooOld({})).toBe(true);
  });

  it('names the browsers that work, with links', () => {
    render(<OldBrowserPage />);
    expect(screen.getByRole('heading', { name: /too old for CLOR/ })).toBeTruthy();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Google Chrome', 'Microsoft Edge', 'Mozilla Firefox', 'Safari']);
  });
});
