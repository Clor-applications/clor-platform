import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordInput, { passwordScore } from './PasswordInput';

describe('PasswordInput', () => {
  it('names the button with its visible word', () => {
    render(<PasswordInput aria-label="Password" value="" onChange={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Show password' });
    expect(btn.textContent).toContain('Show');
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Hide password' }).textContent).toContain('Hide');
  });
  it('rates a new password only when asked', () => {
    const { rerender, container } = render(<PasswordInput aria-label="P" value="abc" onChange={() => {}} />);
    expect(container.querySelector('.ui-pw-strength')).toBeNull();
    rerender(<PasswordInput aria-label="P" strength value="Abcdefgh1!xyz" onChange={() => {}} />);
    expect(container.querySelector('.ui-pw-strength').textContent).toBe('Strong');
  });
  it('scores from weak to strong', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('abc')).toBe(1);
    expect(passwordScore('abcdefgh')).toBe(1);
    expect(passwordScore('Abcdefgh')).toBe(2);
    expect(passwordScore('Abcdefgh1!xy')).toBe(4);
  });
});

describe('PasswordInput inside its label', () => {
  it('keeps the field named by the label alone', () => {
    render(<label><span>Password</span><PasswordInput value="" onChange={() => {}} /></label>);
    expect(screen.getByLabelText('Password', { exact: true })).toBeInTheDocument();
  });
});
