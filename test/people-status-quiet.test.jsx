import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBadge } from '../apps/people/src/workforce/shared';

afterEach(cleanup);

describe('the Employees list status', () => {
  it('shows every status as a soft tag, Active included (owner, 19 Nov 2026)', () => {
    render(<>
      <StatusBadge quiet employee={{ status: 'ACTIVE', dateOfJoining: '2024-01-01' }} />
      <StatusBadge quiet employee={{ status: 'ON_NOTICE' }} />
      <StatusBadge quiet employee={{ status: 'ACTIVE', dateOfJoining: '2999-01-01' }} />
    </>);
    expect(screen.getByText('Active').className).toMatch(/ui-pill-pos/);
    expect(screen.getByText('On notice').className).toMatch(/ui-pill/);
    expect(screen.getByText('Joining soon').className).toMatch(/ui-pill-info/);
  });

  it('keeps the pill everywhere else', () => {
    render(<StatusBadge employee={{ status: 'ACTIVE', dateOfJoining: '2024-01-01' }} />);
    expect(screen.getByText('Active').className).toMatch(/ui-pill/);
  });
});
