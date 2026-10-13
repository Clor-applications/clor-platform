import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/masters', () => ({
  listItems: () => Promise.reject(new Error('offline')),
  createItem: () => Promise.reject(new Error('offline')),
}));
vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));

import ItemPicker from './ItemPicker';

const COMPANY = { id: 1 };
const DB = {
  items: [
    { id: 11, companyId: 1, name: 'MS Angle 50mm', code: 'A50', unit: 'Pcs', gstRate: 18, salePrice: 100 },
    { id: 12, companyId: 1, name: 'MS Plate 10mm', code: 'P10', unit: 'Pcs', gstRate: 18, salePrice: 200 },
    { id: 13, companyId: 1, name: 'Bolt M12', code: 'B12', unit: 'Pcs', gstRate: 18, salePrice: 5 },
  ],
  uoms: [], gstRates: [],
};

const Host = () => {
  const [value, setValue] = useState('');
  return (
    <form>
      <ItemPicker db={DB} setDb={() => {}} currentCompany={COMPANY} value={value} onChange={setValue} />
      <input aria-label="description" />
    </form>
  );
};

const openPicker = async (user) => {
  /* The item field is the search box now — clicking it opens the list. */
  const field = screen.getByRole('combobox');
  await user.click(field);
  await waitFor(() => screen.getByRole('listbox'));
  return field;
};

describe('ItemPicker keyboard', () => {
  it('ArrowDown moves the highlight in the list', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const search = await openPicker(user);
    // The dialog must hand the caret to the search box, not keep it on the
    // panel. This is the whole bug: keys typed at a div go nowhere.
    expect(document.activeElement).toBe(search);
    const first = search.getAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(search.getAttribute('aria-activedescendant')).not.toBe(first);
  });

  it('Enter picks the highlighted item', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.keyboard('{ArrowDown}{Enter}');
    /* The chosen item's name is the field's value now, not a button's label. */
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('MS Plate 10mm'));
  });

  it('typing filters, then Enter picks the match', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.keyboard('Bolt');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Bolt M12'));
  });

  it('Escape closes without choosing', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    /* Nothing was chosen, so the field is still empty and still asking. */
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});

/**
 * What an option shows, and what it does when the name is longer than the row.
 *
 * A line grid is read down its columns, so the unit belongs at the right edge
 * where the eye can run down it. And a name like "Enterprise Network Security
 * Appliance with Extended Support Subscription" used to wrap onto a second
 * line, making that one row taller than its neighbours and knocking the list
 * out of rhythm — it ends in an ellipsis instead.
 */
describe('an option in the list', () => {
  it('puts the unit at the right of the name, not in the detail line', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);

    const option = screen.getByRole('option', { name: /MS Angle 50mm/ });
    const parts = [...option.querySelectorAll('span')];
    expect(parts.at(-1).textContent).toBe('Pcs');
    /* The code line stays where it was; the unit is not duplicated into it. */
    expect(option.textContent).toContain('A50');
  });

  it('holds the name on one line, however long it is', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);

    const name = screen.getByRole('option', { name: /MS Angle 50mm/ }).querySelector('span');
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('min-w-0');
  });
});
