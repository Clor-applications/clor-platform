import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import Drawer from '@ui/components/ui/Drawer';

const ControlledDrawer = () => {
  const [value, setValue] = useState('');
  return (
    <Drawer open title="New category" onClose={() => {}}>
      <label htmlFor="drawer-name">Category name</label>
      <input id="drawer-name" value={value} onChange={(event) => setValue(event.target.value)} />
    </Drawer>
  );
};

describe('Drawer focus', () => {
  it('moves focus into a read-only drawer when its portal opens', async () => {
    render(<Drawer open title="Attendance details" onClose={() => {}}><p>Approved</p></Drawer>);
    expect(await screen.findByRole('dialog', { name: 'Attendance details' })).toHaveFocus();
  });

  it('does not steal focus when a controlled field rerenders its owner', () => {
    render(<ControlledDrawer />);
    const input = screen.getByLabelText('Category name');
    input.focus();

    fireEvent.change(input, { target: { value: 'B' } });

    expect(input).toHaveValue('B');
    expect(input).toHaveFocus();
  });
});
