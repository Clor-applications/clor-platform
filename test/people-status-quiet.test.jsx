import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBadge } from '../apps/people/src/workforce/shared';

afterEach(cleanup);

describe('the Employees list status', () => {
  it('says Active in plain words when quiet, and keeps the pill for anyone who needs a look', () => {
    render(<>
      <StatusBadge quiet employee={{ status: 'ACTIVE', dateOfJoining: '2024-01-01' }} />
      <StatusBadge quiet employee={{ status: 'ON_NOTICE' }} />
      <StatusBadge quiet employee={{ status: 'ACTIVE', dateOfJoining: '2999-01-01' }} />
    </>);
    expect(screen.getByText('Active').className).not.toMatch(/ui-pill/);
    expect(screen.getByText('On notice').className).toMatch(/ui-pill/);
    expect(screen.getByText('Joining soon').className).toMatch(/ui-pill/);
  });

  it('keeps the pill everywhere else', () => {
    render(<StatusBadge employee={{ status: 'ACTIVE', dateOfJoining: '2024-01-01' }} />);
    expect(screen.getByText('Active').className).toMatch(/ui-pill/);
  });
});
