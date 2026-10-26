import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SuggestInput, { rankSuggestions } from './SuggestInput';

/** A text field offers what the company already has; typing stays free and Enter still submits. */
const Host = ({ onSubmit = () => {} }) => {
  const [value, setValue] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
      <label htmlFor="city">City</label>
      <SuggestInput id="city" value={value} onChange={setValue} suggestions={['Pune', 'Bengaluru', { value: 'Mumbai', hint: 'Branch' }, 'pune']} />
      <output data-testid="value">{value}</output>
    </form>
  );
};

describe('SuggestInput', () => {
  it('ranks matches that start with the text first, drops duplicates and the exact value', () => {
    expect(rankSuggestions(['Navi Mumbai', 'Mumbai', 'mumbai', 'Pune'], 'mum').map((s) => s.value)).toEqual(['Mumbai', 'Navi Mumbai']);
    expect(rankSuggestions(['Pune'], 'pune')).toEqual([]);
  });

  it('opens on focus, narrows while typing, takes a row on click', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByLabelText('City'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Pune', 'Bengaluru', 'MumbaiBranch']);
    await user.type(screen.getByLabelText('City'), 'mu');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('option') });
    expect(screen.getByTestId('value').textContent).toBe('Mumbai');
    expect(screen.getByLabelText('City')).toHaveFocus();
  });

  it('Enter submits what was typed unless the arrows chose a row; Escape closes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    const input = screen.getByLabelText('City');
    await user.type(input, 'Be{Enter}');
    expect(onSubmit).toHaveBeenLastCalledWith('Be');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('Bengaluru');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.clear(input);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).toBeNull();
  });
});
