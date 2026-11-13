import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';

import ReaderAllowList, { allowListOf, allowListText } from './ReaderAllowList';

function Harness({ start = '', readerAddresses }) {
  const [v, setV] = useState(start);
  return <ReaderAllowList value={v} onChange={setV} readerAddresses={readerAddresses} />;
}

it('reads the box as one entry per line, commas too, with blanks dropped', () => {
  expect(allowListOf('203.0.113.7\n\n 203.0.113.0/24 , 10.0.0.1\n')).toEqual(['203.0.113.7', '203.0.113.0/24', '10.0.0.1']);
  expect(allowListOf('')).toEqual([]);
  expect(allowListText(['203.0.113.7', '203.0.113.0/24'])).toBe('203.0.113.7\n203.0.113.0/24');
  expect(allowListText(undefined)).toBe('');
});

it('is a labelled field with its help attached, in plain words', () => {
  render(<Harness />);
  const box = screen.getByLabelText('Only accept punches from these network addresses');
  expect(box.tagName).toBe('TEXTAREA');
  const help = document.getElementById(box.getAttribute('aria-describedby'));
  expect(help.textContent).toMatch(/Leave empty to have no such rule/);
  expect(help.textContent).toMatch(/not the reader’s own\s+192\.168/);
});

it('offers the addresses the reader has called from, and adds the ones not listed yet', async () => {
  const user = userEvent.setup();
  render(<Harness start="198.51.100.7" readerAddresses={['198.51.100.7', '198.51.100.42']} />);
  await user.click(screen.getByRole('button', { name: 'Add it to the list' }));
  expect(screen.getByLabelText('Only accept punches from these network addresses').value).toBe('198.51.100.7\n198.51.100.42');
  /* Nothing left to add: the offer goes. */
  expect(screen.queryByRole('button', { name: /Add (it|them) to the list/ })).toBeNull();
});
