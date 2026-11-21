import { fireEvent, screen } from '@testing-library/react';

/**
 * Tests: choose an option in a SelectField the way a person does, by opening it and clicking
 * the option by its words. `option` is the visible label, or a RegExp.
 */
export async function pickOption(field, option) {
  fireEvent.click(field);
  fireEvent.click(await screen.findByRole('menuitemradio', { name: option }));
}
