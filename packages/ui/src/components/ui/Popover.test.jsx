import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import PopupSelect from '../pickers/PopupSelect';

/**
 * Searching a dropdown accepted exactly one letter.
 *
 * Every caller passes an inline `onClose`, so it was a new function on every
 * render of the page behind the panel — and it sat in the listener effect's
 * dependency list. Each render tore the effect down and re-ran it, and its
 * cleanup restores focus to whatever opened the panel. Typing re-renders, so
 * the caret was thrown back onto the trigger after the first character and
 * every keystroke after it went to the button.
 *
 * This is the regression test for that, driven through a real picker rather
 * than the Popover alone: the bug only appears when something inside the panel
 * causes the render.
 */

const Host = () => {
  const [value, setValue] = useState('');
  return (
    <PopupSelect
      label="Group"
      value={value}
      onChange={setValue}
      options={Array.from({ length: 20 }, (_, i) => ({ value: String(i), label: `Group ${i}` }))}
    />
  );
};

describe('typing in a popover', () => {
  it('keeps every letter, not just the first', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('combobox'));

    const box = await screen.findByPlaceholderText(/search/i);
    await user.type(box, 'group 1');
    expect(box).toHaveValue('group 1');
  });

  it('leaves the caret in the search box while typing', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('combobox'));

    const box = await screen.findByPlaceholderText(/search/i);
    await user.type(box, 'gr');
    expect(document.activeElement).toBe(box);
  });

  it('still closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });

  it('still picks what was searched for', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('combobox'));
    await user.type(await screen.findByPlaceholderText(/search/i), 'Group 7');
    /* The ranked list puts the exact match first; taking it with Enter is the
       path a keyboard user actually walks. */
    await user.keyboard('{Enter}');

    expect(screen.getByRole('combobox')).toHaveTextContent('Group 7');
  });
});
