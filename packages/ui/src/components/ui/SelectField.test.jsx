import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectField } from './SelectField';

const PEOPLE = [['', 'Choose a person'], ['e1', 'Asha Rao'], ['e2', 'Bilal Khan'], ['e3', 'Chitra Iyer'], ['e4', 'Dev Shah'], ['e5', 'Esha Nair']];

function Field({ onChange = () => {}, value = '', ...props }) {
  return (
    <>
      <label htmlFor="who">Employee</label>
      <SelectField id="who" value={value} onChange={onChange} {...props}>
        {PEOPLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </SelectField>
    </>
  );
}

describe('SelectField', () => {
  it('is named by its label and reads out the chosen value', () => {
    render(<Field value="e2" aria-describedby="who-help" />);
    const field = screen.getByLabelText('Employee');
    expect(field).toHaveTextContent('Bilal Khan');
    expect(field).toHaveAttribute('aria-describedby', 'who-value who-help');
  });

  it('searches a long list and hands back the value like a native select', async () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} name="employeeId" />);
    fireEvent.click(screen.getByRole('button', { name: /Employee/ }));
    const find = await screen.findByRole('searchbox', { name: 'Find employee' });
    fireEvent.change(find, { target: { value: 'chit' } });
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Chitra Iyer' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: { value: 'e3', name: 'employeeId' } }));
  });

  it('takes the only match on Enter and says when nothing matches', async () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Employee/ }));
    const find = await screen.findByRole('searchbox');
    fireEvent.change(find, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches “zzz”.')).toBeInTheDocument();
    fireEvent.change(find, { target: { value: 'dev' } });
    fireEvent.keyDown(find, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'e4' }) }));
  });

  it('has no search box on a short list', async () => {
    render(
      <SelectField aria-label="Shift" value="a" onChange={() => {}}>
        <option value="a">Morning</option>
        <option value="b">Night</option>
      </SelectField>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Shift', description: 'Morning' }));
    await screen.findByRole('menuitemradio', { name: 'Night' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('writes a hidden input for a form, and does not open when disabled', () => {
    const { container } = render(<Field value="e1" name="employeeId" disabled />);
    expect(container.querySelector('input[type=hidden][name=employeeId]').value).toBe('e1');
    const field = screen.getByRole('button', { name: /Employee/ });
    expect(field).toBeDisabled();
  });

  it('stops its form while empty when required, as a native select does', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Field required /><button type="submit">Save</button></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
