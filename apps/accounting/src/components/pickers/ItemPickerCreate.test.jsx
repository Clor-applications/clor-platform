import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/masters', () => ({
  listItems: () => Promise.reject(new Error('offline')),
  createItem: () => Promise.reject(new Error('offline')),
}));
vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/utils/itemSync', () => ({ saveItemToServer: async () => ({}) }));

import ItemPicker from './ItemPicker';

/**
 * Creating an item from a document line is creating an item.
 *
 * The picker carried a second, smaller form of its own: no taxability, no
 * category, no opening branch or warehouse, its own idea of what an item
 * needs. So the same catalogue got two different sets of answers depending on
 * whether somebody was on the Items screen or halfway through a bill. The
 * picker now opens the item form itself.
 */

const COMPANY = { id: 1 };

const dbWith = () => ({
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', code: 'A50', unit: 'Pcs', gstRate: 18, salePrice: 100 }],
  warehouses: [{ id: 'w1', companyId: 1, name: 'Main Store', branchId: 'b1' }],
  branches: [{ id: 'b1', companyId: 1, name: 'Bengaluru' }],
  uoms: [],
  gstRates: [],
  companies: [{ id: 1 }],
});

/** The picker inside a document line, with the db it writes to. */
const Host = ({ onPick = () => {} }) => {
  const [db, setDb] = useState(dbWith());
  const [value, setValue] = useState('');
  return (
    <form>
      <ItemPicker
        db={db}
        setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
        currentCompany={COMPANY}
        value={value}
        onChange={(id, item) => {
          setValue(id);
          onPick(id, item);
        }}
      />
      <output data-testid="chosen">{value}</output>
    </form>
  );
};

const openPicker = async (user) => {
  /* The item field is a type-ahead: clicking it opens the suggestions. */
  await user.click(screen.getByRole('combobox'));
  return waitFor(() => screen.getByRole('listbox'));
};

const dialog = () => screen.getByRole('dialog');

describe('creating an item from a document line', () => {
  it('opens the item form, not a second smaller one', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.click(screen.getByRole('button', { name: /Create a new item/ }));

    /* Fields only the real form asks for. */
    expect(within(dialog()).getByText('Basic Details')).toBeInTheDocument();
    expect(within(dialog()).getByLabelText(/Item Name/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText(/Taxability/)).toBeInTheDocument();
  });

  it('says what it is doing', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.click(screen.getByRole('button', { name: /Create a new item/ }));
    /* The dialog renames itself: it is no longer a list to pick from. */
    expect(within(dialog()).getByRole('heading', { name: 'Create Item' })).toBeInTheDocument();
  });

  /* Alt+C is reached by typing a name that is not on file — so that is the
     name the form should already be holding. */
  it('carries the name that had no match into the form', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.type(screen.getByRole('combobox'), 'Copper Wire 2.5sqmm');
    await user.keyboard('{Alt>}c{/Alt}');

    expect(within(dialog()).getByLabelText(/Item Name/)).toHaveValue('Copper Wire 2.5sqmm');
  });

  it('puts the item it just made on the line', async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    render(<Host onPick={picked} />);
    await openPicker(user);
    await user.click(screen.getByRole('button', { name: /Create a new item/ }));

    await user.type(within(dialog()).getByLabelText(/Item Name/), 'Copper Wire');
    await user.click(within(dialog()).getByRole('button', { name: /Create Item|Save Item/ }));

    await waitFor(() => expect(picked).toHaveBeenCalled());
    const [, created] = picked.mock.calls.at(-1);
    expect(created.name).toBe('Copper Wire');
    expect(screen.getByTestId('chosen')).toHaveTextContent(String(created.id));
  });

  it('goes back to the list without making anything', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openPicker(user);
    await user.click(screen.getByRole('button', { name: /Create a new item/ }));
    await user.click(within(dialog()).getByRole('button', { name: /Back to the list/ }));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(within(dialog()).queryByText('Basic Details')).toBeNull();
  });
});
