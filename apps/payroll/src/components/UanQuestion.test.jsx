import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UanQuestion from './UanQuestion';

function Harness({ start = '' }) {
  const [uan, setUan] = useState(start);
  return (
    <>
      <UanQuestion value={uan} onChange={setUan} />
      <output data-testid="uan">{uan}</output>
    </>
  );
}

describe('UanQuestion (round 25)', () => {
  it('asks first, and shows no box until answered', () => {
    render(<Harness />);
    expect(screen.getByText('Had PF before, at an earlier job?')).toBeInTheDocument();
    expect(screen.queryByLabelText('UAN')).toBeNull();
  });

  it('asks for the UAN when they had PF, keeping digits only', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Yes'));
    fireEvent.change(screen.getByLabelText('UAN'), { target: { value: '1001-2345 6789' } });
    expect(screen.getByTestId('uan').textContent).toBe('100123456789');
  });

  it('says a UAN comes later when they had none, and clears a typed one', () => {
    render(<Harness start="100123456789" />);
    expect(screen.getByLabelText('Yes')).toBeChecked();
    fireEvent.click(screen.getByLabelText('No'));
    expect(screen.getByText(/No UAN yet/)).toBeInTheDocument();
    expect(screen.getByTestId('uan').textContent).toBe('');
  });
});
